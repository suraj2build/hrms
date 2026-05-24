/**
 * tds-engine.ts — India TDS (Tax Deducted at Source) Computation Engine
 *
 * Pure-function library for annual income-tax and monthly TDS calculation.
 * Supports both old and new tax regimes (FY 2023-24+).
 *
 * Tax law basis:
 *  - Old regime: Finance Act slabs (up to FY 2022-23 structure)
 *  - New regime: Finance Act 2023-24 revised slabs (Section 115BAC)
 *  - Standard deduction: ₹50,000 (Finance Act 2023 — both regimes)
 *  - Section 87A rebate: new regime ≤7L → ₹25,000; old regime ≤5L → ₹12,500
 *  - Surcharge: 10% (>50L), 15% (>1Cr), 25% (>2Cr)  [simplified — excludes 37% removed in FY24]
 *  - Health & Education Cess: 4% on (tax + surcharge)
 *
 * Does NOT: handle AMT, salary arrears special treatment (89(1) relief),
 *           house property loss set-off, or business income.
 */

// ── Input / Config ────────────────────────────────────────────────────────────

export interface TDSConfig {
  /** Financial year string, e.g. '2024-25'. Controls regime defaults and rebate limits. */
  financialYear: string
}

export interface TDSInput {
  /** Gross annual salary BEFORE standard deduction (e.g. CTC or gross-in-hand × 12) */
  grossAnnualIncome: number

  /** Tax regime chosen by the employee */
  regime: 'old' | 'new'

  /**
   * Total approved deductions (Section 80C, 80D, HRA, etc.).
   * Only applied in the OLD regime; ignored automatically for new regime.
   */
  totalDeductions: number

  /**
   * TDS already deducted in earlier months of the same financial year.
   * Used to compute the per-month TDS for the remaining months.
   */
  alreadyDeducted: number

  /**
   * Remaining months in the financial year (including the current month).
   * Minimum: 1. Maximum: 12.
   */
  remainingMonths: number
}

// ── Result ────────────────────────────────────────────────────────────────────

export interface TDSResult {
  /** Tax regime used */
  regime: 'old' | 'new'

  /** Annual income before any deductions or standard deduction */
  grossAnnualIncome: number

  /** Standard deduction applied (₹50,000 from FY 2023-24 for both regimes) */
  standardDeduction: number

  /**
   * Section 80C/80D/HRA/etc. deductions applied.
   * Always 0 for new regime (deductions not allowed).
   */
  applicableDeductions: number

  /** Gross – standardDeduction – applicableDeductions */
  taxableIncome: number

  /** Tax on taxable income as per slab rates (before rebate) */
  taxBeforeRebate: number

  /** Section 87A rebate applied (cannot exceed taxBeforeRebate) */
  rebate87A: number

  /** Tax after 87A rebate */
  taxAfterRebate: number

  /** Surcharge (10% / 15% / 25%) applied on taxAfterRebate */
  surcharge: number

  /** Health & Education Cess: 4% on (taxAfterRebate + surcharge) */
  cess: number

  /** Final annual tax liability = taxAfterRebate + surcharge + cess */
  annualTaxLiability: number

  /** TDS already deducted this financial year */
  alreadyDeducted: number

  /** Remaining tax to be deducted = max(0, annualTaxLiability – alreadyDeducted) */
  remainingTax: number

  /** TDS per remaining month = remainingTax / remainingMonths (rounded to 2 decimals) */
  monthlyTDS: number

  /** Ordered computation steps for audit/explainability UI */
  traceSteps: Array<{ step: string; description: string; value: number }>
}

// ── Internal: Slab helpers ────────────────────────────────────────────────────

interface Slab {
  upTo: number   // income threshold (Infinity for the last slab)
  rate: number   // marginal rate (0–1)
  base: number   // cumulative tax on income up to the previous threshold
  floor: number  // bottom of this slab
}

/**
 * Old regime slabs (applicable to all FYs in the old regime):
 *   0  – 2,50,000 : 0%
 *   2,50,001 – 5,00,000 : 5%
 *   5,00,001 – 10,00,000 : 20%
 *   > 10,00,000 : 30%
 */
const OLD_REGIME_SLABS: Slab[] = [
  { floor: 0,        upTo: 250_000,   rate: 0.00, base: 0 },
  { floor: 250_000,  upTo: 500_000,   rate: 0.05, base: 0 },
  { floor: 500_000,  upTo: 1_000_000, rate: 0.20, base: 12_500 },
  { floor: 1_000_000, upTo: Infinity, rate: 0.30, base: 112_500 },
]

/**
 * New regime slabs (FY 2023-24 onwards — Finance Act 2023):
 *   0  – 3,00,000 : 0%
 *   3,00,001 – 6,00,000 : 5%
 *   6,00,001 – 9,00,000 : 10%
 *   9,00,001 – 12,00,000 : 15%
 *   12,00,001 – 15,00,000 : 20%
 *   > 15,00,000 : 30%
 */
const NEW_REGIME_SLABS: Slab[] = [
  { floor: 0,          upTo: 300_000,   rate: 0.00, base: 0 },
  { floor: 300_000,    upTo: 600_000,   rate: 0.05, base: 0 },
  { floor: 600_000,    upTo: 900_000,   rate: 0.10, base: 15_000 },
  { floor: 900_000,    upTo: 1_200_000, rate: 0.15, base: 45_000 },
  { floor: 1_200_000,  upTo: 1_500_000, rate: 0.20, base: 90_000 },
  { floor: 1_500_000,  upTo: Infinity,  rate: 0.30, base: 150_000 },
]

/** Apply slab structure to a taxable income figure */
function applySlabs(income: number, slabs: Slab[]): number {
  if (income <= 0) return 0
  for (const slab of [...slabs].reverse()) {
    if (income > slab.floor) {
      return slab.base + (income - slab.floor) * slab.rate
    }
  }
  return 0
}

// ── Internal: Surcharge ───────────────────────────────────────────────────────

/**
 * Surcharge on income-tax liability (based on total taxable income, not tax):
 *   > 50 L to ≤ 1 Cr : 10%
 *   > 1 Cr to ≤ 2 Cr : 15%
 *   > 2 Cr            : 25%
 *
 * Note: The 37% surcharge on >5Cr has been removed in the new regime from FY24.
 * We apply 25% as the cap for simplicity (safe for most payroll use cases).
 */
function computeSurcharge(taxableIncome: number, tax: number): number {
  if (taxableIncome > 20_000_000) return Math.round(tax * 0.25 * 100) / 100
  if (taxableIncome > 10_000_000) return Math.round(tax * 0.15 * 100) / 100
  if (taxableIncome > 5_000_000)  return Math.round(tax * 0.10 * 100) / 100
  return 0
}

// ── Internal: Standard deduction ─────────────────────────────────────────────

/**
 * Standard deduction from FY 2023-24: ₹50,000 for salaried individuals,
 * applicable in both old and new regimes (Section 16(ia) + 115BAC amendment).
 */
const STANDARD_DEDUCTION = 50_000

// ── Internal: 87A Rebate ─────────────────────────────────────────────────────

/**
 * Section 87A rebate limits:
 *  - New regime (FY24+): taxable income ≤ 7,00,000 → rebate up to ₹25,000
 *  - Old regime         : taxable income ≤ 5,00,000 → rebate up to ₹12,500
 */
function compute87ARebate(regime: 'old' | 'new', taxableIncome: number, taxBeforeRebate: number): number {
  if (regime === 'new') {
    if (taxableIncome <= 700_000) return Math.min(taxBeforeRebate, 25_000)
    return 0
  }
  // Old regime
  if (taxableIncome <= 500_000) return Math.min(taxBeforeRebate, 12_500)
  return 0
}

// ── Main export ───────────────────────────────────────────────────────────────

/**
 * computeTDS — India payroll TDS engine.
 *
 * @param input  Employee-specific income, deduction, and FY context
 * @param config Financial year config (controls slab selection)
 * @returns      Full TDS breakdown with traceSteps for explainability
 */
export function computeTDS(input: TDSInput, _config: TDSConfig): TDSResult {
  const {
    grossAnnualIncome,
    regime,
    totalDeductions,
    alreadyDeducted,
    remainingMonths,
  } = input

  const trace: Array<{ step: string; description: string; value: number }> = []

  // Step 1 — Gross annual income
  trace.push({
    step: '1. Gross Annual Income',
    description: 'Projected annual gross salary (before any deductions)',
    value: grossAnnualIncome,
  })

  // Step 2 — Standard deduction
  const standardDeduction = STANDARD_DEDUCTION
  trace.push({
    step: '2. Standard Deduction',
    description: 'Section 16(ia) standard deduction — applicable to both regimes from FY 2023-24',
    value: standardDeduction,
  })

  // Step 3 — Applicable deductions (old regime only)
  const applicableDeductions = regime === 'old' ? Math.max(0, totalDeductions) : 0
  trace.push({
    step: '3. Section 80C/D/HRA Deductions',
    description: regime === 'old'
      ? `Approved declarations (80C, 80D, HRA, etc.) — old regime`
      : 'Deductions not allowed under new regime (set to ₹0)',
    value: applicableDeductions,
  })

  // Step 4 — Taxable income
  const taxableIncome = Math.max(0, grossAnnualIncome - standardDeduction - applicableDeductions)
  trace.push({
    step: '4. Taxable Income',
    description: 'Gross − Standard Deduction − Applicable Deductions',
    value: taxableIncome,
  })

  // Step 5 — Tax per slab
  const slabs = regime === 'new' ? NEW_REGIME_SLABS : OLD_REGIME_SLABS
  const taxBeforeRebate = Math.round(applySlabs(taxableIncome, slabs) * 100) / 100
  trace.push({
    step: '5. Tax as per Slab Rates',
    description: regime === 'new'
      ? 'New regime slabs (FY 2023-24): 0%/5%/10%/15%/20%/30%'
      : 'Old regime slabs: 0%/5%/20%/30%',
    value: taxBeforeRebate,
  })

  // Step 6 — Section 87A rebate
  const rebate87A = compute87ARebate(regime, taxableIncome, taxBeforeRebate)
  trace.push({
    step: '6. Section 87A Rebate',
    description: regime === 'new'
      ? `New regime: taxable income ≤ ₹7L → rebate up to ₹25,000`
      : `Old regime: taxable income ≤ ₹5L → rebate up to ₹12,500`,
    value: rebate87A,
  })

  // Step 7 — Tax after rebate
  const taxAfterRebate = Math.max(0, taxBeforeRebate - rebate87A)
  trace.push({
    step: '7. Tax After 87A Rebate',
    description: 'Tax on slab − 87A rebate (cannot be negative)',
    value: taxAfterRebate,
  })

  // Step 8 — Surcharge
  const surcharge = computeSurcharge(taxableIncome, taxAfterRebate)
  trace.push({
    step: '8. Surcharge',
    description: 'Surcharge on tax: 10% (>50L), 15% (>1Cr), 25% (>2Cr)',
    value: surcharge,
  })

  // Step 9 — Health & Education Cess
  const cess = Math.round((taxAfterRebate + surcharge) * 0.04 * 100) / 100
  trace.push({
    step: '9. Health & Education Cess',
    description: '4% cess on (tax after rebate + surcharge)',
    value: cess,
  })

  // Step 10 — Annual tax liability
  const annualTaxLiability = Math.round((taxAfterRebate + surcharge + cess) * 100) / 100
  trace.push({
    step: '10. Annual Tax Liability',
    description: 'Tax after rebate + surcharge + cess',
    value: annualTaxLiability,
  })

  // Step 11 — Already deducted this FY
  trace.push({
    step: '11. TDS Already Deducted',
    description: 'Sum of TDS deducted in earlier months of this financial year',
    value: alreadyDeducted,
  })

  // Step 12 — Remaining tax
  const remainingTax = Math.max(0, annualTaxLiability - alreadyDeducted)
  trace.push({
    step: '12. Remaining Tax to Deduct',
    description: 'Annual liability − already deducted (≥ 0)',
    value: remainingTax,
  })

  // Step 13 — Monthly TDS
  const safeMonths = Math.max(1, remainingMonths)
  const monthlyTDS = Math.round((remainingTax / safeMonths) * 100) / 100
  trace.push({
    step: '13. Monthly TDS',
    description: `Remaining tax / ${safeMonths} remaining month(s) in FY`,
    value: monthlyTDS,
  })

  return {
    regime,
    grossAnnualIncome,
    standardDeduction,
    applicableDeductions,
    taxableIncome,
    taxBeforeRebate,
    rebate87A,
    taxAfterRebate,
    surcharge,
    cess,
    annualTaxLiability,
    alreadyDeducted,
    remainingTax,
    monthlyTDS,
    traceSteps: trace,
  }
}
