/**
 * esi-engine — computeESI() regression tests
 *
 * Scenarios covered:
 *   1. Below ceiling                 → eligible, status = 'eligible'
 *   2. At ceiling exactly            → eligible (<=, not <)
 *   3. Above ceiling, no continuation → ineligible, all contributions zero,
 *                                       status = 'ineligible'
 *   4. Above ceiling with forceApplicable → eligible, status = 'continuation'
 *   5. At ceiling with forceApplicable    → eligible, status stays 'eligible'
 *                                            (continuation only applies once
 *                                            wages actually exceed the ceiling)
 *   6. Statutory rounding: fractional raw contribution rounds UP to the next
 *      rupee, for both employee and employer shares independently
 *   7. Statutory rounding: an exact-rupee raw contribution is NOT bumped up
 *      an extra rupee (the epsilon guard doesn't over-round the common case)
 *   8. totalContribution = employeeContribution + employerContribution
 *      (sum of the two independently-rounded shares, not a rounded sum)
 *
 * What is NOT tested:
 *   - Config validation / malformed ESIConfig shapes
 *   - 'exempt' status (no code path in computeESI ever returns it — it's
 *     reserved for a caller-side administrative override, not this engine)
 */

import { describe, it, expect } from 'vitest'
import { computeESI, type ESIConfig } from '../esi-engine.js'

const CONFIG: ESIConfig = {
  employeeContributionPct: 0.75,
  employerContributionPct: 3.25,
  wageCeiling:             21_000,
}

describe('computeESI — eligibility', () => {
  it('below ceiling: eligible, status = eligible', () => {
    const result = computeESI(15_000, CONFIG)

    expect(result.isEligible).toBe(true)
    expect(result.status).toBe('eligible')
  })

  it('at ceiling exactly: eligible (<=, not <)', () => {
    const result = computeESI(21_000, CONFIG)

    expect(result.isEligible).toBe(true)
    expect(result.status).toBe('eligible')
  })

  it('above ceiling, no continuation: ineligible, all contributions zero', () => {
    const result = computeESI(25_000, CONFIG)

    expect(result.isEligible).toBe(false)
    expect(result.status).toBe('ineligible')
    expect(result.employeeContribution).toBe(0)
    expect(result.employerContribution).toBe(0)
    expect(result.totalContribution).toBe(0)
  })

  it('above ceiling with forceApplicable: eligible, status = continuation', () => {
    const result = computeESI(25_000, CONFIG, true)

    expect(result.isEligible).toBe(true)
    expect(result.status).toBe('continuation')
    expect(result.employeeContribution).toBeGreaterThan(0)
  })

  it('at ceiling with forceApplicable: status stays eligible, not continuation', () => {
    const result = computeESI(21_000, CONFIG, true)

    expect(result.isEligible).toBe(true)
    expect(result.status).toBe('eligible')
  })
})

describe('computeESI — statutory rounding (ceil to next rupee)', () => {
  it('fractional raw contribution rounds up to the next rupee', () => {
    // 1234 × 0.75% = 9.255 → ceil → 10
    const result = computeESI(1_234, CONFIG)

    expect(result.employeeContribution).toBe(10)
  })

  it('exact-rupee raw contribution is not bumped up an extra rupee', () => {
    // 100 × 1% = 1.00 exactly — the epsilon guard must not push this to 2
    const result = computeESI(100, { ...CONFIG, employeeContributionPct: 1 })

    expect(result.employeeContribution).toBe(1)
  })

  it('employer and employee shares round independently', () => {
    // 1000 × 0.75% = 7.5 → 8 ; 1000 × 3.25% = 32.5 → 33
    const result = computeESI(1_000, CONFIG)

    expect(result.employeeContribution).toBe(8)
    expect(result.employerContribution).toBe(33)
  })
})

describe('computeESI — total contribution', () => {
  it('sums the two independently-rounded shares', () => {
    const result = computeESI(12_345, CONFIG)

    expect(result.totalContribution).toBe(result.employeeContribution + result.employerContribution)
  })
})
