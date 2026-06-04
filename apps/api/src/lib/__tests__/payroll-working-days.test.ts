/**
 * payroll-engine — roster-aware working-day denominator regression tests
 *
 * Covers countScheduledWorkingDays (the pure core of countWorkingDaysForEmployee),
 * which fixes the LOP-denominator mismatch where total_working_days hardcoded
 * Sat/Sun tenant-wide while lop_days came from each employee's actual roster off.
 *
 * Scenarios:
 *   1. Sat/Sun off (default)        → excludes weekends
 *   2. Tue/Wed roster off           → excludes Tue/Wed, INCLUDES weekends
 *   3. Holidays excluded            → holiday dates removed regardless of dow
 *   4. Sunday-only off (6-day week) → only Sundays excluded
 *   5. Combined off + holiday       → both excluded, no double subtraction
 *   6. Empty range                  → 0
 */

import { describe, it, expect } from 'vitest'
import { countScheduledWorkingDays } from '../payroll-engine.js'

// June 2026: 1st = Monday. 30 days.
//   Sundays: 7, 14, 21, 28   Saturdays: 6, 13, 20, 27
//   Tuesdays: 2, 9, 16, 23, 30   Wednesdays: 3, 10, 17, 24
const TZ = 'Asia/Kolkata'
function juneDates(): string[] {
  return Array.from({ length: 30 }, (_, i) => `2026-06-${String(i + 1).padStart(2, '0')}`)
}

describe('countScheduledWorkingDays', () => {
  it('1. Sat/Sun off → excludes 8 weekend days (22 working)', () => {
    const n = countScheduledWorkingDays(juneDates(), [0, 6], new Set(), TZ)
    expect(n).toBe(22)   // 30 − 4 Sun − 4 Sat
  })

  it('2. Tue/Wed roster off → excludes Tue/Wed, weekends ARE working', () => {
    // Tuesdays: 5 (2,9,16,23,30), Wednesdays: 4 (3,10,17,24) = 9 off days
    const n = countScheduledWorkingDays(juneDates(), [2, 3], new Set(), TZ)
    expect(n).toBe(21)   // 30 − 9
  })

  it('3. holidays excluded regardless of day-of-week', () => {
    const holidays = new Set(['2026-06-01', '2026-06-15'])  // a Mon + a Mon
    const n = countScheduledWorkingDays(juneDates(), [0, 6], holidays, TZ)
    expect(n).toBe(20)   // 22 working − 2 holidays
  })

  it('4. Sunday-only off (6-day week) → only 4 Sundays excluded', () => {
    const n = countScheduledWorkingDays(juneDates(), [0], new Set(), TZ)
    expect(n).toBe(26)   // 30 − 4 Sun
  })

  it('5. off-day that is also a holiday is not double-counted', () => {
    const holidays = new Set(['2026-06-07'])  // 7th is a Sunday (already an off)
    const n = countScheduledWorkingDays(juneDates(), [0, 6], holidays, TZ)
    expect(n).toBe(22)   // unchanged — Sunday already excluded
  })

  it('6. empty range → 0', () => {
    expect(countScheduledWorkingDays([], [0, 6], new Set(), TZ)).toBe(0)
  })

  it('demonstrates the bug it fixes: Tue/Wed-off employee denominator differs from Sat/Sun', () => {
    const satSun = countScheduledWorkingDays(juneDates(), [0, 6], new Set(), TZ)
    const tueWed = countScheduledWorkingDays(juneDates(), [2, 3], new Set(), TZ)
    // Different denominators → different per-day LOP rate. The old code used
    // satSun (22) for everyone; the fix uses the employee's real roster.
    expect(satSun).not.toBe(tueWed)
  })
})
