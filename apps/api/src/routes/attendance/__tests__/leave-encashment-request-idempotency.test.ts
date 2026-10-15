/**
 * SYSTEM_AUDIT_2026-10-14 checkpoint 10+1 — POST /leave/encashment/request
 * read the annual-cap sum then inserted with no idempotency protection,
 * unlike the sibling /leave/accrual/run route in the same file. A
 * double-click or client retry could submit two requests that each pass
 * the cap check and later both get approved, exceeding the configured
 * annual cap. This test proves an Idempotency-Key now makes a retried
 * submission a pure replay (no second insert), matching the established
 * pattern already proven for /leave/accrual/run.
 */
import { describe, it, expect, vi } from 'vitest'
import Fastify from 'fastify'
import leaveAccrualRoutes from '../leave-accrual.js'

const TENANT = 'tenant-1'

function buildApp() {
  const app = Fastify()
  app.decorate('authenticate', async (req: any) => {
    req.tenantId = TENANT
    req.userId   = 'user-1'
    req.userRole = 'employee'
  })

  const idempotencyStore = new Map<string, { status_code: number; response: unknown }>()
  const insertSpy = vi.fn()

  const supabase = {
    from(table: string) {
      if (table === 'profiles') {
        return { select: () => ({ eq: () => ({ single: () => Promise.resolve({ data: { employee_id: 'emp-1' }, error: null }) }) }) }
      }
      if (table === 'leave_accrual_rules') {
        return {
          select: () => ({
            eq: () => ({
              eq: () => ({
                eq: () => ({
                  maybeSingle: () => Promise.resolve({ data: { encashable: true, max_encashable_per_year: 10 }, error: null }),
                }),
              }),
            }),
          }),
        }
      }
      if (table === 'leave_encashment_requests') {
        const selectChain: any = {
          select: () => selectChain,
          eq:     () => selectChain,
          not:    () => Promise.resolve({ data: [], error: null }), // no prior encashment this year
        }
        return {
          select: () => selectChain,
          insert: (payload: any) => {
            insertSpy(payload)
            return {
              select: () => ({
                single: () => Promise.resolve({ data: { id: 'req-1', days: payload.days, status: 'pending', created_at: '2026-01-01' }, error: null }),
              }),
            }
          },
        }
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
          upsert: (row: any) => {
            idempotencyStore.set(row.key, { status_code: row.status_code, response: row.response })
            return { select: () => ({ maybeSingle: () => Promise.resolve({ data: { key: row.key }, error: null }) }) }
          },
        }
        return chain
      }
      throw new Error(`unexpected table ${table}`)
    },
  }
  app.decorate('supabase', supabase as any)
  app.register(leaveAccrualRoutes)
  return { app, insertSpy }
}

describe('POST /leave/encashment/request — idempotency', () => {
  it('a retried submission with the SAME Idempotency-Key replays the cached response, no second insert', async () => {
    const { app, insertSpy } = buildApp()
    const payload = { leave_type_id: '11111111-1111-1111-1111-111111111111', days: 5 }
    const headers = { 'Idempotency-Key': 'client-retry-key-1' }

    const first = await app.inject({ method: 'POST', url: '/leave/encashment/request', payload, headers })
    expect(first.statusCode).toBe(201)
    expect(insertSpy).toHaveBeenCalledTimes(1)

    const second = await app.inject({ method: 'POST', url: '/leave/encashment/request', payload, headers })
    expect(second.statusCode).toBe(201)
    expect(second.headers['idempotency-replayed']).toBe('true')
    // The key proof: the retried call did NOT insert a second row — the
    // exact gap this round's fix closes (previously, no idempotency check
    // existed at all, so a retry always inserted again).
    expect(insertSpy).toHaveBeenCalledTimes(1)
  })

  it('two DIFFERENT Idempotency-Keys (two genuinely separate requests) both insert — unaffected', async () => {
    const { app, insertSpy } = buildApp()
    const payload = { leave_type_id: '11111111-1111-1111-1111-111111111111', days: 5 }

    await app.inject({ method: 'POST', url: '/leave/encashment/request', payload, headers: { 'Idempotency-Key': 'key-a' } })
    await app.inject({ method: 'POST', url: '/leave/encashment/request', payload, headers: { 'Idempotency-Key': 'key-b' } })
    expect(insertSpy).toHaveBeenCalledTimes(2)
  })

  it('no Idempotency-Key header at all still succeeds (optional, backward compatible)', async () => {
    const { app, insertSpy } = buildApp()
    const payload = { leave_type_id: '11111111-1111-1111-1111-111111111111', days: 5 }
    const res = await app.inject({ method: 'POST', url: '/leave/encashment/request', payload })
    expect(res.statusCode).toBe(201)
    expect(insertSpy).toHaveBeenCalledTimes(1)
  })
})
