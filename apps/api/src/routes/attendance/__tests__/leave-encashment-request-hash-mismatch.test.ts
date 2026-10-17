/**
 * SYSTEM_AUDIT_2026-10-14 checkpoint 13 — "test same-key reuse with a
 * different payload and retry after a committed request whose HTTP
 * response was lost."
 *
 * checkIdempotency replays whatever was stored under a key purely by
 * (tenant_id, key) lookup, with no comparison against the current request
 * body. A client that reuses an Idempotency-Key across two meaningfully
 * different submissions (a genuine bug, or an accidental key collision)
 * would otherwise silently get back the FIRST request's result describing
 * a DIFFERENT request than the one it just sent — and the second request
 * is dropped without ever being inserted or reported as refused.
 *
 * These tests prove the route-level fix: hashIdempotencyPayload fingerprints
 * the normalized body; getStoredRequestHash is checked BEFORE
 * checkIdempotency's replay path, and a mismatch is refused with 409
 * IDEMPOTENCY_KEY_REUSED rather than replayed or silently reprocessed.
 * They also prove the orthogonal, already-intended case still works:
 * genuine retry (same key, same payload) after a request that fully
 * committed — simulating a client that never saw the HTTP response — still
 * returns the exact cached result, no second RPC call.
 */
import { describe, it, expect, vi } from 'vitest'
import Fastify from 'fastify'
import leaveAccrualRoutes from '../leave-accrual.js'

const TENANT = 'tenant-1'
const LEAVE_TYPE = '11111111-1111-1111-1111-111111111111'

function buildApp(opts: { rpcError?: { message: string } } = {}) {
  const app = Fastify()
  app.decorate('authenticate', async (req: any) => {
    req.tenantId = TENANT
    req.userId   = 'user-1'
    req.userRole = 'employee'
  })

  // Full-fidelity idempotency_keys mock: carries request_hash through
  // insert/upsert/select, unlike the simpler mock in the sibling
  // claim/RPC-wiring test file (which never exercises hashing).
  const idempotencyStore = new Map<string, { status_code: number; response: unknown; request_hash?: string | null }>()
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
            if (idempotencyStore.has(row.key)) {
              return Promise.resolve({ error: { code: '23505', message: 'duplicate key' } })
            }
            idempotencyStore.set(row.key, { status_code: row.status_code, response: row.response, request_hash: row.request_hash ?? null })
            return Promise.resolve({ error: null })
          },
          upsert: (row: any) => {
            idempotencyStore.set(row.key, { status_code: row.status_code, response: row.response, request_hash: row.request_hash ?? null })
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
  return { app, rpcSpy, idempotencyStore }
}

describe('POST /leave/encashment/request — idempotency-key payload-fingerprint mismatch', () => {
  it('same key, DIFFERENT payload on the second call → 409 IDEMPOTENCY_KEY_REUSED, no second RPC call, first result not replayed', async () => {
    const { app, rpcSpy } = buildApp()
    const headers = { 'Idempotency-Key': 'reused-key-1' }

    const first = await app.inject({
      method: 'POST', url: '/leave/encashment/request',
      payload: { leave_type_id: LEAVE_TYPE, days: 5 }, headers,
    })
    expect(first.statusCode).toBe(201)
    expect(rpcSpy).toHaveBeenCalledTimes(1)

    const second = await app.inject({
      method: 'POST', url: '/leave/encashment/request',
      payload: { leave_type_id: LEAVE_TYPE, days: 2 }, // different days — different payload, same key
      headers,
    })
    expect(second.statusCode).toBe(409)
    expect(JSON.parse(second.body).error).toBe('IDEMPOTENCY_KEY_REUSED')
    // Not replayed as the first request's result, and not silently processed either.
    expect(second.headers['idempotency-replayed']).toBeUndefined()
    expect(rpcSpy).toHaveBeenCalledTimes(1)
  })

  it('same key, same payload but different KEY ORDERING in the JSON body → still recognized as the same request (canonicalized hash), replays normally', async () => {
    const { app, rpcSpy } = buildApp()
    const headers = { 'Idempotency-Key': 'reused-key-2' }

    const first = await app.inject({
      method: 'POST', url: '/leave/encashment/request',
      payload: { leave_type_id: LEAVE_TYPE, days: 5, notes: 'year end' }, headers,
    })
    expect(first.statusCode).toBe(201)

    // zod's safeParse always re-serializes to the same key order regardless
    // of request body ordering, so this proves the hash is computed from
    // the PARSED/normalized data, not raw body bytes.
    const second = await app.inject({
      method: 'POST', url: '/leave/encashment/request',
      payload: { notes: 'year end', days: 5, leave_type_id: LEAVE_TYPE }, headers,
    })
    expect(second.statusCode).toBe(201)
    expect(second.headers['idempotency-replayed']).toBe('true')
    expect(rpcSpy).toHaveBeenCalledTimes(1)
  })

  it('retry with the SAME key and SAME payload after a request that fully committed (simulating a lost HTTP response) replays the exact cached result — the orthogonal, already-intended case is unaffected by the new hash check', async () => {
    const { app, rpcSpy } = buildApp()
    const payload = { leave_type_id: LEAVE_TYPE, days: 3 }
    const headers = { 'Idempotency-Key': 'lost-response-key' }

    const committed = await app.inject({ method: 'POST', url: '/leave/encashment/request', payload, headers })
    expect(committed.statusCode).toBe(201)
    const committedBody = JSON.parse(committed.body)

    // Client never saw `committed`'s response (dropped connection) and retries.
    const retry = await app.inject({ method: 'POST', url: '/leave/encashment/request', payload, headers })
    expect(retry.statusCode).toBe(201)
    expect(retry.headers['idempotency-replayed']).toBe('true')
    expect(JSON.parse(retry.body)).toEqual(committedBody)
    expect(rpcSpy).toHaveBeenCalledTimes(1) // never double-submitted to the RPC
  })

  it('a key stored by a hash-naive legacy row (request_hash absent) is unaffected — treated as no stored hash, replays as before', async () => {
    const { app, rpcSpy, idempotencyStore } = buildApp()
    const key = 'legacy-key'
    const scopedKey = `leave-encashment-request::${key}`
    // Simulate a row written before this fix existed: no request_hash field at all.
    idempotencyStore.set(scopedKey, { status_code: 201, response: { data: { id: 'legacy-req', days: 5 } } })

    const res = await app.inject({
      method: 'POST', url: '/leave/encashment/request',
      payload: { leave_type_id: LEAVE_TYPE, days: 5 },
      headers: { 'Idempotency-Key': key },
    })
    expect(res.statusCode).toBe(201)
    expect(res.headers['idempotency-replayed']).toBe('true')
    expect(JSON.parse(res.body)).toEqual({ data: { id: 'legacy-req', days: 5 } })
    expect(rpcSpy).not.toHaveBeenCalled()
  })
})
