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
        const chain: any = { select: () => chain, eq: () => chain, order: () => Promise.resolve({ data: opts.slabs, error: null }) }
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
