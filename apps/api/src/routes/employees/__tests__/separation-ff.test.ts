/**
 * F&F settlement — freeze-on-decision (enforced in the actual write, not
 * just a prior read), version-bound approval, and the atomic, source-
 * validated mark-paid + recovery write-back (PR #30 follow-up fixes,
 * two rounds).
 *
 * Covers the gaps raised against separation-workflow.ts:
 *   1. POST /separation-ff and POST /separation-ff/compute must refuse to
 *      WRITE a row that is no longer 'draft' — not just reject based on a
 *      prior SELECT, which is itself racy (a concurrent approve landing
 *      between that SELECT and the UPDATE would still let the UPDATE
 *      through). Both UPDATEs now fold `.eq('status', 'draft')` into their
 *      own WHERE clause.
 *   2. PATCH /separation-ff/approve's final UPDATE must bind to the exact
 *      `version` the staleness check just validated, not just `status`,
 *      so a concurrent edit landing between validation and the write can't
 *      be silently approved un-reviewed (TOCTOU).
 *   3. PATCH /separation-ff/mark-paid must do the status flip + loan
 *      foreclosure + advance recovery (schedules, ledger, parent status)
 *      as ONE atomic operation, and must validate current source balances
 *      against what was actually approved before writing anything — not
 *      just use whatever balance happens to be there at mark-paid time.
 *      This is now delegated entirely to the `mark_fnf_paid_atomic`
 *      Postgres function (migration 445): the route's own job is just to
 *      call the RPC and map its outcome to an HTTP response, so that's
 *      what's tested here at the route level. The function's actual
 *      transactional/concurrency guarantees (rollback on drift, no double-
 *      ledger under retry, blocking a concurrent payroll-style write on
 *      the same rows) are verified separately against real Postgres — see
 *      scripts/db/verify-fnf-mark-paid-atomic.mjs and the PR description
 *      for that run's output; a mocked RPC response can't exercise actual
 *      transaction semantics, so this file doesn't claim to.
 *   4. PATCH /separation-ff/reopen (new) sends an 'approved' settlement
 *      back to 'draft' — the only way out when mark-paid's SOURCE_DRIFT
 *      check blocks payment, since compute/manual-edit both refuse non-
 *      draft rows.
 *
 * A hand-rolled in-memory Postgres-ish table engine stands in for
 * `fastify.supabase` so these behave like persisted read-back tests: every
 * `.eq()`/`.in()` filter is actually applied against row state, every
 * `.update()` actually mutates matching rows and nothing else, and a
 * "concurrent request" is simulated by mutating the fake table's row
 * between a test's own setup read and the route's own fetch-then-write.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import Fastify, { type FastifyInstance, type FastifyRequest } from 'fastify'
import separationWorkflowRoutes from '../separation-workflow.js'
import { computeFnfSettlement } from '../../../lib/fnf-settlement-engine.js'

// computeFnfSettlement (lib/fnf-settlement-engine.ts) has its own dedicated
// test coverage and pulls from half a dozen other tables (job_history, leave
// policy/balance, gratuity_config, payroll slips, assets, loans, advances) —
// stubbing it here keeps this file's fake Supabase scoped to what
// separation-workflow.ts's own routes query directly, same as the `breakdown`
// shape the real engine returns.
vi.mock('../../../lib/fnf-settlement-engine.js', () => ({ computeFnfSettlement: vi.fn() }))

function stubBreakdown(overrides: Row = {}) {
  return {
    leave_encashment_amount: 5000, gratuity_amount: 10000, notice_period_deduction: 0,
    asset_recovery_amount: 0, loan_recovery_amount: 0, advance_recovery_amount: 0,
    gratuity_eligible: true, gratuity_years: 5, leave_encashment_days: 10, leave_encashment_rate: 500,
    notice_shortfall_days: 0, salary_basis_basic: 30000, salary_basis_gross: 50000,
    ...overrides,
  }
}

const TENANT_ID    = '00000000-0000-0000-0000-000000000099'
const EMPLOYEE_ID  = '00000000-0000-0000-0000-000000000022'
const FF_ID        = '00000000-0000-0000-0000-000000000033'
const SEPARATION_ID = '00000000-0000-0000-0000-000000000044'

type Row = Record<string, any>
type Filter = { op: 'eq' | 'neq' | 'in'; col: string; val: any }

type RaceHook = { after: number; run: () => void }

/** Minimal in-memory stand-in for a PostgREST table: filters are applied
 *  against real row state, updates mutate only matching rows, and
 *  maybeSingle()/single()/plain-await each resolve the way the real
 *  supabase-js client shapes them.
 *
 *  `raceHooks[table]` lets a test fire a mutation exactly between the
 *  route's Nth and (N+1)th query against a given table — simulating a
 *  concurrent request's write landing between this route's own
 *  SELECT-then-validate and its final UPDATE, which is otherwise
 *  impossible to express against a plain seeded snapshot. */
function makeFakeSupabase(seed: Record<string, Row[]>, raceHooks: Record<string, RaceHook[]> = {}) {
  const db: Record<string, Row[]> = {}
  for (const [table, rows] of Object.entries(seed)) db[table] = rows.map(r => ({ ...r }))
  const callCounts: Record<string, number> = {}

  function matches(row: Row, filters: Filter[]) {
    return filters.every(f => {
      if (f.op === 'eq')  return row[f.col] === f.val
      if (f.op === 'neq') return row[f.col] !== f.val
      if (f.op === 'in')  return (f.val as any[]).includes(row[f.col])
      return true
    })
  }

  function from(table: string) {
    if (!db[table]) db[table] = []
    callCounts[table] = (callCounts[table] ?? 0) + 1
    for (const hook of raceHooks[table] ?? []) {
      if (hook.after === callCounts[table] - 1) hook.run()
    }
    const filters: Filter[] = []
    let mode: 'select' | 'update' | 'insert' = 'select'
    let payload: Row | null = null
    let countMode = false

    async function resolve() {
      if (mode === 'insert') {
        const arr = Array.isArray(payload) ? payload : [payload]
        const inserted = arr.map((p: Row) => ({ id: p.id ?? `generated-${db[table].length}-${Math.random().toString(36).slice(2)}`, ...p }))
        db[table].push(...inserted)
        return { data: inserted.map(r => ({ ...r })), error: null, count: null }
      }
      const matched = db[table].filter(r => matches(r, filters))
      if (mode === 'update') {
        for (const row of matched) Object.assign(row, payload)
      }
      // Always hand back a snapshot, never the live row reference — a real
      // PostgREST response is a serialized copy, so a caller holding onto
      // `data` (e.g. the route's `ff` variable) must NOT observe a later
      // mutation made by this same fake engine (a subsequent request, or a
      // race-hook simulating a concurrent one) retroactively through it.
      return { data: matched.map(r => ({ ...r })), error: null, count: countMode ? matched.length : null }
    }

    const chain: any = {
      select: (_cols?: string, opts?: { count?: string; head?: boolean }) => { if (opts?.count) countMode = true; return chain },
      update: (p: Row) => { mode = 'update'; payload = p; return chain },
      insert: (p: Row | Row[]) => { mode = 'insert'; payload = p as Row; return chain },
      eq:  (col: string, val: any) => { filters.push({ op: 'eq', col, val }); return chain },
      neq: (col: string, val: any) => { filters.push({ op: 'neq', col, val }); return chain },
      in:  (col: string, val: any[]) => { filters.push({ op: 'in', col, val }); return chain },
      order: () => chain,
      maybeSingle: async () => {
        const { data, error } = await resolve()
        return { data: (data as Row[])[0] ?? null, error }
      },
      single: async () => {
        const { data, error } = await resolve()
        return { data: (data as Row[])[0] ?? null, error }
      },
      then: (onResolve: (v: unknown) => void, onReject?: (e: unknown) => void) => resolve().then(onResolve, onReject),
    }
    return chain
  }

  return { from: (t: string) => from(t), _db: db, rpc: vi.fn() }
}

type BuildAppOpts = { raceHooks?: Record<string, RaceHook[]>; userRole?: string }

function employeeRow() {
  return { id: EMPLOYEE_ID, tenant_id: TENANT_ID, status: 'relieved' }
}

function separationRow() {
  return { id: SEPARATION_ID, clearance_done: true, employee_id: EMPLOYEE_ID, tenant_id: TENANT_ID }
}

function ffRow(overrides: Row = {}) {
  return {
    id: FF_ID, employee_id: EMPLOYEE_ID, tenant_id: TENANT_ID, status: 'draft', version: 1,
    computed_at: null, // manual entry — skips the staleness recompute branch, isolating the version-bind test
    salary_basis_gross: 50000, salary_basis_basic: 30000,
    gratuity_amount: 10000, leave_encashment_amount: 5000, notice_period_deduction: 0,
    asset_recovery_amount: 0, loan_recovery_amount: 0, advance_recovery_amount: 0,
    last_payroll_amount: 50000, other_additions: 0, other_deductions: 0,
    ...overrides,
  }
}

async function buildApp(seed: Record<string, Row[]>, opts: BuildAppOpts = {}) {
  const fake = makeFakeSupabase(seed, opts.raceHooks)
  const app = Fastify({ logger: false })
  app.decorateRequest('tenantId', '')
  app.decorateRequest('userId', '')
  app.decorateRequest('userRole', '')
  app.decorate('authenticate', async (req: FastifyRequest) => {
    ;(req as any).tenantId = TENANT_ID
    ;(req as any).userId   = 'hr-admin-001'
    ;(req as any).userRole = opts.userRole ?? 'hr_admin'
  })
  app.decorate('supabase', fake as any)
  await app.register(separationWorkflowRoutes)
  await app.ready()
  return { app, fake }
}

const HEADERS = { 'content-type': 'application/json', authorization: 'Bearer test-token' }

beforeEach(() => {
  vi.mocked(computeFnfSettlement).mockReset()
  vi.mocked(computeFnfSettlement).mockResolvedValue(stubBreakdown() as any)
})

describe('F&F freeze-on-decision (POST /separation-ff, POST /separation-ff/compute)', () => {
  it('POST /separation-ff — 409 LOCKED when the row is already approved', async () => {
    const { app } = await buildApp({
      employees: [employeeRow()],
      employee_separation: [separationRow()],
      separation_ff_summary: [ffRow({ status: 'approved' })],
    })

    const res = await app.inject({
      method: 'POST', url: `/employees/${EMPLOYEE_ID}/separation-ff`, headers: HEADERS,
      payload: { last_payroll_amount: 1, leave_encashment_amount: 1, gratuity_amount: 1, notice_period_deduction: 0 },
    })

    expect(res.statusCode).toBe(409)
    expect(JSON.parse(res.body).error).toBe('LOCKED')
    await app.close()
  })

  it('POST /separation-ff — 409 LOCKED when the row is already paid', async () => {
    const { app } = await buildApp({
      employees: [employeeRow()],
      employee_separation: [separationRow()],
      separation_ff_summary: [ffRow({ status: 'paid' })],
    })

    const res = await app.inject({
      method: 'POST', url: `/employees/${EMPLOYEE_ID}/separation-ff`, headers: HEADERS,
      payload: { last_payroll_amount: 1, leave_encashment_amount: 1, gratuity_amount: 1, notice_period_deduction: 0 },
    })

    expect(res.statusCode).toBe(409)
    expect(JSON.parse(res.body).error).toBe('LOCKED')
    await app.close()
  })

  it('POST /separation-ff — a draft row still edits normally', async () => {
    const { app, fake } = await buildApp({
      employees: [employeeRow()],
      employee_separation: [separationRow()],
      separation_ff_summary: [ffRow({ status: 'draft' })],
    })

    const res = await app.inject({
      method: 'POST', url: `/employees/${EMPLOYEE_ID}/separation-ff`, headers: HEADERS,
      payload: { last_payroll_amount: 9999, leave_encashment_amount: 1, gratuity_amount: 1, notice_period_deduction: 0 },
    })

    expect(res.statusCode).toBe(200)
    expect(fake._db.separation_ff_summary[0].last_payroll_amount).toBe(9999)
    await app.close()
  })

  it('POST /separation-ff/compute — 409 LOCKED when already approved, balances untouched', async () => {
    const { app, fake } = await buildApp({
      employees: [employeeRow()],
      employee_separation: [separationRow()],
      separation_ff_summary: [ffRow({ status: 'approved', gratuity_amount: 10000 })],
    })

    const res = await app.inject({
      method: 'POST', url: `/employees/${EMPLOYEE_ID}/separation-ff/compute`, headers: HEADERS, payload: {},
    })

    expect(res.statusCode).toBe(409)
    expect(JSON.parse(res.body).error).toBe('LOCKED')
    // The approved figures must not have been silently rewritten.
    expect(fake._db.separation_ff_summary[0].gratuity_amount).toBe(10000)
    await app.close()
  })

  it('POST /separation-ff — TOCTOU: a concurrent approve lands between the LOCKED pre-check and the write — UPDATE itself must reject, not just the earlier read', async () => {
    // The route's 1st query against separation_ff_summary is the "existing"
    // SELECT the LOCKED pre-check reads; this hook fires right before its
    // 2nd query (the actual UPDATE) — i.e. inside the exact window a
    // check-then-write bug would miss — flipping status to 'approved' in
    // between, as a concurrent PATCH /approve would.
    const { app, fake } = await buildApp(
      { employees: [employeeRow()], employee_separation: [separationRow()], separation_ff_summary: [ffRow({ status: 'draft', last_payroll_amount: 1111 })] },
      { raceHooks: { separation_ff_summary: [{ after: 1, run: () => { fake._db.separation_ff_summary[0].status = 'approved' } }] } },
    )

    const res = await app.inject({
      method: 'POST', url: `/employees/${EMPLOYEE_ID}/separation-ff`, headers: HEADERS,
      payload: { last_payroll_amount: 9999, leave_encashment_amount: 1, gratuity_amount: 1, notice_period_deduction: 0 },
    })

    expect(res.statusCode).toBe(409)
    expect(JSON.parse(res.body).error).toBe('LOCKED')
    // The critical assertion: if the UPDATE's own WHERE clause didn't also
    // require status='draft', this would have silently matched and
    // overwritten the now-approved row with the un-reviewed 9999.
    expect(fake._db.separation_ff_summary[0].last_payroll_amount).toBe(1111)
    expect(fake._db.separation_ff_summary[0].status).toBe('approved')
    await app.close()
  })

  it('POST /separation-ff/compute — TOCTOU: a concurrent approve lands between the LOCKED pre-check and the write', async () => {
    const { app, fake } = await buildApp(
      { employees: [employeeRow()], employee_separation: [separationRow()], separation_ff_summary: [ffRow({ status: 'draft', gratuity_amount: 777 })] },
      { raceHooks: { separation_ff_summary: [{ after: 1, run: () => { fake._db.separation_ff_summary[0].status = 'approved' } }] } },
    )

    const res = await app.inject({
      method: 'POST', url: `/employees/${EMPLOYEE_ID}/separation-ff/compute`, headers: HEADERS, payload: {},
    })

    expect(res.statusCode).toBe(409)
    expect(JSON.parse(res.body).error).toBe('LOCKED')
    expect(fake._db.separation_ff_summary[0].gratuity_amount).toBe(777)
    await app.close()
  })
})

describe('PATCH /separation-ff/approve — version-bound (TOCTOU) CAS', () => {
  it('happy path — binds the UPDATE to the exact version just read, succeeds', async () => {
    const { app, fake } = await buildApp({
      employees: [employeeRow()],
      separation_ff_summary: [ffRow({ status: 'draft', version: 3 })],
    })

    const res = await app.inject({
      method: 'PATCH', url: `/employees/${EMPLOYEE_ID}/separation-ff/approve`, headers: HEADERS, payload: {},
    })

    expect(res.statusCode).toBe(200)
    expect(fake._db.separation_ff_summary[0].status).toBe('approved')
    await app.close()
  })

  it('concurrent edit between fetch and approve — version moved on, 409 VERSION_CONFLICT, status stays draft', async () => {
    // The approve route's 1st query against separation_ff_summary is its own
    // fetch-and-validate SELECT; this hook fires right before its 2nd query
    // (the final UPDATE) — i.e. exactly in the TOCTOU window — simulating a
    // concurrent POST /separation-ff/compute that lands in between and moves
    // the row to a version the approve request never actually validated.
    const { app, fake } = await buildApp(
      { employees: [employeeRow()], separation_ff_summary: [ffRow({ status: 'draft', version: 1 })] },
      { raceHooks: { separation_ff_summary: [{
        after: 1,
        run: () => {
          fake._db.separation_ff_summary[0].version = 2
          fake._db.separation_ff_summary[0].gratuity_amount = 999999 // the un-reviewed, concurrently-edited figure
        },
      }] } },
    )

    const res = await app.inject({
      method: 'PATCH', url: `/employees/${EMPLOYEE_ID}/separation-ff/approve`, headers: HEADERS, payload: {},
    })

    expect(res.statusCode).toBe(409)
    const body = JSON.parse(res.body)
    expect(body.error).toContain('VERSION')
    // The critical assertion: the concurrently-edited, never-reviewed row
    // must NOT have been flipped to 'approved'.
    expect(fake._db.separation_ff_summary[0].status).toBe('draft')
    await app.close()
  })

  it('already approved by a concurrent request — 409 ALREADY_DECIDED, not VERSION_CONFLICT', async () => {
    // Same TOCTOU window as above, but the concurrent request that lands in
    // between is itself a completed approve — status flips too, so the
    // route's own CAS failure must be disambiguated as "already decided",
    // not reported as a stale-version edit.
    const { app, fake } = await buildApp(
      { employees: [employeeRow()], separation_ff_summary: [ffRow({ status: 'draft', version: 1 })] },
      { raceHooks: { separation_ff_summary: [{
        after: 1,
        run: () => {
          fake._db.separation_ff_summary[0].status = 'approved'
          fake._db.separation_ff_summary[0].version = 2
        },
      }] } },
    )

    const res = await app.inject({
      method: 'PATCH', url: `/employees/${EMPLOYEE_ID}/separation-ff/approve`, headers: HEADERS, payload: {},
    })

    expect(res.statusCode).toBe(409)
    expect(JSON.parse(res.body).error).toBe('ALREADY_DECIDED')
    await app.close()
  })
})

describe('PATCH /separation-ff/mark-paid — delegates to mark_fnf_paid_atomic (migration 445)', () => {
  // The route's own job here is just: call the RPC, map its outcome to an
  // HTTP response, reload the row. The RPC itself — FOR UPDATE locking,
  // the source-drift validation, the actual foreclosure/recovery writes,
  // and their atomicity — is real plpgsql verified against real Postgres
  // (scripts/db/verify-fnf-mark-paid-atomic.mjs); that's not something a
  // mocked .rpc() return value can stand in for, so these tests are scoped
  // to what they can actually prove: the route calls the RPC with the
  // right arguments and translates every documented error prefix correctly.

  it('happy path — calls the RPC, reloads and returns the paid row', async () => {
    const { app, fake } = await buildApp({
      employees: [employeeRow()],
      separation_ff_summary: [ffRow({ status: 'approved' })],
    })
    fake.rpc.mockResolvedValueOnce({ data: { id: FF_ID, status: 'paid' }, error: null })
    // The RPC itself commits the status flip inside Postgres; the route
    // reloads afterward, so the fake's own row must reflect that for the
    // reload SELECT to return the up-to-date status.
    fake._db.separation_ff_summary[0].status = 'paid'

    const res = await app.inject({
      method: 'PATCH', url: `/employees/${EMPLOYEE_ID}/separation-ff/mark-paid`, headers: HEADERS, payload: {},
    })

    expect(res.statusCode).toBe(200)
    expect(JSON.parse(res.body).data.status).toBe('paid')
    expect(fake.rpc).toHaveBeenCalledWith('mark_fnf_paid_atomic', expect.objectContaining({
      p_tenant_id: TENANT_ID, p_employee_id: EMPLOYEE_ID, p_user_id: 'hr-admin-001',
    }))
    await app.close()
  })

  it('NOT_FOUND from the RPC → 404', async () => {
    const { app, fake } = await buildApp({ employees: [employeeRow()], separation_ff_summary: [] })
    fake.rpc.mockResolvedValueOnce({ data: null, error: { message: 'NOT_FOUND: F&F record not found' } })

    const res = await app.inject({ method: 'PATCH', url: `/employees/${EMPLOYEE_ID}/separation-ff/mark-paid`, headers: HEADERS, payload: {} })
    expect(res.statusCode).toBe(404)
    expect(JSON.parse(res.body).error).toBe('NOT_FOUND')
    await app.close()
  })

  it('INVALID_STATE from the RPC (never approved) → 409 INVALID_STATE', async () => {
    const { app, fake } = await buildApp({ employees: [employeeRow()], separation_ff_summary: [ffRow({ status: 'draft' })] })
    fake.rpc.mockResolvedValueOnce({ data: null, error: { message: "INVALID_STATE: Cannot mark as paid: F&F must be approved first (current: 'draft')" } })

    const res = await app.inject({ method: 'PATCH', url: `/employees/${EMPLOYEE_ID}/separation-ff/mark-paid`, headers: HEADERS, payload: {} })
    expect(res.statusCode).toBe(409)
    expect(JSON.parse(res.body).error).toBe('INVALID_STATE')
    await app.close()
  })

  it('ALREADY_DECIDED from the RPC (retry after success) → 409 ALREADY_DECIDED', async () => {
    const { app, fake } = await buildApp({ employees: [employeeRow()], separation_ff_summary: [ffRow({ status: 'paid' })] })
    fake.rpc.mockResolvedValueOnce({ data: null, error: { message: 'ALREADY_DECIDED: This F&F settlement is no longer in approved status (current: paid)' } })

    const res = await app.inject({ method: 'PATCH', url: `/employees/${EMPLOYEE_ID}/separation-ff/mark-paid`, headers: HEADERS, payload: {} })
    expect(res.statusCode).toBe(409)
    expect(JSON.parse(res.body).error).toBe('ALREADY_DECIDED')
    await app.close()
  })

  it('SOURCE_DRIFT from the RPC (a source loan/advance/asset balance changed since approval) → 409 SOURCE_DRIFT, settlement left approved', async () => {
    const { app, fake } = await buildApp({ employees: [employeeRow()], separation_ff_summary: [ffRow({ status: 'approved', loan_recovery_amount: 15000 })] })
    fake.rpc.mockResolvedValueOnce({ data: null, error: { message: 'SOURCE_DRIFT: Outstanding loan balance has changed since this settlement was approved (approved 15000, current 9000). Reopen, recompute and re-approve before marking as paid.' } })

    const res = await app.inject({ method: 'PATCH', url: `/employees/${EMPLOYEE_ID}/separation-ff/mark-paid`, headers: HEADERS, payload: {} })
    expect(res.statusCode).toBe(409)
    const body = JSON.parse(res.body)
    expect(body.error).toBe('SOURCE_DRIFT')
    expect(body.message).toContain('15000')
    expect(body.message).toContain('9000')
    // The RPC's own transaction rolled back on RAISE EXCEPTION — nothing
    // for the route to undo, and the settlement is still 'approved' here
    // (unlike a mocked happy path, this test never mutates status to 'paid').
    expect(fake._db.separation_ff_summary[0].status).toBe('approved')
    await app.close()
  })

  it('SOURCE_DRIFT for a leave-encashment balance change (migration 448) → 409 SOURCE_DRIFT, settlement left approved', async () => {
    const { app, fake } = await buildApp({ employees: [employeeRow()], separation_ff_summary: [ffRow({ status: 'approved' })] })
    fake.rpc.mockResolvedValueOnce({ data: null, error: { message: 'SOURCE_DRIFT: Leave encashment balance has changed since this settlement was approved (approved 10 days, current 4 days — likely a standalone encashment request approved in between). Reopen, recompute and re-approve before marking as paid.' } })

    const res = await app.inject({ method: 'PATCH', url: `/employees/${EMPLOYEE_ID}/separation-ff/mark-paid`, headers: HEADERS, payload: {} })
    expect(res.statusCode).toBe(409)
    const body = JSON.parse(res.body)
    expect(body.error).toBe('SOURCE_DRIFT')
    expect(body.message).toContain('10 days')
    expect(body.message).toContain('4 days')
    expect(fake._db.separation_ff_summary[0].status).toBe('approved')
    await app.close()
  })

  it('LEAVE_BASIS_MISSING from the RPC (days > 0, no recorded basis) → 409 LEAVE_BASIS_MISSING, settlement left approved', async () => {
    const { app, fake } = await buildApp({ employees: [employeeRow()], separation_ff_summary: [ffRow({ status: 'approved' })] })
    fake.rpc.mockResolvedValueOnce({ data: null, error: { message: 'LEAVE_BASIS_MISSING: This settlement has a leave encashment amount but no recorded basis to verify it against (predates this check, or was entered manually without running Compute). Recompute via POST /separation-ff/compute, review, and re-approve before marking as paid.' } })

    const res = await app.inject({ method: 'PATCH', url: `/employees/${EMPLOYEE_ID}/separation-ff/mark-paid`, headers: HEADERS, payload: {} })
    expect(res.statusCode).toBe(409)
    expect(JSON.parse(res.body).error).toBe('LEAVE_BASIS_MISSING')
    expect(fake._db.separation_ff_summary[0].status).toBe('approved')
    await app.close()
  })

  it('an unrecognized RPC error falls back to a generic 500, never leaking the raw DB message', async () => {
    const { app, fake } = await buildApp({ employees: [employeeRow()], separation_ff_summary: [ffRow({ status: 'approved' })] })
    fake.rpc.mockResolvedValueOnce({ data: null, error: { message: 'duplicate key value violates unique constraint "advance_recoveries_pkey"' } })

    const res = await app.inject({ method: 'PATCH', url: `/employees/${EMPLOYEE_ID}/separation-ff/mark-paid`, headers: HEADERS, payload: {} })
    expect(res.statusCode).toBe(500)
    expect(res.body).not.toContain('advance_recoveries_pkey')
    await app.close()
  })
})

describe('PATCH /separation-ff/reopen — the way out of a SOURCE_DRIFT block', () => {
  it('approved → draft, clearing approved_by/approved_at', async () => {
    const { app, fake } = await buildApp({
      employees: [employeeRow()],
      separation_ff_summary: [ffRow({ status: 'approved', approved_by: 'hr-admin-001', approved_at: '2026-01-01T00:00:00Z' })],
    })

    const res = await app.inject({ method: 'PATCH', url: `/employees/${EMPLOYEE_ID}/separation-ff/reopen`, headers: HEADERS, payload: {} })

    expect(res.statusCode).toBe(200)
    expect(fake._db.separation_ff_summary[0].status).toBe('draft')
    expect(fake._db.separation_ff_summary[0].approved_by).toBeNull()
    expect(fake._db.separation_ff_summary[0].approved_at).toBeNull()
    await app.close()
  })

  it('cannot reopen a draft settlement — 409 INVALID_STATE', async () => {
    const { app } = await buildApp({ employees: [employeeRow()], separation_ff_summary: [ffRow({ status: 'draft' })] })
    const res = await app.inject({ method: 'PATCH', url: `/employees/${EMPLOYEE_ID}/separation-ff/reopen`, headers: HEADERS, payload: {} })
    expect(res.statusCode).toBe(409)
    expect(JSON.parse(res.body).error).toBe('INVALID_STATE')
  })

  it('cannot reopen a paid settlement — money has already moved, no silent way back to draft', async () => {
    const { app, fake } = await buildApp({ employees: [employeeRow()], separation_ff_summary: [ffRow({ status: 'paid' })] })
    const res = await app.inject({ method: 'PATCH', url: `/employees/${EMPLOYEE_ID}/separation-ff/reopen`, headers: HEADERS, payload: {} })
    expect(res.statusCode).toBe(409)
    expect(JSON.parse(res.body).error).toBe('INVALID_STATE')
    expect(fake._db.separation_ff_summary[0].status).toBe('paid')
    await app.close()
  })

  it('TOCTOU: a concurrent mark-paid lands between the pre-check and the write — the UPDATE itself must reject', async () => {
    const { app, fake } = await buildApp(
      { employees: [employeeRow()], separation_ff_summary: [ffRow({ status: 'approved' })] },
      { raceHooks: { separation_ff_summary: [{ after: 1, run: () => { fake._db.separation_ff_summary[0].status = 'paid' } }] } },
    )
    const res = await app.inject({ method: 'PATCH', url: `/employees/${EMPLOYEE_ID}/separation-ff/reopen`, headers: HEADERS, payload: {} })
    expect(res.statusCode).toBe(409)
    expect(JSON.parse(res.body).error).toBe('ALREADY_DECIDED')
    expect(fake._db.separation_ff_summary[0].status).toBe('paid')
    await app.close()
  })
})

describe('PATCH /separation-ff/correct-payment — the controlled, audited compensating transaction for a PAID settlement (migration 451)', () => {
  // Same scoping as the mark-paid suite above: the route's own job is to
  // gate on role, validate the reason, call the RPC, and map its outcome.
  // The RPC's actual reversal of loans/advances/leave balance — scoped
  // precisely to the rows mark_fnf_paid_atomic itself touched, never a
  // loan/advance that reached the same terminal status some other way —
  // is real plpgsql verified against real Postgres
  // (scripts/db/verify-fnf-mark-paid-atomic.mjs sections [M]/[M2]); a
  // mocked RPC response can't exercise that, so these tests don't claim to.

  it('hr_admin is refused — this action is super_admin only (undoing a payment is bigger than making one)', async () => {
    const { app } = await buildApp(
      { employees: [employeeRow()], separation_ff_summary: [ffRow({ status: 'paid' })] },
      { userRole: 'hr_admin' },
    )
    const res = await app.inject({
      method: 'PATCH', url: `/employees/${EMPLOYEE_ID}/separation-ff/correct-payment`, headers: HEADERS,
      payload: { reason: 'Bank transfer failed', recovery_reference: 'UTR123' },
    })
    expect(res.statusCode).toBe(403)
    expect(JSON.parse(res.body).error).toBe('FORBIDDEN')
    await app.close()
  })

  it('an empty reason is refused before the RPC is even called', async () => {
    const { app, fake } = await buildApp(
      { employees: [employeeRow()], separation_ff_summary: [ffRow({ status: 'paid' })] },
      { userRole: 'super_admin' },
    )
    const res = await app.inject({
      method: 'PATCH', url: `/employees/${EMPLOYEE_ID}/separation-ff/correct-payment`, headers: HEADERS,
      payload: { reason: '', recovery_reference: 'UTR123' },
    })
    expect(res.statusCode).toBe(400)
    expect(fake.rpc).not.toHaveBeenCalled()
    await app.close()
  })

  it('a missing recovery_reference is refused before the RPC is even called — a DB reversal alone cannot reverse a bank payment', async () => {
    const { app, fake } = await buildApp(
      { employees: [employeeRow()], separation_ff_summary: [ffRow({ status: 'paid' })] },
      { userRole: 'super_admin' },
    )
    const res = await app.inject({
      method: 'PATCH', url: `/employees/${EMPLOYEE_ID}/separation-ff/correct-payment`, headers: HEADERS,
      payload: { reason: 'Bank transfer failed' },
    })
    expect(res.statusCode).toBe(400)
    expect(fake.rpc).not.toHaveBeenCalled()
    await app.close()
  })

  it('happy path (super_admin, real reason, real recovery evidence) — calls the RPC, reloads and returns the draft row', async () => {
    const { app, fake } = await buildApp(
      { employees: [employeeRow()], separation_ff_summary: [ffRow({ status: 'paid' })] },
      { userRole: 'super_admin' },
    )
    fake.rpc.mockResolvedValueOnce({ data: { id: FF_ID, status: 'draft', loans_reverted: 1 }, error: null })
    fake._db.separation_ff_summary[0].status = 'draft'

    const res = await app.inject({
      method: 'PATCH', url: `/employees/${EMPLOYEE_ID}/separation-ff/correct-payment`, headers: HEADERS,
      payload: { reason: 'Bank transfer failed — reversing to re-run', recovery_reference: 'Bank reversal confirmed, UTR REV2026101201' },
    })
    expect(res.statusCode).toBe(200)
    expect(JSON.parse(res.body).data.status).toBe('draft')
    expect(fake.rpc).toHaveBeenCalledWith('correct_fnf_payment_atomic', expect.objectContaining({
      p_tenant_id: TENANT_ID, p_employee_id: EMPLOYEE_ID, p_user_id: 'hr-admin-001',
      p_reason: 'Bank transfer failed — reversing to re-run',
      p_recovery_reference: 'Bank reversal confirmed, UTR REV2026101201',
    }))
    await app.close()
  })

  it('INVALID_STATE from the RPC (settlement is not paid) → 409 INVALID_STATE', async () => {
    const { app, fake } = await buildApp(
      { employees: [employeeRow()], separation_ff_summary: [ffRow({ status: 'approved' })] },
      { userRole: 'super_admin' },
    )
    fake.rpc.mockResolvedValueOnce({ data: null, error: { message: "INVALID_STATE: Only a paid settlement can be corrected (current: approved)" } })

    const res = await app.inject({
      method: 'PATCH', url: `/employees/${EMPLOYEE_ID}/separation-ff/correct-payment`, headers: HEADERS,
      payload: { reason: 'test', recovery_reference: 'UTR123' },
    })
    expect(res.statusCode).toBe(409)
    expect(JSON.parse(res.body).error).toBe('INVALID_STATE')
    expect(fake._db.separation_ff_summary[0].status).toBe('approved')
    await app.close()
  })

  it('an unrecognized RPC error falls back to a generic 500, never leaking the raw DB message', async () => {
    const { app, fake } = await buildApp(
      { employees: [employeeRow()], separation_ff_summary: [ffRow({ status: 'paid' })] },
      { userRole: 'super_admin' },
    )
    fake.rpc.mockResolvedValueOnce({ data: null, error: { message: 'duplicate key value violates unique constraint "advance_recoveries_pkey"' } })

    const res = await app.inject({
      method: 'PATCH', url: `/employees/${EMPLOYEE_ID}/separation-ff/correct-payment`, headers: HEADERS,
      payload: { reason: 'test', recovery_reference: 'UTR123' },
    })
    expect(res.statusCode).toBe(500)
    expect(res.body).not.toContain('advance_recoveries_pkey')
    await app.close()
  })
})
