/**
 * tax-computation-engine — NUMERIC-as-string coercion regressions (G13 sweep)
 *
 * it_standard_config's standard_deduction/rebate_87a_limit/rebate_87a_amount/
 * cess_rate and it_tax_slabs' income_from/income_to/tax_rate/base_tax are all
 * DECIMAL — PostgREST/Supabase serialize them as JSON strings, not numbers.
 * `loadStdConfig`'s DB-success path used to `return data as ItStandardConfig`
 * — a type assertion, not a real conversion — so every downstream arithmetic
 * use (cess = (taxAfterRebate + surcharge) * cessRate, etc.) silently
 * corrupted into NaN once a real it_standard_config row existed for the FY.
 */

import { describe, it, expect } from 'vitest'
import { fetchTaxTableCache, computeTaxWithDB, type TaxComputationInput } from '../tax-computation-engine.js'

/** Mock matching loadSlabs (select/eq/eq/order) and loadStdConfig (select/eq/eq/maybeSingle). */
function mockSupabase(opts: {
  slabs: Array<{ income_from: string | number; income_to: string | number | null; tax_rate: string | number; base_tax: string | number; slab_order: number }>
  stdConfig: { standard_deduction: string | number; rebate_87a_limit: string | number; rebate_87a_amount: string | number; cess_rate: string | number } | null
}) {
  return {
    from(table: string) {
      if (table === 'it_tax_slabs') {
        const chain: any = { select: () => chain, eq: () => chain, is: () => chain, order: () => Promise.resolve({ data: opts.slabs, error: null }) }
        return chain
      }
      // it_standard_config
      const chain: any = { select: () => chain, eq: () => chain, maybeSingle: () => Promise.resolve({ data: opts.stdConfig, error: null }) }
      return chain
    },
  } as any
}

const NEW_REGIME_SLABS_STRING = [
  { income_from: '0.00', income_to: '300000.00', tax_rate: '0.0000', base_tax: '0.00', slab_order: 1 },
  { income_from: '300001.00', income_to: '700000.00', tax_rate: '0.0500', base_tax: '0.00', slab_order: 2 },
  { income_from: '700001.00', income_to: null, tax_rate: '0.1000', base_tax: '20000.00', slab_order: 3 },
]

const baseInput: TaxComputationInput = {
  grossAnnualIncome: 900_000,
  regime: 'new',
  financialYear: '2026-27',
  deductions: {
    section80C: 0, section80CCD1B: 0, section80D: 0, section80E: 0, section80G: 0, section80TTA: 0,
    hraExemption: 0, homeLoanInterest: 0, otherDeductions: 0, professionalTax: 0,
    previousEmployerTDS: 0, tdsOthers: 0, otherIncome: 0, previousEmployerSalary: 0,
  },
  alreadyDeducted: 0,
  remainingMonths: 12,
}

describe('fetchTaxTableCache / loadStdConfig — DB-string it_standard_config (G13 sweep)', () => {
  it('string standard_deduction/rebate fields are real numbers in the cache, not strings', async () => {
    const supabase = mockSupabase({
      slabs: NEW_REGIME_SLABS_STRING,
      stdConfig: { standard_deduction: '75000.00', rebate_87a_limit: '700000.00', rebate_87a_amount: '25000.00', cess_rate: '0.0400' },
    })
    const cache = await fetchTaxTableCache(supabase, '2026-27')

    expect(cache.stdCfgNew.standard_deduction).toBe(75000)
    expect(cache.stdCfgNew.rebate_87a_limit).toBe(700000)
    expect(cache.stdCfgNew.rebate_87a_amount).toBe(25000)
    expect(cache.stdCfgNew.cess_rate).toBe(0.04)
    expect(typeof cache.stdCfgNew.standard_deduction).toBe('number')
  })
})

describe('computeTaxWithDB — end-to-end with DB-string config (G13 sweep)', () => {
  it('produces a finite, non-NaN monthlyTDS when it_standard_config values arrive as strings', async () => {
    const supabase = mockSupabase({
      slabs: NEW_REGIME_SLABS_STRING,
      stdConfig: { standard_deduction: '75000.00', rebate_87a_limit: '700000.00', rebate_87a_amount: '25000.00', cess_rate: '0.0400' },
    })

    const result = await computeTaxWithDB(supabase, baseInput)

    expect(Number.isFinite(result.monthlyTDS)).toBe(true)
    expect(Number.isFinite(result.annualTaxLiability)).toBe(true)
    expect(Number.isNaN(result.monthlyTDS)).toBe(false)
    // Before the fix: `return data as ItStandardConfig` left standard_deduction as a
    // string, and `totalGross - stdDed - profTax - homeLoan` string-concatenated,
    // producing NaN all the way down to monthlyTDS.
  })

  it('falls back to hardcoded numeric slabs/config when the DB has no rows (still finite)', async () => {
    const supabase = mockSupabase({ slabs: [], stdConfig: null })

    const result = await computeTaxWithDB(supabase, baseInput)

    expect(Number.isFinite(result.monthlyTDS)).toBe(true)
    expect(Number.isNaN(result.monthlyTDS)).toBe(false)
  })

  it('zero-rate slab row (tax_rate "0.0000") as a string does not corrupt the slab-tax calculation', async () => {
    const supabase = mockSupabase({
      slabs: NEW_REGIME_SLABS_STRING,
      stdConfig: { standard_deduction: '75000.00', rebate_87a_limit: '700000.00', rebate_87a_amount: '25000.00', cess_rate: '0.0400' },
    })
    // Taxable income comfortably inside the 0% slab after standard deduction.
    const result = await computeTaxWithDB(supabase, { ...baseInput, grossAnnualIncome: 350_000 })

    expect(Number.isFinite(result.annualTaxLiability)).toBe(true)
    expect(result.annualTaxLiability).toBe(0)
  })
})

// Migration 455 (round 10): FY2025-26/26-27 new-regime slabs were stale
// (pre-Budget-2025 breakpoints) while it_standard_config's rebate was already
// correct. loadSlabs() now filters `.is('superseded_at', null)` so a
// superseded row left in the table (for audit history, not deleted) is never
// read back into a live computation.
const CORRECTED_FY2026_27_NEW_SLABS = [
  { income_from: '0.00', income_to: '400000.00', tax_rate: '0.0000', base_tax: '0.00', slab_order: 1 },
  { income_from: '400001.00', income_to: '800000.00', tax_rate: '0.0500', base_tax: '0.00', slab_order: 2 },
  { income_from: '800001.00', income_to: '1200000.00', tax_rate: '0.1000', base_tax: '20000.00', slab_order: 3 },
  { income_from: '1200001.00', income_to: '1600000.00', tax_rate: '0.1500', base_tax: '60000.00', slab_order: 4 },
  { income_from: '1600001.00', income_to: '2000000.00', tax_rate: '0.2000', base_tax: '120000.00', slab_order: 5 },
  { income_from: '2000001.00', income_to: '2400000.00', tax_rate: '0.2500', base_tax: '200000.00', slab_order: 6 },
  { income_from: '2400001.00', income_to: null, tax_rate: '0.3000', base_tax: '300000.00', slab_order: 7 },
]
const STD_CONFIG_FY2026_27_NEW = { standard_deduction: '75000.00', rebate_87a_limit: '1200000.00', rebate_87a_amount: '60000.00', cess_rate: '0.0400' }

describe('loadSlabs — superseded-row exclusion (migration 455, round 10)', () => {
  it('calls .is("superseded_at", null) on the it_tax_slabs query, so a superseded row never reaches a live computation', async () => {
    const isCalls: Array<[string, unknown]> = []
    const supabase = {
      from(table: string) {
        if (table === 'it_tax_slabs') {
          const chain: any = {
            select: () => chain,
            eq: () => chain,
            is: (col: string, val: unknown) => { isCalls.push([col, val]); return chain },
            order: () => Promise.resolve({ data: CORRECTED_FY2026_27_NEW_SLABS, error: null }),
          }
          return chain
        }
        const chain: any = { select: () => chain, eq: () => chain, maybeSingle: () => Promise.resolve({ data: STD_CONFIG_FY2026_27_NEW, error: null }) }
        return chain
      },
    } as any

    await computeTaxWithDB(supabase, { ...baseInput, grossAnnualIncome: 1_600_000 })

    expect(isCalls).toContainEqual(['superseded_at', null])
  })

  it('a corrected Budget-2025-structure slab set produces a different (lower) annual liability at Rs.16L gross than the stale pre-Budget-2025 structure did — proving the breakpoints, not just the rebate, now drive the result', async () => {
    const supabase = mockSupabase({ slabs: CORRECTED_FY2026_27_NEW_SLABS, stdConfig: STD_CONFIG_FY2026_27_NEW })

    const result = await computeTaxWithDB(supabase, { ...baseInput, grossAnnualIncome: 1_600_000 })

    // Independently hand-verified against the corrected (Budget 2025) slab structure:
    // taxable 1,525,000 -> 4-8L@5%=20,000 + 8-12L@10%=40,000 + 12-16L@15% of 325,000=48,750
    // = 108,750 pre-cess, *1.04 = 113,100. (See migration 455's own commentary and
    // DEFECTS.md's TDS verification section for the full derivation and the
    // pre-fix value this replaces: Rs.1,63,799.69.)
    expect(result.taxableIncome).toBe(1_525_000)
    expect(result.annualTaxLiability).toBeCloseTo(113_099.84, 1)
    expect(result.annualTaxLiability).not.toBeCloseTo(163_799.69, 1)
  })

  it('below the Rs.12L rebate ceiling, the stale and corrected slab structures agree (both fully rebated) — the fix has zero effect there', async () => {
    const supabase = mockSupabase({ slabs: CORRECTED_FY2026_27_NEW_SLABS, stdConfig: STD_CONFIG_FY2026_27_NEW })

    const result = await computeTaxWithDB(supabase, { ...baseInput, grossAnnualIncome: 1_000_000 })

    expect(result.taxableIncome).toBe(925_000)
    expect(result.annualTaxLiability).toBe(0)
  })
})
