/**
 * fbp-service.ts
 *
 * DB-facing FBP reconciliation logic (the route layer stays thin).
 *
 *   computeQuarterReconciliation — for a tenant/FY/quarter, total each
 *     reimbursement component's PAID amount (from finalized payslips) and
 *     APPROVED bills (proof), compute the taxable shortfall, and upsert
 *     fbp_reconciliations. Locked rows are never recomputed.
 *
 *   fetchFbpTaxableForEmployee — sum of LOCKED taxable across an FY for one
 *     employee, fed into the TDS engine's otherIncome add-back.
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import {
  computeFbpTaxable, quarterMonths, sumComponentPaid,
} from './fbp-reconciliation.js'

export interface ReconciliationRow {
  employee_id:         string
  salary_component_id: string
  component_code:      string
  component_name:      string
  financial_year:      string
  quarter:             number
  paid_amount:         number
  proof_amount:        number
  exemption_limit:     number | null
  taxable_amount:      number
  status:              'pending' | 'locked'
}

/**
 * Compute + persist the quarter's reconciliation for every reimbursement
 * component and every employee who was paid one. Returns the rows. Rows already
 * 'locked' are returned as-is and never overwritten.
 *
 * Exemption limit handling: exemption_limit_annual is prorated to the quarter
 * (÷4) as the per-quarter exempt cap.
 */
export async function computeQuarterReconciliation(
  supabase: SupabaseClient,
  tenantId: string,
  financialYear: string,
  quarter: number,
): Promise<ReconciliationRow[]> {
  // 1. Reimbursement components for this tenant.
  const { data: comps, error: compErr } = await supabase
    .from('salary_components')
    .select('id, code, name, exemption_limit_annual')
    .eq('tenant_id', tenantId)
    .eq('is_reimbursement', true)
  if (compErr) throw new Error(`fbp: failed to load components: ${compErr.message}`)
  if (!comps || comps.length === 0) return []

  const months = quarterMonths(financialYear, quarter)

  // 2. Finalized payslips for the quarter.
  const { data: slips, error: slipErr } = await supabase
    .from('payroll_slips')
    .select('employee_id, component_breakdown, month')
    .eq('tenant_id', tenantId)
    .in('month', months)
    .eq('status', 'finalized')
  if (slipErr) throw new Error(`fbp: failed to load payslips: ${slipErr.message}`)

  // Group slips by employee.
  const slipsByEmp = new Map<string, Array<{ component_breakdown: any }>>()
  for (const s of (slips ?? []) as any[]) {
    const arr = slipsByEmp.get(s.employee_id) ?? []
    arr.push({ component_breakdown: s.component_breakdown })
    slipsByEmp.set(s.employee_id, arr)
  }

  // 3. Approved bills for the quarter, summed per (employee, component).
  const { data: bills, error: billErr } = await supabase
    .from('fbp_bill_submissions')
    .select('employee_id, salary_component_id, amount, approved_amount')
    .eq('tenant_id', tenantId)
    .eq('financial_year', financialYear)
    .eq('quarter', quarter)
    .eq('status', 'approved')
  if (billErr) throw new Error(`fbp: failed to load bills: ${billErr.message}`)

  const proofByKey = new Map<string, number>()
  for (const b of (bills ?? []) as any[]) {
    const key = `${b.employee_id}:${b.salary_component_id}`
    const amt = Number(b.approved_amount ?? b.amount ?? 0)
    proofByKey.set(key, (proofByKey.get(key) ?? 0) + amt)
  }

  // 4. Existing reconciliations (to preserve locked rows).
  const { data: existing } = await supabase
    .from('fbp_reconciliations')
    .select('employee_id, salary_component_id, status, paid_amount, proof_amount, exemption_limit, taxable_amount')
    .eq('tenant_id', tenantId)
    .eq('financial_year', financialYear)
    .eq('quarter', quarter)
  const existingByKey = new Map<string, any>(
    (existing ?? []).map((r: any) => [`${r.employee_id}:${r.salary_component_id}`, r]),
  )

  const rows: ReconciliationRow[] = []
  const toUpsert: any[] = []

  for (const emp of slipsByEmp.keys()) {
    const empSlips = slipsByEmp.get(emp)!
    for (const comp of comps as any[]) {
      const paid = sumComponentPaid(empSlips, comp.code)
      const proof = proofByKey.get(`${emp}:${comp.id}`) ?? 0
      // Skip employees who never received this component AND have no bills.
      if (paid === 0 && proof === 0) continue

      const key = `${emp}:${comp.id}`
      const prior = existingByKey.get(key)

      // Per-quarter exempt cap = annual limit ÷ 4.
      const quarterLimit = comp.exemption_limit_annual != null
        ? Number(comp.exemption_limit_annual) / 4
        : null

      if (prior?.status === 'locked') {
        // Never recompute a locked quarter — surface stored values.
        rows.push({
          employee_id: emp, salary_component_id: comp.id,
          component_code: comp.code, component_name: comp.name,
          financial_year: financialYear, quarter,
          paid_amount: Number(prior.paid_amount), proof_amount: Number(prior.proof_amount),
          exemption_limit: prior.exemption_limit != null ? Number(prior.exemption_limit) : null,
          taxable_amount: Number(prior.taxable_amount), status: 'locked',
        })
        continue
      }

      const calc = computeFbpTaxable({ paid, proof, exemptionLimit: quarterLimit })
      rows.push({
        employee_id: emp, salary_component_id: comp.id,
        component_code: comp.code, component_name: comp.name,
        financial_year: financialYear, quarter,
        paid_amount: calc.paid, proof_amount: calc.proof,
        exemption_limit: quarterLimit, taxable_amount: calc.taxable, status: 'pending',
      })
      toUpsert.push({
        tenant_id: tenantId, employee_id: emp, salary_component_id: comp.id,
        financial_year: financialYear, quarter,
        paid_amount: calc.paid, proof_amount: calc.proof,
        exemption_limit: quarterLimit, taxable_amount: calc.taxable, status: 'pending',
        updated_at: new Date().toISOString(),
      })
    }
  }

  if (toUpsert.length > 0) {
    const { error: upErr } = await supabase
      .from('fbp_reconciliations')
      .upsert(toUpsert, { onConflict: 'tenant_id,employee_id,salary_component_id,financial_year,quarter' })
    if (upErr) throw new Error(`fbp: failed to persist reconciliations: ${upErr.message}`)
  }

  return rows
}

/**
 * Sum of LOCKED reconciled taxable for an employee across a financial year —
 * the FBP add-back fed into TaxComputationInput.deductions.otherIncome.
 * Only locked rows count, so TDS reflects HR-confirmed figures only.
 */
export async function fetchFbpTaxableForEmployee(
  supabase: SupabaseClient,
  tenantId: string,
  employeeId: string,
  financialYear: string,
): Promise<number> {
  const { data, error } = await supabase
    .from('fbp_reconciliations')
    .select('taxable_amount')
    .eq('tenant_id', tenantId)
    .eq('employee_id', employeeId)
    .eq('financial_year', financialYear)
    .eq('status', 'locked')
  if (error) return 0
  const total = (data ?? []).reduce((s: number, r: any) => s + Number(r.taxable_amount ?? 0), 0)
  return Math.round(total * 100) / 100
}

/** Lock every reconciliation row for a tenant/FY/quarter (freezes for TDS). */
export async function lockQuarterReconciliation(
  supabase: SupabaseClient,
  tenantId: string,
  financialYear: string,
  quarter: number,
  userId: string,
): Promise<number> {
  const { data, error } = await supabase
    .from('fbp_reconciliations')
    .update({ status: 'locked', reconciled_by: userId, reconciled_at: new Date().toISOString(), updated_at: new Date().toISOString() })
    .eq('tenant_id', tenantId)
    .eq('financial_year', financialYear)
    .eq('quarter', quarter)
    .eq('status', 'pending')
    .select('id')
  if (error) throw new Error(`fbp: failed to lock quarter: ${error.message}`)
  return (data as any[])?.length ?? 0
}
