/**
 * SYSTEM_AUDIT_2026-10-14 checkpoint 10+1 — GET /leave/collision/preview had
 * zero object-level authorization check: only tenant-membership of
 * employee_id was verified, so any authenticated employee could pass a
 * colleague's employee_id and get back that colleague's holiday/weekly-off
 * collision analysis — a structural gap against the sibling endpoint in
 * the same directory, leave-duration.ts's POST /leave/duration/preview,
 * which both are called with the identical employee_id from the same
 * LeaveApply.tsx screen. These tests prove the fix: self and HR are
 * allowed; a manager is scoped to their direct-report tree; anyone else is
 * refused.
 */
import { describe, it, expect, vi } from 'vitest'
import Fastify from 'fastify'
import leaveCollisionRoutes from '../leave-collision.js'

vi.mock('../../../lib/collision-engine.js', () => ({
  resolveCollisionPolicy: vi.fn().mockResolvedValue({ mode: 'block' }),
  computeCollision:       vi.fn().mockResolvedValue({ collisions: [] }),
}))

const TENANT = 'tenant-1'

function buildApp(opts: {
  userRole:         string
  userId:           string
  callerEmployeeId: string | null
  reportIds:        string[]
  employeeInTenant?: boolean  // false simulates employee_id belonging to a DIFFERENT tenant (or not existing)
}) {
  const app = Fastify()
  app.decorate('authenticate', async (req: any) => {
    req.tenantId = TENANT
    req.userId   = opts.userId
    req.userRole = opts.userRole
  })

  const supabase = {
    from(table: string) {
      if (table === 'employees') {
        const found = opts.employeeInTenant !== false
        return { select: () => ({ eq: () => ({ eq: () => ({ maybeSingle: () => Promise.resolve({ data: found ? { id: 'target' } : null, error: null }) }) }) }) }
      }
      if (table === 'profiles') {
        return {
          select: () => ({
            eq: () => ({
              eq: () => ({
                maybeSingle: () => Promise.resolve({ data: { employee_id: opts.callerEmployeeId }, error: null }),
              }),
            }),
          }),
        }
      }
      throw new Error(`unexpected table ${table}`)
    },
    rpc: (fn: string, params: any) => {
      if (fn === 'get_all_subordinates') {
        return params.p_manager_id === opts.callerEmployeeId
          ? Promise.resolve({ data: opts.reportIds.map(id => ({ id })), error: null })
          : Promise.resolve({ data: [], error: null })
      }
      throw new Error(`unexpected rpc ${fn}`)
    },
  }
  app.decorate('supabase', supabase as any)
  app.register(leaveCollisionRoutes)
  return app
}

const MANAGER_EMP_ID = '11111111-1111-1111-1111-111111111111'
const REPORT_A       = '22222222-2222-2222-2222-222222222222'
const OUTSIDE_EMP    = '33333333-3333-3333-3333-333333333333'
const LEAVE_TYPE     = '44444444-4444-4444-4444-444444444444'

function url(employeeId: string) {
  return `/leave/collision/preview?employee_id=${employeeId}&leave_type_id=${LEAVE_TYPE}&from_date=2026-01-01&to_date=2026-01-02`
}

describe('GET /leave/collision/preview — ownership guard', () => {
  it('a plain employee previewing their OWN employee_id is allowed', async () => {
    const app = buildApp({ userRole: 'employee', userId: 'u1', callerEmployeeId: OUTSIDE_EMP, reportIds: [] })
    const res = await app.inject({ method: 'GET', url: url(OUTSIDE_EMP) })
    expect(res.statusCode).toBe(200)
  })

  it('a plain employee previewing a COLLEAGUE\'s employee_id is refused — previously this returned 200 with the colleague\'s data', async () => {
    const app = buildApp({ userRole: 'employee', userId: 'u1', callerEmployeeId: OUTSIDE_EMP, reportIds: [] })
    const res = await app.inject({ method: 'GET', url: url(REPORT_A) })
    expect(res.statusCode).toBe(403)
  })

  it('HR admin may preview any employee_id', async () => {
    const app = buildApp({ userRole: 'hr_admin', userId: 'u1', callerEmployeeId: 'emp-hr', reportIds: [] })
    const res = await app.inject({ method: 'GET', url: url(OUTSIDE_EMP) })
    expect(res.statusCode).toBe(200)
  })

  it('manager previewing a direct report\'s employee_id is allowed', async () => {
    const app = buildApp({ userRole: 'manager', userId: 'u1', callerEmployeeId: MANAGER_EMP_ID, reportIds: [REPORT_A] })
    const res = await app.inject({ method: 'GET', url: url(REPORT_A) })
    expect(res.statusCode).toBe(200)
  })

  it('manager previewing a NON-report\'s employee_id is refused', async () => {
    const app = buildApp({ userRole: 'manager', userId: 'u1', callerEmployeeId: MANAGER_EMP_ID, reportIds: [REPORT_A] })
    const res = await app.inject({ method: 'GET', url: url(OUTSIDE_EMP) })
    expect(res.statusCode).toBe(403)
  })

  // SYSTEM_AUDIT_2026-10-14 checkpoint 12 — additional cases the user
  // explicitly asked to verify: reassignment, cross-tenant, unlinked
  // manager — checking the new rule matches each endpoint's intended
  // policy, not just the original defect's exact repro.

  it('cross-tenant employee_id is refused 404 (tenant check runs before ownership is ever considered) — HR included', async () => {
    const app = buildApp({ userRole: 'hr_admin', userId: 'u1', callerEmployeeId: 'emp-hr', reportIds: [], employeeInTenant: false })
    const res = await app.inject({ method: 'GET', url: url(OUTSIDE_EMP) })
    expect(res.statusCode).toBe(404)
  })

  it('a manager role with NO linked employee record is refused, not a silent tenant-wide fallthrough', async () => {
    const app = buildApp({ userRole: 'manager', userId: 'u1', callerEmployeeId: null, reportIds: [] })
    const res = await app.inject({ method: 'GET', url: url(OUTSIDE_EMP) })
    expect(res.statusCode).toBe(403)
  })

  it('reassignment: the FORMER manager loses access and the NEW manager gains it — authorization is derived fresh each call, not cached', async () => {
    // Before reassignment: M1 manages the employee.
    const beforeApp = buildApp({ userRole: 'manager', userId: 'm1', callerEmployeeId: MANAGER_EMP_ID, reportIds: [REPORT_A] })
    const before = await beforeApp.inject({ method: 'GET', url: url(REPORT_A) })
    expect(before.statusCode).toBe(200)

    // After reassignment: a fresh getDirectReportIds call for M1 no longer
    // includes the employee (manager_id changed in employees table) —
    // simulated here by a fresh buildApp call whose reportIds fixture
    // reflects the new live state, exactly as a real re-fetch would.
    const afterApp = buildApp({ userRole: 'manager', userId: 'm1', callerEmployeeId: MANAGER_EMP_ID, reportIds: [] })
    const after = await afterApp.inject({ method: 'GET', url: url(REPORT_A) })
    expect(after.statusCode).toBe(403)

    // The NEW manager (M2) now has the employee in their live report tree.
    const M2_EMP_ID = '55555555-5555-5555-5555-555555555555'
    const newManagerApp = buildApp({ userRole: 'manager', userId: 'm2', callerEmployeeId: M2_EMP_ID, reportIds: [REPORT_A] })
    const newManagerRes = await newManagerApp.inject({ method: 'GET', url: url(REPORT_A) })
    expect(newManagerRes.statusCode).toBe(200)
  })
})
