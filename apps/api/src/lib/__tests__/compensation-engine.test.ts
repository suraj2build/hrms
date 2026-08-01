import { describe, it, expect } from 'vitest'
import {
  computeCompensation,
  DEFAULT_COMPENSATION_POLICY,
  type ComponentInput,
  type CompensationPolicy,
} from '../compensation-engine.js'

// Helper to build an earning/deduction/employer component quickly.
let seq = 0
function comp(p: Partial<ComponentInput> & { code: string; calc_type: ComponentInput['calc_type'] }): ComponentInput {
  return {
    salary_component_id: p.code,
    name: p.code,
    code: p.code,
    component_type: p.component_type ?? 'earning',
    calc_type: p.calc_type,
    value: p.value ?? 0,
    sequence: p.sequence ?? seq++,
    is_basic: p.is_basic ?? false,
    affects_pf: p.affects_pf ?? false,
    affects_nlc: p.affects_nlc ?? false,
  }
}

const noPf: CompensationPolicy = { ...DEFAULT_COMPENSATION_POLICY, nlc_enabled: false, pf_enabled: false }
const withPf: CompensationPolicy = { ...DEFAULT_COMPENSATION_POLICY, nlc_enabled: false, pf_enabled: true }

describe('compensation-engine — CTC reconciliation (balance model)', () => {
  it('balance component absorbs the residual so gross+employer == CTC exactly', () => {
    const ctc = 1_200_000
    const components = [
      comp({ code: 'BASIC',   calc_type: 'pct_of_ctc',  value: 40, is_basic: true }),
      comp({ code: 'HRA',     calc_type: 'pct_of_basic', value: 50 }),
      comp({ code: 'SPECIAL', calc_type: 'balance' }),
    ]
    const r = computeCompensation({ ctcAnnual: ctc, components, employee: { pf_enabled: false, pf_capped: true }, policy: noPf })
    expect(r.ctc_reconciled).toBe(true)
    expect(r.residual_annual).toBeCloseTo(0, 0)
    // total cost = gross (+0 employer) = CTC
    expect(r.total_cost_annual).toBeCloseTo(ctc, 0)
    // Basic = 40% of CTC, HRA = 50% of Basic
    const basic = r.components.find(c => c.code === 'BASIC')!
    const hra   = r.components.find(c => c.code === 'HRA')!
    const spec  = r.components.find(c => c.code === 'SPECIAL')!
    expect(basic.annual_amount).toBeCloseTo(480_000, 0)
    expect(hra.annual_amount).toBeCloseTo(240_000, 0)
    // Special = CTC - basic - hra = 480000
    expect(spec.annual_amount).toBeCloseTo(480_000, 0)
  })

  it('employer PF is counted INSIDE CTC (balance shrinks to fund it)', () => {
    const ctc = 1_200_000
    const components = [
      comp({ code: 'BASIC',   calc_type: 'pct_of_ctc',  value: 40, is_basic: true }),
      comp({ code: 'HRA',     calc_type: 'pct_of_basic', value: 50 }),
      comp({ code: 'SPECIAL', calc_type: 'balance' }),
    ]
    const r = computeCompensation({ ctcAnnual: ctc, components, employee: { pf_enabled: true, pf_capped: true }, policy: withPf })
    expect(r.pf_applied).toBe(true)
    // gross + employer contributions must STILL equal CTC (employer PF inside CTC)
    expect(r.total_cost_annual).toBeCloseTo(ctc, 0)
    expect(r.ctc_reconciled).toBe(true)
    // employer PF on capped base 15000 * 12% * 12 = 21600
    const erPf = r.components.find(c => c.code === 'PF_EMPLOYER')!
    expect(erPf.annual_amount).toBeCloseTo(21_600, 0)
    // Special absorbed the employer PF (smaller than the no-PF case of 480000)
    const spec = r.components.find(c => c.code === 'SPECIAL')!
    expect(spec.annual_amount).toBeCloseTo(480_000 - 21_600, 0)
  })

  it('fixed + pct_of_basic + balance reconcile to CTC', () => {
    const ctc = 600_000
    const components = [
      comp({ code: 'BASIC',   calc_type: 'fixed',        value: 20_000, is_basic: true }), // 240000/yr
      comp({ code: 'HRA',     calc_type: 'pct_of_basic', value: 40 }),                      // 96000/yr
      comp({ code: 'CONV',    calc_type: 'fixed',        value: 1_600 }),                   // 19200/yr
      comp({ code: 'SPECIAL', calc_type: 'balance' }),
    ]
    const r = computeCompensation({ ctcAnnual: ctc, components, employee: { pf_enabled: false, pf_capped: true }, policy: noPf })
    expect(r.total_cost_annual).toBeCloseTo(ctc, 0)
    const spec = r.components.find(c => c.code === 'SPECIAL')!
    expect(spec.annual_amount).toBeCloseTo(600_000 - 240_000 - 96_000 - 19_200, 0)
  })

  it('NLC: lifts Basic to >= 50% of gross using the balance, CTC still reconciles', () => {
    const ctc = 1_000_000
    const components = [
      comp({ code: 'BASIC',   calc_type: 'pct_of_ctc',  value: 20, is_basic: true }), // low basic → NLC violated
      comp({ code: 'HRA',     calc_type: 'pct_of_basic', value: 40 }),
      comp({ code: 'SPECIAL', calc_type: 'balance' }),
    ]
    const policy: CompensationPolicy = { ...DEFAULT_COMPENSATION_POLICY, nlc_enabled: true, pf_enabled: false }
    const r = computeCompensation({ ctcAnnual: ctc, components, employee: { pf_enabled: false, pf_capped: true }, policy })
    expect(r.nlc_applied).toBe(true)
    expect(r.nlc_wage_pct ?? 0).toBeGreaterThanOrEqual(49.5)
    expect(r.total_cost_annual).toBeCloseTo(ctc, 0)   // reconciliation preserved
  })

  it('employer pct_of_gross contribution (e.g. employer ESI) uses the SAME final gross as the employee-side pct_of_gross deduction', () => {
    const ctc = 900_000
    const components = [
      comp({ code: 'BASIC',    calc_type: 'pct_of_ctc',   value: 40, is_basic: true }),
      comp({ code: 'HRA',      calc_type: 'pct_of_basic', value: 40 }),
      comp({ code: 'SPECIAL',  calc_type: 'balance' }),
      comp({ code: 'ER_ESI',   calc_type: 'pct_of_gross', value: 3.25, component_type: 'employer_contribution' }),
      comp({ code: 'EE_ESI',   calc_type: 'pct_of_gross', value: 0.75, component_type: 'deduction' }),
    ]
    const r = computeCompensation({ ctcAnnual: ctc, components, employee: { pf_enabled: false, pf_capped: true }, policy: noPf })
    // CTC = gross + employer contributions must still reconcile despite the
    // employer pct_of_gross contribution depending on (and shrinking) the
    // balance that funds it — a circular dependency resolved by fixed-point
    // iteration inside derive().
    expect(r.ctc_reconciled).toBe(true)
    expect(r.total_cost_annual).toBeCloseTo(ctc, 0)

    const gross  = r.totals.gross_annual
    const erEsi  = r.components.find(c => c.code === 'ER_ESI')!
    const eeEsi  = r.components.find(c => c.code === 'EE_ESI')!
    // Both employer and employee ESI must be computed against the SAME final
    // gross wage base — the entire point of PEND-28's fix.
    expect(erEsi.annual_amount).toBeCloseTo(gross * 0.0325, 0)
    expect(eeEsi.annual_amount).toBeCloseTo(gross * 0.0075, 0)
  })

  it('throws on invalid CTC / empty components / missing basic', () => {
    expect(() => computeCompensation({ ctcAnnual: 0, components: [comp({ code: 'X', calc_type: 'fixed', value: 1 })], employee: { pf_enabled: false, pf_capped: true }, policy: noPf })).toThrow()
    expect(() => computeCompensation({ ctcAnnual: 100, components: [], employee: { pf_enabled: false, pf_capped: true }, policy: noPf })).toThrow()
    expect(() => computeCompensation({ ctcAnnual: 100, components: [comp({ code: 'HRA', calc_type: 'pct_of_basic', value: 50 })], employee: { pf_enabled: false, pf_capped: true }, policy: noPf })).toThrow()
  })
})
