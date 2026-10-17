/**
 * Manager-scope regression tests for two SYSTEM_AUDIT_2026-10-14 findings:
 *
 *  1. GET /analytics/workforce/reliability claimed ("Admin can request
 *     team-wide; manager gets their team only") but applied NO scoping at
 *     all — any authenticated manager could pull tenant-wide reliability
 *     scores for every employee.
 *  2. GET /analytics/workforce/drill scoped managers to
 *     `job_history.manager_id = req.employeeId` (one level only), while
 *     manager-scope.ts's documented contract for pure read-only/historical
 *     team visibility is the FULL subordinate tree (getDirectReportIds) —
 *     a manager-of-managers silently lost every grandchild's data.
 *
 * Both are fixed by resolving the caller's full subordinate tree via
 * manager-scope.ts's getDirectReportIds() (backed by the get_all_subordinates
 * RPC) and filtering the attendance_daily / employees query to it.
 */
import { describe, it, expect } from 'vitest'
import Fastify, { type FastifyRequest } from 'fastify'
import workforceIntelligenceRoutes from '../workforce-intelligence.js'
import workforceDrillRoutes from '../workforce-drill.js'

const TENANT_ID = 'tenant-test-001'
const MANAGER_EMPLOYEE_ID = 'mgr-1'
const SUBORDINATE_IDS = ['sub-1', 'sub-2']
const OUTSIDE_EMPLOYEE_ID = 'outside-1'

function genericChain(result: unknown) {
  const chain: any = {
    select: () => chain,
    eq: () => chain, neq: () => chain, gte: () => chain, lte: () => chain, lt: () => chain,
    in: () => chain, not: () => chain, is: () => chain, or: () => chain, order: () => chain,
    limit: () => chain, ilike: () => chain, gt: () => chain,
    maybeSingle: () => Promise.resolve(result),
    single: () => Promise.resolve(result),
    range: (from: number) => Promise.resolve(from === 0 ? result : { data: [], error: null }),
    then: (resolve: (v: unknown) => void) => resolve(result),
  }
  return chain
}

/** attendance_daily rows: one for a subordinate, one for an employee outside the manager's team. */
const ATTENDANCE_ROWS = [
  { employee_id: SUBORDINATE_IDS[0], status: 'present', work_hours: 8, overtime_minutes: 0 },
  { employee_id: SUBORDINATE_IDS[1], status: 'absent',  work_hours: 0, overtime_minutes: 0 },
  { employee_id: OUTSIDE_EMPLOYEE_ID, status: 'present', work_hours: 8, overtime_minutes: 0 },
]

function buildSupabase() {
  return {
    from(table: string) {
      if (table === 'tenants') return genericChain({ data: { timezone: 'UTC' }, error: null })
      if (table === 'profiles') {
        return genericChain({ data: { employee_id: MANAGER_EMPLOYEE_ID }, error: null })
      }
      if (table === 'attendance_daily') {
        // in('employee_id', ids) scopes the rows returned, mirroring Postgres filtering.
        let filterIds: string[] | null = null
        const chain: any = {
          select: () => chain, eq: () => chain, gte: () => chain, lte: () => chain, gt: () => chain,
          in: (col: string, ids: string[]) => { if (col === 'employee_id') filterIds = ids; return chain },
          range: (from: number) => {
            if (from !== 0) return Promise.resolve({ data: [], error: null })
            const rows = filterIds ? ATTENDANCE_ROWS.filter(r => filterIds!.includes(r.employee_id)) : ATTENDANCE_ROWS
            return Promise.resolve({ data: rows, error: null })
          },
        }
        return chain
      }
      if (table === 'employees') {
        let filterIds: string[] | null = null
        const allEmployees = [
          { id: SUBORDINATE_IDS[0], employee_code: 'E1', first_name: 'Sub', last_name: 'One', job_history: [{ is_current: true, department_id: null, departments: null, manager_id: MANAGER_EMPLOYEE_ID }] },
          { id: SUBORDINATE_IDS[1], employee_code: 'E2', first_name: 'Sub', last_name: 'Two', job_history: [{ is_current: true, department_id: null, departments: null, manager_id: MANAGER_EMPLOYEE_ID }] },
          { id: OUTSIDE_EMPLOYEE_ID, employee_code: 'E3', first_name: 'Out', last_name: 'Side', job_history: [{ is_current: true, department_id: null, departments: null, manager_id: 'some-other-manager' }] },
        ]
        const chain: any = {
          select: () => chain, eq: () => chain, status: () => chain,
          in: (col: string, ids: string[]) => { if (col === 'id') filterIds = ids; return chain },
          range: (from: number) => {
            if (from !== 0) return Promise.resolve({ data: [], error: null })
            const rows = filterIds ? allEmployees.filter(e => filterIds!.includes(e.id)) : allEmployees
            return Promise.resolve({ data: rows, error: null })
          },
        }
        return chain
      }
      return genericChain({ data: [], error: null })
    },
    rpc(fn: string, args: any) {
      if (fn === 'get_all_subordinates') {
        // Only the manager's own id resolves subordinates; anyone else gets none.
        const data = args.p_manager_id === MANAGER_EMPLOYEE_ID
          ? SUBORDINATE_IDS.map(id => ({ id }))
          : []
        return Promise.resolve({ data, error: null })
      }
      return Promise.resolve({ data: null, error: null })
    },
  } as any
}

async function buildApp(routes: (f: any) => Promise<void>) {
  const app = Fastify({ logger: false })
  app.decorateRequest('tenantId', '')
  app.decorateRequest('userId', '')
  app.decorateRequest('userRole', '')
  app.decorateRequest('employeeId', '')

  app.decorate('authenticate', async (req: FastifyRequest) => {
    ;(req as any).tenantId   = TENANT_ID
    ;(req as any).userId     = 'manager-user-1'
    ;(req as any).userRole   = 'manager'
    ;(req as any).employeeId = MANAGER_EMPLOYEE_ID
  })
  app.decorate('supabase', buildSupabase())

  await app.register(routes)
  await app.ready()
  return app
}

describe('GET /analytics/workforce/reliability — manager scope', () => {
  it('only returns the manager\'s own subordinate tree, never employees outside it', async () => {
    const app = await buildApp(workforceIntelligenceRoutes)

    const res = await app.inject({
      method: 'GET',
      url: '/analytics/workforce/reliability?from=2026-01-01&to=2026-01-31',
      headers: { authorization: 'Bearer test-token' },
    })

    expect(res.statusCode).toBe(200)
    const body = res.json()
    const ids = body.employees.map((e: any) => e.employee_id)
    expect(ids).toEqual(expect.arrayContaining(SUBORDINATE_IDS))
    expect(ids).not.toContain(OUTSIDE_EMPLOYEE_ID)
  })
})

describe('GET /analytics/workforce/drill — manager scope', () => {
  it('scopes to the full subordinate tree (not just one level), excluding outside employees', async () => {
    const app = await buildApp(workforceDrillRoutes)

    const res = await app.inject({
      method: 'GET',
      url: '/analytics/workforce/drill?metric=absent&from=2026-01-01&to=2026-01-31',
      headers: { authorization: 'Bearer test-token' },
    })

    expect(res.statusCode).toBe(200)
    const body = res.json()
    const ids = body.employees.map((e: any) => e.employee_id)
    expect(ids).not.toContain(OUTSIDE_EMPLOYEE_ID)
  })
})
