/**
 * SYSTEM_AUDIT_2026-10-14 — route-level proof that the overtime approval
 * QUEUE and the approval ACTION agree on scope, across a three-level
 * hierarchy (HR admin -> MANAGER -> DIRECT_REPORT -> GRANDCHILD).
 *
 * This is deliberately a route-level test (real Fastify app.inject() through
 * the actual overtimeRoutes handler), not a lib-level test of
 * getImmediateReportIds in isolation — the user's explicit ask after
 * checkpoint 6 was proof that "queue, count and action scope agree", not
 * just that the helper itself is correct.
 *
 * Scenarios:
 *   1. GET /overtime/requests (manager) lists the direct report's item,
 *      excludes the grandchild's.
 *   2. POST .../approve on the grandchild's item -> 403 (same manager who
 *      couldn't see it in (1) also can't act on it directly by id).
 *   3. POST .../approve on the direct report's item -> succeeds.
 *   4. Reassignment: once the grandchild is promoted to report directly to
 *      MANAGER (manager_id changes), the SAME manager's list now includes
 *      it and approve succeeds -- and symmetrically, if DIRECT_REPORT is
 *      moved OFF this manager, the list and approve both stop allowing it.
 *   5. Cross-tenant: an OT request whose employee exists only in another
 *      tenant is never visible and never actionable.
 *   6. Manager with no linked employee_id -> empty list, 403 on action.
 *   7. HR admin -> sees everything, can act on anything, unaffected by the
 *      manager-scope fix.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import Fastify, { type FastifyInstance, type FastifyRequest } from 'fastify'

vi.mock('../../../lib/ot-engine.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../lib/ot-engine.js')>()
  return { ...actual, approveOtRequest: vi.fn(), rejectOtRequest: vi.fn() }
})
vi.mock('../../../lib/approval-guards.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../lib/approval-guards.js')>()
  return { ...actual, isSelfApproval: vi.fn().mockResolvedValue(false) }
})
vi.mock('../../../lib/approval-orchestrator.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../lib/approval-orchestrator.js')>()
  return {
    ...actual,
    gateApprove: vi.fn().mockResolvedValue({ kind: 'finalize', authorized: false }),
    gateReject:  vi.fn().mockResolvedValue({ kind: 'finalize', authorized: false }),
  }
})
vi.mock('../../../lib/period-lock.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../lib/period-lock.js')>()
  return { ...actual, isMonthLocked: vi.fn().mockResolvedValue(false) }
})
vi.mock('../../../lib/audit-service.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../lib/audit-service.js')>()
  return { ...actual, logAction: vi.fn().mockResolvedValue(undefined) }
})

import overtimeRoutes from '../overtime.js'
import { approveOtRequest } from '../../../lib/ot-engine.js'

const approveMock = approveOtRequest as ReturnType<typeof vi.fn>

const TENANT_ID       = 'tenant-001'
const OTHER_TENANT_ID = 'tenant-002'
const MANAGER_ID       = 'emp-manager'
const DIRECT_REPORT_ID = 'emp-direct-report'
const GRANDCHILD_ID    = 'emp-grandchild'
const CROSS_TENANT_EMP_ID = 'emp-other-tenant'

const OT_DIRECT      = '11111111-1111-1111-1111-111111111111'
const OT_GRANDCHILD  = '22222222-2222-2222-2222-222222222222'
const OT_CROSS_TENANT = '33333333-3333-3333-3333-333333333333'

interface Fixture {
  managerOf: Record<string, string | null>   // employee_id -> manager_id (immediate)
  otRequests: Record<string, { employee_id: string; attendance_date: string; tenant_id: string }>
  callerEmployeeId: string | null
}

function buildSupabase(fx: Fixture) {
  return {
    from(table: string) {
      if (table === 'profiles') {
        const chain: any = {
          select: () => chain,
          eq:     () => chain,
          maybeSingle: () => Promise.resolve({ data: { employee_id: fx.callerEmployeeId }, error: null }),
        }
        return chain
      }
      if (table === 'employees') {
        // Two shapes used against this table:
        //   getImmediateReportIds: .select('id').eq('manager_id', X).eq('tenant_id', Y)
        //   isDirectReport:        .select('id').eq('id', empId).eq('manager_id', mgrId).eq('tenant_id', Y).maybeSingle()
        const chain: any = {
          _filters: {} as Record<string, unknown>,
          select: () => chain,
          eq(field: string, value: unknown) {
            chain._filters[field] = value
            return chain
          },
          maybeSingle() {
            const { id, manager_id, tenant_id } = chain._filters
            if (id !== undefined) {
              const ok = fx.managerOf[id as string] === manager_id && tenant_id === TENANT_ID
              return Promise.resolve({ data: ok ? { id } : null, error: null })
            }
            return Promise.resolve({ data: null, error: null })
          },
          then(resolve: (v: unknown) => void) {
            const ids = Object.entries(fx.managerOf)
              .filter(([, mgr]) => mgr === chain._filters.manager_id)
              .map(([id]) => id)
            resolve({ data: ids.map(id => ({ id })), error: null })
            return Promise.resolve()
          },
        }
        return chain
      }
      if (table === 'overtime_requests') {
        const chain: any = {
          _filters: {} as Record<string, unknown>,
          _ids: null as string[] | null,
          select: () => chain,
          eq(field: string, value: unknown) {
            chain._filters[field] = value
            return chain
          },
          in(field: string, ids: string[]) {
            if (field === 'employee_id') chain._ids = ids
            return chain
          },
          order: () => chain,
          range: () => chain,
          maybeSingle() {
            const id = chain._filters.id as string | undefined
            const row = id ? fx.otRequests[id] : undefined
            if (!row || row.tenant_id !== chain._filters.tenant_id) return Promise.resolve({ data: null, error: null })
            return Promise.resolve({ data: { employee_id: row.employee_id }, error: null })
          },
          then(resolve: (v: unknown) => void) {
            const tenantId = chain._filters.tenant_id
            let rows = Object.entries(fx.otRequests)
              .filter(([, r]) => r.tenant_id === tenantId)
              .map(([id, r]) => ({ id, employee_id: r.employee_id, attendance_date: r.attendance_date }))
            if (chain._ids) rows = rows.filter(r => chain._ids!.includes(r.employee_id))
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

async function buildApp(fx: Fixture, role: string = 'manager'): Promise<FastifyInstance> {
  const app = Fastify({ logger: false })
  app.decorateRequest('tenantId', '')
  app.decorateRequest('userId', '')
  app.decorateRequest('userRole', '')
  app.decorate('authenticate', async (req: FastifyRequest) => {
    ;(req as any).tenantId = TENANT_ID
    ;(req as any).userId   = 'caller-profile-001'
    ;(req as any).userRole = role
  })
  app.decorate('supabase', buildSupabase(fx) as any)
  await app.register(overtimeRoutes)
  await app.ready()
  return app
}

const HEADERS = { 'content-type': 'application/json', authorization: 'Bearer test-token' }

function baseFixture(): Fixture {
  return {
    managerOf: {
      [DIRECT_REPORT_ID]: MANAGER_ID,
      [GRANDCHILD_ID]:    DIRECT_REPORT_ID,   // one level further down — NOT a direct report of MANAGER_ID
    },
    otRequests: {
      [OT_DIRECT]:       { employee_id: DIRECT_REPORT_ID, attendance_date: '2026-01-05', tenant_id: TENANT_ID },
      [OT_GRANDCHILD]:   { employee_id: GRANDCHILD_ID,    attendance_date: '2026-01-06', tenant_id: TENANT_ID },
      [OT_CROSS_TENANT]: { employee_id: CROSS_TENANT_EMP_ID, attendance_date: '2026-01-07', tenant_id: OTHER_TENANT_ID },
    },
    callerEmployeeId: MANAGER_ID,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('Overtime manager scope: queue and action agree', () => {
  it('1. GET /overtime/requests lists the direct report, excludes the grandchild', async () => {
    const app = await buildApp(baseFixture())
    const res = await app.inject({ method: 'GET', url: '/overtime/requests', headers: HEADERS })
    expect(res.statusCode).toBe(200)
    const ids = JSON.parse(res.body).data.map((r: any) => r.id)
    expect(ids).toContain(OT_DIRECT)
    expect(ids).not.toContain(OT_GRANDCHILD)
  })

  it('2. POST .../approve on the grandchild\'s (invisible) item -> 403, never calls approveOtRequest', async () => {
    const app = await buildApp(baseFixture())
    const res = await app.inject({
      method: 'POST', url: `/overtime/requests/${OT_GRANDCHILD}/approve`, headers: HEADERS, payload: {},
    })
    expect(res.statusCode).toBe(403)
    expect(approveMock).not.toHaveBeenCalled()
  })

  it('3. POST .../approve on the direct report\'s (visible) item -> succeeds', async () => {
    approveMock.mockResolvedValue({ ok: true, data: { id: OT_DIRECT, status: 'approved' } })
    const app = await buildApp(baseFixture())
    const res = await app.inject({
      method: 'POST', url: `/overtime/requests/${OT_DIRECT}/approve`, headers: HEADERS, payload: {},
    })
    expect(res.statusCode).toBe(200)
    expect(approveMock).toHaveBeenCalledTimes(1)
  })

  it('4a. REASSIGNMENT: once the grandchild reports directly to the manager, the queue includes it and approve succeeds', async () => {
    approveMock.mockResolvedValue({ ok: true, data: { id: OT_GRANDCHILD, status: 'approved' } })
    const fx = baseFixture()
    fx.managerOf[GRANDCHILD_ID] = MANAGER_ID   // promoted to a direct report

    const listApp = await buildApp(fx)
    const listRes = await listApp.inject({ method: 'GET', url: '/overtime/requests', headers: HEADERS })
    expect(JSON.parse(listRes.body).data.map((r: any) => r.id)).toContain(OT_GRANDCHILD)

    const actApp = await buildApp(fx)
    const actRes = await actApp.inject({
      method: 'POST', url: `/overtime/requests/${OT_GRANDCHILD}/approve`, headers: HEADERS, payload: {},
    })
    expect(actRes.statusCode).toBe(200)
  })

  it('4b. REASSIGNMENT: once the direct report is moved OFF this manager, the queue excludes it and approve 403s', async () => {
    const fx = baseFixture()
    fx.managerOf[DIRECT_REPORT_ID] = 'some-other-manager'   // no longer reports to MANAGER_ID

    const listApp = await buildApp(fx)
    const listRes = await listApp.inject({ method: 'GET', url: '/overtime/requests', headers: HEADERS })
    expect(JSON.parse(listRes.body).data.map((r: any) => r.id)).not.toContain(OT_DIRECT)

    const actApp = await buildApp(fx)
    const actRes = await actApp.inject({
      method: 'POST', url: `/overtime/requests/${OT_DIRECT}/approve`, headers: HEADERS, payload: {},
    })
    expect(actRes.statusCode).toBe(403)
    expect(approveMock).not.toHaveBeenCalled()
  })

  it('5. Cross-tenant: a same-id-shaped OT request belonging to another tenant is never visible or actionable', async () => {
    const app = await buildApp(baseFixture())
    const listRes = await app.inject({ method: 'GET', url: '/overtime/requests', headers: HEADERS })
    expect(JSON.parse(listRes.body).data.map((r: any) => r.id)).not.toContain(OT_CROSS_TENANT)

    const actRes = await app.inject({
      method: 'POST', url: `/overtime/requests/${OT_CROSS_TENANT}/approve`, headers: HEADERS, payload: {},
    })
    // authorizeOtTarget's tenant-scoped fetch finds nothing -> 404, never 200
    expect(actRes.statusCode).toBe(404)
    expect(approveMock).not.toHaveBeenCalled()
  })

  it('6. Manager with no linked employee_id -> empty queue, 403 on any action', async () => {
    const fx = baseFixture()
    fx.callerEmployeeId = null
    const app = await buildApp(fx)

    const listRes = await app.inject({ method: 'GET', url: '/overtime/requests', headers: HEADERS })
    expect(JSON.parse(listRes.body).data).toEqual([])

    const actRes = await app.inject({
      method: 'POST', url: `/overtime/requests/${OT_DIRECT}/approve`, headers: HEADERS, payload: {},
    })
    expect(actRes.statusCode).toBe(403)
  })

  it('7. HR admin sees and can act on everything in-tenant, unaffected by the manager-scope fix', async () => {
    approveMock.mockResolvedValue({ ok: true, data: { id: OT_GRANDCHILD, status: 'approved' } })
    const app = await buildApp(baseFixture(), 'hr_admin')

    const listRes = await app.inject({ method: 'GET', url: '/overtime/requests', headers: HEADERS })
    const ids = JSON.parse(listRes.body).data.map((r: any) => r.id)
    expect(ids).toContain(OT_DIRECT)
    expect(ids).toContain(OT_GRANDCHILD)
    expect(ids).not.toContain(OT_CROSS_TENANT)

    const actRes = await app.inject({
      method: 'POST', url: `/overtime/requests/${OT_GRANDCHILD}/approve`, headers: HEADERS, payload: {},
    })
    expect(actRes.statusCode).toBe(200)
  })
})
