/**
 * fbp-reconciliation.ts
 *
 * Pure helpers for Flexible Benefit Plan (FBP) quarterly reconciliation.
 *
 * An FBP allowance is paid monthly in salary, then each quarter reconciled
 * against the bills the employee submitted. The bill-backed amount (up to an
 * optional annual exemption limit) is tax-exempt; the rest is taxable and is
 * added to taxable income for TDS.
 *
 * No I/O — the route/service layer fetches paid + proof amounts and calls these.
 */

export interface FbpTaxableInput {
  /** Amount actually paid via payroll for this component in the period */
  paid:   number
  /** Approved bills (proof) the employee submitted for the period */
  proof:  number
  /** Optional annual exemption cap on the exempt portion; null = no cap */
  exemptionLimit?: number | null
}

export interface FbpTaxableResult {
  paid:    number
  proof:   number
  /** Exempt (substantiated) amount = min(proof, paid, limit) */
  exempt:  number
  /** Taxable (unsubstantiated) amount = paid − exempt */
  taxable: number
}

function r2(n: number): number {
  return Math.round(n * 100) / 100
}

/**
 * Compute the taxable (unsubstantiated) portion of an FBP allowance.
 *
 *   exempt  = min(proof, paid, exemptionLimit ?? ∞)   // can't exempt more than paid or more than the cap
 *   taxable = max(0, paid − exempt)
 */
export function computeFbpTaxable(input: FbpTaxableInput): FbpTaxableResult {
  const paid  = Math.max(0, input.paid)
  const proof = Math.max(0, input.proof)
  const cap   = input.exemptionLimit == null ? Infinity : Math.max(0, input.exemptionLimit)

  const exempt  = r2(Math.min(proof, paid, cap))
  const taxable = r2(Math.max(0, paid - exempt))
  return { paid: r2(paid), proof: r2(proof), exempt, taxable }
}

// ── Indian financial-year quarters ─────────────────────────────────────────────
// FY string format '2026-27'. Q1 = Apr–Jun, Q2 = Jul–Sep, Q3 = Oct–Dec, Q4 = Jan–Mar.

/** Parse the starting calendar year from an FY string like '2026-27' → 2026. */
export function fyStartYear(financialYear: string): number {
  const start = Number(financialYear.split('-')[0])
  if (!Number.isFinite(start)) throw new Error(`Invalid financial year: ${financialYear}`)
  return start
}

/**
 * Return the three 'YYYY-MM' payroll months for an FY quarter.
 *   ('2026-27', 1) → ['2026-04','2026-05','2026-06']
 *   ('2026-27', 4) → ['2027-01','2027-02','2027-03']
 */
export function quarterMonths(financialYear: string, quarter: number): string[] {
  if (quarter < 1 || quarter > 4) throw new Error(`Invalid quarter: ${quarter}`)
  const start = fyStartYear(financialYear)
  // Q1 starts at calendar month 4 (Apr).
  const firstMonthIdx = 4 + (quarter - 1) * 3  // 4,7,10,13
  return [0, 1, 2].map(off => {
    const m = firstMonthIdx + off            // 4..15
    const year  = start + Math.floor((m - 1) / 12)
    const month = ((m - 1) % 12) + 1
    return `${year}-${String(month).padStart(2, '0')}`
  })
}

/**
 * All 'YYYY-MM' months from the start of the FY through the END of `quarter`
 * (cumulative / year-to-date). ('2026-27', 2) → Apr..Sep (6 months).
 */
export function cumulativeMonths(financialYear: string, quarter: number): string[] {
  const out: string[] = []
  for (let q = 1; q <= quarter; q++) out.push(...quarterMonths(financialYear, q))
  return out
}

/** Which FY quarter (1-4) a 'YYYY-MM' month belongs to. */
export function monthToQuarter(month: string): number {
  const m = Number(month.split('-')[1])
  // Apr(4)→Q1 … Mar(3)→Q4
  if (m >= 4 && m <= 6)  return 1
  if (m >= 7 && m <= 9)  return 2
  if (m >= 10 && m <= 12) return 3
  return 4 // Jan-Mar
}

// ── Payslip aggregation ─────────────────────────────────────────────────────────

interface SlipLike {
  component_breakdown?: Array<{ code?: string; monthly_amount?: number }> | null
}

/**
 * Sum a component's paid amount (by code, case-insensitive) across a set of
 * payroll slips — used to total what was actually paid for an FBP component in
 * a quarter.
 */
export function sumComponentPaid(slips: SlipLike[], code: string): number {
  const target = code.toUpperCase()
  let total = 0
  for (const slip of slips) {
    for (const c of slip.component_breakdown ?? []) {
      if ((c.code ?? '').toUpperCase() === target) total += Number(c.monthly_amount ?? 0)
    }
  }
  return r2(total)
}
