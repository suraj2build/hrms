/**
 * payroll-flags tests (PI-1).
 *
 * Locks in the rollout-lever contract. Dual control (four-eyes finalize) is
 * DEFAULT ON — an opt-OUT tightening — so the lever can only RELAX enforcement
 * via an explicit OFF value; unset or anything unrecognised keeps four-eyes on.
 */
import { describe, it, expect, afterEach } from 'vitest'
import { isPayrollDualControlEnabled } from '../payroll-flags.js'

const KEY = 'PAYROLL_FINALIZE_DUAL_CONTROL'

afterEach(() => { delete process.env[KEY] })

describe('isPayrollDualControlEnabled', () => {
  it('defaults to ON when unset (four-eyes enforced by default)', () => {
    delete process.env[KEY]
    expect(isPayrollDualControlEnabled()).toBe(true)
  })

  it('turns OFF only for explicit opt-out values (case/space-insensitive)', () => {
    for (const v of ['off', 'false', '0', 'disabled', 'no', ' OFF ', 'False']) {
      process.env[KEY] = v
      expect(isPayrollDualControlEnabled()).toBe(false)
    }
  })

  it('stays ON for unrecognised / empty values (opt-out tightening)', () => {
    for (const v of ['on', 'true', '1', 'enabled', 'yes', 'maybe', '']) {
      process.env[KEY] = v
      expect(isPayrollDualControlEnabled()).toBe(true)
    }
  })
})
