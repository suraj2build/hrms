/**
 * LeaveEngine — central service for all leave-related business logic.
 *
 * Exports:
 *  - expandDateRange          pure date utility shared by leave.ts + roster-api.ts
 *  - shiftDate                pure date utility (advance / rewind a date by N days)
 *  - computeLeaveDays         compute calendar days + payable days (simple, no exclusions)
 *  - computeWorkingLeaveDays  exclude holidays + weekly-offs per employee shift (Step 5)
 *  - validateBalance          pre-approve balance check (prevents over-draw)
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import {
  resolveEmployeeOrgContext,
  getWeeklyOffDays,
  getHolidayDates,
  getLocalDayOfWeek,
  type HolidayRowWithDate,
} from './org-context.js'

// ── Pure date utilities ────────────────────────────────────────────────────

/**
 * Build an array of YYYY-MM-DD strings for every calendar day in [from, to]
 * inclusive.  Uses UTC noon to avoid DST boundary issues.
 */
export function expandDateRange(from: string, to: string): string[] {
  const dates: string[] = []
  const cur = new Date(`${from}T12:00:00.000Z`)
  const end = new Date(`${to}T12:00:00.000Z`)
  while (cur <= end) {
    dates.push(cur.toISOString().slice(0, 10))
    cur.setUTCDate(cur.getUTCDate() + 1)
  }
  return dates
}

/**
 * Advance (or rewind) a YYYY-MM-DD string by `n` days.
 * Positive n = forward, negative n = backward.
 */
export function shiftDate(dateStr: string, n: number): string {
  const d = new Date(`${dateStr}T12:00:00.000Z`)
  d.setUTCDate(d.getUTCDate() + n)
  return d.toISOString().slice(0, 10)
}

// ── Simple day computation ─────────────────────────────────────────────────

export interface LeaveDayResult {
  /** Total calendar days in the range (inclusive). Half-day = 0.5. */
  computed_days: number
  /** Days that count toward payroll.  Currently equals computed_days. */
  payable_days:  number
}

/**
 * Compute leave day counts for a date range (calendar days only, no exclusions).
 *
 * Use `computeWorkingLeaveDays` instead when you need to exclude holidays /
 * weekly offs per the employee's shift configuration.
 *
 * @param from     YYYY-MM-DD start (inclusive)
 * @param to       YYYY-MM-DD end (inclusive)
 * @param opts.halfDay  When true, treat the entire request as a 0.5-day leave
 */
export function computeLeaveDays(
  from: string,
  to:   string,
  opts?: { halfDay?: boolean },
): LeaveDayResult {
  const dates         = expandDateRange(from, to)
  const computed_days = opts?.halfDay ? 0.5 : dates.length
  const payable_days  = computed_days
  return { computed_days, payable_days }
}

// ── Working-day-aware day computation (Step 5) ────────────────────────────

export interface WorkingLeaveDayResult extends LeaveDayResult {
  /** Raw calendar days before exclusions (= to - from + 1) */
  calendar_days:     number
  /** Days removed because they fell on a public holiday */
  excluded_holidays: number
  /** Days removed because they fell on the employee's weekly off */
  excluded_weekly_offs: number
  /** YYYY-MM-DD strings of the days actually counted (for audit / UI) */
  counted_dates:     string[]
}

// ── Session-aware day computation (Phase 3) ──────────────────────────────────

export type LeaveSession = 'full_day' | 'first_half' | 'second_half' | 'hourly'

/**
 * Compute leave days taking session granularity into account.
 *  - full_day:   each calendar day counts as 1.0
 *  - first_half / second_half: the entire request counts as 0.5 (same-day half-day)
 *  - hourly:     computed_days = hoursRequested / stdShiftHours (default 8h shift)
 *
 * Falls back to computeLeaveDays({ halfDay }) when session is undefined.
 */
export function computeLeaveSession(
  from:           string,
  to:             string,
  session:        LeaveSession = 'full_day',
  hoursRequested?: number,
  stdShiftHours:  number = 8,
): LeaveDayResult {
  if (session === 'first_half' || session === 'second_half') {
    return { computed_days: 0.5, payable_days: 0.5 }
  }
  if (session === 'hourly') {
    const hours = hoursRequested ?? 0
    const computed_days = parseFloat((hours / stdShiftHours).toFixed(4))
    return { computed_days, payable_days: computed_days }
  }
  // full_day
  return computeLeaveDays(from, to)
}

/**
 * Compute working leave days for a date range, excluding:
 *  1. Public holidays declared in `holiday_calendar` for the tenant, filtered
 *     by the employee's site (site-scoped), work location (legacy location-
 *     scoped), or global (no site / location attached).
 *  2. Weekly-off days resolved from the employee's roster pattern.
 *     Precedence: employee roster → site default roster → [] (no exclusions).
 *     Note: shifts carry timing rules only; weekly_off_days on shifts is deprecated.
 *
 * Falls back gracefully when roster / holiday data is unavailable.
 *
 * @param opts.halfDay  When true and exactly one working day remains after
 *                      exclusions, returns 0.5 instead of 1.
 */
export async function computeWorkingLeaveDays(
  supabase:    SupabaseClient,
  tenantId:    string,
  employeeId:  string,
  from:        string,
  to:          string,
  opts?: { halfDay?: boolean },
): Promise<WorkingLeaveDayResult> {
  const allDates = expandDateRange(from, to)

  // ── Resolve org context (site, roster, location, timezone) ─────────────────
  // Use `from` as the reference date for context resolution
  const orgCtx = await resolveEmployeeOrgContext(supabase, tenantId, employeeId, from)

  // ── Fetch applicable holidays in the date range ─────────────────────────────
  // Optional (restricted/RH) holidays are not automatic days off — exclude them
  // so leave-day counting converges with payroll and leave-request-service.
  const { data: rawHolidays } = await supabase
    .from('holiday_calendar')
    .select('date, name, is_optional, site_id, location_id, holiday_group_id')
    .eq('tenant_id', tenantId)
    .gte('date', from)
    .lte('date', to)
    .eq('is_optional', false)

  const holidaySet = getHolidayDates(
    (rawHolidays ?? []) as HolidayRowWithDate[],
    orgCtx,
  )

  // ── Resolve weekly-off days using unified precedence ────────────────────────
  // Precedence: employee roster > site default roster > []
  // Shifts carry timing rules only; weekly_off_days on shifts is deprecated.
  const weeklyOffDays = getWeeklyOffDays(
    [],   // shift weekly_off_days deprecated — roster is the sole source
    orgCtx.emp_roster_weekly_off,
    orgCtx.site_default_roster_weekly_off,
  )

  // ── Apply exclusions ────────────────────────────────────────────────────────
  const counted: string[] = []
  let   excludedHolidays   = 0
  let   excludedWeeklyOffs = 0

  for (const d of allDates) {
    if (holidaySet.has(d)) {
      excludedHolidays++
      continue
    }
    // Resolve day-of-week in the SITE timezone (matches payroll/attendance engines)
    // rather than raw UTC, so tz-boundary dates don't land on the wrong day.
    const dow = getLocalDayOfWeek(d, orgCtx.site_timezone)
    if (weeklyOffDays.includes(dow)) {
      excludedWeeklyOffs++
      continue
    }
    counted.push(d)
  }

  const calendarDays  = allDates.length
  const workingCount  = counted.length
  const computed_days = opts?.halfDay && workingCount >= 1 ? 0.5 : workingCount
  const payable_days  = computed_days

  return {
    computed_days,
    payable_days,
    calendar_days:        calendarDays,
    excluded_holidays:    excludedHolidays,
    excluded_weekly_offs: excludedWeeklyOffs,
    counted_dates:        counted,
  }
}

// ── Half-day / session leave resolution ─────────────────────────────────────

export interface LeaveDayResolution {
  status:       'leave' | 'half_day' | 'present'
  day_fraction: number
  is_payable:   boolean
}

/**
 * Resolve the attendance_daily values for ONE leave day, honoring half-day
 * sessions and merging with any attendance already recorded for that date.
 *
 * Model (each day = 1.0):
 *   - leavePortion   = 0.5 for first_half/second_half, else 1.0
 *   - leavePayable   = leavePortion when the leave type is paid, else 0
 *   - workedPortion  = the part of the day the employee actually worked, taken
 *                      from the existing attendance row (only meaningful for a
 *                      half-day leave, where the other half may be worked)
 *   - day_fraction   = min(1, leavePayable + workedPortion)
 *
 * Examples:
 *   full paid leave                      → 1.0 payable (status 'leave')
 *   full unpaid leave                    → 0.0 (→ 1.0 LOP)
 *   half paid leave, worked other half   → 1.0 payable (status 'present')
 *   half paid leave, didn't work         → 0.5 payable, 0.5 LOP ('half_day')
 *   half unpaid leave, worked other half → 0.5 payable, 0.5 LOP ('half_day')
 */
export function resolveLeaveDayFraction(opts: {
  session:           LeaveSession
  isPaid:            boolean
  existingStatus?:   string | null
  existingFraction?: number | null
}): LeaveDayResolution {
  const isHalf       = opts.session !== 'full_day'
  const leavePortion = isHalf ? 0.5 : 1.0
  const leavePayable = opts.isPaid ? leavePortion : 0

  let workedPortion = 0
  if (isHalf) {
    const s = opts.existingStatus
    if (s === 'present' || s === 'late') {
      workedPortion = 0.5
    } else if (s === 'half_day') {
      workedPortion = Math.min(0.5, opts.existingFraction ?? 0.5)
    }
  }

  const day_fraction = Math.min(1.0, Math.round((leavePayable + workedPortion) * 100) / 100)
  const status = !isHalf
    ? 'leave'
    : (day_fraction >= 1.0 ? 'present' : 'half_day')

  return { status, day_fraction, is_payable: day_fraction > 0 }
}

// ── Balance validation ─────────────────────────────────────────────────────

export interface BalanceCheckResult {
  /** true = sufficient balance (or no balance row set = unlimited) */
  valid:          boolean
  /** Current stored balance in days.  0 when no row exists. */
  currentBalance: number
  /** Human-readable reason when valid = false */
  message?:       string
}

/**
 * Check whether an employee has sufficient leave balance before approving.
 *
 * Rules:
 *  - If no balance row exists for the employee + leave type + year, we treat
 *    it as "unlimited" (HR has not set a cap) and return valid = true.
 *  - If a row exists and balance < days, return valid = false with a message.
 *  - DB errors return valid = false so callers can surface a 500.
 *
 * NOTE: This does NOT mutate the balance.  Deduction still happens via the
 *       deduct_leave_balance() Postgres RPC after approval is committed.
 */
export async function validateBalance(
  supabase:    SupabaseClient,
  tenantId:    string,
  employeeId:  string,
  leaveTypeId: string,
  days:        number,
  year:        number,
): Promise<BalanceCheckResult> {
  const { data, error } = await supabase
    .from('employee_leave_balance')
    .select('balance')
    .eq('tenant_id',     tenantId)
    .eq('employee_id',   employeeId)
    .eq('leave_type_id', leaveTypeId)
    .eq('year',          year)
    .maybeSingle()

  if (error) {
    return {
      valid:          false,
      currentBalance: 0,
      message:        'Failed to fetch leave balance — please try again',
    }
  }

  // No balance row = HR has not set a limit → treat as unlimited
  if (!data) {
    return { valid: true, currentBalance: 0 }
  }

  const currentBalance = Number(data.balance)

  if (currentBalance < days) {
    return {
      valid: false,
      currentBalance,
      message:
        `Insufficient leave balance. ` +
        `Available: ${currentBalance} day(s), Requested: ${days} day(s).`,
    }
  }

  return { valid: true, currentBalance }
}
