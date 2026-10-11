/**
 * PATCH /probation-confirmations/:id/decide — HR decision tests.
 *
 * GET /probation-confirmations (plain select + mapping) is covered loosely
 * by the happy-path list test; most of the coverage here is the decide
 * route's state-machine guards, since that's where a wrong decision would
 * silently stamp a confirmation date onto the wrong job_history row or let
 * an already-decided cycle be re-decided.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import Fastify, { type FastifyInstance, type FastifyRequest } from 'fastify'

import probationConfirmationsRoutes from '../probation-confirmations.js'

const TENANT_ID = '00000000-0000-0000-0000-000000000099'
const CYCLE_ID  = '00000000-0000-0000-0000-000000000011'
const EMPLOYEE_ID = '00000000-0000-0000-0000-000000000022'
const JOB_HISTORY_ID = '00000000-0000-0000-0000-000000000033'

function cycleRow(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: CYCLE_ID, employee_id: EMPLOYEE_ID, job_history_id: JOB_HISTORY_ID,
    status: 'pending_hr', version: 1,
    ...overrides,
  }
}

function buildMockSupabase(opts: {
  cycle?: ReturnType<typeof cycleRow> | null
  updateResult?: Record<string, unknown> | null
  jobHistory?: Record<string, unknown> | null
} = {}) {
  const cycle = opts.cycle === undefined ? cycleRow() : opts.cycle
  const jobHistoryUpdateSpy = vi.fn().mockResolvedValue({ error: null })

  const supabase = {
    from(table: string) {
      if (table === 'probation_confirmations') {
        const chain: any = {
          select: () => chain,
          update: () => chain,
          eq:     () => chain,
          maybeSingle: () => Promise.resolve({ data: cycle, error: null }),
        }
        // Distinguish the initial fetch (select) from the update+select —
        // both chain the same eq()s, so branch on whether update() was called.
        let isUpdate = false
        chain.update = (payload: any) => { isUpdate = true; chain._payload = payload; return chain }
        chain.maybeSingle = () => {
          if (isUpdate) {
            return Promise.resolve({
              data: opts.updateResult === undefined ? { ...cycle, ...chain._payload } : opts.updateResult,
              error: null,
            })
          }
          return Promise.resolve({ data: cycle, error: null })
        }
        return chain
      }
      if (table === 'job_history') {
        const chain: any = {
          select: () => chain,
          eq:     () => chain,
          update: (payload: any) => { jobHistoryUpdateSpy(payload); return chain },
          maybeSingle: () => Promise.resolve({
            data: opts.jobHistory === undefined
              ? { id: JOB_HISTORY_ID, is_current: true, employment_type: 'probation', confirmation_date: null }
              : opts.jobHistory,
            error: null,
          }),
          then: (resolve: (v: unknown) => void) => resolve({ error: null }),
        }
        return chain
      }
      if (table === 'audit_logs') {
        return { insert: () => Promise.resolve({ error: null }) }
      }
      throw new Error(`buildMockSupabase: unexpected table "${table}"`)
    },
  }
  return { supabase, jobHistoryUpdateSpy }
}

async function buildApp(opts: Parameters<typeof buildMockSupabase>[0] = {}) {
  const { supabase, jobHistoryUpdateSpy } = buildMockSupabase(opts)
  const app = Fastify({ logger: false })

  app.decorateRequest('tenantId', '')
  app.decorateRequest('userId', '')
  app.decorateRequest('userRole', '')

  app.decorate('authenticate', async (req: FastifyRequest) => {
    ;(req as any).tenantId = TENANT_ID
    ;(req as any).userId   = 'hr-admin-001'
    ;(req as any).userRole = 'hr_admin'
  })
  app.decorate('supabase', supabase as any)

  await app.register(probationConfirmationsRoutes)
  await app.ready()
  return { app, jobHistoryUpdateSpy }
}

const HEADERS = { 'content-type': 'application/json', authorization: 'Bearer test-token' }

beforeEach(() => { vi.clearAllMocks() })

describe('PATCH /probation-confirmations/:id/decide', () => {
  it('confirm: sets job_history.confirmation_date when the row is still current + probation + unconfirmed', async () => {
    const { app, jobHistoryUpdateSpy } = await buildApp()

    const res = await app.inject({
      method: 'PATCH', url: `/probation-confirmations/${CYCLE_ID}/decide`, headers: HEADERS,
      payload: { decision: 'confirm' },
    })

    expect(res.statusCode).toBe(200)
    expect(jobHistoryUpdateSpy).toHaveBeenCalledWith(
      expect.objectContaining({ confirmation_date: expect.any(String) }),
    )
    await app.close()
  })

  it('confirm: does NOT touch job_history when it is no longer the current row (promoted/role-changed since recommendation)', async () => {
    const { app, jobHistoryUpdateSpy } = await buildApp({
      jobHistory: { id: JOB_HISTORY_ID, is_current: false, employment_type: 'probation', confirmation_date: null },
    })

    const res = await app.inject({
      method: 'PATCH', url: `/probation-confirmations/${CYCLE_ID}/decide`, headers: HEADERS,
      payload: { decision: 'confirm' },
    })

    expect(res.statusCode).toBe(200)
    expect(jobHistoryUpdateSpy).not.toHaveBeenCalled()
    await app.close()
  })

  it('extend: requires extended_to_date — 400 without it', async () => {
    const { app } = await buildApp()

    const res = await app.inject({
      method: 'PATCH', url: `/probation-confirmations/${CYCLE_ID}/decide`, headers: HEADERS,
      payload: { decision: 'extend' },
    })

    expect(res.statusCode).toBe(400)
  })

  it('extend: succeeds with extended_to_date, job_history is never touched', async () => {
    const { app, jobHistoryUpdateSpy } = await buildApp()

    const res = await app.inject({
      method: 'PATCH', url: `/probation-confirmations/${CYCLE_ID}/decide`, headers: HEADERS,
      payload: { decision: 'extend', extended_to_date: '2099-01-01' },
    })

    expect(res.statusCode).toBe(200)
    expect(jobHistoryUpdateSpy).not.toHaveBeenCalled()
    await app.close()
  })

  it('already-decided cycle (status != pending_hr) → 409, no update attempted', async () => {
    const { app, jobHistoryUpdateSpy } = await buildApp({ cycle: cycleRow({ status: 'confirmed' }) })

    const res = await app.inject({
      method: 'PATCH', url: `/probation-confirmations/${CYCLE_ID}/decide`, headers: HEADERS,
      payload: { decision: 'confirm' },
    })

    expect(res.statusCode).toBe(409)
    expect(jobHistoryUpdateSpy).not.toHaveBeenCalled()
    await app.close()
  })

  it('version conflict — update matches 0 rows → 409 VERSION_CONFLICT', async () => {
    const { app } = await buildApp({ updateResult: null })

    const res = await app.inject({
      method: 'PATCH', url: `/probation-confirmations/${CYCLE_ID}/decide`, headers: HEADERS,
      payload: { decision: 'confirm', expected_version: 1 },
    })

    expect(res.statusCode).toBe(409)
    const body = JSON.parse(res.body)
    expect(body.error).toBe('VERSION_CONFLICT')
  })

  it('cycle not found → 404', async () => {
    const { app } = await buildApp({ cycle: null })

    const res = await app.inject({
      method: 'PATCH', url: `/probation-confirmations/${CYCLE_ID}/decide`, headers: HEADERS,
      payload: { decision: 'confirm' },
    })

    expect(res.statusCode).toBe(404)
  })
})
