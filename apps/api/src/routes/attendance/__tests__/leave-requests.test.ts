/**
 * Leave approval → leave_accrual_ledger integration tests
 *
 * The actual ledger INSERT (accrual_type 'consumption' on approve, 'reversal'
 * on cancel-approved) lives inside two Postgres SECURITY DEFINER RPCs
 * (approve_leave_request_atomic / reverse_leave_request_atomic), not in JS —
 * status UPDATE + balance deduction + ledger write happen in one DB
 * transaction. These tests drive the real POST /leave-requests/:id/approve
 * and /leave-requests/:id/cancel-approved route handlers via Fastify
 * app.inject() and assert what the JS layer controls: that the RPC is
 * invoked with the correct parameters (the only way to reach the ledger
 * write from this side), that RPC errors abort cleanly with no side effect,
 * and that the app-layer guards which make reversal idempotent and safe are
 * enforced. The RPC's own SQL (the INSERT, its ON CONFLICT DO NOTHING
 * idempotency, and the CHECK constraint) is not exercised here — that
 * requires a real Postgres connection, a different test tier than the rest
 * of this repo's route-level tests.
 *
 * Scenarios covered:
 *   Approve:
 *     1. Happy path — paid leave, PENDING → RPC called with correct params, 200
 *     2. Unpaid leave — p_is_paid: false passed through (ledger gating is SQL-side)
 *     3. RPC error (CONFLICT) — structured error returned, no event published
 *     4. Post-transaction non-fatal failure — recomputeRange rejects, route still 200
 *        (approval already committed in the RPC; this is documented, not a bug)
 *     5. Status pre-check — already-APPROVED request → 409, RPC never called
 *     6. Period-lock guard — locked month → 409, RPC never called
 *   Reverse (cancel-approved):
 *     7. Happy path — APPROVED, future-dated → RPC called with correct params, 200
 *     8. Idempotency — reversing twice: second call's status pre-check (now
 *        CANCELLED) rejects with 409 before the RPC is invoked a second time
 *     9. Self-approval guard — reversing your own approval → 403, RPC never called
 *     10. Elapsed-range guard — leave already started → 409, RPC never called
 *
 * What is NOT tested here:
 *   - The RPC's own SQL (ledger INSERT, ON CONFLICT idempotency, CHECK constraint)
 *   - Multi-level approval chains (gateApprove's 'advanced'/chain path — mocked
 *     to always return the no-chain legacy 'finalize' decision)
 *   - Manager-based authorization (validateApprover's employees/profiles lookup —
 *     all tests here act as hr_admin, which short-circuits that check)
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import Fastify, { type FastifyInstance, type FastifyRequest } from 'fastify'

// ── Mock the collaborators approval-service.ts pulls in, keep the route +
// approval-service.ts themselves real. vi.mock is hoisted above these imports
// by vitest, so it intercepts resolution before leave-requests.ts loads.

vi.mock('../../../lib/leave-request-service.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../lib/leave-request-service.js')>()
  return { ...actual, getLeaveRequest: vi.fn() }
})
vi.mock('../../../lib/period-lock.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../lib/period-lock.js')>()
  return { ...actual, getLockedMonths: vi.fn().mockResolvedValue(new Set()) }
})
vi.mock('../../../lib/approval-orchestrator.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../lib/approval-orchestrator.js')>()
  return { ...actual, gateApprove: vi.fn().mockResolvedValue({ kind: 'finalize', authorized: false }) }
})
vi.mock('../../../lib/approval-guards.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../lib/approval-guards.js')>()
  return { ...actual, isSelfApproval: vi.fn().mockResolvedValue(false) }
})
vi.mock('../../../lib/attendance-engine.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../lib/attendance-engine.js')>()
  return {
    ...actual,
    recomputeRange: vi.fn().mockResolvedValue(undefined),
    fetchTenantTz:  vi.fn().mockResolvedValue('Asia/Kolkata'),
  }
})
vi.mock('../../../lib/leave-engine.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../lib/leave-engine.js')>()
  return { ...actual, validateBalance: vi.fn().mockResolvedValue({ valid: true, currentBalance: 100 }) }
})
vi.mock('../../../lib/leave-policy-service.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../lib/leave-policy-service.js')>()
  // Default: no resolvable policy rule — every existing test in this file
  // predates PEND-94 and asserts nothing about policy_mismatch, so this
  // must resolve to a no-op (policyMismatch stays false) unless a test
  // overrides it.
  return { ...actual, resolveEffectivePolicyRule: vi.fn().mockResolvedValue(null) }
})

import leaveRequestsRoutes from '../leave-requests.js'
import { getLeaveRequest }  from '../../../lib/leave-request-service.js'
import { getLockedMonths }  from '../../../lib/period-lock.js'
import { isSelfApproval }   from '../../../lib/approval-guards.js'
import { recomputeRange }   from '../../../lib/attendance-engine.js'
import { resolveEffectivePolicyRule } from '../../../lib/leave-policy-service.js'

const getLeaveRequestMock = getLeaveRequest as ReturnType<typeof vi.fn>
const getLockedMonthsMock = getLockedMonths as ReturnType<typeof vi.fn>
const isSelfApprovalMock  = isSelfApproval  as ReturnType<typeof vi.fn>
const recomputeRangeMock  = recomputeRange  as ReturnType<typeof vi.fn>
const resolveEffectivePolicyRuleMock = resolveEffectivePolicyRule as ReturnType<typeof vi.fn>

// ── Fixtures ─────────────────────────────────────────────────────────────────

const TENANT_ID = 'tenant-test-001'
const REQUEST_ID = 'leave-req-001'

function leaveRequestRow(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id:              REQUEST_ID,
    tenant_id:       TENANT_ID,
    employee_id:     'emp-001',
    leave_type_id:   'lt-annual',
    from_date:       '2099-06-10',
    to_date:         '2099-06-12',
    computed_days:   3,
    half_day:        false,
    session:         'full_day',
    hours_requested: null,
    status:          'PENDING',
    reason:          'Family trip',
    rejection_reason: null,
    requested_by:    'emp-001',
    approved_by:     null,
    approved_at:     null,
    created_at:      '2099-05-01T00:00:00.000Z',
    updated_at:      '2099-05-01T00:00:00.000Z',
    leave_types:     { id: 'lt-annual', name: 'Annual Leave', is_paid: true, allow_sandwich: true },
    ...overrides,
  }
}

function okResult(row: ReturnType<typeof leaveRequestRow>) {
  return { ok: true, value: row }
}

// ── Supabase mock ────────────────────────────────────────────────────────────
// Only the tables/RPCs this route path still calls directly need a shape —
// getLeaveRequest/getLockedMonths/isSelfApproval/validateBalance/recomputeRange
// /fetchTenantTz are all mocked above at the module level.

function buildMockSupabase(opts: { priorApprovedLeaveToDate?: string | null } = {}) {
  const rpcMock = vi.fn()
  const supabase = {
    rpc: rpcMock,
    from(table: string) {
      if (table === 'audit_logs') {
        return { insert: () => Promise.resolve({ error: null }) }
      }
      if (table === 'attendance_daily') {
        // Reversal's post-transaction cleanup delete — non-fatal, chain resolves empty.
        const chain: any = {
          delete: () => chain,
          eq:     () => chain,
          gte:    () => chain,
          lte:    () => chain,
          then:   (resolve: (v: unknown) => void) => resolve({ error: null }),
        }
        return chain
      }
      if (table === 'leave_requests') {
        // PEND-94's min_gap_days check — the prior-most-recent-approved-leave
        // lookup. Only reached when resolveEffectivePolicyRuleMock returns a
        // rule with min_gap_days > 0; every other test never touches this.
        const chain: any = {
          select: () => chain,
          eq:     () => chain,
          neq:    () => chain,
          lt:     () => chain,
          order:  () => chain,
          limit:  () => chain,
          maybeSingle: () => Promise.resolve({
            data: opts.priorApprovedLeaveToDate ? { to_date: opts.priorApprovedLeaveToDate } : null,
            error: null,
          }),
        }
        return chain
      }
      throw new Error(`buildMockSupabase: unexpected table "${table}"`)
    },
  }
  return { supabase, rpcMock }
}

// ── App builder ──────────────────────────────────────────────────────────────

async function buildApp(opts: { priorApprovedLeaveToDate?: string | null } = {}): Promise<{ app: FastifyInstance; rpcMock: ReturnType<typeof vi.fn>; publishMock: ReturnType<typeof vi.fn> }> {
  const { supabase, rpcMock } = buildMockSupabase(opts)
  const publishMock = vi.fn()

  const app = Fastify({ logger: false })

  app.decorateRequest('tenantId', '')
  app.decorateRequest('userId', '')
  app.decorateRequest('userRole', '')

  app.decorate('authenticate', async (req: FastifyRequest) => {
    ;(req as any).tenantId = TENANT_ID
    ;(req as any).userId   = 'approver-001'
    ;(req as any).userRole = 'hr_admin'
  })

  app.decorate('supabase', supabase as any)
  app.decorate('eventPublisher', { publish: publishMock } as any)

  await app.register(leaveRequestsRoutes)
  await app.ready()

  return { app, rpcMock, publishMock }
}

// No content-type header — these routes take no request body, and Fastify
// rejects an empty body when content-type is set to application/json.
const HEADERS = { 'authorization': 'Bearer test-token' }

beforeEach(() => {
  vi.clearAllMocks()
  getLockedMonthsMock.mockResolvedValue(new Set())
  isSelfApprovalMock.mockResolvedValue(false)
  recomputeRangeMock.mockResolvedValue(undefined)
  resolveEffectivePolicyRuleMock.mockResolvedValue(null)
})

// ── Approve ──────────────────────────────────────────────────────────────────

describe('POST /leave-requests/:id/approve', () => {
  it('happy path — paid leave calls approve_leave_request_atomic with the exact params and returns 200', async () => {
    const row = leaveRequestRow()
    getLeaveRequestMock.mockResolvedValue(okResult(row))
    const { app, rpcMock } = await buildApp()
    rpcMock.mockResolvedValue({ data: { id: REQUEST_ID, status: 'APPROVED' }, error: null })

    const res = await app.inject({
      method: 'POST', url: `/leave-requests/${REQUEST_ID}/approve`, headers: HEADERS,
    })

    expect(res.statusCode).toBe(200)
    expect(JSON.parse(res.body).data.status).toBe('APPROVED')
    expect(rpcMock).toHaveBeenCalledWith('approve_leave_request_atomic', expect.objectContaining({
      p_tenant_id:     TENANT_ID,
      p_request_id:    REQUEST_ID,
      p_approver_id:   'approver-001',
      p_is_paid:       true,
      p_employee_id:   row.employee_id,
      p_leave_type_id: row.leave_type_id,
      p_buckets:       [{ year: 2099, days: row.computed_days }],
      p_year:          2099,
    }))
  })

  it('unpaid leave still calls the RPC, with p_is_paid: false (ledger gating is SQL-side, not JS-side)', async () => {
    const row = leaveRequestRow({ leave_types: { id: 'lt-unpaid', name: 'Unpaid Leave', is_paid: false, allow_sandwich: false } })
    getLeaveRequestMock.mockResolvedValue(okResult(row))
    const { app, rpcMock } = await buildApp()
    rpcMock.mockResolvedValue({ data: { id: REQUEST_ID, status: 'APPROVED' }, error: null })

    const res = await app.inject({ method: 'POST', url: `/leave-requests/${REQUEST_ID}/approve`, headers: HEADERS })

    expect(res.statusCode).toBe(200)
    expect(rpcMock).toHaveBeenCalledWith('approve_leave_request_atomic', expect.objectContaining({ p_is_paid: false }))
  })

  it('RPC error aborts cleanly — structured error returned, no event published', async () => {
    const row = leaveRequestRow()
    getLeaveRequestMock.mockResolvedValue(okResult(row))
    const { app, rpcMock, publishMock } = await buildApp()
    rpcMock.mockResolvedValue({ data: null, error: { message: 'CONFLICT: Request is already APPROVED' } })

    const res = await app.inject({ method: 'POST', url: `/leave-requests/${REQUEST_ID}/approve`, headers: HEADERS })

    expect(res.statusCode).toBe(409)
    expect(JSON.parse(res.body).error).toBe('CONFLICT')
    expect(publishMock).not.toHaveBeenCalled()
  })

  it('post-transaction recompute failure is non-fatal — approval already committed, route still returns 200', async () => {
    const row = leaveRequestRow()
    getLeaveRequestMock.mockResolvedValue(okResult(row))
    const { app, rpcMock } = await buildApp()
    rpcMock.mockResolvedValue({ data: { id: REQUEST_ID, status: 'APPROVED' }, error: null })
    recomputeRangeMock.mockRejectedValue(new Error('attendance engine boom'))

    const res = await app.inject({ method: 'POST', url: `/leave-requests/${REQUEST_ID}/approve`, headers: HEADERS })

    expect(res.statusCode).toBe(200)
    expect(JSON.parse(res.body).data.status).toBe('APPROVED')
  })

  it('status pre-check rejects an already-APPROVED request with 409, RPC never called', async () => {
    const row = leaveRequestRow({ status: 'APPROVED' })
    getLeaveRequestMock.mockResolvedValue(okResult(row))
    const { app, rpcMock } = await buildApp()

    const res = await app.inject({ method: 'POST', url: `/leave-requests/${REQUEST_ID}/approve`, headers: HEADERS })

    expect(res.statusCode).toBe(409)
    expect(JSON.parse(res.body).error).toBe('CONFLICT')
    expect(rpcMock).not.toHaveBeenCalled()
  })

  it('period-lock guard rejects approval for a locked month with 409, RPC never called', async () => {
    const row = leaveRequestRow()
    getLeaveRequestMock.mockResolvedValue(okResult(row))
    getLockedMonthsMock.mockResolvedValue(new Set(['2099-06']))
    const { app, rpcMock } = await buildApp()

    const res = await app.inject({ method: 'POST', url: `/leave-requests/${REQUEST_ID}/approve`, headers: HEADERS })

    expect(res.statusCode).toBe(409)
    expect(JSON.parse(res.body).error).toBe('CONFLICT')
    expect(JSON.parse(res.body).message).toMatch(/locked/)
    expect(rpcMock).not.toHaveBeenCalled()
  })

  it('year-straddling request (Dec 29 – Jan 2) splits into two p_buckets, one per calendar year (PEND-103)', async () => {
    const perDay = (date: string, days_charged: number) => ({
      date, day_of_week: 'Mon', is_holiday: false, is_weekly_off: false, is_sandwich: false,
      is_attendance_overlap: false, session: 'full_day', days_charged, reason: '',
    })
    const row = leaveRequestRow({
      from_date: '2099-12-29', to_date: '2100-01-02', computed_days: 5,
      duration_breakdown: {
        per_day: [
          perDay('2099-12-29', 1), perDay('2099-12-30', 1), perDay('2099-12-31', 1),
          perDay('2100-01-01', 1), perDay('2100-01-02', 1),
        ],
      },
    })
    getLeaveRequestMock.mockResolvedValue(okResult(row))
    const { app, rpcMock } = await buildApp()
    rpcMock.mockResolvedValue({ data: { id: REQUEST_ID, status: 'APPROVED' }, error: null })

    const res = await app.inject({ method: 'POST', url: `/leave-requests/${REQUEST_ID}/approve`, headers: HEADERS })

    expect(res.statusCode).toBe(200)
    expect(rpcMock).toHaveBeenCalledWith('approve_leave_request_atomic', expect.objectContaining({
      p_buckets: [
        { year: 2099, days: 3 },
        { year: 2100, days: 2 },
      ],
    }))
  })
})

// ── PEND-94: policy_mismatch governance signal ────────────────────────────────
// leave.policy-mismatch existed since Sprint 2 but nothing ever set
// policy_mismatch on the published event, so the rule could never fire.
// These assert the event payload the governance rule engine actually reads —
// not the HTTP response, which is unaffected either way (advisory, non-blocking).

describe('POST /leave-requests/:id/approve — PEND-94 policy_mismatch', () => {
  it('no resolvable policy rule → policy_mismatch: false, no reasons', async () => {
    const row = leaveRequestRow()
    getLeaveRequestMock.mockResolvedValue(okResult(row))
    resolveEffectivePolicyRuleMock.mockResolvedValue(null)
    const { app, rpcMock, publishMock } = await buildApp()
    rpcMock.mockResolvedValue({ data: { id: REQUEST_ID, status: 'APPROVED' }, error: null })

    const res = await app.inject({ method: 'POST', url: `/leave-requests/${REQUEST_ID}/approve`, headers: HEADERS })

    expect(res.statusCode).toBe(200)
    expect(publishMock).toHaveBeenCalledWith(expect.objectContaining({
      payload: expect.objectContaining({ policy_mismatch: false, policy_mismatch_reasons: [] }),
    }))
  })

  it('span exceeds max_consecutive_days → policy_mismatch: true with a specific reason, approval still succeeds', async () => {
    // Row spans Jun 10–12 (3 days); policy caps this leave type at 2.
    const row = leaveRequestRow()
    getLeaveRequestMock.mockResolvedValue(okResult(row))
    resolveEffectivePolicyRuleMock.mockResolvedValue({ max_consecutive_days: 2, min_gap_days: 0 })
    const { app, rpcMock, publishMock } = await buildApp()
    rpcMock.mockResolvedValue({ data: { id: REQUEST_ID, status: 'APPROVED' }, error: null })

    const res = await app.inject({ method: 'POST', url: `/leave-requests/${REQUEST_ID}/approve`, headers: HEADERS })

    // Advisory only — never blocks the approval itself.
    expect(res.statusCode).toBe(200)
    expect(JSON.parse(res.body).data.status).toBe('APPROVED')
    expect(publishMock).toHaveBeenCalledWith(expect.objectContaining({
      payload: expect.objectContaining({
        policy_mismatch: true,
        policy_mismatch_reasons: [expect.stringContaining('3 consecutive days')],
      }),
    }))
  })

  it('span within max_consecutive_days → policy_mismatch: false', async () => {
    const row = leaveRequestRow() // 3-day span
    getLeaveRequestMock.mockResolvedValue(okResult(row))
    resolveEffectivePolicyRuleMock.mockResolvedValue({ max_consecutive_days: 5, min_gap_days: 0 })
    const { app, rpcMock, publishMock } = await buildApp()
    rpcMock.mockResolvedValue({ data: { id: REQUEST_ID, status: 'APPROVED' }, error: null })

    await app.inject({ method: 'POST', url: `/leave-requests/${REQUEST_ID}/approve`, headers: HEADERS })

    expect(publishMock).toHaveBeenCalledWith(expect.objectContaining({
      payload: expect.objectContaining({ policy_mismatch: false, policy_mismatch_reasons: [] }),
    }))
  })

  it('gap since last approved leave of the same type is under min_gap_days → policy_mismatch: true', async () => {
    // This request starts 2099-06-10; prior approved leave of the same type
    // ended 2099-06-05 — a 4-day gap. Policy requires at least 7.
    const row = leaveRequestRow()
    getLeaveRequestMock.mockResolvedValue(okResult(row))
    resolveEffectivePolicyRuleMock.mockResolvedValue({ max_consecutive_days: null, min_gap_days: 7 })
    const { app, rpcMock, publishMock } = await buildApp({ priorApprovedLeaveToDate: '2099-06-05' })
    rpcMock.mockResolvedValue({ data: { id: REQUEST_ID, status: 'APPROVED' }, error: null })

    const res = await app.inject({ method: 'POST', url: `/leave-requests/${REQUEST_ID}/approve`, headers: HEADERS })

    expect(res.statusCode).toBe(200)
    expect(publishMock).toHaveBeenCalledWith(expect.objectContaining({
      payload: expect.objectContaining({
        policy_mismatch: true,
        policy_mismatch_reasons: [expect.stringContaining('4 day(s)')],
      }),
    }))
  })

  it('gap since last approved leave of the same type satisfies min_gap_days → policy_mismatch: false', async () => {
    const row = leaveRequestRow()
    getLeaveRequestMock.mockResolvedValue(okResult(row))
    resolveEffectivePolicyRuleMock.mockResolvedValue({ max_consecutive_days: null, min_gap_days: 3 })
    const { app, rpcMock, publishMock } = await buildApp({ priorApprovedLeaveToDate: '2099-06-05' })
    rpcMock.mockResolvedValue({ data: { id: REQUEST_ID, status: 'APPROVED' }, error: null })

    await app.inject({ method: 'POST', url: `/leave-requests/${REQUEST_ID}/approve`, headers: HEADERS })

    expect(publishMock).toHaveBeenCalledWith(expect.objectContaining({
      payload: expect.objectContaining({ policy_mismatch: false, policy_mismatch_reasons: [] }),
    }))
  })

  it('resolveEffectivePolicyRule throwing is non-fatal — approval succeeds, policy_mismatch defaults to false', async () => {
    const row = leaveRequestRow()
    getLeaveRequestMock.mockResolvedValue(okResult(row))
    resolveEffectivePolicyRuleMock.mockRejectedValue(new Error('policy service boom'))
    const { app, rpcMock, publishMock } = await buildApp()
    rpcMock.mockResolvedValue({ data: { id: REQUEST_ID, status: 'APPROVED' }, error: null })

    const res = await app.inject({ method: 'POST', url: `/leave-requests/${REQUEST_ID}/approve`, headers: HEADERS })

    expect(res.statusCode).toBe(200)
    expect(JSON.parse(res.body).data.status).toBe('APPROVED')
    expect(publishMock).toHaveBeenCalledWith(expect.objectContaining({
      payload: expect.objectContaining({ policy_mismatch: false, policy_mismatch_reasons: [] }),
    }))
  })
})

// ── Reverse (cancel-approved) ────────────────────────────────────────────────

describe('POST /leave-requests/:id/cancel-approved', () => {
  it('happy path — APPROVED, future-dated leave calls reverse_leave_request_atomic with the exact params, 200', async () => {
    const row = leaveRequestRow({ status: 'APPROVED', approved_by: 'approver-001', approved_at: '2099-05-02T00:00:00.000Z' })
    getLeaveRequestMock.mockResolvedValue(okResult(row))
    const { app, rpcMock, publishMock } = await buildApp()
    rpcMock.mockResolvedValue({ data: { id: REQUEST_ID, status: 'CANCELLED' }, error: null })

    const res = await app.inject({ method: 'POST', url: `/leave-requests/${REQUEST_ID}/cancel-approved`, headers: HEADERS })

    expect(res.statusCode).toBe(200)
    expect(JSON.parse(res.body).data.status).toBe('CANCELLED')
    expect(rpcMock).toHaveBeenCalledWith('reverse_leave_request_atomic', expect.objectContaining({
      p_tenant_id:     TENANT_ID,
      p_request_id:    REQUEST_ID,
      p_actor_id:      'approver-001',
      p_is_paid:       true,
      p_employee_id:   row.employee_id,
      p_leave_type_id: row.leave_type_id,
      p_buckets:       [{ year: 2099, days: row.computed_days }],
      p_year:          2099,
    }))
    expect(publishMock).toHaveBeenCalledOnce()
  })

  it('idempotency — reversing twice: the second call is rejected by the status pre-check before the RPC runs again', async () => {
    const approvedRow = leaveRequestRow({ status: 'APPROVED' })
    const cancelledRow = leaveRequestRow({ status: 'CANCELLED' })
    getLeaveRequestMock
      .mockResolvedValueOnce(okResult(approvedRow))
      .mockResolvedValueOnce(okResult(cancelledRow))
    const { app, rpcMock } = await buildApp()
    rpcMock.mockResolvedValue({ data: { id: REQUEST_ID, status: 'CANCELLED' }, error: null })

    const first  = await app.inject({ method: 'POST', url: `/leave-requests/${REQUEST_ID}/cancel-approved`, headers: HEADERS })
    const second = await app.inject({ method: 'POST', url: `/leave-requests/${REQUEST_ID}/cancel-approved`, headers: HEADERS })

    expect(first.statusCode).toBe(200)
    expect(second.statusCode).toBe(409)
    expect(JSON.parse(second.body).error).toBe('CONFLICT')
    expect(JSON.parse(second.body).message).toMatch(/CANCELLED/)
    expect(rpcMock).toHaveBeenCalledTimes(1) // not called again for the second, rejected request
  })

  it('self-approval guard blocks reversing your own approved leave with 403, RPC never called', async () => {
    const row = leaveRequestRow({ status: 'APPROVED', employee_id: 'approver-001-linked-employee' })
    getLeaveRequestMock.mockResolvedValue(okResult(row))
    isSelfApprovalMock.mockResolvedValue(true)
    const { app, rpcMock } = await buildApp()

    const res = await app.inject({ method: 'POST', url: `/leave-requests/${REQUEST_ID}/cancel-approved`, headers: HEADERS })

    expect(res.statusCode).toBe(403)
    expect(JSON.parse(res.body).error).toBe('FORBIDDEN')
    expect(JSON.parse(res.body).message).toMatch(/cannot reverse your own/)
    expect(rpcMock).not.toHaveBeenCalled()
  })

  it('elapsed-range guard blocks reversing a leave that has already started, RPC never called', async () => {
    const row = leaveRequestRow({ status: 'APPROVED', from_date: '2020-01-01', to_date: '2020-01-03' })
    getLeaveRequestMock.mockResolvedValue(okResult(row))
    const { app, rpcMock } = await buildApp()

    const res = await app.inject({ method: 'POST', url: `/leave-requests/${REQUEST_ID}/cancel-approved`, headers: HEADERS })

    expect(res.statusCode).toBe(409)
    expect(JSON.parse(res.body).error).toBe('CONFLICT')
    expect(JSON.parse(res.body).message).toMatch(/already started/)
    expect(rpcMock).not.toHaveBeenCalled()
  })
})
