/**
 * fbp-reconciliation — pure engine tests
 */

import { describe, it, expect } from 'vitest'
import {
  computeFbpTaxable, quarterMonths, cumulativeMonths, monthToQuarter, fyStartYear, sumComponentPaid,
} from '../fbp-reconciliation.js'

describe('computeFbpTaxable', () => {
  it('fully substantiated → nothing taxable', () => {
    expect(computeFbpTaxable({ paid: 12000, proof: 12000 }))
      .toEqual({ paid: 12000, proof: 12000, exempt: 12000, taxable: 0 })
  })

  it('no bills → fully taxable', () => {
    expect(computeFbpTaxable({ paid: 12000, proof: 0 }))
      .toEqual({ paid: 12000, proof: 0, exempt: 0, taxable: 12000 })
  })

  it('partial bills → only the shortfall is taxable', () => {
    expect(computeFbpTaxable({ paid: 12000, proof: 7500 }))
      .toEqual({ paid: 12000, proof: 7500, exempt: 7500, taxable: 4500 })
  })

  it('bills exceed paid → exempt capped at paid, nothing taxable', () => {
    expect(computeFbpTaxable({ paid: 12000, proof: 15000 }))
      .toEqual({ paid: 12000, proof: 15000, exempt: 12000, taxable: 0 })
  })

  it('exemption limit caps the exempt portion', () => {
    // paid 12000, proof 12000, but only 6000 is exemptible → 6000 taxable
    expect(computeFbpTaxable({ paid: 12000, proof: 12000, exemptionLimit: 6000 }))
      .toEqual({ paid: 12000, proof: 12000, exempt: 6000, taxable: 6000 })
  })

  it('null exemption limit means no cap', () => {
    expect(computeFbpTaxable({ paid: 9000, proof: 9000, exemptionLimit: null }).taxable).toBe(0)
  })
})

describe('quarterMonths (Indian FY)', () => {
  it('Q1 = Apr-Jun of start year', () => {
    expect(quarterMonths('2026-27', 1)).toEqual(['2026-04', '2026-05', '2026-06'])
  })
  it('Q3 = Oct-Dec of start year', () => {
    expect(quarterMonths('2026-27', 3)).toEqual(['2026-10', '2026-11', '2026-12'])
  })
  it('Q4 = Jan-Mar of the following year', () => {
    expect(quarterMonths('2026-27', 4)).toEqual(['2027-01', '2027-02', '2027-03'])
  })
  it('rejects invalid quarter', () => {
    expect(() => quarterMonths('2026-27', 5)).toThrow()
  })
})

describe('cumulativeMonths (YTD)', () => {
  it('Q1 → 3 months', () => {
    expect(cumulativeMonths('2026-27', 1)).toEqual(['2026-04', '2026-05', '2026-06'])
  })
  it('Q2 → 6 months (Apr–Sep)', () => {
    expect(cumulativeMonths('2026-27', 2)).toHaveLength(6)
    expect(cumulativeMonths('2026-27', 2)[5]).toBe('2026-09')
  })
  it('Q4 → all 12 months', () => {
    const ms = cumulativeMonths('2026-27', 4)
    expect(ms).toHaveLength(12)
    expect(ms[0]).toBe('2026-04')
    expect(ms[11]).toBe('2027-03')
  })
})

describe('monthToQuarter', () => {
  it('maps months to FY quarters', () => {
    expect(monthToQuarter('2026-04')).toBe(1)
    expect(monthToQuarter('2026-09')).toBe(2)
    expect(monthToQuarter('2026-12')).toBe(3)
    expect(monthToQuarter('2027-01')).toBe(4)
    expect(monthToQuarter('2027-03')).toBe(4)
  })
})

describe('fyStartYear', () => {
  it('parses the start year', () => {
    expect(fyStartYear('2026-27')).toBe(2026)
  })
})

describe('sumComponentPaid', () => {
  it('sums a component code across slips (case-insensitive)', () => {
    const slips = [
      { component_breakdown: [{ code: 'FUEL', monthly_amount: 4000 }, { code: 'HRA', monthly_amount: 20000 }] },
      { component_breakdown: [{ code: 'fuel', monthly_amount: 4000 }] },
      { component_breakdown: [{ code: 'FUEL', monthly_amount: 4000 }] },
    ]
    expect(sumComponentPaid(slips, 'FUEL')).toBe(12000)
  })
  it('returns 0 when the component is absent', () => {
    expect(sumComponentPaid([{ component_breakdown: [] }], 'FUEL')).toBe(0)
  })
})
