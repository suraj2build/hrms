/**
 * leave-engine — resolveLeaveDayFraction (half-day / session) regression tests
 *
 * Verifies the attendance_daily values written when a leave is approved, across
 * full-day and half-day sessions, paid/unpaid, and merging with attendance that
 * already exists for the date.
 */

import { describe, it, expect } from 'vitest'
import { resolveLeaveDayFraction } from '../leave-engine.js'

describe('resolveLeaveDayFraction', () => {
  it('full-day paid leave → 1.0 payable, status leave', () => {
    expect(resolveLeaveDayFraction({ session: 'full_day', isPaid: true }))
      .toEqual({ status: 'leave', day_fraction: 1.0, is_payable: true })
  })

  it('full-day unpaid leave → 0.0 (LOP), status leave', () => {
    expect(resolveLeaveDayFraction({ session: 'full_day', isPaid: false }))
      .toEqual({ status: 'leave', day_fraction: 0.0, is_payable: false })
  })

  it('half-day paid leave, no prior attendance → 0.5 payable, half_day', () => {
    expect(resolveLeaveDayFraction({ session: 'first_half', isPaid: true }))
      .toEqual({ status: 'half_day', day_fraction: 0.5, is_payable: true })
  })

  it('half-day paid leave + worked the other half (present) → merges to 1.0, present', () => {
    expect(resolveLeaveDayFraction({
      session: 'second_half', isPaid: true, existingStatus: 'present',
    })).toEqual({ status: 'present', day_fraction: 1.0, is_payable: true })
  })

  it('half-day paid leave + existing half_day present (0.5) → merges to 1.0', () => {
    expect(resolveLeaveDayFraction({
      session: 'first_half', isPaid: true, existingStatus: 'half_day', existingFraction: 0.5,
    })).toEqual({ status: 'present', day_fraction: 1.0, is_payable: true })
  })

  it('half-day UNPAID leave + worked other half → 0.5 payable (worked), 0.5 LOP', () => {
    expect(resolveLeaveDayFraction({
      session: 'first_half', isPaid: false, existingStatus: 'present',
    })).toEqual({ status: 'half_day', day_fraction: 0.5, is_payable: true })
  })

  it('half-day UNPAID leave, no work → 0.0 (full LOP)', () => {
    expect(resolveLeaveDayFraction({ session: 'first_half', isPaid: false }))
      .toEqual({ status: 'half_day', day_fraction: 0.0, is_payable: false })
  })

  it('half-day paid leave + prior absent → only the leave half is payable (0.5)', () => {
    expect(resolveLeaveDayFraction({
      session: 'second_half', isPaid: true, existingStatus: 'absent',
    })).toEqual({ status: 'half_day', day_fraction: 0.5, is_payable: true })
  })

  it('late counts as worked for merge purposes', () => {
    expect(resolveLeaveDayFraction({
      session: 'first_half', isPaid: true, existingStatus: 'late',
    })).toEqual({ status: 'present', day_fraction: 1.0, is_payable: true })
  })
})
