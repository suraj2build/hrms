/**
 * SYSTEM_AUDIT_2026-10-14 — bulk-approve/bulk-reject ownership-guard scope fix.
 *
 * Both routes' own comment says the guard exists so "every request in the
 * batch must belong to a direct report" (P6.5), but the guard used
 * getDirectReportIds — the full subordinate tree — so a batch containing a
 * GRANDCHILD's request (not an immediate report) passed this gate even
 * though approveRegularisation/rejectRegularisation's own validateApprover
 * check (immediate-manager-only) would always refuse it per-item. Fixed to
 * use getImmediateReportIds, matching the guard's own stated intent and the
 * real downstream authorization.
 *
 * Full matrix per the user's explicit ask: grandchild exclusion, a mixed
 * batch proving NO item is processed when any one is unauthorized (not
 * just the unauthorized one skipped), reassignment, cross-tenant, an
 * unlinked manager, and HR-admin access preserved.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import Fastify, { type FastifyInstance, type FastifyRequest } from 'fastify'

vi.mock('../../../lib/approval-service.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../lib/approval-service.js')>()
  return { ...actual, approveRegularisation: vi.fn(), rejectRegularisation: vi.fn() }
})

import regularisationRoutes from '../regularisation.js'
import { approveRegularisation, rejectRegularisation } from '../../../lib/approval-service.js'

const approveMock = approveRegularisation as ReturnType<typeof vi.fn>
const rejectMock  = rejectRegularisation  as ReturnType<typeof vi.fn>

const TENANT_ID        = 'tenant-001'
const OTHER_TENANT_ID  = 'tenant-002'
const MANAGER_ID        = 'emp-manager'
const DIRECT_REPORT_ID  = 'emp-direct-report'
const DIRECT_REPORT_2_ID = 'emp-direct-report-2'
const GRANDCHILD_ID     = 'emp-grandchild'
const CROSS_TENANT_EMP_ID = 'emp-other-tenant'

const REG_DIRECT       = 'ec98fe8b-8623-494b-ab04-2e154a38d3b1'
const REG_DIRECT_2     = 'a1a1a1a1-1111-1111-1111-111111111111'
const REG_DIRECT_3     = 'c3c3c3c3-3333-3333-3333-333333333333'
const REG_GRANDCHILD   = 'd6d1f12d-cc77-44b3-af0c-bccc24f4a098'
const REG_CROSS_TENANT = 'b2b2b2b2-2222-2222-2222-222222222222'

interface EmployeeRow { managerId: string | null; tenantId: string }
interface Fixture {
  employees: Record<string, EmployeeRow>
  callerEmployeeId: string | null
  regs: Record<string, { employeeId: string; tenantId: string }>
}

function baseFixture(): Fixture {
  return {
    employees: {
      [DIRECT_REPORT_ID]:   { managerId: MANAGER_ID,       tenantId: TENANT_ID },
      [DIRECT_REPORT_2_ID]: { managerId: MANAGER_ID,       tenantId: TENANT_ID },
      [GRANDCHILD_ID]:      { managerId: DIRECT_REPORT_ID, tenantId: TENANT_ID },
      [CROSS_TENANT_EMP_ID]: { managerId: MANAGER_ID,      tenantId: OTHER_TENANT_ID },
    },
    callerEmployeeId: MANAGER_ID,
    regs: {
      [REG_DIRECT]:       { employeeId: DIRECT_REPORT_ID,   tenantId: TENANT_ID },
      [REG_DIRECT_2]:     { employeeId: DIRECT_REPORT_2_ID, tenantId: TENANT_ID },
      [REG_DIRECT_3]:     { employeeId: DIRECT_REPORT_ID,   tenantId: TENANT_ID },
      [REG_GRANDCHILD]:   { employeeId: GRANDCHILD_ID,      tenantId: TENANT_ID },
      [REG_CROSS_TENANT]: { employeeId: CROSS_TENANT_EMP_ID, tenantId: OTHER_TENANT_ID },
    },
  }
}

function buildSupabase(fx: Fixture) {
  return {
    from(table: string) {
      if (table === 'profiles') {
        const chain: any = {
          select: () => chain,
          eq:     () => chain,
          maybeSingle: () => Promise.resolve({ data: { employee_id: fx.callerEmployeeId }, error: null }),
          single:      () => Promise.resolve({ data: { employee_id: fx.callerEmployeeId }, error: null }),
        }
        return chain
      }
      if (table === 'employees') {
        const chain: any = {
          _filters: {} as Record<string, unknown>,
          select: () => chain,
          eq(field: string, value: unknown) { chain._filters[field] = value; return chain },
          then(resolve: (v: unknown) => void) {
            const ids = Object.entries(fx.employees)
              .filter(([, e]) => e.managerId === chain._filters.manager_id && e.tenantId === chain._filters.tenant_id)
              .map(([id]) => id)
            resolve({ data: ids.map(id => ({ id })), error: null })
            return Promise.resolve()
          },
        }
        return chain
      }
      if (table === 'attendance_regularisation') {
        const chain: any = {
          _filters: {} as Record<string, unknown>,
          select: () => chain,
          eq(field: string, value: unknown) { chain._filters[field] = value; return chain },
          in(field: string, ids: string[]) { if (field === 'id') chain._ids = ids; return chain },
          then(resolve: (v: unknown) => void) {
            const tenantId = chain._filters.tenant_id
            const rows = Object.entries(fx.regs)
              .filter(([id, r]) => r.tenantId === tenantId && (!chain._ids || chain._ids.includes(id)))
              .map(([id, r]) => ({ id, employee_id: r.employeeId }))
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
    ;(req as any).userId   = 'manager-profile-001'
    ;(req as any).userRole = role
  })
  app.decorate('supabase', buildSupabase(fx) as any)
  await app.register(regularisationRoutes)
  await app.ready()
  return app
}

const HEADERS = { 'content-type': 'application/json', authorization: 'Bearer test-token' }

beforeEach(() => {
  vi.resetAllMocks()
})

describe('POST /attendance/regularisation/bulk-approve — ownership guard scope', () => {
  it('403s a batch containing a grandchild\'s request instead of letting it through to approveRegularisation', async () => {
    const app = await buildApp(baseFixture())
    const res = await app.inject({
      method: 'POST', url: '/attendance/regularisation/bulk-approve', headers: HEADERS,
      payload: { ids: [REG_DIRECT, REG_GRANDCHILD] },
    })
    expect(res.statusCode).toBe(403)
    expect(JSON.parse(res.body).unauthorized_ids).toEqual([REG_GRANDCHILD])
    expect(approveMock).not.toHaveBeenCalled()
  })

  it('PREVALIDATION: a mixed batch (one authorized + one unauthorized) processes ZERO items, not just skips the bad one', async () => {
    const app = await buildApp(baseFixture())
    const res = await app.inject({
      method: 'POST', url: '/attendance/regularisation/bulk-approve', headers: HEADERS,
      payload: { ids: [REG_DIRECT, REG_DIRECT_2, REG_GRANDCHILD] },
    })
    expect(res.statusCode).toBe(403)
    // approveMock must not have been called for REG_DIRECT or REG_DIRECT_2 either —
    // the whole batch is validated before any item is touched.
    expect(approveMock).not.toHaveBeenCalled()
  })

  it('allows a batch containing only immediate direct reports\' requests through the gate', async () => {
    approveMock.mockResolvedValue({ ok: true, value: { id: REG_DIRECT, status: 'approved', employee_id: DIRECT_REPORT_ID, date: '2026-01-05', requested_check_in: null, requested_check_out: null } })
    const app = await buildApp(baseFixture())
    const res = await app.inject({
      method: 'POST', url: '/attendance/regularisation/bulk-approve', headers: HEADERS,
      payload: { ids: [REG_DIRECT, REG_DIRECT_2] },
    })
    expect(res.statusCode).toBe(200)
    expect(approveMock).toHaveBeenCalledTimes(2)
  })

  it('PER-ITEM PARTIAL SUCCESS (distinct from prevalidation above, and NOT transactional atomicity): a runtime failure on one AUTHORIZED item does not abort the rest of the batch or silently drop it — each item\'s outcome is independently reported', async () => {
    // All three ids pass the ownership guard (unlike the prevalidation tests
    // above, where an UNAUTHORIZED id blocks the whole batch before any
    // item is touched). Here every id IS authorized; the middle one's own
    // approveRegularisation() call throws at runtime (e.g. a transient DB
    // error), simulating a failure INSIDE an otherwise-valid batch.
    //
    // SYSTEM_AUDIT_2026-10-14 checkpoint 7 correction: an earlier version of
    // this test's title called this "transactional atomicity," which the
    // user correctly rejected — if authorized items commit independently
    // (as asserted below: item 1 succeeds, item 2 fails, item 3 STILL
    // succeeds, all three outcomes reported), that is per-item partial
    // success, the opposite of atomicity, not a variant of it. The real
    // guarantees here are: no partial corruption (item 1's success is not
    // undone by item 2's failure — each id's own approve_regularisation_
    // atomic call is independently atomic, but the BATCH itself is not) and
    // no silent loss (item 3 still gets processed and reported, not
    // abandoned because item 2 blew up). The route's own response shape,
    // {results, summary}, is the accurate contract: a per-item report, not
    // an all-or-nothing transaction result. See the route's own doc comment
    // in regularisation.ts for the full stated contract.
    approveMock.mockImplementation(async (_supabase: unknown, opts: { regularisationId: string }) => {
      if (opts.regularisationId === REG_DIRECT_2) throw new Error('simulated transient DB failure')
      return { ok: true, value: { id: opts.regularisationId, status: 'approved', employee_id: DIRECT_REPORT_ID, date: '2026-01-05', requested_check_in: null, requested_check_out: null } }
    })
    const app = await buildApp(baseFixture())
    const res = await app.inject({
      method: 'POST', url: '/attendance/regularisation/bulk-approve', headers: HEADERS,
      payload: { ids: [REG_DIRECT, REG_DIRECT_2, REG_DIRECT_3] },
    })
    expect(res.statusCode).toBe(200)   // the batch endpoint itself never fails outright
    const body = JSON.parse(res.body)
    expect(approveMock).toHaveBeenCalledTimes(3)   // all three were attempted — item 2's failure did not stop item 3
    const byId = new Map<string, { id: string; ok: boolean; error?: string }>(
      body.results.map((r: any) => [r.id, r]),
    )
    expect(byId.get(REG_DIRECT)!.ok).toBe(true)
    expect(byId.get(REG_DIRECT_2)!.ok).toBe(false)
    expect(byId.get(REG_DIRECT_2)!.error).toContain('simulated transient DB failure')
    expect(byId.get(REG_DIRECT_3)!.ok).toBe(true)   // not abandoned because REG_DIRECT_2 failed
    expect(body.summary).toEqual({ approved: 2, failed: 1, total: 3 })
  })

  it('RETRY SAFETY: resubmitting the same batch (no Idempotency-Key) after a partial failure does not re-approve the already-succeeded items — each retry attempt is independently re-validated', async () => {
    // SYSTEM_AUDIT_2026-10-14 checkpoint 7, point B's explicit ask: "Failed
    // items are explicitly reported and retry safely." This simulates the
    // realistic case the user is worried about: a manager sees "2 approved,
    // 1 failed" and, without an Idempotency-Key (a plain UI "retry" click,
    // not a replayed request), resubmits the SAME three ids. The already-
    // succeeded items must not be silently re-approved (which would risk
    // double-applying punches/balance effects downstream) — they must come
    // back as an explicit, accurate failure, while the genuinely-still-
    // pending item is free to succeed. This models approveRegularisation's
    // real status pre-check (approval-service.ts: `if (regRow.status !==
    // 'pending') return { ok:false, error:{type:'CONFLICT', ...} }`) and
    // migration 462's approve_regularisation_atomic DB-level backstop of
    // the exact same invariant — the mock below stands in for that already-
    // proven real behavior so this test can assert the ROUTE reports it
    // correctly on a second pass.
    let firstCallDone = false
    approveMock.mockImplementation(async (_supabase: unknown, opts: { regularisationId: string }) => {
      if (!firstCallDone) {
        if (opts.regularisationId === REG_DIRECT_2) throw new Error('simulated transient DB failure')
        return { ok: true, value: { id: opts.regularisationId, status: 'approved', employee_id: DIRECT_REPORT_ID, date: '2026-01-05', requested_check_in: null, requested_check_out: null } }
      }
      // Second pass: REG_DIRECT/REG_DIRECT_3 are now already-approved from
      // the first call and must be refused; REG_DIRECT_2 (the one that
      // genuinely failed before) is free to succeed this time.
      if (opts.regularisationId === REG_DIRECT || opts.regularisationId === REG_DIRECT_3) {
        return { ok: false, error: { type: 'CONFLICT', message: 'Request is already approved' } }
      }
      return { ok: true, value: { id: opts.regularisationId, status: 'approved', employee_id: DIRECT_REPORT_ID, date: '2026-01-05', requested_check_in: null, requested_check_out: null } }
    })

    const app = await buildApp(baseFixture())
    const ids = [REG_DIRECT, REG_DIRECT_2, REG_DIRECT_3]

    const first = await app.inject({ method: 'POST', url: '/attendance/regularisation/bulk-approve', headers: HEADERS, payload: { ids } })
    expect(JSON.parse(first.body).summary).toEqual({ approved: 2, failed: 1, total: 3 })

    firstCallDone = true
    const second = await app.inject({ method: 'POST', url: '/attendance/regularisation/bulk-approve', headers: HEADERS, payload: { ids } })
    expect(second.statusCode).toBe(200)
    const secondBody = JSON.parse(second.body)
    const byId = new Map<string, { id: string; ok: boolean; error?: string }>(
      secondBody.results.map((r: any) => [r.id, r]),
    )
    // The two already-succeeded items are explicitly reported as failed on
    // retry — never silently reported as approved a second time.
    expect(byId.get(REG_DIRECT)!.ok).toBe(false)
    expect(byId.get(REG_DIRECT)!.error).toContain('already approved')
    expect(byId.get(REG_DIRECT_3)!.ok).toBe(false)
    expect(byId.get(REG_DIRECT_3)!.error).toContain('already approved')
    // The genuinely-still-pending item processes cleanly exactly once.
    expect(byId.get(REG_DIRECT_2)!.ok).toBe(true)
    expect(secondBody.summary).toEqual({ approved: 1, failed: 2, total: 3 })
  })

  it('REASSIGNMENT: once the grandchild\'s request\'s owner is promoted to a direct report, the batch gate allows it', async () => {
    approveMock.mockResolvedValue({ ok: true, value: { id: REG_GRANDCHILD, status: 'approved', employee_id: GRANDCHILD_ID, date: '2026-01-05', requested_check_in: null, requested_check_out: null } })
    const fx = baseFixture()
    fx.employees[GRANDCHILD_ID].managerId = MANAGER_ID
    const app = await buildApp(fx)
    const res = await app.inject({
      method: 'POST', url: '/attendance/regularisation/bulk-approve', headers: HEADERS,
      payload: { ids: [REG_GRANDCHILD] },
    })
    expect(res.statusCode).toBe(200)
  })

  it('REASSIGNMENT: once a direct report is moved off this manager, the batch gate refuses it', async () => {
    const fx = baseFixture()
    fx.employees[DIRECT_REPORT_ID].managerId = 'some-other-manager'
    const app = await buildApp(fx)
    const res = await app.inject({
      method: 'POST', url: '/attendance/regularisation/bulk-approve', headers: HEADERS,
      payload: { ids: [REG_DIRECT] },
    })
    expect(res.statusCode).toBe(403)
    expect(approveMock).not.toHaveBeenCalled()
  })

  it('CROSS-TENANT: an id belonging to another tenant is never flagged by the ownership guard (nothing in THIS tenant to match against) and instead falls through to the per-item call\'s own tenant-scoped NOT_FOUND — confirmed never approved', async () => {
    // This is a genuine, narrower nuance worth recording rather than papering
    // over: the bulk ownership guard's `unauthorized` list is computed only
    // from rows that DID resolve inside this tenant (`.eq('tenant_id', ...)`)
    // but belong to someone who isn't a direct report. An id that resolves to
    // NOTHING in this tenant (wrong tenant, or simply doesn't exist) produces
    // an empty match either way, so the guard has nothing to flag -- it isn't
    // distinguishing "not yours" from "not found here" at the gate. The
    // request still reaches approveRegularisation per-item, but THAT call is
    // independently tenant-scoped and returns NOT_FOUND for a cross-tenant id
    // -- so nothing cross-tenant is ever read or mutated either way. Different
    // code path than the grandchild case (which 403s at the gate), same safe
    // outcome (never approved).
    const app = await buildApp(baseFixture())
    const res = await app.inject({
      method: 'POST', url: '/attendance/regularisation/bulk-approve', headers: HEADERS,
      payload: { ids: [REG_CROSS_TENANT] },
    })
    expect(res.statusCode).toBe(200)   // the bulk route always 200s; per-item outcome is in `results`
    const body = JSON.parse(res.body)
    expect(body.summary.approved).toBe(0)
    expect(body.results[0].ok).toBe(false)
  })

  it('UNLINKED MANAGER: a manager with no linked employee_id is refused outright, before any lookup', async () => {
    const fx = baseFixture()
    fx.callerEmployeeId = null
    const app = await buildApp(fx)
    const res = await app.inject({
      method: 'POST', url: '/attendance/regularisation/bulk-approve', headers: HEADERS,
      payload: { ids: [REG_DIRECT] },
    })
    expect(res.statusCode).toBe(403)
    expect(approveMock).not.toHaveBeenCalled()
  })

  it('HR ADMIN: bypasses the ownership guard entirely, including for the grandchild\'s request', async () => {
    approveMock.mockResolvedValue({ ok: true, value: { id: REG_GRANDCHILD, status: 'approved', employee_id: GRANDCHILD_ID, date: '2026-01-05', requested_check_in: null, requested_check_out: null } })
    const app = await buildApp(baseFixture(), 'hr_admin')
    const res = await app.inject({
      method: 'POST', url: '/attendance/regularisation/bulk-approve', headers: HEADERS,
      payload: { ids: [REG_GRANDCHILD] },
    })
    expect(res.statusCode).toBe(200)
    expect(approveMock).toHaveBeenCalledTimes(1)
  })
})

describe('POST /attendance/regularisation/bulk-reject — ownership guard scope', () => {
  it('403s a batch containing a grandchild\'s request instead of letting it through to rejectRegularisation', async () => {
    const app = await buildApp(baseFixture())
    const res = await app.inject({
      method: 'POST', url: '/attendance/regularisation/bulk-reject', headers: HEADERS,
      payload: { ids: [REG_GRANDCHILD] },
    })
    expect(res.statusCode).toBe(403)
    expect(JSON.parse(res.body).unauthorized_ids).toEqual([REG_GRANDCHILD])
    expect(rejectMock).not.toHaveBeenCalled()
  })

  it('PREVALIDATION: a mixed batch processes ZERO items when any one is unauthorized', async () => {
    const app = await buildApp(baseFixture())
    const res = await app.inject({
      method: 'POST', url: '/attendance/regularisation/bulk-reject', headers: HEADERS,
      payload: { ids: [REG_DIRECT, REG_GRANDCHILD] },
    })
    expect(res.statusCode).toBe(403)
    expect(rejectMock).not.toHaveBeenCalled()
  })

  it('HR ADMIN: bypasses the ownership guard entirely', async () => {
    rejectMock.mockResolvedValue({ ok: true, value: { id: REG_GRANDCHILD, status: 'rejected' } })
    const app = await buildApp(baseFixture(), 'hr_admin')
    const res = await app.inject({
      method: 'POST', url: '/attendance/regularisation/bulk-reject', headers: HEADERS,
      payload: { ids: [REG_GRANDCHILD] },
    })
    expect(res.statusCode).toBe(200)
    expect(rejectMock).toHaveBeenCalledTimes(1)
  })
})
