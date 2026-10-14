/**
 * /employees/:id/{attendance,overtime,payroll-summary} — team-scope guard
 * (SYSTEM_AUDIT_2026-10-14 continuation). These endpoints were gated only on
 * role (MANAGER_ROLES: hr_admin/super_admin/manager) with no check that the
 * target employee is actually in the caller's team — any manager could pull
 * any employee's attendance, overtime, AND payroll-summary (CTC, net pay,
 * deductions) tenant-wide just by knowing the employee_id. Fixed using the
 * same isDirectReport/getDirectReportIds pattern already established for
 * overtime/comp-off/separation clearance (manager-scope.ts).
 */
import { describe, it, expect, vi } from 'vitest'
import Fastify from 'fastify'
import contextDataRoutes from '../context-data.js'

const TENANT = 'tenant-1'
const MANAGER_USER_ID = 'user-mgr-1'
const MANAGER_EMP_ID  = 'emp-mgr-1'
const OWN_REPORT_ID   = 'emp-report-1'
const OUTSIDE_EMP_ID  = 'emp-outside-1'

function buildApp(opts: { userRole: string; userId: string }) {
  const app = Fastify()
  app.decorate('authenticate', async (req: any) => {
    req.tenantId = TENANT
    req.userId   = opts.userId
    req.userRole = opts.userRole
  })

  const supabase = {
    from(table: string) {
      if (table === 'employees') {
        return {
          select: () => ({
            eq: () => ({
              eq: () => ({
                maybeSingle: () => Promise.resolve({ data: { id: OWN_REPORT_ID }, error: null }),
              }),
            }),
          }),
        }
      }
      if (table === 'profiles') {
        return {
          select: () => ({
            eq: () => ({
              eq: () => ({
                maybeSingle: () => Promise.resolve({ data: { employee_id: MANAGER_EMP_ID }, error: null }),
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
        // Manager's only direct report is OWN_REPORT_ID — OUTSIDE_EMP_ID is never in this list.
        if (params.p_manager_id === MANAGER_EMP_ID) {
          return Promise.resolve({ data: [{ id: OWN_REPORT_ID }], error: null })
        }
        return Promise.resolve({ data: [], error: null })
      }
      throw new Error(`unexpected rpc ${fn}`)
    },
  }
  app.decorate('supabase', supabase as any)
  app.register(contextDataRoutes)
  return app
}

describe('GET /employees/:id/attendance — manager team-scope', () => {
  it('a manager CAN view their own direct report\'s attendance', async () => {
    const app = buildApp({ userRole: 'manager', userId: MANAGER_USER_ID })
    await app.ready()
    const res = await app.inject({ method: 'GET', url: `/employees/${OWN_REPORT_ID}/attendance` })
    expect(res.statusCode).toBe(200)
  })

  it('SECURITY: a manager CANNOT view an employee outside their team', async () => {
    const app = buildApp({ userRole: 'manager', userId: MANAGER_USER_ID })
    await app.ready()
    const res = await app.inject({ method: 'GET', url: `/employees/${OUTSIDE_EMP_ID}/attendance` })
    expect(res.statusCode).toBe(403)
  })

  it('an hr_admin bypasses team scoping entirely', async () => {
    const app = buildApp({ userRole: 'hr_admin', userId: 'user-hr-1' })
    await app.ready()
    const res = await app.inject({ method: 'GET', url: `/employees/${OUTSIDE_EMP_ID}/attendance` })
    expect(res.statusCode).toBe(200)
  })
})

describe('GET /employees/:id/overtime — manager team-scope', () => {
  it('SECURITY: a manager CANNOT view overtime for an employee outside their team', async () => {
    const app = buildApp({ userRole: 'manager', userId: MANAGER_USER_ID })
    await app.ready()
    const res = await app.inject({ method: 'GET', url: `/employees/${OUTSIDE_EMP_ID}/overtime` })
    expect(res.statusCode).toBe(403)
  })
})

describe('GET /employees/:id/payroll-summary — manager team-scope (most sensitive: CTC/net pay/deductions)', () => {
  it('SECURITY: a manager CANNOT view payroll summary for an employee outside their team', async () => {
    const app = buildApp({ userRole: 'manager', userId: MANAGER_USER_ID })
    await app.ready()
    const res = await app.inject({ method: 'GET', url: `/employees/${OUTSIDE_EMP_ID}/payroll-summary` })
    expect(res.statusCode).toBe(403)
  })

  it('a manager CAN view payroll summary for their own direct report', async () => {
    const app = buildApp({ userRole: 'manager', userId: MANAGER_USER_ID })
    await app.ready()
    const res = await app.inject({ method: 'GET', url: `/employees/${OWN_REPORT_ID}/payroll-summary` })
    expect(res.statusCode).toBe(200)
  })
})
