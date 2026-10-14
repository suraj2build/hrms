/**
 * SYSTEM_AUDIT_2026-10-14 — the user correctly pushed back on an earlier
 * conclusion that routes/attendance/leave.ts's legacy leave_applications
 * apply/approve flow was "dead" because nothing in the current frontend
 * calls it. That conflated "no UI caller" with "unreachable": the route
 * file IS registered (`fastify.register(attendanceLeaveRoute)` in
 * index.ts, `/attendance/leave/*`), so any authenticated caller can still
 * reach it directly over HTTP — confirmed here via real Fastify
 * app.inject() through the actual registered route handler (only the
 * Supabase client is mocked; this is the live route code executing against
 * a real, simulated HTTP request/response cycle, not a stub of the route).
 *
 * That reachability check surfaced a real, distinct gap from checkpoint
 * 6's manager-scope fixes: this legacy approve handler had NO hard
 * period-lock block — unlike the canonical flow (approveLeaveRequest in
 * approval-service.ts, and approveRegularisation), which refuses outright
 * once the affected month is locked. This file only had a "payroll freeze
 * guard" further down that lets the approval through regardless and
 * queues a best-effort reconciliation adjustment afterward. Fixed to
 * mirror the canonical hard block exactly, checked before any balance or
 * attendance_daily mutation.
 *
 * What this file does NOT cover (disclosed, not implied): the full
 * open-period approve-success pipeline (balance deduction, attendance_daily
 * write, sandwich leave, ledger entries) is pre-existing, untouched-by-this-
 * fix behavior and is not independently re-verified here — mocking it
 * faithfully end-to-end is a separate, larger undertaking than this specific
 * fix warrants. The new guard only ever adds an EARLY return on a NEW
 * condition; it cannot change behavior on the path where that condition is
 * false, so the pre-existing open-period path carries no new regression
 * risk from this change.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import Fastify, { type FastifyInstance, type FastifyRequest } from 'fastify'

vi.mock('../../../lib/approval-guards.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../lib/approval-guards.js')>()
  return { ...actual, isSelfApproval: vi.fn().mockResolvedValue(false) }
})

import attendanceLeaveRoute from '../leave.js'

const TENANT_ID = 'tenant-001'
const APP_ID    = 'leave-app-001'
const EMPLOYEE_ID = 'emp-001'

interface Fixture {
  lockedMonths: string[]       // period_month values with a non-OPEN state
  leaveApplication: { employee_id: string; tenant_id: string; from_date: string; to_date: string; status: string; leave_type_id: string; session: string } | null
  // cancel-path only (F1/F2 fix below): what cancel_legacy_leave_application_atomic should do
  cancelRpcError?: string | null
}

function buildSupabase(fx: Fixture) {
  return {
    rpc: vi.fn((fnName: string) => {
      if (fnName === 'cancel_legacy_leave_application_atomic') {
        if (fx.cancelRpcError) {
          return Promise.resolve({ data: null, error: { message: fx.cancelRpcError } })
        }
        return Promise.resolve({ data: { id: APP_ID, status: 'cancelled' }, error: null })
      }
      return Promise.resolve({ data: true, error: null })
    }),
    from(table: string) {
      if (table === 'tenants') {
        const chain: any = {
          select: () => chain, eq: () => chain,
          maybeSingle: () => Promise.resolve({ data: { timezone: 'UTC' }, error: null }),
        }
        return chain
      }
      if (table === 'leave_accrual_ledger') {
        const chain: any = {
          select: () => chain, eq: () => chain,
          // A pre-existing consumption row — daysToRestore resolves to 1,
          // so computeWorkingLeaveDays (which would need far more mocking)
          // is never reached on the cancel path under test here.
          maybeSingle: () => Promise.resolve({ data: { days: -1 }, error: null }),
        }
        return chain
      }
      if (table === 'attendance_daily') {
        const chain: any = {
          delete: () => chain,
          eq:     () => chain,
          in:     () => chain,
          then:   (resolve: (v: unknown) => void) => resolve({ error: null }),
        }
        return chain
      }
      if (table === 'profiles') {
        const chain: any = {
          select: () => chain, eq: () => chain,
          single:      () => Promise.resolve({ data: { employee_id: EMPLOYEE_ID }, error: null }),
          maybeSingle: () => Promise.resolve({ data: { employee_id: EMPLOYEE_ID }, error: null }),
        }
        return chain
      }
      if (table === 'leave_types') {
        const chain: any = {
          select: () => chain, eq: () => chain,
          maybeSingle: () => Promise.resolve({ data: { id: 'lt-1', name: 'Annual Leave', is_paid: true, allow_sandwich: false, allow_half_day: true }, error: null }),
        }
        return chain
      }
      if (table === 'leave_applications') {
        const chain: any = {
          select: () => chain,
          eq:     () => chain,
          in:     () => chain,
          lte:    () => chain,
          gte:    () => chain,
          limit:  () => chain,
          single:      () => Promise.resolve({ data: fx.leaveApplication ? { id: APP_ID, ...fx.leaveApplication } : null, error: fx.leaveApplication ? null : { message: 'not found' } }),
          maybeSingle: () => Promise.resolve({ data: null, error: null }),   // overlap check in /apply: no existing overlap
          insert: () => ({
            select: () => ({
              single: () => Promise.resolve({ data: { id: APP_ID, from_date: '2026-02-10', to_date: '2026-02-11', status: 'pending', created_at: '2026-02-01T00:00:00Z' }, error: null }),
            }),
          }),
        }
        return chain
      }
      if (table === 'attendance_period_locks') {
        const chain: any = {
          select: () => chain,
          eq:     () => chain,
          neq:    () => chain,
          in(field: string, months: string[]) {
            if (field === 'period_month') chain._months = months
            return chain
          },
          then(resolve: (v: unknown) => void) {
            const rows = (chain._months ?? [])
              .filter((m: string) => fx.lockedMonths.includes(m))
              .map((m: string) => ({ period_month: m, state: 'LOCKED' }))
            resolve({ data: rows, error: null })
            return Promise.resolve()
          },
        }
        return chain
      }
      throw new Error(`unexpected table ${table}`)
    },
  }
}

async function buildApp(fx: Fixture): Promise<FastifyInstance> {
  const app = Fastify({ logger: false })
  app.decorateRequest('tenantId', '')
  app.decorateRequest('userId', '')
  app.decorateRequest('userRole', '')
  app.decorate('authenticate', async (req: FastifyRequest) => {
    ;(req as any).tenantId = TENANT_ID
    ;(req as any).userId   = 'profile-001'
    ;(req as any).userRole = 'hr_admin'
  })
  app.decorate('supabase', buildSupabase(fx) as any)
  await app.register(attendanceLeaveRoute)
  await app.ready()
  return app
}

const HEADERS = { 'content-type': 'application/json', authorization: 'Bearer test-token' }

beforeEach(() => {
  vi.clearAllMocks()
})

describe('routes/attendance/leave.ts — confirmed live and reachable (not dead code)', () => {
  it('POST /attendance/leave/apply is registered and responds for real, over a simulated HTTP request', async () => {
    const app = await buildApp({ lockedMonths: [], leaveApplication: null })
    const res = await app.inject({
      method: 'POST', url: '/attendance/leave/apply', headers: HEADERS,
      payload: { leave_type_id: '11111111-1111-1111-1111-111111111111', from_date: '2026-02-10', to_date: '2026-02-11', session: 'full_day' },
    })
    // Confirms the route is registered and executing real handler code
    // (a 404 here would mean "not registered"; this is neither mocked away
    // nor dead — it inserts into leave_applications for real).
    expect(res.statusCode).toBe(201)
  })

  it('POST /attendance/leave/:id/approve is registered and reachable (not a 404 dead route)', async () => {
    const fx: Fixture = {
      lockedMonths: [],
      leaveApplication: { employee_id: EMPLOYEE_ID, tenant_id: TENANT_ID, from_date: '2026-02-10', to_date: '2026-02-10', status: 'pending', leave_type_id: 'lt-1', session: 'full_day' },
    }
    const app = await buildApp(fx)
    const res = await app.inject({ method: 'POST', url: `/attendance/leave/${APP_ID}/approve`, headers: HEADERS, payload: {} })
    // Whatever the outcome, it must not be a 404 "route not found" —
    // confirming registration/reachability independent of the fix below.
    expect(res.statusCode).not.toBe(404)
  })
})

describe('routes/attendance/leave.ts — period-lock fix (new)', () => {
  it('refuses to approve once the affected month is locked — 409, before any balance RPC or attendance write', async () => {
    const fx: Fixture = {
      lockedMonths: ['2026-02'],
      leaveApplication: { employee_id: EMPLOYEE_ID, tenant_id: TENANT_ID, from_date: '2026-02-10', to_date: '2026-02-10', status: 'pending', leave_type_id: 'lt-1', session: 'full_day' },
    }
    const app = await buildApp(fx)
    const res = await app.inject({ method: 'POST', url: `/attendance/leave/${APP_ID}/approve`, headers: HEADERS, payload: {} })
    expect(res.statusCode).toBe(409)
    const body = JSON.parse(res.body)
    expect(body.error).toBe('PERIOD_LOCKED')
    expect(body.message).toContain('2026-02')
  })

  it('still allows approval when the month is open (the pre-existing, unaffected path reaches the RPC)', async () => {
    const fx: Fixture = {
      lockedMonths: [],
      leaveApplication: { employee_id: EMPLOYEE_ID, tenant_id: TENANT_ID, from_date: '2026-02-10', to_date: '2026-02-10', status: 'pending', leave_type_id: 'lt-1', session: 'full_day' },
    }
    const app = await buildApp(fx)
    const res = await app.inject({ method: 'POST', url: `/attendance/leave/${APP_ID}/approve`, headers: HEADERS, payload: {} })
    // Not blocked by the new guard. (It may still fail further down this
    // heavily-dependent pipeline in this minimal mock — the point of this
    // assertion is only that PERIOD_LOCKED is not the reason.)
    expect(res.statusCode).not.toBe(409)
  })
})

describe('routes/attendance/leave.ts — cancel handler: F1 period-lock + F2 elapsed-range fix (new)', () => {
  // SYSTEM_AUDIT_2026-10-14 continued audit: comparing POST /attendance/leave/:id/cancel
  // against canonical reverseApprovedLeaveRequest surfaced two real gaps this legacy
  // path had with NO equivalent protection at all (not even a JS pre-check, unlike
  // approve's getLockedMonths fast-fail): F1 — no period-lock check before mutating
  // balance/ledger/attendance_daily; F2 — no guard against reversing a leave that has
  // already started (over-credits balance, corrupts already-elapsed attendance).
  // Both are fixed: F1 via migration 461's cancel_legacy_leave_application_atomic
  // (status + period-lock check + mutation, one transaction); F2 via a JS-side
  // tenant-local "today" comparison before calling that RPC at all.

  it('F2 — refuses to cancel a leave that has already started, before the RPC is ever called', async () => {
    const fx: Fixture = {
      lockedMonths: [],
      leaveApplication: { employee_id: EMPLOYEE_ID, tenant_id: TENANT_ID, from_date: '2015-01-10', to_date: '2015-01-10', status: 'approved', leave_type_id: 'lt-1', session: 'full_day' },
    }
    const app = await buildApp(fx)
    const res = await app.inject({ method: 'POST', url: `/attendance/leave/${APP_ID}/cancel`, headers: HEADERS, payload: {} })
    expect(res.statusCode).toBe(409)
    const body = JSON.parse(res.body)
    expect(body.error).toBe('ALREADY_STARTED')
  })

  it('F1 — refuses to cancel once the affected month is locked, surfaced by the atomic RPC', async () => {
    const fx: Fixture = {
      lockedMonths: [],
      leaveApplication: { employee_id: EMPLOYEE_ID, tenant_id: TENANT_ID, from_date: '2099-03-10', to_date: '2099-03-10', status: 'approved', leave_type_id: 'lt-1', session: 'full_day' },
      cancelRpcError: 'CONFLICT: PERIOD_LOCKED: Cannot cancel — the pay period 2099-03 is locked. Reopen the period before cancelling this approved leave.',
    }
    const app = await buildApp(fx)
    const res = await app.inject({ method: 'POST', url: `/attendance/leave/${APP_ID}/cancel`, headers: HEADERS, payload: {} })
    expect(res.statusCode).toBe(409)
    const body = JSON.parse(res.body)
    expect(body.error).toBe('PERIOD_LOCKED')
    expect(body.message).toContain('2099-03')
  })

  it('succeeds for a future-dated, open-period approved leave — calls the atomic RPC and restores days', async () => {
    const fx: Fixture = {
      lockedMonths: [],
      leaveApplication: { employee_id: EMPLOYEE_ID, tenant_id: TENANT_ID, from_date: '2099-03-10', to_date: '2099-03-10', status: 'approved', leave_type_id: 'lt-1', session: 'full_day' },
    }
    const app = await buildApp(fx)
    const res = await app.inject({ method: 'POST', url: `/attendance/leave/${APP_ID}/cancel`, headers: HEADERS, payload: {} })
    expect(res.statusCode).toBe(200)
    const body = JSON.parse(res.body)
    expect(body.days_restored).toBe(1)
  })

  it('a non-approved application is rejected by the pre-RPC status check (unchanged pre-existing behavior)', async () => {
    const fx: Fixture = {
      lockedMonths: [],
      leaveApplication: { employee_id: EMPLOYEE_ID, tenant_id: TENANT_ID, from_date: '2099-03-10', to_date: '2099-03-10', status: 'pending', leave_type_id: 'lt-1', session: 'full_day' },
    }
    const app = await buildApp(fx)
    const res = await app.inject({ method: 'POST', url: `/attendance/leave/${APP_ID}/cancel`, headers: HEADERS, payload: {} })
    expect(res.statusCode).toBe(409)
    const body = JSON.parse(res.body)
    expect(body.error).toBe('INVALID_STATE')
  })
})
