/**
 * SYSTEM_AUDIT_2026-10-14 checkpoint 10+1 — both GET /leave/policy/resolve
 * endpoints used `!MANAGER_ROLES.includes(role)` to decide whether to run
 * the ownership check, which skips it for EVERY manager-tier role, not
 * just HR — a plain `manager` with zero reporting relationship to
 * :employeeId could resolve any tenant employee's leave policy (accrual
 * rate, eligibility days, minimum service) plus name/employee_code/
 * joining_date. These tests prove the fix: self and HR are allowed; a
 * manager is scoped to their direct-report tree; anyone else is refused —
 * for both the full-resolve and the single-leave-type-resolve endpoints.
 */
import { describe, it, expect, vi } from 'vitest'
import Fastify from 'fastify'
import leavePolicyResolveRoute from '../leave-policy-resolve.js'

vi.mock('../../../lib/leave-policy-service.js', () => ({
  resolveEffectivePolicyForEmployee: vi.fn().mockResolvedValue({ policy_name: 'Default', scope: 'default', rules: [] }),
  resolveEffectivePolicyRule:        vi.fn().mockResolvedValue({ accrual_rate: 1.5 }),
}))
vi.mock('../../../lib/attendance-engine.js', () => ({
  fetchTenantTz:   vi.fn().mockResolvedValue('Asia/Kolkata'),
  utcToLocalDate:  vi.fn().mockReturnValue('2026-03-31'),
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
      if (table === 'employees') {
        const found = opts.employeeInTenant !== false
        return { select: () => ({ eq: () => ({ eq: () => ({ maybeSingle: () => Promise.resolve({ data: found ? { id: 'target', first_name: 'F', last_name: 'L', employee_code: 'E1', joining_date: '2020-01-01' } : null, error: null }) }) }) }) }
      }
      if (table === 'leave_types') {
        return { select: () => ({ eq: () => ({ eq: () => ({ maybeSingle: () => Promise.resolve({ data: { id: 'lt-1', name: 'Casual' }, error: null }) }) }) }) }
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
  app.register(leavePolicyResolveRoute)
  return app
}

const MANAGER_EMP_ID = '11111111-1111-1111-1111-111111111111'
const REPORT_A       = '22222222-2222-2222-2222-222222222222'
const OUTSIDE_EMP    = '33333333-3333-3333-3333-333333333333'
const LEAVE_TYPE     = '44444444-4444-4444-4444-444444444444'

describe('GET /leave/policy/resolve/:employeeId — ownership guard', () => {
  it('self is allowed', async () => {
    const app = buildApp({ userRole: 'employee', userId: 'u1', callerEmployeeId: OUTSIDE_EMP, reportIds: [] })
    const res = await app.inject({ method: 'GET', url: `/leave/policy/resolve/${OUTSIDE_EMP}` })
    expect(res.statusCode).toBe(200)
  })

  it('a plain employee resolving a colleague\'s policy is refused', async () => {
    const app = buildApp({ userRole: 'employee', userId: 'u1', callerEmployeeId: OUTSIDE_EMP, reportIds: [] })
    const res = await app.inject({ method: 'GET', url: `/leave/policy/resolve/${REPORT_A}` })
    expect(res.statusCode).toBe(403)
  })

  it('HR admin may resolve any employee', async () => {
    const app = buildApp({ userRole: 'hr_admin', userId: 'u1', callerEmployeeId: 'emp-hr', reportIds: [] })
    const res = await app.inject({ method: 'GET', url: `/leave/policy/resolve/${OUTSIDE_EMP}` })
    expect(res.statusCode).toBe(200)
  })

  it('manager may resolve a direct report\'s policy', async () => {
    const app = buildApp({ userRole: 'manager', userId: 'u1', callerEmployeeId: MANAGER_EMP_ID, reportIds: [REPORT_A] })
    const res = await app.inject({ method: 'GET', url: `/leave/policy/resolve/${REPORT_A}` })
    expect(res.statusCode).toBe(200)
  })

  it('manager resolving a NON-report\'s policy is refused — previously this returned 200, tenant-wide', async () => {
    const app = buildApp({ userRole: 'manager', userId: 'u1', callerEmployeeId: MANAGER_EMP_ID, reportIds: [REPORT_A] })
    const res = await app.inject({ method: 'GET', url: `/leave/policy/resolve/${OUTSIDE_EMP}` })
    expect(res.statusCode).toBe(403)
  })

  // SYSTEM_AUDIT_2026-10-14 checkpoint 12 — additional cases the user
  // explicitly asked to verify against each endpoint's intended policy.

  it('a manager role with NO linked employee record is refused, not a silent tenant-wide fallthrough', async () => {
    const app = buildApp({ userRole: 'manager', userId: 'u1', callerEmployeeId: null, reportIds: [] })
    const res = await app.inject({ method: 'GET', url: `/leave/policy/resolve/${OUTSIDE_EMP}` })
    expect(res.statusCode).toBe(403)
  })

  it('HR resolving a CROSS-TENANT employee_id is refused 404 — the tenant-membership check still runs after the (HR-bypassed) ownership check', async () => {
    const app = buildApp({ userRole: 'hr_admin', userId: 'u1', callerEmployeeId: 'emp-hr', reportIds: [], employeeInTenant: false })
    const res = await app.inject({ method: 'GET', url: `/leave/policy/resolve/${OUTSIDE_EMP}` })
    expect(res.statusCode).toBe(404)
  })

  it('reassignment: the FORMER manager loses access and the NEW manager gains it — authorization is derived fresh each call, not cached', async () => {
    const before = await buildApp({ userRole: 'manager', userId: 'm1', callerEmployeeId: MANAGER_EMP_ID, reportIds: [REPORT_A] })
      .inject({ method: 'GET', url: `/leave/policy/resolve/${REPORT_A}` })
    expect(before.statusCode).toBe(200)

    const after = await buildApp({ userRole: 'manager', userId: 'm1', callerEmployeeId: MANAGER_EMP_ID, reportIds: [] })
      .inject({ method: 'GET', url: `/leave/policy/resolve/${REPORT_A}` })
    expect(after.statusCode).toBe(403)

    const M2_EMP_ID = '55555555-5555-5555-5555-555555555555'
    const newManagerRes = await buildApp({ userRole: 'manager', userId: 'm2', callerEmployeeId: M2_EMP_ID, reportIds: [REPORT_A] })
      .inject({ method: 'GET', url: `/leave/policy/resolve/${REPORT_A}` })
    expect(newManagerRes.statusCode).toBe(200)
  })
})

describe('GET /leave/policy/resolve/:employeeId/type/:leaveTypeId — same guard', () => {
  it('manager resolving a NON-report\'s single-type policy is refused', async () => {
    const app = buildApp({ userRole: 'manager', userId: 'u1', callerEmployeeId: MANAGER_EMP_ID, reportIds: [REPORT_A] })
    const res = await app.inject({ method: 'GET', url: `/leave/policy/resolve/${OUTSIDE_EMP}/type/${LEAVE_TYPE}` })
    expect(res.statusCode).toBe(403)
  })

  it('manager resolving a direct report\'s single-type policy is allowed', async () => {
    const app = buildApp({ userRole: 'manager', userId: 'u1', callerEmployeeId: MANAGER_EMP_ID, reportIds: [REPORT_A] })
    const res = await app.inject({ method: 'GET', url: `/leave/policy/resolve/${REPORT_A}/type/${LEAVE_TYPE}` })
    expect(res.statusCode).toBe(200)
  })
})
