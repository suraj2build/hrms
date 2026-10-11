/**
 * F&F settlement — freeze-on-decision, version-bound approval, and the
 * paid-time recovery write-back (PR #30 follow-up fixes).
 *
 * Covers the three gaps raised against separation-workflow.ts:
 *   1. POST /separation-ff and POST /separation-ff/compute must refuse to
 *      touch a row that is no longer 'draft' (approval must freeze the
 *      reviewed figures).
 *   2. PATCH /separation-ff/approve's final UPDATE must bind to the exact
 *      `version` the staleness check just validated, not just `status`,
 *      so a concurrent edit landing between validation and the write can't
 *      be silently approved un-reviewed (TOCTOU).
 *   3. PATCH /separation-ff/mark-paid must reconcile outstanding
 *      employee_loans / advance_recovery_schedules so the SAME balance
 *      can't later be recovered a second time through a normal payroll
 *      run — and that write-back must be idempotent under retries.
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

  return { from: (t: string) => from(t), _db: db }
}

type BuildAppOpts = { raceHooks?: Record<string, RaceHook[]> }

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
    ;(req as any).userRole = 'hr_admin'
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

describe('PATCH /separation-ff/mark-paid — idempotent recovery write-back', () => {
  function loanRow(overrides: Row = {}) {
    return {
      id: 'loan-1', tenant_id: TENANT_ID, employee_id: EMPLOYEE_ID,
      status: 'active', outstanding_balance: 15000,
      ...overrides,
    }
  }
  function loanScheduleRow(overrides: Row = {}) {
    return { id: 'sched-loan-1', tenant_id: TENANT_ID, loan_id: 'loan-1', status: 'pending', ...overrides }
  }
  function advanceRow(overrides: Row = {}) {
    return { id: 'advance-1', tenant_id: TENANT_ID, employee_id: EMPLOYEE_ID, status: 'recovering', ...overrides }
  }
  function advanceScheduleRow(overrides: Row = {}) {
    return {
      id: 'sched-adv-1', tenant_id: TENANT_ID, advance_id: 'advance-1',
      status: 'pending', recovery_month: '2026-11', scheduled_amount: 2000,
      ...overrides,
    }
  }

  it('forecloses outstanding loans and recovers outstanding advances on mark-paid', async () => {
    const { app, fake } = await buildApp({
      employees: [employeeRow()],
      separation_ff_summary: [ffRow({ status: 'approved' })],
      employee_loans: [loanRow()],
      loan_schedules: [loanScheduleRow()],
      advance_salary_requests: [advanceRow()],
      advance_recovery_schedules: [advanceScheduleRow()],
      advance_recoveries: [],
    })

    const res = await app.inject({
      method: 'PATCH', url: `/employees/${EMPLOYEE_ID}/separation-ff/mark-paid`, headers: HEADERS, payload: {},
    })

    expect(res.statusCode).toBe(200)
    expect(fake._db.separation_ff_summary[0].status).toBe('paid')

    // Loan: foreclosed, balance zeroed, its schedule adjusted out of the
    // normal payroll run's own filter (status='pending' AND loan.status='active').
    const loan = fake._db.employee_loans.find((l: Row) => l.id === 'loan-1')!
    expect(loan.status).toBe('foreclosed')
    expect(loan.outstanding_balance).toBe(0)
    expect(fake._db.loan_schedules.find((s: Row) => s.id === 'sched-loan-1')!.status).toBe('adjusted')

    // Advance: schedule recovered, ledger entry written, parent flipped out
    // of the normal payroll run's own filter (status IN ('disbursed','recovering')).
    expect(fake._db.advance_recovery_schedules.find((s: Row) => s.id === 'sched-adv-1')!.status).toBe('recovered')
    expect(fake._db.advance_recoveries).toHaveLength(1)
    expect(fake._db.advance_recoveries[0].amount).toBe(2000)
    expect(fake._db.advance_salary_requests.find((a: Row) => a.id === 'advance-1')!.status).toBe('fully_recovered')

    await app.close()
  })

  it('a loan already foreclosed by a concurrent request is left untouched — no double write', async () => {
    const { app, fake } = await buildApp({
      employees: [employeeRow()],
      separation_ff_summary: [ffRow({ status: 'approved' })],
      employee_loans: [loanRow({ status: 'foreclosed', outstanding_balance: 0, foreclosure_amount: 15000 })],
      loan_schedules: [loanScheduleRow({ status: 'adjusted' })],
      advance_salary_requests: [],
      advance_recovery_schedules: [],
      advance_recoveries: [],
    })

    const res = await app.inject({
      method: 'PATCH', url: `/employees/${EMPLOYEE_ID}/separation-ff/mark-paid`, headers: HEADERS, payload: {},
    })

    expect(res.statusCode).toBe(200)
    // Already-foreclosed loan is excluded from the fetch filter (status IN
    // ('disbursed','active')) entirely — its foreclosure_amount must not be
    // re-stamped with a second, possibly different "outstanding at the time" value.
    expect(fake._db.employee_loans[0].foreclosure_amount).toBe(15000)
    await app.close()
  })

  it('retrying mark-paid after it already succeeded cannot double-deduct — second call 409s before reconciliation re-runs', async () => {
    const { app, fake } = await buildApp({
      employees: [employeeRow()],
      separation_ff_summary: [ffRow({ status: 'approved' })],
      employee_loans: [loanRow()],
      loan_schedules: [loanScheduleRow()],
      advance_salary_requests: [advanceRow()],
      advance_recovery_schedules: [advanceScheduleRow()],
      advance_recoveries: [],
    })

    const first = await app.inject({ method: 'PATCH', url: `/employees/${EMPLOYEE_ID}/separation-ff/mark-paid`, headers: HEADERS, payload: {} })
    expect(first.statusCode).toBe(200)
    expect(fake._db.advance_recoveries).toHaveLength(1)

    // Client retries the same request (timeout, double-click, etc.) — the
    // settlement is already 'paid', so this must be rejected before the
    // reconciliation logic runs a second time against the same balances.
    const second = await app.inject({ method: 'PATCH', url: `/employees/${EMPLOYEE_ID}/separation-ff/mark-paid`, headers: HEADERS, payload: {} })
    expect(second.statusCode).toBe(409)
    expect(JSON.parse(second.body).error).toBe('INVALID_STATE')

    // No second ledger entry — the retry did not re-run the recovery write-back.
    expect(fake._db.advance_recoveries).toHaveLength(1)
    expect(fake._db.employee_loans[0].status).toBe('foreclosed')
    await app.close()
  })

  it('an advance with no pending schedules left is skipped without error (already fully reconciled)', async () => {
    const { app, fake } = await buildApp({
      employees: [employeeRow()],
      separation_ff_summary: [ffRow({ status: 'approved' })],
      employee_loans: [],
      loan_schedules: [],
      advance_salary_requests: [advanceRow({ status: 'fully_recovered' })],
      advance_recovery_schedules: [advanceScheduleRow({ status: 'recovered' })],
      advance_recoveries: [],
    })

    const res = await app.inject({
      method: 'PATCH', url: `/employees/${EMPLOYEE_ID}/separation-ff/mark-paid`, headers: HEADERS, payload: {},
    })

    expect(res.statusCode).toBe(200)
    // 'fully_recovered' is outside the fetch filter (status IN
    // ('disbursed','recovering')) — no new ledger entry should appear.
    expect(fake._db.advance_recoveries).toHaveLength(0)
    await app.close()
  })
})
