/**
 * standard-leave-types.ts
 *
 * Canonical best-practice leave-type library (India-first). Tenants can load
 * this set in one click to get a sensible starting point, then edit / add /
 * remove and configure quotas & accrual in Leave Policies.
 *
 * Note: leave_types carries the TYPE definition + session flags. Annual quota,
 * accrual frequency, carry-forward and encashment live in Leave Policies — set
 * those per type after loading. `is_paid=false` would model LWP/LOP.
 */

export interface StandardLeaveType {
  name:              string
  is_paid:           boolean
  allow_sandwich:    boolean
  allow_half_day:    boolean
  allow_hourly:      boolean
  max_hours_per_day: number | null
  /** Guidance only — shown in the seed description; not a DB column. */
  note:              string
}

export const STANDARD_LEAVE_TYPES: StandardLeaveType[] = [
  { name: 'Earned Leave',       is_paid: true, allow_sandwich: true,  allow_half_day: true,  allow_hourly: false, max_hours_per_day: null, note: 'EL / Privilege Leave — accrues, carry-forward & encashable (set in policy).' },
  { name: 'Casual Leave',       is_paid: true, allow_sandwich: false, allow_half_day: true,  allow_hourly: false, max_hours_per_day: null, note: 'CL — short notice; typically no carry-forward.' },
  { name: 'Sick Leave',        is_paid: true, allow_sandwich: false, allow_half_day: true,  allow_hourly: false, max_hours_per_day: null, note: 'SL — illness; may need a medical certificate beyond N days.' },
  { name: 'Maternity Leave',   is_paid: true, allow_sandwich: false, allow_half_day: false, allow_hourly: false, max_hours_per_day: null, note: 'ML — 26 weeks (Maternity Benefit Act); female employees.' },
  { name: 'Paternity Leave',   is_paid: true, allow_sandwich: false, allow_half_day: false, allow_hourly: false, max_hours_per_day: null, note: 'PL — typically 15 days; male employees.' },
  { name: 'Bereavement Leave', is_paid: true, allow_sandwich: false, allow_half_day: false, allow_hourly: false, max_hours_per_day: null, note: 'BL — death in immediate family; few days.' },
  { name: 'Compensatory Off',  is_paid: true, allow_sandwich: false, allow_half_day: true,  allow_hourly: false, max_hours_per_day: null, note: 'CO — credited for working a weekly-off/holiday (auto comp-off feeds this).' },
  { name: 'Special Leave',     is_paid: true, allow_sandwich: false, allow_half_day: true,  allow_hourly: false, max_hours_per_day: null, note: 'SPL — discretionary / marriage / exam etc.' },
]
