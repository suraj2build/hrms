/**
 * SYSTEM_AUDIT_2026-10-14 — manager-of-managers scope fix regression tests.
 *
 * Two endpoints in leave-requests.ts previously scoped a manager's view via
 * getDirectReportIds (the FULL subordinate tree, any depth) while the action
 * the view exists to drive — reverseApprovedLeaveRequest / the leave+reg+ot
 * +comp-off approve/reject actions behind the pending-count badge — only ever
 * authorizes the employee's IMMEDIATE manager (validateApprover /
 * authorizeOtTarget / authorizeCompOffTarget, all isDirectReport-based, one
 * level). A manager-of-managers could see a grandchild's item in the list or
 * badge count with a clickable action that would always 403.
 *
 *   1. GET /approvals/pending-count — must count only immediate reports'
 *      pending items, not the whole subordinate tree.
 *   2. GET /leave-requests?status=APPROVED (manager, no employee_id) — the
 *      "Approved" tab backing the cancel-approval action — must list only
 *      immediate reports' approved leave.
 *
 * Both are verified against a three-level hierarchy (manager -> direct report
 * -> grandchild) so "immediate only" and "full tree" produce different,
 * observable results.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import Fastify, { type FastifyInstance, type FastifyRequest } from 'fastify'

import leaveRequestsRoutes from '../leave-requests.js'

const TENANT_ID       = 'tenant-test-001'
const MANAGER_ID      = 'emp-manager'      // the caller — manages DIRECT_REPORT_ID only
const DIRECT_REPORT_ID = 'emp-direct-report'  // manager_id = MANAGER_ID
const GRANDCHILD_ID    = 'emp-grandchild'     // manager_id = DIRECT_REPORT_ID (deep tree only)

// employee_id -> manager_id, used by getImmediateReportIds' employees query.
const MANAGER_OF: Record<string, string | null> = {
  [DIRECT_REPORT_ID]: MANAGER_ID,
  [GRANDCHILD_ID]:    DIRECT_REPORT_ID,
}

function buildMockSupabase(rows: {
  leaveApproved?: Array<{ id: string; employee_id: string }>
  pendingCounts?: { leave?: string[]; reg?: string[]; ot?: string[]; co?: string[] }
}) {
  const leaveApproved = rows.leaveApproved ?? []
  const pending = rows.pendingCounts ?? {}

  function employeesChain() {
    const chain: any = {
      select: () => chain,
      eq(field: string, value: unknown) {
        if (field === 'manager_id') chain._managerId = value
        return chain
      },
      then(resolve: (v: unknown) => void) {
        const reportIds = Object.entries(MANAGER_OF)
          .filter(([, mgr]) => mgr === chain._managerId)
          .map(([id]) => id)
        resolve({ data: reportIds.map(id => ({ id })), error: null })
        return Promise.resolve()
      },
    }
    return chain
  }

  // Generic "count rows whose employee_id is in a given list" chain, used by
  // both the /approvals/pending-count badge and the count-only branch of
  // GET /leave-requests.
  function countableChain(allIds: string[]) {
    const chain: any = {
      _ids: null as string[] | null,
      select: () => chain,
      eq(field: string, value: unknown) {
        if (field === 'status') chain._status = value
        return chain
      },
      in(field: string, ids: string[]) {
        if (field === 'employee_id') chain._ids = ids
        return chain
      },
      order: () => chain,
      range: () => chain,
      then(resolve: (v: unknown) => void) {
        const scoped = chain._ids ? allIds.filter(id => chain._ids!.includes(id)) : allIds
        resolve({ data: scoped.map(id => ({ id: `row-${id}` })), error: null, count: scoped.length })
        return Promise.resolve()
      },
    }
    return chain
  }

  const supabase = {
    rpc: vi.fn(),
    from(table: string) {
      if (table === 'profiles') {
        const chain: any = {
          select: () => chain,
          eq:     () => chain,
          maybeSingle: () => Promise.resolve({ data: { employee_id: MANAGER_ID }, error: null }),
        }
        return chain
      }
      if (table === 'employees') return employeesChain()
      if (table === 'leave_requests') {
        // Serves two call sites that both query this table directly:
        //   - the Approved tab's list/count (status=APPROVED) -> leaveApproved
        //   - the pending-count badge (status=PENDING)         -> pendingCounts.leave
        const approvedIds = leaveApproved.map(r => r.employee_id)
        const pendingLeaveIds = pending.leave ?? []
        const chain: any = {
          select: () => chain,
          eq(field: string, value: unknown) {
            if (field === 'status') chain._status = value
            return chain
          },
          gte:    () => chain,
          lte:    () => chain,
          order:  () => chain,
          in(field: string, ids: string[]) {
            if (field === 'employee_id') chain._ids = ids
            return chain
          },
          range:  () => chain,
          then(resolve: (v: unknown) => void) {
            const sourceIds = chain._status === 'PENDING' ? pendingLeaveIds : approvedIds
            const scoped = chain._ids ? sourceIds.filter((id: string) => chain._ids!.includes(id)) : sourceIds
            resolve({ data: scoped.map((id: string) => ({ id: `leave-${id}`, employee_id: id })), error: null, count: scoped.length })
            return Promise.resolve()
          },
        }
        return chain
      }
      if (table === 'attendance_regularisation') return countableChain(pending.reg ?? [])
      if (table === 'overtime_requests')         return countableChain(pending.ot ?? [])
      if (table === 'comp_off_requests')         return countableChain(pending.co ?? [])
      throw new Error(`buildMockSupabase: unexpected table "${table}"`)
    },
  }
  return supabase
}

async function buildApp(opts: Parameters<typeof buildMockSupabase>[0]): Promise<FastifyInstance> {
  const supabase = buildMockSupabase(opts)
  const app = Fastify({ logger: false })

  app.decorateRequest('tenantId', '')
  app.decorateRequest('userId', '')
  app.decorateRequest('userRole', '')

  app.decorate('authenticate', async (req: FastifyRequest) => {
    ;(req as any).tenantId = TENANT_ID
    ;(req as any).userId   = 'manager-profile-001'
    ;(req as any).userRole = 'manager'
  })

  app.decorate('supabase', supabase as any)
  app.decorate('eventPublisher', { publish: vi.fn() } as any)

  await app.register(leaveRequestsRoutes)
  await app.ready()
  return app
}

const HEADERS = { authorization: 'Bearer test-token' }

beforeEach(() => {
  vi.clearAllMocks()
})

describe('GET /approvals/pending-count — manager scope', () => {
  it('counts only the immediate direct report, not a grandchild down the subordinate tree', async () => {
    const app = await buildApp({
      pendingCounts: {
        leave: [DIRECT_REPORT_ID, GRANDCHILD_ID],
        reg:   [GRANDCHILD_ID],
        ot:    [DIRECT_REPORT_ID, GRANDCHILD_ID],
        co:    [GRANDCHILD_ID],
      },
    })

    const res = await app.inject({ method: 'GET', url: '/approvals/pending-count', headers: HEADERS })
    expect(res.statusCode).toBe(200)
    const body = JSON.parse(res.body).data

    // Only DIRECT_REPORT_ID's leave+overtime rows count; every GRANDCHILD_ID
    // row (reg, ot, co) must be excluded — those items would always 403 if
    // this manager tried to act on them.
    expect(body.leave).toBe(1)
    expect(body.regularisation).toBe(0)
    expect(body.overtime).toBe(1)
    expect(body.comp_off).toBe(0)
    expect(body.total).toBe(2)
  })
})

describe('GET /leave-requests?status=APPROVED — manager Approved tab scope', () => {
  it('lists only the immediate direct report\'s approved leave, not a grandchild\'s', async () => {
    const app = await buildApp({
      leaveApproved: [
        { id: 'leave-a', employee_id: DIRECT_REPORT_ID },
        { id: 'leave-b', employee_id: GRANDCHILD_ID },
      ],
    })

    const res = await app.inject({ method: 'GET', url: '/leave-requests?status=APPROVED', headers: HEADERS })
    expect(res.statusCode).toBe(200)
    const body = JSON.parse(res.body)

    const employeeIds = body.data.map((r: any) => r.employee_id)
    expect(employeeIds).toContain(DIRECT_REPORT_ID)
    expect(employeeIds).not.toContain(GRANDCHILD_ID)
    expect(body.total).toBe(1)
  })
})
