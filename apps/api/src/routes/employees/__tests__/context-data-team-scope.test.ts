/**
 * /employees/:id/{attendance,overtime,payroll-summary} — team-scope guard
 * (SYSTEM_AUDIT_2026-10-14 continuation). These endpoints were gated only on
 * role (MANAGER_ROLES: hr_admin/super_admin/manager) with no check that the
 * target employee is actually in the caller's team — any manager could pull
 * any employee's attendance, overtime, AND payroll-summary (CTC, net pay,
 * deductions) tenant-wide just by knowing the employee_id.
 *
 * Two distinct policies are enforced and tested separately:
 *  - attendance/overtime: operational visibility, scoped to the caller's
 *    FULL subordinate tree via getDirectReportIds — same pattern as
 *    team-assets.ts / team-helpdesk.ts / team-regularisation-context.ts.
 *  - payroll-summary: compensation visibility, scoped to IMMEDIATE direct
 *    reports only (employees.manager_id === callerEmpId) — mirroring
 *    manager-compensation.ts (Program 5 · P5.3), the one other place in
 *    this codebase that defines manager-visible compensation policy. A
 *    manager-of-managers must NOT see a grandchild report's CTC through
 *    this endpoint just because team-assets-style tooling would show them
 *    that employee's assets/tickets.
 */
import { describe, it, expect } from 'vitest'
import Fastify from 'fastify'
import contextDataRoutes from '../context-data.js'

const TENANT       = 'tenant-1'
const OTHER_TENANT = 'tenant-2'

interface EmployeeRow { id: string; tenant_id: string; manager_id: string | null }

function buildApp(opts: {
  userRole:          string
  userId:            string
  callerEmployeeId:  string | null   // null simulates a manager with no linked employee record
  employees:         EmployeeRow[]
  subordinateIdsByManager: Record<string, string[]>  // full subordinate tree, as get_all_subordinates would return
}) {
  const app = Fastify()
  app.decorate('authenticate', async (req: any) => {
    req.tenantId = TENANT
    req.userId   = opts.userId
    req.userRole = opts.userRole
  })

  const empById = new Map(opts.employees.map(e => [e.id, e]))

  const supabase = {
    from(table: string) {
      if (table === 'employees') {
        return {
          select: () => ({
            eq: (_c1: string, idOrTenant: string) => ({
              eq: (c2: string, v2: string) => {
                // Two shapes used by this route file:
                //   .eq('id', X).eq('tenant_id', req.tenantId)                      — getEmployee / canAccessEmployee self-check
                //   .eq('id', X).eq('tenant_id', T).eq('manager_id', callerEmpId)   — canAccessCompensation
                const maybeSingle = () => {
                  const row = empById.get(idOrTenant)
                  if (!row || row.tenant_id !== v2) return Promise.resolve({ data: null, error: null })
                  return Promise.resolve({ data: { id: row.id }, error: null })
                }
                return {
                  maybeSingle,
                  eq: (_c3: string, managerId: string) => ({
                    maybeSingle: () => {
                      const row = empById.get(idOrTenant)
                      if (!row || row.tenant_id !== v2 || row.manager_id !== managerId) return Promise.resolve({ data: null, error: null })
                      return Promise.resolve({ data: { id: row.id }, error: null })
                    },
                  }),
                }
              },
            }),
          }),
        }
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
      if (table === 'attendance_daily') {
        return { select: () => ({ eq: () => ({ eq: () => ({ order: () => ({ limit: () => Promise.resolve({ data: [], error: null }) }) }) }) }) }
      }
      if (table === 'overtime_requests') {
        return { select: () => ({ eq: () => ({ eq: () => ({ order: () => ({ limit: () => Promise.resolve({ data: [], error: null }) }) }) }) }) }
      }
      if (table === 'payroll_slips') {
        return { select: () => ({ eq: () => ({ eq: () => ({ order: () => ({ limit: () => ({ maybeSingle: () => Promise.resolve({ data: null, error: null }) }) }) }) }) }) }
      }
      if (table === 'employee_compensations') {
        return { select: () => ({ eq: () => ({ eq: () => ({ eq: () => ({ limit: () => ({ maybeSingle: () => Promise.resolve({ data: null, error: null }) }) }) }) }) }) }
      }
      throw new Error(`unexpected table ${table}`)
    },
    rpc: (fn: string, params: any) => {
      if (fn === 'get_all_subordinates') {
        const ids = opts.subordinateIdsByManager[params.p_manager_id] ?? []
        return Promise.resolve({ data: ids.map(id => ({ id })), error: null })
      }
      throw new Error(`unexpected rpc ${fn}`)
    },
  }
  app.decorate('supabase', supabase as any)
  app.register(contextDataRoutes)
  return app
}

const MANAGER_USER_ID = 'user-mgr-1'
const MANAGER_EMP_ID  = 'emp-mgr-1'
const OWN_REPORT_ID   = 'emp-report-1'     // direct report of MANAGER_EMP_ID
const GRANDCHILD_ID   = 'emp-grandchild-1' // in MANAGER_EMP_ID's subordinate TREE, but not a direct report
const OUTSIDE_EMP_ID  = 'emp-outside-1'    // not in the tree at all
const CROSS_TENANT_ID = 'emp-cross-tenant' // exists, but in a different tenant

const baseEmployees: EmployeeRow[] = [
  { id: MANAGER_EMP_ID,  tenant_id: TENANT,       manager_id: null },
  { id: OWN_REPORT_ID,   tenant_id: TENANT,       manager_id: MANAGER_EMP_ID },
  { id: GRANDCHILD_ID,   tenant_id: TENANT,       manager_id: OWN_REPORT_ID },
  { id: OUTSIDE_EMP_ID,  tenant_id: TENANT,       manager_id: null },
  { id: CROSS_TENANT_ID, tenant_id: OTHER_TENANT, manager_id: null },
]
const baseSubordinates = {
  [MANAGER_EMP_ID]: [OWN_REPORT_ID, GRANDCHILD_ID],  // full tree: direct + grandchild
}

describe('GET /employees/:id/attendance — operational visibility (full subordinate tree)', () => {
  it('a manager CAN view their own direct report\'s attendance', async () => {
    const app = buildApp({ userRole: 'manager', userId: MANAGER_USER_ID, callerEmployeeId: MANAGER_EMP_ID, employees: baseEmployees, subordinateIdsByManager: baseSubordinates })
    await app.ready()
    const res = await app.inject({ method: 'GET', url: `/employees/${OWN_REPORT_ID}/attendance` })
    expect(res.statusCode).toBe(200)
  })

  it('a manager CAN view a grandchild report\'s attendance (full subordinate tree, not just direct)', async () => {
    const app = buildApp({ userRole: 'manager', userId: MANAGER_USER_ID, callerEmployeeId: MANAGER_EMP_ID, employees: baseEmployees, subordinateIdsByManager: baseSubordinates })
    await app.ready()
    const res = await app.inject({ method: 'GET', url: `/employees/${GRANDCHILD_ID}/attendance` })
    expect(res.statusCode).toBe(200)
  })

  it('SECURITY: a manager CANNOT view an employee outside their team', async () => {
    const app = buildApp({ userRole: 'manager', userId: MANAGER_USER_ID, callerEmployeeId: MANAGER_EMP_ID, employees: baseEmployees, subordinateIdsByManager: baseSubordinates })
    await app.ready()
    const res = await app.inject({ method: 'GET', url: `/employees/${OUTSIDE_EMP_ID}/attendance` })
    expect(res.statusCode).toBe(403)
  })

  it('an hr_admin bypasses team scoping entirely', async () => {
    const app = buildApp({ userRole: 'hr_admin', userId: 'user-hr-1', callerEmployeeId: null, employees: baseEmployees, subordinateIdsByManager: baseSubordinates })
    await app.ready()
    const res = await app.inject({ method: 'GET', url: `/employees/${OUTSIDE_EMP_ID}/attendance` })
    expect(res.statusCode).toBe(200)
  })

  it('SECURITY: a manager role with no linked employee record is refused, not silently passed through', async () => {
    const app = buildApp({ userRole: 'manager', userId: 'user-unlinked', callerEmployeeId: null, employees: baseEmployees, subordinateIdsByManager: baseSubordinates })
    await app.ready()
    const res = await app.inject({ method: 'GET', url: `/employees/${OWN_REPORT_ID}/attendance` })
    expect(res.statusCode).toBe(403)
  })

  it('SECURITY: a manager cannot reach an employee that exists only in a different tenant', async () => {
    const app = buildApp({ userRole: 'manager', userId: MANAGER_USER_ID, callerEmployeeId: MANAGER_EMP_ID, employees: baseEmployees, subordinateIdsByManager: baseSubordinates })
    await app.ready()
    const res = await app.inject({ method: 'GET', url: `/employees/${CROSS_TENANT_ID}/attendance` })
    expect(res.statusCode).toBe(403)
  })
})

describe('GET /employees/:id/overtime — operational visibility', () => {
  it('SECURITY: a manager CANNOT view overtime for an employee outside their team', async () => {
    const app = buildApp({ userRole: 'manager', userId: MANAGER_USER_ID, callerEmployeeId: MANAGER_EMP_ID, employees: baseEmployees, subordinateIdsByManager: baseSubordinates })
    await app.ready()
    const res = await app.inject({ method: 'GET', url: `/employees/${OUTSIDE_EMP_ID}/overtime` })
    expect(res.statusCode).toBe(403)
  })
})

describe('GET /employees/:id/payroll-summary — compensation visibility (DIRECT reports ONLY, narrower than attendance/overtime)', () => {
  it('a manager CAN view payroll summary for their own DIRECT report', async () => {
    const app = buildApp({ userRole: 'manager', userId: MANAGER_USER_ID, callerEmployeeId: MANAGER_EMP_ID, employees: baseEmployees, subordinateIdsByManager: baseSubordinates })
    await app.ready()
    const res = await app.inject({ method: 'GET', url: `/employees/${OWN_REPORT_ID}/payroll-summary` })
    expect(res.statusCode).toBe(200)
  })

  it('SECURITY: a manager CANNOT view a GRANDCHILD report\'s payroll summary, even though they ARE in the subordinate tree used for attendance/overtime', async () => {
    const app = buildApp({ userRole: 'manager', userId: MANAGER_USER_ID, callerEmployeeId: MANAGER_EMP_ID, employees: baseEmployees, subordinateIdsByManager: baseSubordinates })
    await app.ready()
    const res = await app.inject({ method: 'GET', url: `/employees/${GRANDCHILD_ID}/payroll-summary` })
    expect(res.statusCode).toBe(403)
  })

  it('SECURITY: a manager CANNOT view payroll summary for an employee outside their team entirely', async () => {
    const app = buildApp({ userRole: 'manager', userId: MANAGER_USER_ID, callerEmployeeId: MANAGER_EMP_ID, employees: baseEmployees, subordinateIdsByManager: baseSubordinates })
    await app.ready()
    const res = await app.inject({ method: 'GET', url: `/employees/${OUTSIDE_EMP_ID}/payroll-summary` })
    expect(res.statusCode).toBe(403)
  })

  it('a manager CAN view their own payroll summary (self)', async () => {
    const app = buildApp({ userRole: 'manager', userId: MANAGER_USER_ID, callerEmployeeId: MANAGER_EMP_ID, employees: baseEmployees, subordinateIdsByManager: baseSubordinates })
    await app.ready()
    const res = await app.inject({ method: 'GET', url: `/employees/${MANAGER_EMP_ID}/payroll-summary` })
    expect(res.statusCode).toBe(200)
  })

  it('an hr_admin bypasses compensation scoping entirely', async () => {
    const app = buildApp({ userRole: 'hr_admin', userId: 'user-hr-1', callerEmployeeId: null, employees: baseEmployees, subordinateIdsByManager: baseSubordinates })
    await app.ready()
    const res = await app.inject({ method: 'GET', url: `/employees/${GRANDCHILD_ID}/payroll-summary` })
    expect(res.statusCode).toBe(200)
  })

  it('SECURITY: a manager role with no linked employee record cannot view anyone\'s payroll summary', async () => {
    const app = buildApp({ userRole: 'manager', userId: 'user-unlinked', callerEmployeeId: null, employees: baseEmployees, subordinateIdsByManager: baseSubordinates })
    await app.ready()
    const res = await app.inject({ method: 'GET', url: `/employees/${OWN_REPORT_ID}/payroll-summary` })
    expect(res.statusCode).toBe(403)
  })

  it('SECURITY: a manager cannot view payroll summary for an employee that exists only in a different tenant', async () => {
    const app = buildApp({ userRole: 'manager', userId: MANAGER_USER_ID, callerEmployeeId: MANAGER_EMP_ID, employees: baseEmployees, subordinateIdsByManager: baseSubordinates })
    await app.ready()
    const res = await app.inject({ method: 'GET', url: `/employees/${CROSS_TENANT_ID}/payroll-summary` })
    expect(res.statusCode).toBe(403)
  })

  it('REASSIGNMENT: once an employee is moved to a new manager, the FORMER manager immediately loses payroll-summary access', async () => {
    const formerManagerEmpId = 'emp-mgr-former'
    const reassignedEmpId    = 'emp-reassigned'
    // employees.manager_id now points at the NEW manager — the former
    // manager's own employee_id no longer matches, reflecting a completed
    // reassignment (this route reads the live employees row, not a cache).
    const employeesAfterReassignment: EmployeeRow[] = [
      ...baseEmployees,
      { id: formerManagerEmpId, tenant_id: TENANT, manager_id: null },
      { id: reassignedEmpId,    tenant_id: TENANT, manager_id: MANAGER_EMP_ID }, // now reports to MANAGER_EMP_ID, not formerManagerEmpId
    ]
    const app = buildApp({
      userRole: 'manager',
      userId:   'user-former-mgr',
      callerEmployeeId: formerManagerEmpId,
      employees: employeesAfterReassignment,
      // The former manager's own subordinate tree is now empty post-reassignment.
      subordinateIdsByManager: { ...baseSubordinates, [formerManagerEmpId]: [] },
    })
    await app.ready()
    const res = await app.inject({ method: 'GET', url: `/employees/${reassignedEmpId}/payroll-summary` })
    expect(res.statusCode).toBe(403)
  })

  it('REASSIGNMENT: the NEW manager gains payroll-summary access immediately after the same reassignment', async () => {
    const reassignedEmpId = 'emp-reassigned-2'
    const employeesAfterReassignment: EmployeeRow[] = [
      ...baseEmployees,
      { id: reassignedEmpId, tenant_id: TENANT, manager_id: MANAGER_EMP_ID },
    ]
    const app = buildApp({ userRole: 'manager', userId: MANAGER_USER_ID, callerEmployeeId: MANAGER_EMP_ID, employees: employeesAfterReassignment, subordinateIdsByManager: baseSubordinates })
    await app.ready()
    const res = await app.inject({ method: 'GET', url: `/employees/${reassignedEmpId}/payroll-summary` })
    expect(res.statusCode).toBe(200)
  })
})
