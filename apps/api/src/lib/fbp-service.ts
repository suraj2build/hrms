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
  computeFbpTaxable, cumulativeMonths, sumComponentPaid,
} from './fbp-reconciliation.js'
import { fetchAllRows } from './supabase-paginate.js'

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
 * Compute + persist the reconciliation cumulatively (YEAR-TO-DATE through the
 * given quarter) for every reimbursement component and every employee paid one.
 * Stored paid/proof/taxable are YTD figures; the exempt cap is the FULL annual
 * exemption limit applied against YTD bills. Rows already 'locked' are returned
 * as-is and never overwritten.
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

  // YTD: all months from the FY start through the end of this quarter.
  const months = cumulativeMonths(financialYear, quarter)

  // 2. Finalized payslips across the YTD window.
  // Builds YTD taxable/exempt amounts for every employee across up to 12
  // months — easily exceeds PostgREST's 1000-row cap for a large tenant.
  let slips: any[]
  try {
    slips = await fetchAllRows<any>((from, to) =>
      supabase
        .from('payroll_slips')
        .select('employee_id, component_breakdown, month')
        .eq('tenant_id', tenantId)
        .in('month', months)
        .eq('status', 'finalized')
        .range(from, to),
    )
  } catch (err: any) {
    throw new Error(`fbp: failed to load payslips: ${err.message}`)
  }

  // Group slips by employee.
  const slipsByEmp = new Map<string, Array<{ component_breakdown: any }>>()
  for (const s of (slips ?? []) as any[]) {
    const arr = slipsByEmp.get(s.employee_id) ?? []
    arr.push({ component_breakdown: s.component_breakdown })
    slipsByEmp.set(s.employee_id, arr)
  }

  // 3. Approved bills YTD (quarters 1..Q), summed per (employee, component).
  let bills: any[]
  try {
    bills = await fetchAllRows<any>((from, to) =>
      supabase
        .from('fbp_bill_submissions')
        .select('employee_id, salary_component_id, amount, approved_amount')
        .eq('tenant_id', tenantId)
        .eq('financial_year', financialYear)
        .lte('quarter', quarter)
        .eq('status', 'approved')
        .range(from, to),
    )
  } catch (err: any) {
    throw new Error(`fbp: failed to load bills: ${err.message}`)
  }

  const proofByKey = new Map<string, number>()
  for (const b of (bills ?? []) as any[]) {
    const key = `${b.employee_id}:${b.salary_component_id}`
    const amt = Number(b.approved_amount ?? b.amount ?? 0)
    proofByKey.set(key, (proofByKey.get(key) ?? 0) + amt)
  }

  // 4. Existing reconciliations (to preserve locked rows). Must be complete —
  // a truncated scan would miss some already-locked rows below, and this
  // function would silently recompute and overwrite them, contradicting the
  // "never overwritten" guarantee documented above.
  let existing: any[]
  try {
    existing = await fetchAllRows<any>((from, to) =>
      supabase
        .from('fbp_reconciliations')
        .select('employee_id, salary_component_id, status, paid_amount, proof_amount, exemption_limit, taxable_amount')
        .eq('tenant_id', tenantId)
        .eq('financial_year', financialYear)
        .eq('quarter', quarter)
        .range(from, to),
    )
  } catch (err: any) {
    throw new Error(`fbp: failed to load existing reconciliations: ${err.message}`)
  }
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

      // YTD exempt cap = the FULL annual exemption limit (applied against YTD bills).
      const quarterLimit = comp.exemption_limit_annual != null
        ? Number(comp.exemption_limit_annual)
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
 * FBP taxable add-back for an employee for the year, fed into TDS gross.
 *
 * Reconciliation is cumulative (YTD), so each component's taxable is taken from
 * its LATEST locked quarter (not summed across quarters — that would double
 * count). Summed across components. Only locked rows count.
 */
export async function fetchFbpTaxableForEmployee(
  supabase: SupabaseClient,
  tenantId: string,
  employeeId: string,
  financialYear: string,
): Promise<number> {
  const { data, error } = await supabase
    .from('fbp_reconciliations')
    .select('salary_component_id, quarter, taxable_amount')
    .eq('tenant_id', tenantId)
    .eq('employee_id', employeeId)
    .eq('financial_year', financialYear)
    .eq('status', 'locked')
  // Fails into TDS withholding computation (grossAnnualIncome += this value)
  // — silently returning 0 on a query error is indistinguishable from a
  // real "no locked FBP taxable" and under-withholds statutory TDS for an
  // employee who actually has locked unsubstantiated-FBP income.
  if (error) throw error

  // Per component, keep the highest locked quarter's (cumulative) taxable.
  const latestByComp = new Map<string, { quarter: number; taxable: number }>()
  for (const r of (data ?? []) as any[]) {
    const cur = latestByComp.get(r.salary_component_id)
    if (!cur || r.quarter > cur.quarter) {
      latestByComp.set(r.salary_component_id, { quarter: r.quarter, taxable: Number(r.taxable_amount ?? 0) })
    }
  }
  let total = 0
  for (const v of latestByComp.values()) total += v.taxable
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
