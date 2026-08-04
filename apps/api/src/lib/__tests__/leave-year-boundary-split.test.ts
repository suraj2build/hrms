/**
 * splitByCalendarYear — leave year-boundary balance-bucket split (PEND-103)
 *
 * `employee_leave_balance` is bucketed one row per (employee, leave_type,
 * calendar year). A leave request that spans Dec 31 → Jan 1 must debit BOTH
 * years' buckets, not just the bucket for `from_date`'s year — the old code
 * (`new Date(req.from_date).getFullYear()`) either falsely rejected a valid
 * split-year approval (checking only one year's balance for the full day
 * count) or silently over-drew one year's bucket while leaving the other
 * untouched. `splitByCalendarYear` groups a request's `per_day` breakdown by
 * the calendar year of each charged day, so the caller can validate/debit
 * each year's bucket independently.
 *
 * Scenarios covered:
 *   1. Same-year request — one bucket, correct day count
 *   2. Year-straddling request (Dec 29 – Jan 2) — two buckets, correct split
 *   3. Days with days_charged: 0 (holiday/weekoff in-span) are excluded from
 *      the sum but don't spuriously create an empty bucket for their year
 *   4. Missing/empty per_day (legacy rows predating the duration engine) —
 *      falls back to a single bucket using fallbackDate/fallbackDays
 *   5. Fractional (half-day) entries sum and round correctly within a bucket
 *
 * What is NOT tested here:
 *   - The RPC-side per-bucket balance UPDATE/ledger INSERT loop (SQL, not
 *     exercised by these JS-side tests — see leave-requests.test.ts for the
 *     JS-layer call-site assertions against the mocked RPC)
 */

import { describe, it, expect } from 'vitest'
import { splitByCalendarYear, type PerDayEntry } from '../leave-duration-engine.js'

function perDay(date: string, days_charged: number): PerDayEntry {
  return {
    date,
    day_of_week: 'Mon',
    is_holiday: false,
    is_weekly_off: false,
    is_sandwich: false,
    is_attendance_overlap: false,
    session: days_charged === 0 ? 'none' : 'full_day',
    days_charged,
    reason: '',
  }
}

describe('splitByCalendarYear', () => {
  it('same-year request → single bucket with the full day count', () => {
    const buckets = splitByCalendarYear(
      [perDay('2099-06-10', 1), perDay('2099-06-11', 1), perDay('2099-06-12', 1)],
      '2099-06-10', 3,
    )
    expect(buckets).toEqual([{ year: 2099, days: 3 }])
  })

  it('year-straddling request (Dec 29 – Jan 2) → two buckets, correctly split', () => {
    const buckets = splitByCalendarYear(
      [
        perDay('2099-12-29', 1), perDay('2099-12-30', 1), perDay('2099-12-31', 1),
        perDay('2100-01-01', 1), perDay('2100-01-02', 1),
      ],
      '2099-12-29', 5,
    )
    expect(buckets).toEqual([
      { year: 2099, days: 3 },
      { year: 2100, days: 2 },
    ])
  })

  it('zero-charge in-span days (holiday/weekoff) are excluded, not turned into empty buckets', () => {
    const buckets = splitByCalendarYear(
      [
        perDay('2099-12-31', 1),
        perDay('2100-01-01', 0), // holiday, not charged
        perDay('2100-01-02', 1),
      ],
      '2099-12-31', 2,
    )
    expect(buckets).toEqual([
      { year: 2099, days: 1 },
      { year: 2100, days: 1 },
    ])
  })

  it('missing per_day (legacy row) → single fallback bucket from fallbackDate/fallbackDays', () => {
    expect(splitByCalendarYear(null, '2099-03-15', 2)).toEqual([{ year: 2099, days: 2 }])
    expect(splitByCalendarYear(undefined, '2099-03-15', 2)).toEqual([{ year: 2099, days: 2 }])
  })

  it('empty per_day array → single fallback bucket', () => {
    expect(splitByCalendarYear([], '2099-03-15', 2)).toEqual([{ year: 2099, days: 2 }])
  })

  it('per_day present but every entry is zero-charge (e.g. all holidays) → falls back rather than an empty-bucket result', () => {
    const buckets = splitByCalendarYear(
      [perDay('2099-06-10', 0), perDay('2099-06-11', 0)],
      '2099-06-10', 0,
    )
    expect(buckets).toEqual([{ year: 2099, days: 0 }])
  })

  it('fractional (half-day) entries sum and round correctly within a bucket', () => {
    const buckets = splitByCalendarYear(
      [perDay('2099-06-10', 0.5), perDay('2099-06-11', 0.25)],
      '2099-06-10', 0.75,
    )
    expect(buckets).toEqual([{ year: 2099, days: 0.75 }])
  })

  it('buckets are returned sorted by year ascending', () => {
    const buckets = splitByCalendarYear(
      [perDay('2100-01-01', 1), perDay('2099-12-31', 1)],
      '2099-12-31', 2,
    )
    expect(buckets.map(b => b.year)).toEqual([2099, 2100])
  })
})
