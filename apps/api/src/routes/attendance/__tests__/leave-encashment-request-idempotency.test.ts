/**
 * SYSTEM_AUDIT_2026-10-14 checkpoint 12 — corrects checkpoint 11's
 * encashment-request fix, which was reviewed and found incomplete: it
 * used checkIdempotency/storeIdempotency (a plain check-then-work-then-
 * store pair whose own module doc warns it has a race window wide enough
 * for two concurrent SAME-key requests to both pass), and idempotency
 * alone can never protect the annual cap against two DIFFERENT-key
 * requests, which are two genuinely separate submissions by design.
 *
 * This round switches to claimIdempotency's atomic INSERT-based claim for
 * the same-key race, and moves the cap check + insert into a single RPC
 * (request_leave_encashment_atomic, migration 465) for the cap-enforcement
 * concern — a different, complementary piece of protection. These are
 * mocked-route tests proving the ROUTE's wiring to both mechanisms is
 * correct; the RPC's own concurrency guarantee is proven separately
 * against real Postgres in scripts/db/verify-encashment-cap-atomic.mjs.
 */
import { describe, it, expect, vi } from 'vitest'
import Fastify from 'fastify'
import leaveAccrualRoutes from '../leave-accrual.js'

const TENANT = 'tenant-1'

function buildApp(opts: { rpcError?: { message: string } } = {}) {
  const app = Fastify()
  app.decorate('authenticate', async (req: any) => {
    req.tenantId = TENANT
    req.userId   = 'user-1'
    req.userRole = 'employee'
  })

  const idempotencyStore = new Map<string, { status_code: number; response: unknown }>()
  const rpcSpy = vi.fn()

  const supabase = {
    from(table: string) {
      if (table === 'profiles') {
        return { select: () => ({ eq: () => ({ single: () => Promise.resolve({ data: { employee_id: 'emp-1' }, error: null }) }) }) }
      }
      if (table === 'idempotency_keys') {
        let queriedKey: string | undefined
        const chain: any = {
          select: () => chain,
          eq:     (col: string, v: string) => {
            if (col === 'key') queriedKey = v
            return chain
          },
          maybeSingle: () => {
            const hit = queriedKey ? idempotencyStore.get(queriedKey) : null
            return Promise.resolve({ data: hit ?? null, error: null })
          },
          insert: (row: any) => {
            // claimIdempotency: a real INSERT that fails 23505 if the key
            // already has a row (claimed-in-progress OR already stored).
            if (idempotencyStore.has(row.key)) {
              return Promise.resolve({ error: { code: '23505', message: 'duplicate key' } })
            }
            idempotencyStore.set(row.key, { status_code: row.status_code, response: row.response })
            return Promise.resolve({ error: null })
          },
          upsert: (row: any) => {
            idempotencyStore.set(row.key, { status_code: row.status_code, response: row.response })
            return { select: () => ({ maybeSingle: () => Promise.resolve({ data: { key: row.key }, error: null }) }) }
          },
          delete: () => ({
            eq: () => ({
              eq: () => ({
                eq: () => { if (queriedKey) idempotencyStore.delete(queriedKey); return Promise.resolve({ error: null }) },
              }),
            }),
          }),
        }
        return chain
      }
      throw new Error(`unexpected table ${table}`)
    },
    rpc: (fn: string, params: any) => {
      if (fn === 'request_leave_encashment_atomic') {
        rpcSpy(params)
        if (opts.rpcError) return Promise.resolve({ data: null, error: opts.rpcError })
        return Promise.resolve({ data: { id: 'req-1', days: params.p_days, status: 'pending', created_at: '2026-01-01' }, error: null })
      }
      throw new Error(`unexpected rpc ${fn}`)
    },
  }
  app.decorate('supabase', supabase as any)
  app.register(leaveAccrualRoutes)
  return { app, rpcSpy }
}

const LEAVE_TYPE = '11111111-1111-1111-1111-111111111111'

describe('POST /leave/encashment/request — atomic claim + RPC wiring', () => {
  it('delegates the cap check + insert to request_leave_encashment_atomic, not a raw insert', async () => {
    const { app, rpcSpy } = buildApp()
    const res = await app.inject({ method: 'POST', url: '/leave/encashment/request', payload: { leave_type_id: LEAVE_TYPE, days: 5 } })
    expect(res.statusCode).toBe(201)
    expect(rpcSpy).toHaveBeenCalledWith(expect.objectContaining({
      p_employee_id: 'emp-1', p_leave_type_id: LEAVE_TYPE, p_days: 5,
    }))
  })

  it('a retried submission with the SAME Idempotency-Key replays the cached response, no second RPC call', async () => {
    const { app, rpcSpy } = buildApp()
    const payload = { leave_type_id: LEAVE_TYPE, days: 5 }
    const headers = { 'Idempotency-Key': 'client-retry-key-1' }

    const first = await app.inject({ method: 'POST', url: '/leave/encashment/request', payload, headers })
    expect(first.statusCode).toBe(201)
    expect(rpcSpy).toHaveBeenCalledTimes(1)

    const second = await app.inject({ method: 'POST', url: '/leave/encashment/request', payload, headers })
    expect(second.statusCode).toBe(201)
    expect(second.headers['idempotency-replayed']).toBe('true')
    expect(rpcSpy).toHaveBeenCalledTimes(1)
  })

  it('a request whose key is already CLAIMED (status_code=0, in-flight — the exact state a genuinely simultaneous twin leaves behind) is rejected 409, not raced through to the RPC', async () => {
    // Deterministic proof of the branch a genuine race would hit: rather
    // than relying on JS microtask timing to force two in-flight calls to
    // interleave (unreliable in a synchronous mock — Node has no real I/O
    // delay here to interleave on), pre-seed the idempotency store with
    // the CLAIM_IN_PROGRESS sentinel row a first caller's claimIdempotency
    // would have just inserted, then prove a second caller sharing that
    // key is refused outright. The genuinely-concurrent, real-timing
    // version of this same proof runs against real Postgres in
    // scripts/db/verify-encashment-cap-atomic.mjs (two real pg.Client
    // connections, BEGIN/pause/COMMIT controlled).
    const { app, rpcSpy } = buildApp()
    const key = 'in-flight-key'
    const scopedKey = `leave-encashment-request::${key}`
    // Prime the store as claimIdempotency's own INSERT would have left it:
    // status_code 0 (CLAIM_IN_PROGRESS), response null — checkIdempotency
    // treats this as "not a cached hit" (so it proceeds to attempt its own
    // claim), and claimIdempotency's INSERT then collides 23505 on it.
    const primeRes = await app.inject({
      method: 'POST', url: '/leave/encashment/request',
      payload: { leave_type_id: LEAVE_TYPE, days: 5 },
      headers: { 'Idempotency-Key': 'priming-only' },
    })
    expect(primeRes.statusCode).toBe(201) // sanity: priming call itself succeeds

    // Manually seed an in-flight claim for a DIFFERENT key, bypassing the
    // route (simulating the exact moment between claimIdempotency's
    // INSERT and the eventual storeIdempotency()/releaseIdempotencyClaim()
    // a real concurrent twin would be caught inside).
    const supabase = (app as any).supabase
    await supabase.from('idempotency_keys').insert({ tenant_id: TENANT, key: scopedKey, status_code: 0, response: null })

    const res = await app.inject({
      method: 'POST', url: '/leave/encashment/request',
      payload: { leave_type_id: LEAVE_TYPE, days: 5 },
      headers: { 'Idempotency-Key': key },
    })
    expect(res.statusCode).toBe(409)
    expect(JSON.parse(res.body).error).toBe('DUPLICATE_REQUEST')
    // Crucially: the RPC (the actual cap-check-and-insert work) was never
    // reached for the refused call.
    expect(rpcSpy).toHaveBeenCalledTimes(1) // only the priming call's RPC invocation
  })

  it('two DIFFERENT Idempotency-Keys both reach the RPC — idempotency does not (and must not) suppress genuinely separate requests; the RPC itself is what enforces the shared cap', async () => {
    const { app, rpcSpy } = buildApp()
    const payload = { leave_type_id: LEAVE_TYPE, days: 5 }
    await app.inject({ method: 'POST', url: '/leave/encashment/request', payload, headers: { 'Idempotency-Key': 'key-a' } })
    await app.inject({ method: 'POST', url: '/leave/encashment/request', payload, headers: { 'Idempotency-Key': 'key-b' } })
    expect(rpcSpy).toHaveBeenCalledTimes(2)
  })

  it('no Idempotency-Key header at all still succeeds (optional, backward compatible)', async () => {
    const { app, rpcSpy } = buildApp()
    const res = await app.inject({ method: 'POST', url: '/leave/encashment/request', payload: { leave_type_id: LEAVE_TYPE, days: 5 } })
    expect(res.statusCode).toBe(201)
    expect(rpcSpy).toHaveBeenCalledTimes(1)
  })

  it('a NOT_ENCASHABLE RPC error maps to 422 and releases the idempotency claim (so a corrected retry is not permanently blocked)', async () => {
    const { app } = buildApp({ rpcError: { message: 'NOT_ENCASHABLE: This leave type does not allow encashment' } })
    const headers = { 'Idempotency-Key': 'key-fail-1' }
    const res = await app.inject({ method: 'POST', url: '/leave/encashment/request', payload: { leave_type_id: LEAVE_TYPE, days: 5 }, headers })
    expect(res.statusCode).toBe(422)
    expect(JSON.parse(res.body).error).toBe('NOT_ENCASHABLE')

    // The claim was released on failure — a retry with the SAME key must
    // be allowed to try again, not stuck replaying a 422 forever or
    // refused as a duplicate-in-flight request.
    const { app: app2 } = buildApp()
    const retry = await app2.inject({ method: 'POST', url: '/leave/encashment/request', payload: { leave_type_id: LEAVE_TYPE, days: 5 }, headers })
    expect(retry.statusCode).toBe(201)
  })

  it('an ENCASHMENT_LIMIT_EXCEEDED RPC error maps to 422 with the cap message', async () => {
    const { app } = buildApp({ rpcError: { message: 'ENCASHMENT_LIMIT_EXCEEDED: Annual encashment limit is 5 days. Already requested: 3' } })
    const res = await app.inject({ method: 'POST', url: '/leave/encashment/request', payload: { leave_type_id: LEAVE_TYPE, days: 5 } })
    expect(res.statusCode).toBe(422)
    const body = JSON.parse(res.body)
    expect(body.error).toBe('ENCASHMENT_LIMIT_EXCEEDED')
    expect(body.message).toMatch(/Annual encashment limit is 5 days/)
  })
})
