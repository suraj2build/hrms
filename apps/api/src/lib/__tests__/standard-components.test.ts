/**
 * standard-salary-components — integrity tests for the seeded best-practice set.
 */

import { describe, it, expect } from 'vitest'
import { STANDARD_SALARY_COMPONENTS } from '../standard-salary-components.js'

const CALC_TYPES = ['fixed', 'pct_of_basic', 'pct_of_ctc', 'pct_of_gross']

describe('STANDARD_SALARY_COMPONENTS', () => {
  it('has a non-trivial set of components', () => {
    expect(STANDARD_SALARY_COMPONENTS.length).toBeGreaterThanOrEqual(10)
  })

  it('codes are unique', () => {
    const codes = STANDARD_SALARY_COMPONENTS.map(c => c.code)
    expect(new Set(codes).size).toBe(codes.length)
  })

  it('display_order values are unique', () => {
    const orders = STANDARD_SALARY_COMPONENTS.map(c => c.display_order)
    expect(new Set(orders).size).toBe(orders.length)
  })

  it('exactly one component is marked is_basic', () => {
    expect(STANDARD_SALARY_COMPONENTS.filter(c => c.is_basic).length).toBe(1)
  })

  it('the basic component is BASIC and is PF-applicable', () => {
    const basic = STANDARD_SALARY_COMPONENTS.find(c => c.is_basic)!
    expect(basic.code).toBe('BASIC')
    expect(basic.is_pf_applicable).toBe(true)
    expect(basic.default_calculation_type).toBe('pct_of_ctc')
  })

  it('every component_type is valid', () => {
    for (const c of STANDARD_SALARY_COMPONENTS) {
      expect(['earning', 'deduction', 'employer_contribution']).toContain(c.component_type)
    }
  })

  it('default_calculation_type and default_value are both set or both null', () => {
    for (const c of STANDARD_SALARY_COMPONENTS) {
      const hasType = c.default_calculation_type !== null
      const hasVal  = c.default_value !== null
      expect(hasType).toBe(hasVal)
      if (hasType) {
        expect(CALC_TYPES).toContain(c.default_calculation_type)
        expect(c.default_value!).toBeGreaterThanOrEqual(0)
      }
    }
  })

  it('SPECIAL (balancer) and TDS have no default rule', () => {
    for (const code of ['SPECIAL', 'TDS']) {
      const c = STANDARD_SALARY_COMPONENTS.find(x => x.code === code)!
      expect(c.default_calculation_type).toBeNull()
    }
  })

  it('reserves the engine PF codes so seeding reuses them', () => {
    const codes = STANDARD_SALARY_COMPONENTS.map(c => c.code)
    expect(codes).toContain('PF_EMPLOYEE')
    expect(codes).toContain('PF_EMPLOYER')
  })
})
