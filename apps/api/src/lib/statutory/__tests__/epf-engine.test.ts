/**
 * epf-engine — computeEPF() regression tests
 *
 * Scenarios covered:
 *   1. Not applicable                → all zeros, single trace note
 *   2. Below wage ceiling            → uncapped pfWages used, isCapped = false
 *   3. At wage ceiling exactly       → cappedPfWages = ceiling, isCapped = false
 *   4. Above wage ceiling            → cappedPfWages = ceiling, isCapped = true
 *   5. Wage ceiling disabled         → uncapped pfWages used regardless of amount
 *   6. International worker         → no ceiling applied even above statutory cap
 *   7. Higher PF opted               → employee contribution computed on uncapped
 *                                      wages at higherPfPct, employer side still
 *                                      computed on the (possibly capped) wages
 *   8. Voluntary PF disabled by config → voluntaryPfContribution = 0 even if opted
 *   9. Voluntary PF enabled          → computed on cappedPfWages at voluntaryPfPct
 *  10. EDLI cap                     → edliContribution clamped to config.edliCap
 *  11. EDLI below cap               → edliContribution = raw rate×wages, uncapped
 *  12. Admin charges                → proportional only, no per-employee floor
 *      applied (floor is documented as establishment-level, applied by callers)
 *  13. Total employer contribution  → employerPf + employerEps + edliContribution
 *
 * What is NOT tested:
 *   - Establishment-level EDLI-floor aggregation (lives in payroll/exports.ts,
 *     payroll/filing-pack.ts, datasets/statutory.ts callers, not this engine)
 *   - Config validation / malformed EPFConfig shapes
 */

import { describe, it, expect } from 'vitest'
import { computeEPF, DEFAULT_EPF_CONFIG, type EPFInput, type EPFConfig } from '../epf-engine.js'

const EMP = 'emp-001'

function input(overrides: Partial<EPFInput> = {}): EPFInput {
  return {
    employeeId:            EMP,
    pfWages:                12_000,
    voluntaryPfPct:         0,
    isEpfApplicable:        true,
    isInternationalWorker:  false,
    higherPfOpted:          false,
    higherPfPct:            0,
    ...overrides,
  }
}

function config(overrides: Partial<EPFConfig> = {}): EPFConfig {
  return { ...DEFAULT_EPF_CONFIG, ...overrides }
}

describe('computeEPF — applicability', () => {
  it('not applicable: returns all zeros with a single trace note', () => {
    const result = computeEPF(input({ isEpfApplicable: false }), config())

    expect(result.cappedPfWages).toBe(0)
    expect(result.employeeContribution).toBe(0)
    expect(result.employerPf).toBe(0)
    expect(result.employerEps).toBe(0)
    expect(result.edliContribution).toBe(0)
    expect(result.adminCharges).toBe(0)
    expect(result.totalEmployerContribution).toBe(0)
    expect(result.isCapped).toBe(false)
    expect(result.traceSteps).toEqual(['EPF not applicable for this employee'])
  })
})

describe('computeEPF — wage ceiling', () => {
  it('below ceiling: uncapped pfWages used, isCapped = false', () => {
    const result = computeEPF(input({ pfWages: 12_000 }), config())

    expect(result.cappedPfWages).toBe(12_000)
    expect(result.isCapped).toBe(false)
  })

  it('at ceiling exactly: cappedPfWages = ceiling, isCapped = false', () => {
    const result = computeEPF(input({ pfWages: 15_000 }), config({ wageCeiling: 15_000 }))

    expect(result.cappedPfWages).toBe(15_000)
    expect(result.isCapped).toBe(false)
  })

  it('above ceiling: cappedPfWages clamped to ceiling, isCapped = true', () => {
    const result = computeEPF(input({ pfWages: 25_000 }), config({ wageCeiling: 15_000 }))

    expect(result.cappedPfWages).toBe(15_000)
    expect(result.isCapped).toBe(true)
  })

  it('ceiling disabled: uncapped pfWages used regardless of amount', () => {
    const result = computeEPF(
      input({ pfWages: 40_000 }),
      config({ isWageCeilingApplicable: false }),
    )

    expect(result.cappedPfWages).toBe(40_000)
    expect(result.isCapped).toBe(false)
  })

  it('international worker: no ceiling applied even above the statutory cap', () => {
    const result = computeEPF(
      input({ pfWages: 40_000, isInternationalWorker: true }),
      config({ wageCeiling: 15_000, isWageCeilingApplicable: true }),
    )

    expect(result.cappedPfWages).toBe(40_000)
    expect(result.isCapped).toBe(false)
  })
})

describe('computeEPF — employee contribution', () => {
  it('standard rate: cappedPfWages × employeeContributionPct', () => {
    const result = computeEPF(
      input({ pfWages: 12_000 }),
      config({ employeeContributionPct: 12 }),
    )

    expect(result.employeeContribution).toBe(1_440) // 12000 × 12%
  })

  it('higher PF opted: uses uncapped pfWages at higherPfPct, not the capped base', () => {
    const result = computeEPF(
      input({ pfWages: 25_000, higherPfOpted: true, higherPfPct: 12 }),
      config({ wageCeiling: 15_000 }),
    )

    // Employee contribution on full uncapped wages, not the 15,000 ceiling
    expect(result.employeeContribution).toBe(3_000) // 25000 × 12%
    // Employer-side contributions still computed on the capped base
    expect(result.employerPf).toBe(round2(15_000 * DEFAULT_EPF_CONFIG.employerPfPct / 100))
  })
})

describe('computeEPF — voluntary PF', () => {
  it('disabled by config: voluntaryPfContribution = 0 even if a rate is supplied', () => {
    const result = computeEPF(
      input({ voluntaryPfPct: 5 }),
      config({ allowVoluntaryPf: false }),
    )

    expect(result.voluntaryPfContribution).toBe(0)
  })

  it('enabled: computed on cappedPfWages at voluntaryPfPct', () => {
    const result = computeEPF(
      input({ pfWages: 12_000, voluntaryPfPct: 5 }),
      config({ allowVoluntaryPf: true }),
    )

    expect(result.voluntaryPfContribution).toBe(600) // 12000 × 5%
  })
})

describe('computeEPF — EDLI', () => {
  it('below cap: edliContribution = raw rate × cappedPfWages, uncapped', () => {
    const result = computeEPF(
      input({ pfWages: 10_000 }),
      config({ edliRatePct: 0.5, edliCap: 75 }),
    )

    expect(result.edliContribution).toBe(50) // 10000 × 0.5% = 50, under cap
  })

  it('above cap: edliContribution clamped to config.edliCap', () => {
    const result = computeEPF(
      input({ pfWages: 20_000, isInternationalWorker: true }), // bypass ceiling to push raw EDLI over cap
      config({ edliRatePct: 0.5, edliCap: 75 }),
    )

    expect(result.edliContribution).toBe(75) // raw = 100, clamped to 75
  })
})

describe('computeEPF — admin charges', () => {
  it('proportional only, no per-employee floor applied by the engine', () => {
    const result = computeEPF(
      input({ pfWages: 1_000 }), // small wages → raw admin charge well under a typical floor
      config({ adminChargesPct: 0.5, edliFloor: 25 }),
    )

    expect(result.adminCharges).toBe(5) // 1000 × 0.5% = 5, NOT floored to 25
  })
})

describe('computeEPF — total employer contribution', () => {
  it('sums employerPf + employerEps + edliContribution', () => {
    const result = computeEPF(input({ pfWages: 12_000 }), config())

    expect(result.totalEmployerContribution).toBe(
      round2(result.employerPf + result.employerEps + result.edliContribution),
    )
  })
})

function round2(n: number): number {
  return Math.round(n * 100) / 100
}
