/**
 * SYSTEM_AUDIT_2026-10-14 — route-level proof that the comp-off approval
 * QUEUE and the approval ACTION agree on scope. Mirrors
 * overtime-manager-scope.test.ts's structure and rationale.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import Fastify, { type FastifyInstance, type FastifyRequest } from 'fastify'

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

import compOffRoutes from '../comp-off.js'

const TENANT_ID       = 'tenant-001'
const OTHER_TENANT_ID = 'tenant-002'
const MANAGER_ID       = 'emp-manager'
const DIRECT_REPORT_ID = 'emp-direct-report'
const GRANDCHILD_ID    = 'emp-grandchild'
const CROSS_TENANT_EMP_ID = 'emp-other-tenant'
const LEAVE_TYPE_ID = 'lt-comp-off'

const CO_DIRECT       = '11111111-1111-1111-1111-111111111111'
const CO_GRANDCHILD   = '22222222-2222-2222-2222-222222222222'
const CO_CROSS_TENANT = '33333333-3333-3333-3333-333333333333'

interface CoRow { employee_id: string; worked_date: string; tenant_id: string; status: string; leave_type_id: string | null; days_to_credit: number }
interface Fixture {
  managerOf: Record<string, string | null>
  coRequests: Record<string, CoRow>
  callerEmployeeId: string | null
}

function buildSupabase(fx: Fixture) {
  return {
    rpc: vi.fn((fnName: string, params: any) => {
      if (fnName === 'approve_comp_off_claim_atomic') {
        const row = fx.coRequests[params.p_co_id]
        if (!row || row.tenant_id !== TENANT_ID) return Promise.resolve({ data: null, error: { message: 'NOT_FOUND: Comp off request not found' } })
        if (row.status !== 'pending') return Promise.resolve({ data: null, error: { message: `CONFLICT: Request is already ${row.status}` } })
        row.status = 'approved'
        return Promise.resolve({ data: { id: params.p_co_id, status: 'approved' }, error: null })
      }
      return Promise.resolve({ data: null, error: null })
    }),
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
        //   getImmediateReportIds: .select('id').eq('manager_id', X).eq('tenant_id', Y)          -> list (then)
        //   isDirectReport:        .select('id').eq('id', e).eq('manager_id', m).eq('tenant_id', Y).maybeSingle()
        const chain: any = {
          _filters: {} as Record<string, unknown>,
          select: () => chain,
          eq(field: string, value: unknown) { chain._filters[field] = value; return chain },
          maybeSingle() {
            const { id, manager_id } = chain._filters
            const ok = id !== undefined && fx.managerOf[id as string] === manager_id
            return Promise.resolve({ data: ok ? { id } : null, error: null })
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
      if (table === 'comp_off_requests') {
        const chain: any = {
          _filters: {} as Record<string, unknown>,
          _ids: null as string[] | null,
          select: () => chain,
          eq(field: string, value: unknown) { chain._filters[field] = value; return chain },
          in(field: string, ids: string[]) { if (field === 'employee_id') chain._ids = ids; return chain },
          order: () => chain,
          update(fields: Record<string, unknown>) {
            chain._updateFields = fields
            return chain
          },
          maybeSingle() {
            const id = chain._filters.id as string | undefined
            const row = id ? fx.coRequests[id] : undefined
            if (!row || row.tenant_id !== chain._filters.tenant_id) return Promise.resolve({ data: null, error: null })
            return Promise.resolve({ data: { employee_id: row.employee_id, leave_type_id: row.leave_type_id, worked_date: row.worked_date, days_to_credit: row.days_to_credit, status: row.status, id, tenant_id: row.tenant_id }, error: null })
          },
          then(resolve: (v: unknown) => void) {
            if (chain._updateFields) {
              // The atomic claim UPDATE ... WHERE status='pending'
              const id = chain._filters.id as string
              const row = fx.coRequests[id]
              if (row && row.tenant_id === chain._filters.tenant_id && row.status === 'pending') {
                row.status = chain._updateFields.status as string
                resolve({ data: [{ id }], error: null })
              } else {
                resolve({ data: [], error: null })
              }
              return Promise.resolve()
            }
            const tenantId = chain._filters.tenant_id
            let rows = Object.entries(fx.coRequests)
              .filter(([, r]) => r.tenant_id === tenantId)
              .map(([id, r]) => ({ id, employee_id: r.employee_id, worked_date: r.worked_date, worked_reason: null, days_to_credit: r.days_to_credit, status: r.status, notes: null, created_at: '2026-01-01', reviewed_at: null, leave_types: null, employees: null }))
            if (chain._ids) rows = rows.filter(r => chain._ids!.includes(r.employee_id))
            resolve({ data: rows, error: null })
            return Promise.resolve()
          },
        }
        return chain
      }
      if (table === 'leave_policy_rules' || table === 'leave_policies') {
        const chain: any = {
          select: () => chain, eq: () => chain, not: () => chain, order: () => chain, limit: () => chain,
          maybeSingle: () => Promise.resolve({ data: null, error: null }),
        }
        return chain
      }
      if (table === 'leave_accrual_ledger') {
        return { upsert: () => ({ select: () => Promise.resolve({ data: [{ id: 'ledger-1' }], error: null }) }) }
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
  await app.register(compOffRoutes)
  await app.ready()
  return app
}

const HEADERS = { 'content-type': 'application/json', authorization: 'Bearer test-token' }

function baseFixture(): Fixture {
  return {
    managerOf: {
      [DIRECT_REPORT_ID]: MANAGER_ID,
      [GRANDCHILD_ID]:    DIRECT_REPORT_ID,
    },
    coRequests: {
      [CO_DIRECT]:       { employee_id: DIRECT_REPORT_ID, worked_date: '2026-01-05', tenant_id: TENANT_ID, status: 'pending', leave_type_id: LEAVE_TYPE_ID, days_to_credit: 1 },
      [CO_GRANDCHILD]:   { employee_id: GRANDCHILD_ID,    worked_date: '2026-01-06', tenant_id: TENANT_ID, status: 'pending', leave_type_id: LEAVE_TYPE_ID, days_to_credit: 1 },
      [CO_CROSS_TENANT]: { employee_id: CROSS_TENANT_EMP_ID, worked_date: '2026-01-07', tenant_id: OTHER_TENANT_ID, status: 'pending', leave_type_id: LEAVE_TYPE_ID, days_to_credit: 1 },
    },
    callerEmployeeId: MANAGER_ID,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('Comp-off manager scope: queue and action agree', () => {
  it('1. GET /attendance/comp-off lists the direct report, excludes the grandchild', async () => {
    const app = await buildApp(baseFixture())
    const res = await app.inject({ method: 'GET', url: '/attendance/comp-off', headers: HEADERS })
    expect(res.statusCode).toBe(200)
    const ids = JSON.parse(res.body).data.map((r: any) => r.id)
    expect(ids).toContain(CO_DIRECT)
    expect(ids).not.toContain(CO_GRANDCHILD)
  })

  it('2. POST .../approve on the grandchild\'s (invisible) item -> 403, request never claimed', async () => {
    const fx = baseFixture()
    const app = await buildApp(fx)
    const res = await app.inject({
      method: 'POST', url: `/attendance/comp-off/${CO_GRANDCHILD}/approve`, headers: HEADERS, payload: {},
    })
    expect(res.statusCode).toBe(403)
    expect(fx.coRequests[CO_GRANDCHILD].status).toBe('pending')   // untouched
  })

  it('3. POST .../approve on the direct report\'s (visible) item -> succeeds and credits', async () => {
    const fx = baseFixture()
    const app = await buildApp(fx)
    const res = await app.inject({
      method: 'POST', url: `/attendance/comp-off/${CO_DIRECT}/approve`, headers: HEADERS, payload: {},
    })
    expect(res.statusCode).toBe(200)
    expect(fx.coRequests[CO_DIRECT].status).toBe('approved')
  })

  it('4a. REASSIGNMENT: grandchild promoted to a direct report -> queue includes it, approve succeeds', async () => {
    const fx = baseFixture()
    fx.managerOf[GRANDCHILD_ID] = MANAGER_ID

    const listApp = await buildApp(fx)
    const listRes = await listApp.inject({ method: 'GET', url: '/attendance/comp-off', headers: HEADERS })
    expect(JSON.parse(listRes.body).data.map((r: any) => r.id)).toContain(CO_GRANDCHILD)

    const actApp = await buildApp(fx)
    const actRes = await actApp.inject({
      method: 'POST', url: `/attendance/comp-off/${CO_GRANDCHILD}/approve`, headers: HEADERS, payload: {},
    })
    expect(actRes.statusCode).toBe(200)
  })

  it('4b. REASSIGNMENT: direct report moved off this manager -> queue excludes it, approve 403s', async () => {
    const fx = baseFixture()
    fx.managerOf[DIRECT_REPORT_ID] = 'some-other-manager'

    const listApp = await buildApp(fx)
    const listRes = await listApp.inject({ method: 'GET', url: '/attendance/comp-off', headers: HEADERS })
    expect(JSON.parse(listRes.body).data.map((r: any) => r.id)).not.toContain(CO_DIRECT)

    const actApp = await buildApp(fx)
    const actRes = await actApp.inject({
      method: 'POST', url: `/attendance/comp-off/${CO_DIRECT}/approve`, headers: HEADERS, payload: {},
    })
    expect(actRes.statusCode).toBe(403)
    expect(fx.coRequests[CO_DIRECT].status).toBe('pending')
  })

  it('5. Cross-tenant comp-off request is never visible or actionable', async () => {
    const app = await buildApp(baseFixture())
    const listRes = await app.inject({ method: 'GET', url: '/attendance/comp-off', headers: HEADERS })
    expect(JSON.parse(listRes.body).data.map((r: any) => r.id)).not.toContain(CO_CROSS_TENANT)

    const actRes = await app.inject({
      method: 'POST', url: `/attendance/comp-off/${CO_CROSS_TENANT}/approve`, headers: HEADERS, payload: {},
    })
    expect(actRes.statusCode).toBe(404)
  })

  it('6. Manager with no linked employee_id -> empty queue, 403 on any action', async () => {
    const fx = baseFixture()
    fx.callerEmployeeId = null
    const app = await buildApp(fx)

    const listRes = await app.inject({ method: 'GET', url: '/attendance/comp-off', headers: HEADERS })
    expect(JSON.parse(listRes.body).data).toEqual([])

    const actRes = await app.inject({
      method: 'POST', url: `/attendance/comp-off/${CO_DIRECT}/approve`, headers: HEADERS, payload: {},
    })
    expect(actRes.statusCode).toBe(403)
  })

  it('7. HR admin sees and can act on everything in-tenant', async () => {
    const fx = baseFixture()
    const app = await buildApp(fx, 'hr_admin')

    const listRes = await app.inject({ method: 'GET', url: '/attendance/comp-off', headers: HEADERS })
    const ids = JSON.parse(listRes.body).data.map((r: any) => r.id)
    expect(ids).toContain(CO_DIRECT)
    expect(ids).toContain(CO_GRANDCHILD)
    expect(ids).not.toContain(CO_CROSS_TENANT)

    const actRes = await app.inject({
      method: 'POST', url: `/attendance/comp-off/${CO_GRANDCHILD}/approve`, headers: HEADERS, payload: {},
    })
    expect(actRes.statusCode).toBe(200)
  })
})
