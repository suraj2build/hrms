/**
 * POST /attendance/regularisation/:id/approve — DEFECT-07 regression
 * (found during the PR #30 live-screen Attendance/Leave UAT, 2026-10-12)
 *
 * A regularisation form always submits both requested_check_in AND
 * requested_check_out, even when only one of the two was genuinely missing
 * (e.g. "forgot checkout" — the employee already has a real IN punch for
 * that day). Approving it used to `.insert()` both rows as a single batch
 * into `attendance_punch_logs`. If either row collided with an existing
 * punch on `uidx_punch_logs_dedup` (tenant_id, employee_id, punched_at,
 * direction), Postgres rejected the WHOLE batch — silently losing the
 * genuinely-new row too, because the error was swallowed. Final attendance
 * then missed a real punch the employee was supposed to get credited for.
 *
 * Fixed by upserting with `{ onConflict: 'tenant_id,employee_id,punched_at,
 * direction', ignoreDuplicates: true }`, so a colliding row is skipped
 * in-place instead of failing the whole statement, and by logging (not
 * swallowing) any remaining error.
 *
 * This test isolates the route's own behavior — approveRegularisation,
 * recomputeRange, and the fire-and-forget event/ledger/orchestrator calls
 * are mocked so only the punch-write call shape is under test.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import Fastify, { type FastifyInstance, type FastifyRequest } from 'fastify'

vi.mock('../../../lib/approval-service.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../lib/approval-service.js')>()
  return { ...actual, approveRegularisation: vi.fn(), rejectRegularisation: vi.fn() }
})
vi.mock('../../../lib/attendance-engine.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../lib/attendance-engine.js')>()
  return { ...actual, recomputeRange: vi.fn().mockResolvedValue(undefined) }
})
vi.mock('../../../lib/event-emitter.js', () => ({ emitEvent: vi.fn().mockResolvedValue(undefined) }))
vi.mock('../../../lib/event-bus.js', () => ({ eventBus: { emit: vi.fn() } }))
vi.mock('../../../lib/ledger-writer.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../lib/ledger-writer.js')>()
  return { ...actual, writeLedgerEntry: vi.fn().mockResolvedValue(undefined) }
})
vi.mock('../../../lib/workforce-orchestrator.js', () => ({
  orchestrateWorkforceEvent: vi.fn().mockResolvedValue(undefined),
}))
vi.mock('../../../lib/idempotency.js', () => ({
  checkIdempotency: vi.fn().mockResolvedValue(null),
  storeIdempotency: vi.fn().mockResolvedValue(undefined),
}))

import regularisationRoutes from '../regularisation.js'
import { approveRegularisation } from '../../../lib/approval-service.js'

const approveRegularisationMock = approveRegularisation as ReturnType<typeof vi.fn>

const TENANT_ID = '00000000-0000-0000-0000-000000000099'
const EMPLOYEE_ID = '00000000-0000-0000-0000-000000000002'
const REG_ID = '00000000-0000-0000-0000-0000000000ab'

function buildMockSupabase(upsertCalls: Array<{ table: string; rows: any[]; opts: any }>) {
  return {
    from(table: string) {
      if (table === 'attendance_punch_logs') {
        const chain: any = {
          upsert: (rows: any[], opts: any) => {
            upsertCalls.push({ table, rows, opts })
            return Promise.resolve({ data: null, error: null })
          },
          // Guard against a regression back to plain insert() — fail loudly
          // if the route ever calls this instead of upsert again.
          insert: () => {
            throw new Error('attendance_punch_logs.insert() called directly — DEFECT-07 regressed (must use upsert with ignoreDuplicates)')
          },
        }
        return chain
      }
      throw new Error(`buildMockSupabase: unexpected table "${table}"`)
    },
  }
}

async function buildApp(upsertCalls: Array<{ table: string; rows: any[]; opts: any }>): Promise<FastifyInstance> {
  const supabase = buildMockSupabase(upsertCalls)
  const app = Fastify({ logger: false })

  app.decorateRequest('tenantId', '')
  app.decorateRequest('userId', '')
  app.decorateRequest('userRole', '')

  app.decorate('authenticate', async (req: FastifyRequest) => {
    ;(req as any).tenantId = TENANT_ID
    ;(req as any).userId   = 'approver-profile-001'
    ;(req as any).userRole = 'hr_admin'
  })

  app.decorate('supabase', supabase as any)

  await app.register(regularisationRoutes)
  await app.ready()
  return app
}

const HEADERS = { authorization: 'Bearer test-token' }

beforeEach(() => {
  vi.clearAllMocks()
})

describe('regularisation approve — punch_logs write (DEFECT-07)', () => {
  it('writes both check-in and check-out via upsert with ignoreDuplicates, not a plain insert', async () => {
    approveRegularisationMock.mockResolvedValue({
      ok: true,
      value: {
        id: REG_ID, employee_id: EMPLOYEE_ID, status: 'approved', date: '2026-10-08',
        requested_check_in:  '2026-10-08T09:00:00.000Z',
        requested_check_out: '2026-10-08T18:00:00.000Z',
      },
    })

    const upsertCalls: Array<{ table: string; rows: any[]; opts: any }> = []
    const app = await buildApp(upsertCalls)

    const res = await app.inject({
      method: 'POST', url: `/attendance/regularisation/${REG_ID}/approve`, headers: HEADERS,
    })

    expect(res.statusCode).toBe(200)
    expect(upsertCalls).toHaveLength(1)
    expect(upsertCalls[0].opts).toEqual({
      onConflict: 'tenant_id,employee_id,punched_at,direction',
      ignoreDuplicates: true,
    })
    expect(upsertCalls[0].rows).toHaveLength(2)
    expect(upsertCalls[0].rows.map((r: any) => r.direction).sort()).toEqual(['IN', 'OUT'])

    await app.close()
  })

  it('a punch write error is logged, not swallowed, and the approval still responds 200', async () => {
    approveRegularisationMock.mockResolvedValue({
      ok: true,
      value: {
        id: REG_ID, employee_id: EMPLOYEE_ID, status: 'approved', date: '2026-10-08',
        requested_check_in:  '2026-10-08T09:00:00.000Z',
        requested_check_out: null,
      },
    })

    const supabase = {
      from(table: string) {
        if (table === 'attendance_punch_logs') {
          return { upsert: () => Promise.resolve({ data: null, error: { message: 'simulated DB error' } }) }
        }
        throw new Error(`unexpected table "${table}"`)
      },
    }

    const app = Fastify({ logger: false })
    app.decorateRequest('tenantId', ''); app.decorateRequest('userId', ''); app.decorateRequest('userRole', '')
    app.decorate('authenticate', async (req: FastifyRequest) => {
      ;(req as any).tenantId = TENANT_ID
      ;(req as any).userId   = 'approver-profile-001'
      ;(req as any).userRole = 'hr_admin'
    })
    app.decorate('supabase', supabase as any)
    await app.register(regularisationRoutes)
    await app.ready()

    const warnSpy = vi.spyOn(app.log, 'warn')
    const res = await app.inject({
      method: 'POST', url: `/attendance/regularisation/${REG_ID}/approve`, headers: HEADERS,
    })

    expect(res.statusCode).toBe(200)
    expect(warnSpy).toHaveBeenCalledWith(
      expect.objectContaining({ err: expect.objectContaining({ message: 'simulated DB error' }) }),
      'punch_logs insert failed after regularisation approval',
    )

    await app.close()
  })
})

describe('regularisation bulk-approve — punch_logs write (DEFECT-07, same fix in the bulk path)', () => {
  it('writes punches via upsert with ignoreDuplicates for each approved id in the batch', async () => {
    const REG_ID_2 = '00000000-0000-0000-0000-0000000000ac'
    approveRegularisationMock.mockImplementation(async (_supabase: any, args: any) => ({
      ok: true,
      value: {
        id: args.regularisationId, employee_id: EMPLOYEE_ID, status: 'approved', date: '2026-10-08',
        requested_check_in:  '2026-10-08T09:00:00.000Z',
        requested_check_out: '2026-10-08T18:00:00.000Z',
      },
    }))

    const upsertCalls: Array<{ table: string; rows: any[]; opts: any }> = []
    const app = await buildApp(upsertCalls)

    const res = await app.inject({
      method: 'POST', url: '/attendance/regularisation/bulk-approve', headers: HEADERS,
      payload: { ids: [REG_ID, REG_ID_2] },
    })

    expect(res.statusCode).toBe(200)
    const body = JSON.parse(res.body)
    expect(body.summary).toEqual({ approved: 2, failed: 0, total: 2 })

    expect(upsertCalls).toHaveLength(2)
    for (const call of upsertCalls) {
      expect(call.opts).toEqual({
        onConflict: 'tenant_id,employee_id,punched_at,direction',
        ignoreDuplicates: true,
      })
      expect(call.rows).toHaveLength(2)
    }

    await app.close()
  })
})
