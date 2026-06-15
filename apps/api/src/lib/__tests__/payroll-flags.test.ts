/**
 * payroll-flags tests (PI-1).
 *
 * Locks in the rollout-lever contract: dual control is OFF by default, so
 * deploying PI-1 does NOT change the existing single-operator finalize flow.
 * Only an explicit opt-in enables four-eyes enforcement.
 */
import { describe, it, expect, afterEach } from 'vitest'
import { isPayrollDualControlEnabled } from '../payroll-flags.js'

const KEY = 'PAYROLL_FINALIZE_DUAL_CONTROL'

afterEach(() => { delete process.env[KEY] })

describe('isPayrollDualControlEnabled', () => {
  it('defaults to OFF when unset (no behaviour change on deploy)', () => {
    delete process.env[KEY]
    expect(isPayrollDualControlEnabled()).toBe(false)
  })

  it('stays OFF for falsey / unrecognised values', () => {
    for (const v of ['off', 'false', '0', 'no', '', 'maybe']) {
      process.env[KEY] = v
      expect(isPayrollDualControlEnabled()).toBe(false)
    }
  })

  it('turns ON only for explicit opt-in values (case/space-insensitive)', () => {
    for (const v of ['on', 'true', '1', 'enabled', 'yes', ' ON ', 'True']) {
      process.env[KEY] = v
      expect(isPayrollDualControlEnabled()).toBe(true)
    }
  })
})
