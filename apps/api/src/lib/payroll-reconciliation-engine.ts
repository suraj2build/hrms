// Pure computation — zero DB I/O.
// Accepts pre-fetched run row + payroll_slips data and returns a structured
// reconciliation report that cross-checks run-level totals against slip sums,
// verifies per-employee net-pay equations, and aggregates component breakdowns.

import { round2 } from './payroll-engine.js'

const TOLERANCE = 0.01  // ₹ — rounding tolerance for accumulated float arithmetic

export interface ComponentAggregate {
  code:           string
  name:           string
  component_type: string  // 'earning' | 'deduction' | 'employer_contribution' | etc.
  total_amount:   number
  employee_count: number
}

export interface EmployeeReconRow {
  employee_id:            string
  employee_code:          string
  gross_pay:              number
  total_deductions:       number
  net_pay:                number
  employer_contributions: number
  tds_deducted:           number
  expected_net:           number  // gross_pay - total_deductions
  variance:               number  // net_pay - expected_net
}

export interface ReconTotals {
  run_total_gross:       number   // from payroll_runs row (source of truth)
  run_total_deductions:  number
  run_total_net:         number
  slip_total_gross:      number   // summed from payroll_slips
  slip_total_deductions: number
  slip_total_net:        number
  slip_total_employer:   number   // total employer contributions (EPF + ESI + gratuity)
  slip_total_tds:        number
}

export interface PayrollReconciliationReport {
  run_id:       string
  month:        string
  tenant_id:    string
  generated_at: string

  employee_count:          number
  employees_with_variance: number

  totals: ReconTotals

  checks: {
    run_vs_slip_gross:      boolean  // run.total_gross ≈ Σ slips.gross_pay
    run_vs_slip_net:        boolean  // run.total_net ≈ Σ slips.net_pay
    run_vs_slip_deductions: boolean  // run.total_deductions ≈ Σ slips.total_deductions
    net_equation:           boolean  // slip_total_gross − slip_total_deductions ≈ slip_total_net
  }

  components:         ComponentAggregate[]  // sorted by total_amount desc
  employee_variances: EmployeeReconRow[]    // only employees where |variance| > TOLERANCE
  reconciled:         boolean
  issues:             string[]
}

export type SlipForRecon = {
  employee_id:            string
  employee_code:          string
  gross_pay:              number
  total_deductions:       number
  net_pay:                number
  employer_contributions: number
  tds_deducted:           number
  component_breakdown:    Array<{ code: string; name: string; component_type: string; monthly_amount: number }> | null
}

export type RunForRecon = {
  id:               string
  month:            string
  tenant_id:        string
  total_gross:      number | null
  total_deductions: number | null
  total_net:        number | null
}

export function buildPayrollReconciliationReport(
  run:   RunForRecon,
  slips: SlipForRecon[],
): PayrollReconciliationReport {
  let slipGross = 0, slipDeductions = 0, slipNet = 0, slipEmployer = 0, slipTds = 0
  const componentMap  = new Map<string, ComponentAggregate>()
  const empVariances: EmployeeReconRow[] = []

  for (const s of slips) {
    slipGross      += s.gross_pay
    slipDeductions += s.total_deductions
    slipNet        += s.net_pay
    slipEmployer   += s.employer_contributions
    slipTds        += s.tds_deducted

    // Per-employee net-pay equation: net = gross − deductions
    const expectedNet = round2(s.gross_pay - s.total_deductions)
    const variance    = round2(s.net_pay - expectedNet)
    if (Math.abs(variance) > TOLERANCE) {
      empVariances.push({
        employee_id:            s.employee_id,
        employee_code:          s.employee_code,
        gross_pay:              s.gross_pay,
        total_deductions:       s.total_deductions,
        net_pay:                s.net_pay,
        employer_contributions: s.employer_contributions,
        tds_deducted:           s.tds_deducted,
        expected_net:           expectedNet,
        variance,
      })
    }

    // Aggregate component breakdown
    for (const comp of (s.component_breakdown ?? [])) {
      if (!componentMap.has(comp.code)) {
        componentMap.set(comp.code, {
          code:           comp.code,
          name:           comp.name,
          component_type: comp.component_type,
          total_amount:   0,
          employee_count: 0,
        })
      }
      const agg = componentMap.get(comp.code)!
      agg.total_amount   = round2(agg.total_amount + comp.monthly_amount)
      agg.employee_count += 1
    }
  }

  slipGross      = round2(slipGross)
  slipDeductions = round2(slipDeductions)
  slipNet        = round2(slipNet)
  slipEmployer   = round2(slipEmployer)
  slipTds        = round2(slipTds)

  const rg = run.total_gross      ?? 0
  const rd = run.total_deductions ?? 0
  const rn = run.total_net        ?? 0

  const checks = {
    run_vs_slip_gross:      Math.abs(rg - slipGross)                              <= TOLERANCE,
    run_vs_slip_net:        Math.abs(rn - slipNet)                                <= TOLERANCE,
    run_vs_slip_deductions: Math.abs(rd - slipDeductions)                         <= TOLERANCE,
    net_equation:           Math.abs(round2(slipGross - slipDeductions) - slipNet)    <= TOLERANCE,
  }

  const issues: string[] = []
  if (!checks.run_vs_slip_gross)
    issues.push(`Run total_gross ₹${rg} ≠ slip sum ₹${slipGross} (Δ ₹${round2(Math.abs(rg - slipGross))})`)
  if (!checks.run_vs_slip_net)
    issues.push(`Run total_net ₹${rn} ≠ slip sum ₹${slipNet} (Δ ₹${round2(Math.abs(rn - slipNet))})`)
  if (!checks.run_vs_slip_deductions)
    issues.push(`Run total_deductions ₹${rd} ≠ slip sum ₹${slipDeductions} (Δ ₹${round2(Math.abs(rd - slipDeductions))})`)
  if (!checks.net_equation)
    issues.push(`Net pay equation fails: gross ₹${slipGross} − deductions ₹${slipDeductions} = ₹${round2(slipGross - slipDeductions)}, not ₹${slipNet}`)
  if (empVariances.length > 0)
    issues.push(`${empVariances.length} employee(s) have net pay arithmetic imbalance`)

  return {
    run_id:       run.id,
    month:        run.month,
    tenant_id:    run.tenant_id,
    generated_at: new Date().toISOString(),

    employee_count:          slips.length,
    employees_with_variance: empVariances.length,

    totals: {
      run_total_gross:       rg,
      run_total_deductions:  rd,
      run_total_net:         rn,
      slip_total_gross:      slipGross,
      slip_total_deductions: slipDeductions,
      slip_total_net:        slipNet,
      slip_total_employer:   slipEmployer,
      slip_total_tds:        slipTds,
    },

    checks,
    components:         Array.from(componentMap.values()).sort((a, b) => b.total_amount - a.total_amount),
    employee_variances: empVariances,
    reconciled:         issues.length === 0,
    issues,
  }
}
