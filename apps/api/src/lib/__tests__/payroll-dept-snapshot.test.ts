/**
 * payroll-dept-snapshot — reconciliation tests
 *
 * These tests are the regression gate for the "no single source of truth" bug:
 * department payroll cost is now aggregated in exactly one place
 * (aggregateDeptCost), consumed by both the live /analytics/payroll/cost
 * endpoint and the finalize-time payroll_dept_snapshots writer.
 *
 * The invariants asserted here are what makes the snapshot and the live number
 * provably equal — if anyone reintroduces a parallel aggregation that drifts,
 * one of these fails.
 *
 * Covered:
 *   1. otFromBreakdown — OT extraction across code/name/type shapes
 *   2. aggregateDeptCost — per-department rollup + the cross-surface
 *      reconciliation invariants (Σ dept === Σ slips for every figure)
 *   3. resolveSlipDept — current-dept resolution, unassigned fallback
 *   4. buildDeptSnapshots — writes reconciling rows, replace-by-month semantics,
 *      prior-month variance flags, ot_heavy flag, non-fatal error handling
 */

import { describe, it, expect, vi } from 'vitest'
import {
  otFromBreakdown, resolveSlipDept, aggregateDeptCost, buildDeptSnapshots,
} from '../payroll-dept-snapshot.js'

// ── Slip fixtures ──────────────────────────────────────────────────────────────
// Shape mirrors the SLIP_DEPT_SELECT PostgREST result: each slip carries a
// nested employees.job_history[] with the current row flagged.

function slip(opts: {
  gross: number; net: number; lop?: number
  ot?: number
  deptId?: string | null; deptName?: string
}) {
  const breakdown: any[] = [
    { code: 'BASIC', name: 'Basic', type: 'earning', amount: opts.gross * 0.5 },
  ]
  if (opts.ot && opts.ot > 0) {
    breakdown.push({ code: 'OT', name: 'Overtime', type: 'earning', amount: opts.ot })
  }
  return {
    gross_pay:           opts.gross,
    net_pay:             opts.net,
    lop_amount:          opts.lop ?? 0,
    component_breakdown: breakdown,
    employees: {
      job_history: [
        opts.deptId === undefined
          ? { department_id: 'd-eng', is_current: true, departments: { id: 'd-eng', name: 'Engineering' } }
          : { department_id: opts.deptId, is_current: true, departments: opts.deptId ? { id: opts.deptId, name: opts.deptName ?? opts.deptId } : null },
        // a stale, non-current row that must be ignored
        { department_id: 'd-old', is_current: false, departments: { id: 'd-old', name: 'OldDept' } },
      ],
    },
  }
}

describe('otFromBreakdown', () => {
  it('sums overtime components by code/name/type, ignores others', () => {
    expect(otFromBreakdown([
      { code: 'OT', amount: 500 },
      { name: 'Over Time', amount: 250 },
      { type: 'overtime', value: 100 },
      { code: 'BASIC', amount: 9999 },
    ])).toBe(850)
  })
  it('non-array / empty → 0', () => {
    expect(otFromBreakdown(null)).toBe(0)
    expect(otFromBreakdown(undefined)).toBe(0)
    expect(otFromBreakdown([])).toBe(0)
  })
  it('does not match unrelated tokens containing "ot" (e.g. "total")', () => {
    expect(otFromBreakdown([{ name: 'Total Allowance', amount: 1000 }])).toBe(0)
  })
})

describe('resolveSlipDept', () => {
  it('picks the current job_history row', () => {
    expect(resolveSlipDept(slip({ gross: 100, net: 90 })))
      .toEqual({ department_id: 'd-eng', department_name: 'Engineering' })
  })
  it('falls back to Unassigned when dept is null', () => {
    expect(resolveSlipDept(slip({ gross: 100, net: 90, deptId: null })))
      .toEqual({ department_id: null, department_name: 'Unassigned' })
  })
  it('handles missing employees/job_history', () => {
    expect(resolveSlipDept({})).toEqual({ department_id: null, department_name: 'Unassigned' })
  })
})

describe('aggregateDeptCost — rollup', () => {
  const slips = [
    slip({ gross: 1000, net: 850, lop: 50, ot: 200, deptId: 'd-eng', deptName: 'Engineering' }),
    slip({ gross: 2000, net: 1700, lop: 0,  ot: 0,   deptId: 'd-eng', deptName: 'Engineering' }),
    slip({ gross: 1500, net: 1300, lop: 100, ot: 50, deptId: 'd-sales', deptName: 'Sales' }),
    slip({ gross: 800,  net: 700,  lop: 0,  ot: 0,   deptId: null }), // unassigned
  ]
  const depts = aggregateDeptCost(slips)

  it('groups per department + unassigned bucket', () => {
    expect(depts.map(d => d.department_id).sort())
      .toEqual([null, 'd-eng', 'd-sales'].sort())
  })

  it('sorts by total_gross desc', () => {
    expect(depts[0].department_id).toBe('d-eng') // 3000 is the largest
  })

  it('computes per-dept figures correctly', () => {
    const eng = depts.find(d => d.department_id === 'd-eng')!
    expect(eng).toMatchObject({
      headcount: 2, total_gross: 3000, total_net: 2550, total_ot_cost: 200, total_lop: 50,
      avg_gross: 1500,
    })
  })

  it('unassigned bucket is keyed by null department_id', () => {
    const un = depts.find(d => d.department_id === null)!
    expect(un.department_name).toBe('Unassigned')
    expect(un.headcount).toBe(1)
  })
})

describe('aggregateDeptCost — reconciliation invariants', () => {
  // Mixed set incl. unassigned, OT, LOP, varied depts.
  const slips = [
    slip({ gross: 1000, net: 850,  lop: 50,  ot: 200, deptId: 'd-eng' }),
    slip({ gross: 2000, net: 1700, lop: 0,   ot: 0,   deptId: 'd-eng' }),
    slip({ gross: 1500, net: 1300, lop: 100, ot: 50,  deptId: 'd-sales' }),
    slip({ gross: 800,  net: 700,  lop: 0,   ot: 0,   deptId: null }),
    slip({ gross: 1234, net: 1111, lop: 23,  ot: 77,  deptId: 'd-ops' }),
  ]
  const depts = aggregateDeptCost(slips)
  const sum = (f: (d: any) => number) => depts.reduce((a, d) => a + f(d), 0)

  it('Σ headcount === slips.length', () => {
    expect(sum(d => d.headcount)).toBe(slips.length)
  })
  it('Σ total_gross === Σ slip.gross_pay', () => {
    expect(sum(d => d.total_gross)).toBe(slips.reduce((a, s) => a + Number(s.gross_pay), 0))
  })
  it('Σ total_net === Σ slip.net_pay', () => {
    expect(sum(d => d.total_net)).toBe(slips.reduce((a, s) => a + Number(s.net_pay), 0))
  })
  it('Σ total_ot_cost === Σ otFromBreakdown(slip)', () => {
    expect(sum(d => d.total_ot_cost))
      .toBe(slips.reduce((a, s) => a + otFromBreakdown(s.component_breakdown), 0))
  })
  it('Σ total_lop === Σ slip.lop_amount', () => {
    expect(sum(d => d.total_lop)).toBe(slips.reduce((a, s) => a + Number(s.lop_amount), 0))
  })
  it('empty input → no rows, all sums zero', () => {
    expect(aggregateDeptCost([])).toEqual([])
  })
})

// ── buildDeptSnapshots against a mocked Supabase ────────────────────────────────

interface Captured {
  /** Rows passed to the .upsert() call, if it was reached. */
  inserted: any[] | null
  /** True if the narrow "delete the null-department row first" call fired. */
  deletedUnassigned: boolean
  /** True if the stale-department cleanup delete fired. */
  deletedStale: boolean
}

/**
 * Minimal Supabase stub for buildDeptSnapshots. Serves slips for the run and
 * (optionally) prior-month snapshot rows, and captures the upsert + the two
 * possible delete calls the writer performs so tests can assert the
 * persisted rows.
 *
 * buildDeptSnapshots' write path (current shape, not the old delete-then-
 * insert): upsert first (so a failed write leaves the prior snapshot intact),
 * then an optional narrow delete of the null-department row (unique
 * constraints treat NULLs as distinct, so upsert's onConflict can't match a
 * prior run's null-department row), then a stale-department cleanup delete.
 * Both deletes share the `.delete().eq().eq()` prefix — disambiguate on the
 * next call: `.is()` is the narrow unassigned delete, `.not()` is the stale
 * cleanup.
 */
function mockSupabase(opts: {
  slips: any[]
  priorSnaps?: Array<{ department_id: string | null; total_gross: number }>
  upsertError?: string
}): { supabase: any; captured: Captured } {
  const captured: Captured = { inserted: null, deletedUnassigned: false, deletedStale: false }
  const supabase = {
    from(table: string) {
      if (table === 'payroll_slips') {
        // buildDeptSnapshots pages this query via fetchAllRows(), which appends
        // .order('employee_id').range(from, to) after the .eq() filters — the
        // chain must support both, and .range() must actually respect its
        // bounds (return an empty page once exhausted) or fetchAllRows loops
        // forever re-fetching the same non-empty page.
        return {
          select: () => ({ eq: () => ({ eq: () => ({ order: () => ({
            range: (from: number, to: number) => Promise.resolve({ data: opts.slips.slice(from, to + 1), error: null }),
          }) }) }) }),
        }
      }
      if (table === 'payroll_dept_snapshots') {
        return {
          // prior-month read
          select: () => ({ eq: () => ({ eq: () => Promise.resolve({ data: opts.priorSnaps ?? [], error: null }) }) }),
          delete: () => ({ eq: () => ({ eq: () => ({
            is: () => { captured.deletedUnassigned = true; return Promise.resolve({ error: null }) },
            not: () => ({ not: () => { captured.deletedStale = true; return Promise.resolve({ error: null }) } }),
          }) }) }),
          upsert: (rows: any[]) => {
            captured.inserted = rows
            return Promise.resolve({ error: opts.upsertError ? { message: opts.upsertError } : null })
          },
        }
      }
      throw new Error(`unexpected table ${table}`)
    },
  }
  return { supabase, captured }
}

describe('buildDeptSnapshots', () => {
  const slips = [
    slip({ gross: 1000, net: 850,  lop: 50,  ot: 200, deptId: 'd-eng',   deptName: 'Engineering' }),
    slip({ gross: 2000, net: 1700, lop: 0,   ot: 0,   deptId: 'd-eng',   deptName: 'Engineering' }),
    slip({ gross: 1500, net: 1300, lop: 100, ot: 50,  deptId: 'd-sales', deptName: 'Sales' }),
  ]

  it('writes one reconciling row per department and reports row count', async () => {
    const { supabase, captured } = mockSupabase({ slips })
    const res = await buildDeptSnapshots({ supabase, tenantId: 't1', month: '2026-06', runId: 'r1' })

    expect(res).toEqual({ ok: true, rows: 2 })
    expect(captured.deletedStale).toBe(true) // stale-department cleanup after upsert
    expect(captured.deletedUnassigned).toBe(false) // no null-department row in this run

    const eng = captured.inserted!.find(r => r.department_id === 'd-eng')!
    expect(eng).toMatchObject({
      tenant_id: 't1', payroll_run_id: 'r1', month: '2026-06',
      department_name: 'Engineering', headcount: 2,
      total_gross: 3000, total_net: 2550, total_ot_cost: 200,
      total_lop_deduction: 50, avg_gross: 1500,
    })

    // Persisted totals reconcile with the raw slips.
    const persistedGross = captured.inserted!.reduce((a, r) => a + r.total_gross, 0)
    expect(persistedGross).toBe(slips.reduce((a, s) => a + Number(s.gross_pay), 0))
  })

  it('flags ot_heavy when OT > 15% of gross', async () => {
    // gross 1000, ot 200 → 20% > 15% → ot_heavy
    const { supabase, captured } = mockSupabase({ slips: [slip({ gross: 1000, net: 800, ot: 200, deptId: 'd-x' })] })
    await buildDeptSnapshots({ supabase, tenantId: 't1', month: '2026-06', runId: 'r1' })
    expect(captured.inserted![0].ot_heavy).toBe(true)
  })

  it('computes prior-month variance and high-variance flag', async () => {
    // prior gross 1000, current 2000 → +100% → has_high_variance
    const { supabase, captured } = mockSupabase({
      slips: [slip({ gross: 2000, net: 1800, deptId: 'd-eng', deptName: 'Engineering' })],
      priorSnaps: [{ department_id: 'd-eng', total_gross: 1000 }],
    })
    await buildDeptSnapshots({ supabase, tenantId: 't1', month: '2026-06', runId: 'r1' })
    const row = captured.inserted![0]
    expect(row.prior_month_gross).toBe(1000)
    expect(row.variance_amount).toBe(1000)
    expect(row.variance_pct).toBe(100)
    expect(row.has_high_variance).toBe(true)
  })

  it('leaves variance null when no prior month exists', async () => {
    const { supabase, captured } = mockSupabase({ slips: [slip({ gross: 500, net: 450, deptId: 'd-eng' })] })
    await buildDeptSnapshots({ supabase, tenantId: 't1', month: '2026-06', runId: 'r1' })
    const row = captured.inserted![0]
    expect(row.prior_month_gross).toBeNull()
    expect(row.variance_pct).toBeNull()
    expect(row.has_high_variance).toBe(false)
  })

  it('no slips → refuses to write rather than erasing a real snapshot with zero rows', async () => {
    // A run producing no department rows must never silently upsert/delete
    // over a prior, good snapshot — this table is read directly by the
    // executive dashboard. buildDeptSnapshots returns ok:false and touches
    // neither upsert nor delete.
    const { supabase, captured } = mockSupabase({ slips: [] })
    const res = await buildDeptSnapshots({ supabase, tenantId: 't1', month: '2026-06', runId: 'r1' })
    expect(res).toEqual({
      ok: false, rows: 0,
      error: 'No department rows computed for this run — refusing to replace existing snapshot',
    })
    expect(captured.inserted).toBeNull()
    expect(captured.deletedUnassigned).toBe(false)
    expect(captured.deletedStale).toBe(false)
  })

  it('surfaces upsert failure non-fatally (ok:false + message)', async () => {
    const { supabase } = mockSupabase({ slips, upsertError: 'boom' })
    const res = await buildDeptSnapshots({ supabase, tenantId: 't1', month: '2026-06', runId: 'r1' })
    expect(res.ok).toBe(false)
    expect(res.error).toBe('boom')
  })

  it('deletes the null-department bucket first when this run has an unassigned dept', async () => {
    const { supabase, captured } = mockSupabase({
      slips: [slip({ gross: 500, net: 450, deptId: null })],
    })
    const res = await buildDeptSnapshots({ supabase, tenantId: 't1', month: '2026-06', runId: 'r1' })
    expect(res).toEqual({ ok: true, rows: 1 })
    expect(captured.deletedUnassigned).toBe(true)
    // A single unassigned-only row has no non-null department_id to key the
    // stale-cleanup delete on, so that branch is skipped.
    expect(captured.deletedStale).toBe(false)
  })
})
