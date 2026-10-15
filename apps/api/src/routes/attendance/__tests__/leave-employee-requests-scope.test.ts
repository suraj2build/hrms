/**
 * SYSTEM_AUDIT_2026-10-14 checkpoint 10+1 — GET /leave/requests was gated
 * only on `MANAGER_ROLES.includes(role)`, with no team-membership check: a
 * plain `manager` (not HR) could pass ANY employee_id tenant-wide, or omit
 * it entirely and get every tenant leave request (including `reason`/
 * `rejection_reason` text), the same defect class checkpoint 6 already
 * fixed for the Approved-tab list in leave-requests.ts and checkpoint 4
 * fixed for context-data.ts. These tests prove the fix: a manager is
 * scoped to their own direct-report tree (self-service omits the param →
 * employeeIds filter; an out-of-team employee_id → 403); HR admins are
 * unaffected (still tenant-wide); a plain employee is still refused, as
 * before.
 */
import { describe, it, expect } from 'vitest'
import Fastify from 'fastify'
import leaveEmployeeRoutes from '../leave-employee.js'

const TENANT = 'tenant-1'

function buildApp(opts: {
  userRole:         string
  userId:           string
  callerEmployeeId: string | null
  reportIds:        string[]  // what get_all_subordinates returns for callerEmployeeId
}) {
  const app = Fastify()
  app.decorate('authenticate', async (req: any) => {
    req.tenantId = TENANT
    req.userId   = opts.userId
    req.userRole = opts.userRole
  })

  const capturedFilters: { employeeId?: string; employeeIds?: string[] }[] = []

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
      if (table === 'leave_requests') {
        const filter: { employeeId?: string; employeeIds?: string[] } = {}
        const chain: any = {
          select: () => chain,
          eq: (col: string, v: string) => {
            if (col === 'employee_id') filter.employeeId = v
            return chain
          },
          in: (col: string, v: string[]) => {
            if (col === 'employee_id') filter.employeeIds = v
            return chain
          },
          order: () => chain,
          gte:   () => chain,
          lte:   () => chain,
          range: () => { capturedFilters.push(filter); return chain },
          then:  (resolve: any) => resolve({ data: [], error: null }),
        }
        return chain
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
  app.register(leaveEmployeeRoutes)
  return { app, capturedFilters }
}

const MANAGER_EMP_ID = '11111111-1111-1111-1111-111111111111'
const REPORT_A       = '22222222-2222-2222-2222-222222222222'
const OUTSIDE_EMP    = '33333333-3333-3333-3333-333333333333'

describe('GET /leave/requests — team-scope guard', () => {
  it('plain employee role is still refused (pre-existing check, unaffected)', async () => {
    const { app } = buildApp({ userRole: 'employee', userId: 'u1', callerEmployeeId: 'emp-x', reportIds: [] })
    const res = await app.inject({ method: 'GET', url: '/leave/requests' })
    expect(res.statusCode).toBe(403)
  })

  it('HR admin may pass any employee_id, tenant-wide, unaffected', async () => {
    const { app, capturedFilters } = buildApp({ userRole: 'hr_admin', userId: 'u1', callerEmployeeId: 'emp-hr', reportIds: [] })
    const res = await app.inject({ method: 'GET', url: `/leave/requests?employee_id=${OUTSIDE_EMP}` })
    expect(res.statusCode).toBe(200)
    expect(capturedFilters[0]).toEqual({ employeeId: OUTSIDE_EMP })
  })

  it('HR admin omitting employee_id gets tenant-wide (no employeeIds restriction)', async () => {
    const { app, capturedFilters } = buildApp({ userRole: 'hr_admin', userId: 'u1', callerEmployeeId: 'emp-hr', reportIds: [] })
    const res = await app.inject({ method: 'GET', url: '/leave/requests' })
    expect(res.statusCode).toBe(200)
    expect(capturedFilters[0]).toEqual({})
  })

  it('manager requesting a direct report\'s id → 200, scoped to that one id', async () => {
    const { app, capturedFilters } = buildApp({
      userRole: 'manager', userId: 'u1', callerEmployeeId: MANAGER_EMP_ID, reportIds: [REPORT_A],
    })
    const res = await app.inject({ method: 'GET', url: `/leave/requests?employee_id=${REPORT_A}` })
    expect(res.statusCode).toBe(200)
    expect(capturedFilters[0]).toEqual({ employeeId: REPORT_A })
  })

  it('manager requesting a NON-report\'s id → 403, previously would have returned 200 with that employee\'s data', async () => {
    const { app } = buildApp({
      userRole: 'manager', userId: 'u1', callerEmployeeId: MANAGER_EMP_ID, reportIds: [REPORT_A],
    })
    const res = await app.inject({ method: 'GET', url: `/leave/requests?employee_id=${OUTSIDE_EMP}` })
    expect(res.statusCode).toBe(403)
  })

  it('manager omitting employee_id → scoped to their own report tree, not tenant-wide', async () => {
    const { app, capturedFilters } = buildApp({
      userRole: 'manager', userId: 'u1', callerEmployeeId: MANAGER_EMP_ID, reportIds: [REPORT_A],
    })
    const res = await app.inject({ method: 'GET', url: '/leave/requests' })
    expect(res.statusCode).toBe(200)
    expect(capturedFilters[0]).toEqual({ employeeIds: [REPORT_A] })
  })

  it('manager role with no linked employee record → 403, not a silent tenant-wide fallthrough', async () => {
    const { app } = buildApp({ userRole: 'manager', userId: 'u1', callerEmployeeId: null, reportIds: [] })
    const res = await app.inject({ method: 'GET', url: '/leave/requests' })
    expect(res.statusCode).toBe(403)
  })
})
