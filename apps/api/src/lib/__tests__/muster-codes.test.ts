/**
 * muster-codes — DEFECT-04 (PR #30 Attendance/Leave UAT, 2026-10-12): the
 * muster roll showed a worked weekly-off/holiday day the same way whether the
 * employee worked a full day or only a half day, because day_fraction is
 * (correctly) hardcoded to 1.0 for both — payroll doesn't depend on the
 * worked fraction for a WO/holiday day. Fixed by having deriveMusterCode()
 * accept the pre-override worked fraction and emit a distinct PWO_H/PHL_H
 * code for the half-day case, without touching day_fraction at all.
 */

import { describe, it, expect } from 'vitest'
import { deriveMusterCode, MUSTER_CODE_DEFS } from '../muster-codes.js'

describe('deriveMusterCode — DEFECT-04: half vs full day worked on WO/holiday', () => {
  it('a full day worked on a weekly off is PWO', () => {
    expect(deriveMusterCode('present', false, true, 1.0)).toBe('PWO')
  })

  it('a half day worked on a weekly off is PWO_H, not PWO', () => {
    expect(deriveMusterCode('half_day', false, true, 0.5)).toBe('PWO_H')
  })

  it('a full day worked on a holiday is PHL', () => {
    expect(deriveMusterCode('present', true, false, 1.0)).toBe('PHL')
  })

  it('a half day worked on a holiday is PHL_H, not PHL', () => {
    expect(deriveMusterCode('half_day', true, false, 0.5)).toBe('PHL_H')
  })

  it('holiday takes precedence over weekly-off when both flags are set, half-day still distinguished', () => {
    expect(deriveMusterCode('half_day', true, true, 0.5)).toBe('PHL_H')
  })

  it('omitting workedFraction (legacy callers) defaults to the full-day code — no silent regression', () => {
    expect(deriveMusterCode('present', false, true)).toBe('PWO')
    expect(deriveMusterCode('present', true, false)).toBe('PHL')
  })

  it('PWO_H/PHL_H carry day_fraction 1.0 — payroll stays untouched by this display-only distinction', () => {
    expect(MUSTER_CODE_DEFS.PWO_H.day_fraction).toBe(1.0)
    expect(MUSTER_CODE_DEFS.PHL_H.day_fraction).toBe(1.0)
    expect(MUSTER_CODE_DEFS.PWO_H.is_payable).toBe(true)
    expect(MUSTER_CODE_DEFS.PHL_H.is_payable).toBe(true)
  })

  it('neither holiday nor weekly-off worked falls through to the status map, unaffected', () => {
    expect(deriveMusterCode('present', false, false, 1.0)).toBe('P')
    expect(deriveMusterCode('half_day', false, false, 0.5)).toBe('HLF')
  })
})
