import { describe, it, expect } from 'vitest'
import { addDaysToDateStr, daysBetweenDateStrs } from '../absconding-engine.js'

describe('addDaysToDateStr (ISSUE-154) — UTC-anchored, server-TZ-independent', () => {
  it('adds a positive day offset within a month', () => {
    expect(addDaysToDateStr('2026-07-01', 7)).toBe('2026-07-08')
  })

  it('subtracts (negative offset)', () => {
    expect(addDaysToDateStr('2026-07-08', -7)).toBe('2026-07-01')
  })

  it('crosses a month boundary', () => {
    expect(addDaysToDateStr('2026-07-28', 5)).toBe('2026-08-02')
  })

  it('crosses a year boundary', () => {
    expect(addDaysToDateStr('2026-12-30', 5)).toBe('2027-01-04')
  })

  it('handles a leap-year February correctly', () => {
    // 2028 is a leap year — Feb has 29 days
    expect(addDaysToDateStr('2028-02-28', 1)).toBe('2028-02-29')
    expect(addDaysToDateStr('2028-02-28', 2)).toBe('2028-03-01')
  })

  it('zero offset returns the same date', () => {
    expect(addDaysToDateStr('2026-07-15', 0)).toBe('2026-07-15')
  })
})

describe('daysBetweenDateStrs (ISSUE-154)', () => {
  it('computes the whole-day difference between two dates', () => {
    expect(daysBetweenDateStrs('2026-07-01', '2026-07-08')).toBe(7)
  })

  it('same date returns 0', () => {
    expect(daysBetweenDateStrs('2026-07-01', '2026-07-01')).toBe(0)
  })

  it('never goes negative even if "to" precedes "from"', () => {
    expect(daysBetweenDateStrs('2026-07-08', '2026-07-01')).toBe(0)
  })

  it('is consistent with addDaysToDateStr as inverse operations', () => {
    const start = '2026-03-10'
    const shifted = addDaysToDateStr(start, 21)
    expect(daysBetweenDateStrs(start, shifted)).toBe(21)
  })
})
