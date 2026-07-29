/**
 * payroll-dept-snapshot — canonical department-level payroll cost aggregation.
 *
 * payroll_dept_snapshots is the SINGLE SOURCE OF TRUTH for department-level
 * payroll cost: it is read by the executive Financial/CEO dashboards and the
 * cost-analytics endpoints. Historically nothing ever wrote it, so those
 * dashboards silently showed ₹0 OT / dept cost. This module (re)builds it from
 * the authoritative per-employee payroll_slips whenever a run is finalized.
 *
 * It is also the ONE place department cost is aggregated. Both the finalize-time
 * snapshot writer (`buildDeptSnapshots`) and the live `/analytics/payroll/cost`
 * endpoint call `aggregateDeptCost`, over the same `SLIP_DEPT_SELECT` query, so
 * the snapshot and the live number are computed by identical code and can never
 * drift. `otFromBreakdown` lives here too (previously copy-pasted in cost.ts and
 * manager/team-payroll-cost.ts).
 */

import { fetchAllRows } from './supabase-paginate.js'

/**
 * The exact PostgREST select used to pull per-employee slips joined to the
 * employee's current department. Shared so every caller aggregates the same
 * shape — change the join in one place only.
 */
export const SLIP_DEPT_SELECT = `
  employee_id, gross_pay, net_pay, lop_amount, component_breakdown,
  employees!inner(
    id,
    job_history!job_history_employee_id_fkey(department_id, is_current, departments(id, name))
  )
` as const

/** Best-effort overtime cost from a payroll slip's component_breakdown JSONB. */
export function otFromBreakdown(cb: unknown): number {
  if (!Array.isArray(cb)) return 0
  let ot = 0
  for (const c of cb as any[]) {
    const key = `${c?.code ?? ''} ${c?.name ?? ''} ${c?.type ?? ''}`.toLowerCase()
    if (/over\s*time|overtime|(^|[^a-z])ot([^a-z]|$)/.test(key)) {
      ot += Number(c?.amount ?? c?.value ?? 0) || 0
    }
  }
  return ot
}

/** Resolve a slip's department from its nested current job_history row. */
export function resolveSlipDept(slip: any): { department_id: string | null; department_name: string } {
  const jh = (slip?.employees?.job_history ?? []).find((j: any) => j.is_current)
  return {
    department_id:   jh?.department_id ?? null,
    department_name: jh?.departments?.name ?? 'Unassigned',
  }
}

export interface DeptCost {
  department_id:   string | null
  department_name: string
  headcount:       number
  total_gross:     number
  total_net:       number
  total_ot_cost:   number
  total_lop:       number
  avg_gross:       number
}

/** Sentinel map key for slips with no department (department_id is NULL). */
const UNASSIGNED = '__unassigned__'

/**
 * Aggregate per-employee slips into per-department cost rows. Pure: no I/O, no
 * rounding of intermediate sums (callers round on persist). This is THE
 * definition of "department payroll cost" — every surface derives from it.
 *
 * Reconciliation invariants (asserted in tests):
 *   • Σ dept.headcount      === slips.length
 *   • Σ dept.total_gross    === Σ slip.gross_pay
 *   • Σ dept.total_net      === Σ slip.net_pay
 *   • Σ dept.total_ot_cost  === Σ otFromBreakdown(slip)
 *   • Σ dept.total_lop      === Σ slip.lop_amount
 */
export function aggregateDeptCost(slips: any[]): DeptCost[] {
  const deptMap = new Map<string, DeptCost>()
  for (const slip of slips ?? []) {
    const { department_id, department_name } = resolveSlipDept(slip)
    const mapKey = department_id ?? UNASSIGNED
    const entry = deptMap.get(mapKey) ?? {
      department_id, department_name,
      headcount: 0, total_gross: 0, total_net: 0, total_ot_cost: 0, total_lop: 0, avg_gross: 0,
    }
    entry.headcount++
    entry.total_gross   += Number(slip.gross_pay ?? 0)
    entry.total_net     += Number(slip.net_pay ?? 0)
    entry.total_ot_cost += otFromBreakdown(slip.component_breakdown)
    entry.total_lop     += Number(slip.lop_amount ?? 0)
    deptMap.set(mapKey, entry)
  }
  return Array.from(deptMap.values())
    .map(d => ({ ...d, avg_gross: d.headcount > 0 ? Math.round(d.total_gross / d.headcount) : 0 }))
    .sort((a, b) => b.total_gross - a.total_gross)
}

function priorMonth(m: string): string {
  const [y, mo] = m.split('-').map(Number)
  const d = new Date(y, mo - 2, 1)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

const round2 = (n: number) => Math.round(n * 100) / 100

/**
 * Rebuild payroll_dept_snapshots for (tenant, month) from the finalized run's
 * payroll_slips. Replace-by-month (delete + insert) so the snapshot always
 * reflects the latest finalized run for that month. Returns a result object;
 * callers treat failures as non-fatal to payroll finalization.
 */
export async function buildDeptSnapshots(args: {
  supabase: any; tenantId: string; month: string; runId: string
}): Promise<{ ok: boolean; rows: number; error?: string }> {
  const { supabase, tenantId, month, runId } = args

  // Authoritative per-employee output, joined to the employee's current dept.
  // One row per employee in the run — paginate for large tenants.
  let slips: any[]
  try {
    slips = await fetchAllRows((from, to) =>
      supabase
        .from('payroll_slips')
        .select(SLIP_DEPT_SELECT)
        .eq('run_id', runId)
        .eq('tenant_id', tenantId)
        .order('employee_id')
        .range(from, to),
    )
  } catch (slipErr: any) {
    return { ok: false, rows: 0, error: slipErr.message }
  }

  const depts = aggregateDeptCost(slips)

  // Prior-month gross per department, for variance flags.
  const { data: priorSnaps } = await supabase
    .from('payroll_dept_snapshots')
    .select('department_id, total_gross')
    .eq('tenant_id', tenantId)
    .eq('month', priorMonth(month))
  const priorGross = new Map<string, number>()
  for (const p of (priorSnaps ?? []) as any[]) {
    priorGross.set((p.department_id ?? UNASSIGNED) as string, Number(p.total_gross ?? 0))
  }

  const rows = depts.map((d) => {
    const prior = priorGross.get(d.department_id ?? UNASSIGNED)
    const variance_amount = prior != null ? round2(d.total_gross - prior) : null
    const variance_pct = prior != null && prior > 0 ? round2((d.total_gross - prior) / prior * 100) : null
    return {
      tenant_id:           tenantId,
      payroll_run_id:      runId,
      department_id:       d.department_id,
      department_name:     d.department_name,
      month,
      headcount:           d.headcount,
      total_gross:         round2(d.total_gross),
      total_net:           round2(d.total_net),
      total_ot_cost:       round2(d.total_ot_cost),
      total_lop_deduction: round2(d.total_lop),
      avg_gross:           d.headcount > 0 ? round2(d.total_gross / d.headcount) : 0,
      prior_month_gross:   prior ?? null,
      variance_pct,
      variance_amount,
      has_high_variance:   variance_pct != null && Math.abs(variance_pct) > 10,
      ot_heavy:            d.total_gross > 0 && d.total_ot_cost > d.total_gross * 0.15,
    }
  })

  // Zero departments computed for this run (e.g. a run that produced no
  // slips) must never silently replace a prior, good snapshot with nothing —
  // this table is read directly by the executive dashboard, so an empty
  // rebuild reporting ok:true would erase real numbers with no error surfaced
  // anywhere. Refuse instead of deleting.
  if (rows.length === 0) {
    return { ok: false, rows: 0, error: 'No department rows computed for this run — refusing to replace existing snapshot' }
  }

  // Upsert before deleting anything, so a failed write leaves the prior
  // month's snapshot intact instead of the old delete-then-insert window
  // (delete succeeds, insert fails → dashboard reads zero until the next
  // successful rebuild).
  //
  // department_id is nullable (the "Unassigned" bucket) and Postgres unique
  // constraints treat NULLs as distinct from one another, so upsert's
  // onConflict can't match against a prior run's null-department row —
  // delete that single row explicitly first (a narrow, single-row delete,
  // not the whole month).
  if (rows.some(r => r.department_id == null)) {
    const { error: delUnassignedErr } = await supabase
      .from('payroll_dept_snapshots')
      .delete()
      .eq('tenant_id', tenantId)
      .eq('month', month)
      .is('department_id', null)
    if (delUnassignedErr) return { ok: false, rows: 0, error: delUnassignedErr.message }
  }

  const { error: upsertErr } = await supabase
    .from('payroll_dept_snapshots')
    .upsert(rows, { onConflict: 'tenant_id,department_id,month' })
  if (upsertErr) return { ok: false, rows: 0, error: upsertErr.message }

  // Clean up rows for departments that no longer appear in this run (e.g.
  // merged/deleted departments) — mirrors the prior delete-all replace
  // semantics for anything outside the current department set.
  const currentDeptIds = rows.map(r => r.department_id).filter((id): id is string => id != null)
  if (currentDeptIds.length > 0) {
    const { error: staleErr } = await supabase
      .from('payroll_dept_snapshots')
      .delete()
      .eq('tenant_id', tenantId)
      .eq('month', month)
      .not('department_id', 'is', null)
      .not('department_id', 'in', `(${currentDeptIds.join(',')})`)
    if (staleErr) return { ok: false, rows: rows.length, error: staleErr.message }
  }

  return { ok: true, rows: rows.length }
}
