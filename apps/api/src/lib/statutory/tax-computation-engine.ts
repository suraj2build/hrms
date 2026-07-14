/**
 * tax-computation-engine.ts — Extended India Income Tax Computation Engine
 *
 * Extends the base tds-engine with:
 *  - DB-driven slab loading from `it_tax_slabs` + `it_standard_config`
 *  - Rich section-level deduction breakdown (80C, 80D, HRA, Sec 24b, etc.)
 *  - Full IT Statement output with monthly TDS spread
 *  - Both-regime comparison baked in — always returns oldRegimeTax + newRegimeTax
 *  - Trace steps for every computation stage (explainability / audit UI)
 *
 * Tax law basis: Finance Act 2023-24 (new regime revised slabs, Sec 87A ₹25k rebate).
 * Does NOT handle: AMT, Sec 89(1) arrears relief, business income, LTCG/STCG.
 */

// ── Month constants ────────────────────────────────────────────────────────────
const MONTH_NAMES = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']
const FY_MONTH_ORDER = [4,5,6,7,8,9,10,11,12,1,2,3]  // Apr → Mar

// ── Interfaces ────────────────────────────────────────────────────────────────

export interface TaxComputationInput {
  grossAnnualIncome: number
  regime: 'old' | 'new'
  financialYear: string
  deductions: {
    section80C: number            // capped at 150,000
    section80CCD1B: number        // NPS additional, capped at 50,000
    section80D: number            // health insurance premium
    section80E: number            // education loan interest (no cap)
    section80G: number            // donations
    section80TTA: number          // savings interest, capped 10,000
    hraExemption: number          // computed or declared
    homeLoanInterest: number      // Sec 24(b), capped 200,000 self-occ
    otherDeductions: number       // 80DD, 80DDB, 80U, etc.
    professionalTax: number       // Sec 16(iii)
    previousEmployerTDS: number   // TDS credit from Form 12B
    tdsOthers: number             // TDS on bank interest / 26AS
    otherIncome: number           // add-back (rent, interest income)
    previousEmployerSalary: number // add-back gross to total
  }
  alreadyDeducted: number
  remainingMonths: number
}

export interface TaxComputationResult {
  regime: 'old' | 'new'
  financialYear: string
  // ── Income ──────────────────────────────────────────────────────────────────
  grossSalaryIncome: number
  previousEmployerSalary: number
  otherIncome: number
  totalGrossIncome: number
  // ── Pre-Chapter VI-A deductions ─────────────────────────────────────────────
  standardDeduction: number
  professionalTax: number
  homeLoanInterest: number
  grossTotalIncome: number
  // ── Chapter VI-A ────────────────────────────────────────────────────────────
  deduction80C: number
  deduction80CCD1B: number
  deduction80D: number
  deduction80E: number
  deduction80G: number
  deduction80TTA: number
  hraExemption: number
  totalChapterVIADeductions: number
  // ── Tax computation ─────────────────────────────────────────────────────────
  taxableIncome: number
  taxOnIncome: number
  rebate87A: number
  taxAfterRebate: number
  surcharge: number
  cess: number
  annualTaxLiability: number
  // ── TDS recovery ────────────────────────────────────────────────────────────
  previousEmployerTDS: number
  tdsCredits: number
  netTaxPayable: number
  alreadyDeducted: number
  remainingTax: number
  monthlyTDS: number
  // ── Monthly spread ──────────────────────────────────────────────────────────
  monthlyBreakdown: Array<{
    month: string
    monthNum: number
    tdsThisMonth: number
  }>
  // ── Trace ───────────────────────────────────────────────────────────────────
  traceSteps: Array<{ step: string; description: string; value: number }>
  // ── Regime comparison ───────────────────────────────────────────────────────
  oldRegimeTax?: number
  newRegimeTax?: number
  recommendedRegime?: 'old' | 'new'
  taxSavingWithOptimal?: number
}

// ── Internal slab shape ───────────────────────────────────────────────────────

interface Slab {
  floor: number
  upTo: number
  rate: number
  base: number
}

// ── Pre-fetch cache types (exported for callers doing batch pre-fetch) ─────────

export interface TaxTableCache {
  slabsOld:  Slab[]
  slabsNew:  Slab[]
  stdCfgOld: ItStandardConfig
  stdCfgNew: ItStandardConfig
}

// ── Hardcoded fallback slabs ──────────────────────────────────────────────────

const FALLBACK_OLD_SLABS: Slab[] = [
  { floor: 0,          upTo: 250_000,   rate: 0.00, base: 0 },
  { floor: 250_000,    upTo: 500_000,   rate: 0.05, base: 0 },
  { floor: 500_000,    upTo: 1_000_000, rate: 0.20, base: 12_500 },
  { floor: 1_000_000,  upTo: Infinity,  rate: 0.30, base: 112_500 },
]

const FALLBACK_NEW_SLABS: Slab[] = [
  { floor: 0,          upTo: 300_000,   rate: 0.00, base: 0 },
  { floor: 300_000,    upTo: 600_000,   rate: 0.05, base: 0 },
  { floor: 600_000,    upTo: 900_000,   rate: 0.10, base: 15_000 },
  { floor: 900_000,    upTo: 1_200_000, rate: 0.15, base: 45_000 },
  { floor: 1_200_000,  upTo: 1_500_000, rate: 0.20, base: 90_000 },
  { floor: 1_500_000,  upTo: Infinity,  rate: 0.30, base: 150_000 },
]

// ── Deduction caps ────────────────────────────────────────────────────────────

const CAP_80C       = 150_000
const CAP_80CCD1B   = 50_000
const CAP_80TTA     = 10_000
const CAP_HOME_LOAN = 200_000  // Sec 24(b) self-occupied

// ── Pure math helpers ─────────────────────────────────────────────────────────

function applySlabs(income: number, slabs: Slab[]): number {
  if (income <= 0) return 0
  for (const slab of [...slabs].reverse()) {
    if (income > slab.floor) {
      return slab.base + (income - slab.floor) * slab.rate
    }
  }
  return 0
}

function computeSurcharge(taxableIncome: number, tax: number): number {
  if (taxableIncome > 20_000_000) return Math.round(tax * 0.25 * 100) / 100
  if (taxableIncome > 10_000_000) return Math.round(tax * 0.15 * 100) / 100
  if (taxableIncome > 5_000_000)  return Math.round(tax * 0.10 * 100) / 100
  return 0
}

function compute87ARebate(
  regime: 'old' | 'new',
  taxableIncome: number,
  taxBeforeRebate: number,
  rebateLimit: number,
  rebateAmount: number,
): number {
  if (regime === 'new') {
    // Use DB config if available; otherwise default 7L / 25k
    const limit  = rebateLimit  || 700_000
    const amount = rebateAmount || 25_000
    return taxableIncome <= limit ? Math.min(taxBeforeRebate, amount) : 0
  }
  // Old regime: 5L / 12.5k
  const limit  = rebateLimit  || 500_000
  const amount = rebateAmount || 12_500
  return taxableIncome <= limit ? Math.min(taxBeforeRebate, amount) : 0
}

// ── DB config interface ───────────────────────────────────────────────────────

export interface ItStandardConfig {
  standard_deduction: number
  rebate_87a_limit: number
  rebate_87a_amount: number
  cess_rate: number
}

// ── DB slab loader ────────────────────────────────────────────────────────────

async function loadSlabs(
  supabase: any,
  financialYear: string,
  regime: 'old' | 'new',
): Promise<Slab[]> {
  const { data, error } = await supabase
    .from('it_tax_slabs')
    .select('income_from, income_to, tax_rate, base_tax, slab_order')
    .eq('financial_year', financialYear)
    .eq('regime', regime)
    .order('slab_order', { ascending: true })

  if (error || !data || (data as any[]).length === 0) {
    return regime === 'new' ? FALLBACK_NEW_SLABS : FALLBACK_OLD_SLABS
  }

  return (data as any[]).map((row: any, idx: number, arr: any[]) => ({
    floor: Number(row.income_from),
    upTo:  row.income_to === null ? Infinity : Number(row.income_to),
    rate:  Number(row.tax_rate),
    base:  Number(row.base_tax ?? 0),
  }))
}

async function loadStdConfig(
  supabase: any,
  financialYear: string,
  regime: 'old' | 'new',
): Promise<ItStandardConfig> {
  const { data, error } = await supabase
    .from('it_standard_config')
    .select('standard_deduction, rebate_87a_limit, rebate_87a_amount, cess_rate')
    .eq('financial_year', financialYear)
    .eq('regime', regime)
    .maybeSingle()

  if (error || !data) {
    return {
      standard_deduction: 75_000,   // Finance Act 2024-25 enhanced std deduction
      rebate_87a_limit:   regime === 'new' ? 700_000 : 500_000,
      rebate_87a_amount:  regime === 'new' ? 25_000  : 12_500,
      cess_rate:          0.04,
    }
  }
  return data as ItStandardConfig
}

/** Pre-fetch all tax table rows for a financial year in a single round-trip.
 *  Pass the result to computeTaxWithDB to skip per-employee DB calls. */
export async function fetchTaxTableCache(
  supabase: any,
  financialYear: string,
): Promise<TaxTableCache> {
  const [slabsOld, slabsNew, stdCfgOld, stdCfgNew] = await Promise.all([
    loadSlabs(supabase, financialYear, 'old'),
    loadSlabs(supabase, financialYear, 'new'),
    loadStdConfig(supabase, financialYear, 'old'),
    loadStdConfig(supabase, financialYear, 'new'),
  ])
  return { slabsOld, slabsNew, stdCfgOld, stdCfgNew }
}

// ── Core single-regime computation ───────────────────────────────────────────

interface RegimeResult {
  standardDeduction: number
  professionalTax: number
  homeLoanInterest: number
  grossTotalIncome: number
  deduction80C: number
  deduction80CCD1B: number
  deduction80D: number
  deduction80E: number
  deduction80G: number
  deduction80TTA: number
  hraExemption: number
  totalChapterVIADeductions: number
  taxableIncome: number
  taxOnIncome: number
  rebate87A: number
  taxAfterRebate: number
  surcharge: number
  cess: number
  annualTaxLiability: number
  netTaxPayable: number
  remainingTax: number
  monthlyTDS: number
  traceSteps: Array<{ step: string; description: string; value: number }>
}

async function computeSingleRegime(
  supabase: any,
  input: TaxComputationInput,
  regime: 'old' | 'new',
  cache?: TaxTableCache,
): Promise<RegimeResult> {
  const { financialYear, deductions, alreadyDeducted, remainingMonths } = input
  const trace: Array<{ step: string; description: string; value: number }> = []

  // Load DB config — use pre-fetched cache when available to avoid per-employee queries
  const slabs  = cache ? (regime === 'old' ? cache.slabsOld  : cache.slabsNew)  : await loadSlabs(supabase, financialYear, regime)
  const stdCfg = cache ? (regime === 'old' ? cache.stdCfgOld : cache.stdCfgNew) : await loadStdConfig(supabase, financialYear, regime)

  const stepNum = (() => { let n = 1; return () => n++ })()

  // ── Step 1: Gross salary from this employer ──────────────────────────────────
  const grossSalary = input.grossAnnualIncome
  trace.push({ step: `${stepNum()}. Gross Salary (This Employer)`, description: 'Annual CTC / projected gross for FY', value: grossSalary })

  // ── Step 2: Previous employer salary ────────────────────────────────────────
  const prevSalary = Math.max(0, deductions.previousEmployerSalary ?? 0)
  trace.push({ step: `${stepNum()}. Previous Employer Salary`, description: 'Gross salary received from previous employer(s) this FY', value: prevSalary })

  // ── Step 3: Other income ────────────────────────────────────────────────────
  const otherIncome = Math.max(0, deductions.otherIncome ?? 0)
  trace.push({ step: `${stepNum()}. Other Income`, description: 'Rental income, interest, etc.', value: otherIncome })

  // ── Step 4: Total gross income ──────────────────────────────────────────────
  const totalGross = grossSalary + prevSalary + otherIncome
  trace.push({ step: `${stepNum()}. Total Gross Income`, description: 'Sum of all income sources', value: totalGross })

  // ── Step 5: Standard deduction (Sec 16(ia)) ─────────────────────────────────
  const stdDed = stdCfg.standard_deduction
  trace.push({ step: `${stepNum()}. Standard Deduction [Sec 16(ia)]`, description: `₹${stdDed.toLocaleString('en-IN')} — applicable to both regimes`, value: stdDed })

  // ── Step 6: Professional tax (Sec 16(iii)) ──────────────────────────────────
  const profTax = Math.max(0, deductions.professionalTax ?? 0)
  trace.push({ step: `${stepNum()}. Professional Tax [Sec 16(iii)]`, description: 'PT deducted from salary', value: profTax })

  // ── Step 7: Home loan interest (Sec 24(b)) — old regime only ────────────────
  const homeLoan = regime === 'old' ? Math.min(Math.max(0, deductions.homeLoanInterest ?? 0), CAP_HOME_LOAN) : 0
  trace.push({ step: `${stepNum()}. Home Loan Interest [Sec 24(b)]`, description: regime === 'old' ? `Capped at ₹2,00,000 for self-occupied` : 'Not applicable under new regime', value: homeLoan })

  // ── Step 8: Gross Total Income ───────────────────────────────────────────────
  const gti = Math.max(0, totalGross - stdDed - profTax - homeLoan)
  trace.push({ step: `${stepNum()}. Gross Total Income`, description: 'Total Income − Sec 16 deductions − Sec 24(b)', value: gti })

  // ── Chapter VI-A deductions (old regime only) ────────────────────────────────
  let ded80C = 0, ded80CCD1B = 0, ded80D = 0, ded80E = 0, ded80G = 0, ded80TTA = 0, dedHRA = 0
  let totalVIA = 0

  if (regime === 'old') {
    ded80C     = Math.min(Math.max(0, deductions.section80C      ?? 0), CAP_80C)
    ded80CCD1B = Math.min(Math.max(0, deductions.section80CCD1B  ?? 0), CAP_80CCD1B)
    ded80D     = Math.max(0, deductions.section80D      ?? 0)
    ded80E     = Math.max(0, deductions.section80E      ?? 0)
    ded80G     = Math.max(0, deductions.section80G      ?? 0)
    ded80TTA   = Math.min(Math.max(0, deductions.section80TTA    ?? 0), CAP_80TTA)
    dedHRA     = Math.max(0, deductions.hraExemption    ?? 0)
    totalVIA   = ded80C + ded80CCD1B + ded80D + ded80E + ded80G + ded80TTA + dedHRA
      + Math.max(0, deductions.otherDeductions ?? 0)

    trace.push({ step: `${stepNum()}. 80C Deductions`,          description: `PPF, LIC, ELSS, PF, etc. — capped ₹1,50,000`,          value: ded80C })
    trace.push({ step: `${stepNum()}. 80CCD(1B) NPS`,           description: 'Additional NPS contribution — capped ₹50,000',          value: ded80CCD1B })
    trace.push({ step: `${stepNum()}. 80D Health Insurance`,    description: 'Medical premium for self + parents',                     value: ded80D })
    trace.push({ step: `${stepNum()}. 80E Education Loan`,      description: 'Interest on education loan (no cap)',                    value: ded80E })
    trace.push({ step: `${stepNum()}. 80G Donations`,           description: 'Approved charitable donations',                         value: ded80G })
    trace.push({ step: `${stepNum()}. 80TTA Savings Interest`,  description: 'Savings bank interest — capped ₹10,000',                value: ded80TTA })
    trace.push({ step: `${stepNum()}. HRA Exemption`,           description: 'Least of: actual HRA / 40-50% basic / excess rent paid', value: dedHRA })
    trace.push({ step: `${stepNum()}. Total Chapter VI-A`,      description: 'All Sec 80 deductions combined',                        value: totalVIA })
  } else {
    trace.push({ step: `${stepNum()}. Chapter VI-A Deductions`, description: 'Not available under new regime (all set to ₹0)', value: 0 })
  }

  // ── Taxable income ───────────────────────────────────────────────────────────
  const taxableIncome = Math.max(0, gti - totalVIA)
  trace.push({ step: `${stepNum()}. Taxable Income`, description: 'GTI − Total Chapter VI-A deductions', value: taxableIncome })

  // ── Tax on slab ──────────────────────────────────────────────────────────────
  const taxOnSlab = Math.round(applySlabs(taxableIncome, slabs) * 100) / 100
  const slabDesc  = regime === 'new'
    ? 'New regime: 0%/5%/10%/15%/20%/30%'
    : 'Old regime: 0%/5%/20%/30%'
  trace.push({ step: `${stepNum()}. Tax as per Slab Rates`, description: slabDesc, value: taxOnSlab })

  // ── Section 87A rebate ───────────────────────────────────────────────────────
  const rebate = compute87ARebate(regime, taxableIncome, taxOnSlab, stdCfg.rebate_87a_limit, stdCfg.rebate_87a_amount)
  trace.push({ step: `${stepNum()}. Section 87A Rebate`, description: `${regime === 'new' ? `New regime ≤₹7L → ₹25,000` : `Old regime ≤₹5L → ₹12,500`}`, value: rebate })

  // ── Tax after rebate ─────────────────────────────────────────────────────────
  const taxAfterRebate = Math.max(0, taxOnSlab - rebate)
  trace.push({ step: `${stepNum()}. Tax After 87A Rebate`, description: 'Slab tax − rebate (cannot be negative)', value: taxAfterRebate })

  // ── Surcharge ────────────────────────────────────────────────────────────────
  const surcharge = computeSurcharge(taxableIncome, taxAfterRebate)
  trace.push({ step: `${stepNum()}. Surcharge`, description: '10% (>50L) / 15% (>1Cr) / 25% (>2Cr)', value: surcharge })

  // ── Cess ─────────────────────────────────────────────────────────────────────
  const cessRate = stdCfg.cess_rate ?? 0.04
  const cess = Math.round((taxAfterRebate + surcharge) * cessRate * 100) / 100
  trace.push({ step: `${stepNum()}. Health & Education Cess`, description: `${(cessRate * 100).toFixed(0)}% on (tax + surcharge)`, value: cess })

  // ── Annual tax liability ──────────────────────────────────────────────────────
  const annualTax = Math.round((taxAfterRebate + surcharge + cess) * 100) / 100
  trace.push({ step: `${stepNum()}. Annual Tax Liability`, description: 'Tax after rebate + surcharge + cess', value: annualTax })

  // ── TDS credits ──────────────────────────────────────────────────────────────
  const prevEmpTds = Math.max(0, deductions.previousEmployerTDS ?? 0)
  const tdsOthers  = Math.max(0, deductions.tdsOthers ?? 0)
  const totalCredits = prevEmpTds + tdsOthers
  trace.push({ step: `${stepNum()}. Previous Employer TDS`, description: 'TDS deducted by previous employer (Form 12B)', value: prevEmpTds })
  trace.push({ step: `${stepNum()}. TDS from Others (26AS)`, description: 'TDS on bank interest / rent / other sources', value: tdsOthers })

  // ── Net tax payable ───────────────────────────────────────────────────────────
  const netTaxPayable = Math.max(0, annualTax - totalCredits)
  trace.push({ step: `${stepNum()}. Net Tax Payable`, description: 'Annual liability − all TDS credits', value: netTaxPayable })

  // ── Already deducted this FY ─────────────────────────────────────────────────
  trace.push({ step: `${stepNum()}. TDS Already Deducted`, description: 'Employer TDS paid in earlier months of this FY', value: alreadyDeducted })

  // ── Remaining tax ─────────────────────────────────────────────────────────────
  const remainingTax = Math.max(0, netTaxPayable - alreadyDeducted)
  trace.push({ step: `${stepNum()}. Remaining Tax to Deduct`, description: 'Net payable − already deducted (≥ 0)', value: remainingTax })

  // ── Monthly TDS ───────────────────────────────────────────────────────────────
  const safeMonths = Math.max(1, remainingMonths)
  const monthlyTDS = Math.round((remainingTax / safeMonths) * 100) / 100
  trace.push({ step: `${stepNum()}. Monthly TDS`, description: `Remaining / ${safeMonths} month(s) remaining in FY`, value: monthlyTDS })

  return {
    standardDeduction:         stdDed,
    professionalTax:           profTax,
    homeLoanInterest:          homeLoan,
    grossTotalIncome:          gti,
    deduction80C:              ded80C,
    deduction80CCD1B:          ded80CCD1B,
    deduction80D:              ded80D,
    deduction80E:              ded80E,
    deduction80G:              ded80G,
    deduction80TTA:            ded80TTA,
    hraExemption:              dedHRA,
    totalChapterVIADeductions: totalVIA,
    taxableIncome,
    taxOnIncome:               taxOnSlab,
    rebate87A:                 rebate,
    taxAfterRebate,
    surcharge,
    cess,
    annualTaxLiability:        annualTax,
    netTaxPayable,
    remainingTax,
    monthlyTDS,
    traceSteps:                trace,
  }
}

// ── Monthly breakdown generator ───────────────────────────────────────────────

function buildMonthlyBreakdown(
  financialYear: string,
  remainingMonths: number,
  monthlyTDS: number,
): Array<{ month: string; monthNum: number; tdsThisMonth: number }> {
  const fyStart = parseInt(financialYear.split('-')[0], 10)
  const now = new Date()
  const currentMonthStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`

  return FY_MONTH_ORDER.map((monthNum) => {
    const year = monthNum >= 4 ? fyStart : fyStart + 1
    const monthStr = `${year}-${String(monthNum).padStart(2, '0')}`
    const isFuture = monthStr >= currentMonthStr
    return {
      month:        MONTH_NAMES[monthNum - 1],
      monthNum,
      tdsThisMonth: isFuture ? monthlyTDS : 0,
    }
  })
}

// ── Main export ───────────────────────────────────────────────────────────────

export async function computeTaxWithDB(
  supabase: any,
  input: TaxComputationInput,
  cache?: TaxTableCache,
): Promise<TaxComputationResult> {
  const { regime, financialYear, deductions } = input

  // Always compute both regimes for comparison
  const [chosenResult, otherResult] = await Promise.all([
    computeSingleRegime(supabase, input, regime, cache),
    computeSingleRegime(supabase, { ...input, regime: regime === 'new' ? 'old' : 'new' }, regime === 'new' ? 'old' : 'new', cache),
  ])

  const oldRegimeTax = regime === 'old' ? chosenResult.annualTaxLiability : otherResult.annualTaxLiability
  const newRegimeTax = regime === 'new' ? chosenResult.annualTaxLiability : otherResult.annualTaxLiability
  const recommendedRegime: 'old' | 'new' = oldRegimeTax <= newRegimeTax ? 'old' : 'new'
  const taxSavingWithOptimal = Math.abs(oldRegimeTax - newRegimeTax)

  const monthlyBreakdown = buildMonthlyBreakdown(financialYear, input.remainingMonths, chosenResult.monthlyTDS)

  const grossSalary       = input.grossAnnualIncome
  const prevSalary        = Math.max(0, deductions.previousEmployerSalary ?? 0)
  const otherInc          = Math.max(0, deductions.otherIncome ?? 0)
  const totalGrossIncome  = grossSalary + prevSalary + otherInc

  return {
    regime,
    financialYear,
    // Income
    grossSalaryIncome:         grossSalary,
    previousEmployerSalary:    prevSalary,
    otherIncome:               otherInc,
    totalGrossIncome,
    // Pre VI-A
    standardDeduction:         chosenResult.standardDeduction,
    professionalTax:           chosenResult.professionalTax,
    homeLoanInterest:          chosenResult.homeLoanInterest,
    grossTotalIncome:          chosenResult.grossTotalIncome,
    // Chapter VI-A
    deduction80C:              chosenResult.deduction80C,
    deduction80CCD1B:          chosenResult.deduction80CCD1B,
    deduction80D:              chosenResult.deduction80D,
    deduction80E:              chosenResult.deduction80E,
    deduction80G:              chosenResult.deduction80G,
    deduction80TTA:            chosenResult.deduction80TTA,
    hraExemption:              chosenResult.hraExemption,
    totalChapterVIADeductions: chosenResult.totalChapterVIADeductions,
    // Tax
    taxableIncome:             chosenResult.taxableIncome,
    taxOnIncome:               chosenResult.taxOnIncome,
    rebate87A:                 chosenResult.rebate87A,
    taxAfterRebate:            chosenResult.taxAfterRebate,
    surcharge:                 chosenResult.surcharge,
    cess:                      chosenResult.cess,
    annualTaxLiability:        chosenResult.annualTaxLiability,
    // TDS recovery
    previousEmployerTDS:       Math.max(0, deductions.previousEmployerTDS ?? 0),
    tdsCredits:                Math.max(0, deductions.tdsOthers ?? 0),
    netTaxPayable:             chosenResult.netTaxPayable,
    alreadyDeducted:           input.alreadyDeducted,
    remainingTax:              chosenResult.remainingTax,
    monthlyTDS:                chosenResult.monthlyTDS,
    // Monthly
    monthlyBreakdown,
    // Trace
    traceSteps:                chosenResult.traceSteps,
    // Comparison
    oldRegimeTax,
    newRegimeTax,
    recommendedRegime,
    taxSavingWithOptimal,
  }
}
