/**
 * payroll-dept-snapshot — canonical population of payroll_dept_snapshots.
 *
 * payroll_dept_snapshots is the SINGLE SOURCE OF TRUTH for department-level
 * payroll cost: it is read by the executive Financial/CEO dashboards and the
 * cost-analytics endpoints. Historically nothing ever wrote it, so those
 * dashboards silently showed ₹0 OT / dept cost. This module (re)builds it from
 * the authoritative per-employee payroll_slips whenever a run is finalized.
 *
 * Also the single home for `otFromBreakdown` (previously copy-pasted in cost.ts
 * and manager/team-payroll-cost.ts) so OT extraction can never drift.
 */

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

function priorMonth(m: string): string {
  const [y, mo] = m.split('-').map(Number)
  const d = new Date(y, mo - 2, 1)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

const round2 = (n: number) => Math.round(n * 100) / 100

interface DeptAgg {
  department_id: string | null
  department_name: string
  headcount: number
  total_gross: number
  total_net: number
  total_ot_cost: number
  total_lop_deduction: number
}

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
  const { data: slips, error: slipErr } = await supabase
    .from('payroll_slips')
    .select(`
      employee_id, gross_pay, net_pay, lop_amount, component_breakdown,
      employees!inner(
        id,
        job_history!job_history_employee_id_fkey(department_id, is_current, departments(id, name))
      )
    `)
    .eq('run_id', runId)
    .eq('tenant_id', tenantId)

  if (slipErr) return { ok: false, rows: 0, error: slipErr.message }

  const deptMap = new Map<string, DeptAgg>()
  for (const slip of (slips ?? []) as any[]) {
    const jh = (slip.employees?.job_history ?? []).find((j: any) => j.is_current)
    const deptId: string | null = jh?.department_id ?? null
    const deptName = jh?.departments?.name ?? 'Unassigned'
    const mapKey = deptId ?? '__unassigned__'
    const entry = deptMap.get(mapKey) ?? {
      department_id: deptId, department_name: deptName,
      headcount: 0, total_gross: 0, total_net: 0, total_ot_cost: 0, total_lop_deduction: 0,
    }
    entry.headcount++
    entry.total_gross         += Number(slip.gross_pay ?? 0)
    entry.total_net           += Number(slip.net_pay ?? 0)
    entry.total_ot_cost       += otFromBreakdown(slip.component_breakdown)
    entry.total_lop_deduction += Number(slip.lop_amount ?? 0)
    deptMap.set(mapKey, entry)
  }

  // Prior-month gross per department, for variance flags.
  const { data: priorSnaps } = await supabase
    .from('payroll_dept_snapshots')
    .select('department_id, total_gross')
    .eq('tenant_id', tenantId)
    .eq('month', priorMonth(month))
  const priorGross = new Map<string, number>()
  for (const p of (priorSnaps ?? []) as any[]) {
    priorGross.set((p.department_id ?? '__unassigned__') as string, Number(p.total_gross ?? 0))
  }

  const rows = Array.from(deptMap.entries()).map(([mapKey, d]) => {
    const prior = priorGross.get(mapKey)
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
      total_lop_deduction: round2(d.total_lop_deduction),
      avg_gross:           d.headcount > 0 ? round2(d.total_gross / d.headcount) : 0,
      prior_month_gross:   prior ?? null,
      variance_pct,
      variance_amount,
      has_high_variance:   variance_pct != null && Math.abs(variance_pct) > 10,
      ot_heavy:            d.total_gross > 0 && d.total_ot_cost > d.total_gross * 0.15,
    }
  })

  // Replace this month's rows so the snapshot always reflects the latest run.
  const { error: delErr } = await supabase
    .from('payroll_dept_snapshots')
    .delete()
    .eq('tenant_id', tenantId)
    .eq('month', month)
  if (delErr) return { ok: false, rows: 0, error: delErr.message }

  if (rows.length > 0) {
    const { error: insErr } = await supabase.from('payroll_dept_snapshots').insert(rows)
    if (insErr) return { ok: false, rows: 0, error: insErr.message }
  }
  return { ok: true, rows: rows.length }
}
