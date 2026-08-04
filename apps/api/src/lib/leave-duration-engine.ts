/**
 * Leave Duration Engine — v1
 *
 * THE single authoritative source for leave duration computation.
 * ALL leave requests MUST resolve through this engine.
 * NO frontend duration calculation is permitted.
 * NO duplicated attendance logic.
 *
 * Responsibilities:
 *   • Session-aware duration calculation (full/first_half/second_half/hourly)
 *   • Start-session and end-session handling for multi-day requests
 *   • Holiday handling (skip/include/block) per policy
 *   • Weekoff handling (skip/include/sandwich_only) per policy
 *   • Sandwich calculation (include/exclude/block) per policy
 *   • Attendance overlap detection (prevents double-counting)
 *   • Hourly → fractional days conversion
 *   • Payroll-safe rounding with configurable precision
 *   • Per-day audit trail for every calendar day in the span
 *   • Human-readable policy explanation steps
 *   • Engine versioning for replay safety
 */

export const ENGINE_VERSION = 'v1' as const

// ── Public types ──────────────────────────────────────────────────────────────

export type LeaveSession =
  | 'full_day'
  | 'first_half'
  | 'second_half'
  | 'hourly'

export type RoundingMode =
  | 'half_up'
  | 'half_down'
  | 'ceil'
  | 'floor'
  | 'nearest_0_5'
  | 'nearest_0_25'

export type SandwichMode = 'include' | 'exclude' | 'block'

export type HolidaySessionHandling = 'skip' | 'include' | 'block'
export type WeekoffSessionHandling = 'skip' | 'include' | 'sandwich_only'

/** Input: the leave span the employee is requesting. */
export interface LeaveSessionSpan {
  start_date:       string        // YYYY-MM-DD
  start_session:    LeaveSession
  end_date:         string        // YYYY-MM-DD
  end_session:      LeaveSession
  requested_hours?: number        // Required when start_session='hourly'
}

/** Input: per-calendar-day context, resolved from attendance + holiday calendars. */
export interface DayContext {
  date:           string   // YYYY-MM-DD
  is_holiday:     boolean
  is_weekly_off:  boolean
  holiday_name?:  string
  shift_hours?:   number   // Override per-day shift hours (for shift_aware mode)
  has_attendance?: boolean // True if employee has an approved attendance record this day
  attendance_session?: 'full_day' | 'first_half' | 'second_half' | null
}

/** Policy rules that govern duration calculation. */
export interface DurationPolicy {
  // Session permissions
  allow_half_day:               boolean
  allow_hourly_leave:           boolean
  allow_cross_session:          boolean
  allow_mixed_sessions:         boolean
  minimum_leave_unit:           number   // 0.25 | 0.5 | 1.0
  maximum_sessions_per_day:     number

  // Calculation mode
  session_calculation_mode:     'standard' | 'shift_aware' | 'attendance_aware'

  // Collision handling
  sandwich_mode:                SandwichMode
  sandwich_session_handling:    'full_day' | 'prorate' | 'exclude'
  holiday_session_handling:     HolidaySessionHandling
  weekoff_session_handling:     WeekoffSessionHandling
  collision_on_holiday:         'block' | 'allow' | 'convert_to_holiday'
  collision_on_weekly_off:      'block' | 'allow' | 'convert_to_weekly_off'

  // Rounding
  fractional_rounding_mode:     RoundingMode
  maximum_fractional_precision: number   // 0.25 | 0.5 | 1.0

  // Shift
  hours_per_shift:              number   // Default shift hours (denominator for hourly)
}

/** Per-day breakdown entry in the audit trail. */
export interface PerDayEntry {
  date:             string
  day_of_week:      string   // 'Mon' | 'Tue' | ... | 'Sun'
  is_holiday:       boolean
  is_weekly_off:    boolean
  is_sandwich:      boolean
  is_attendance_overlap: boolean
  session:          'full_day' | 'first_half' | 'second_half' | 'none'
  days_charged:     number   // 0 | 0.25 | 0.5 | 1.0
  reason:           string   // Human-readable explanation for this day
}

/** Aggregated breakdown for storage in duration_breakdown JSONB. */
export interface DurationBreakdown {
  working_days:          number   // Days charged from working days
  holidays:              number   // Holiday days in span (counted, not charged unless include)
  weekoffs:              number   // Weekly off days in span (counted, not charged unless include)
  sandwich_days:         number   // Sandwich days included by policy
  attendance_overlap:    number   // Days with existing attendance (not double-counted)
  hourly_equivalent:     number   // For hourly requests: hours/shift_hours
  fractional_adjustment: number   // Rounding delta
  per_day:               PerDayEntry[]
}

/** Complete result from the duration engine. */
export interface DurationResult {
  calculated_days:   number          // Final engine output, payroll-safe rounded
  raw_days:          number          // Pre-rounding total
  breakdown:         DurationBreakdown
  precision:         number          // Effective precision used
  is_valid:          boolean
  errors:            string[]        // Block-level errors (calculation cannot proceed)
  warnings:          string[]        // Non-blocking issues to surface to approver
  policy_applied:    string          // Which engine path was used
  explain:           string[]        // Ordered human-readable explanation steps
  engine_version:    string
}

// ── Default (permissive) policy — used when no policy is resolved ─────────────

export const DEFAULT_POLICY: DurationPolicy = {
  allow_half_day:               true,
  allow_hourly_leave:           false,
  allow_cross_session:          true,
  allow_mixed_sessions:         false,
  minimum_leave_unit:           0.5,
  maximum_sessions_per_day:     2,
  session_calculation_mode:     'standard',
  sandwich_mode:                'exclude',
  sandwich_session_handling:    'full_day',
  holiday_session_handling:     'skip',
  weekoff_session_handling:     'skip',
  collision_on_holiday:         'allow',
  collision_on_weekly_off:      'allow',
  fractional_rounding_mode:     'nearest_0_5',
  maximum_fractional_precision: 0.5,
  hours_per_shift:              8,
}

// ── Internal helpers ──────────────────────────────────────────────────────────

const DOW_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

function getDow(date: string): string {
  return DOW_SHORT[new Date(`${date}T12:00:00Z`).getUTCDay()]
}

/**
 * Determine how many days a session contributes on the start day vs end day.
 *
 * Start-day semantics:
 *   full_day   → 1.0 (leave covers the whole first day)
 *   first_half → 1.0 (leave starts from AM — full day from the start)
 *   second_half→ 0.5 (employee works morning, leave starts PM)
 *
 * End-day semantics:
 *   full_day   → 1.0 (leave covers the whole last day)
 *   second_half→ 1.0 (leave ends at EOD — full last day)
 *   first_half → 0.5 (leave ends at noon, employee works PM)
 */
function startDayMultiplier(session: LeaveSession): number {
  if (session === 'second_half') return 0.5
  return 1.0  // full_day and first_half → full first day
}

function endDayMultiplier(session: LeaveSession): number {
  if (session === 'first_half') return 0.5
  return 1.0  // full_day and second_half → full last day
}

/**
 * Payroll-safe rounding with configurable mode.
 * Precision is the step size (0.25, 0.5, 1.0).
 */
function roundToPrecision(value: number, mode: RoundingMode, precision: number): number {
  if (precision <= 0 || precision > 1) precision = 0.5
  const factor = 1 / precision
  switch (mode) {
    case 'ceil':         return Math.ceil(value * factor) / factor
    case 'floor':        return Math.floor(value * factor) / factor
    case 'nearest_0_25': return Math.round(value * 4) / 4
    case 'nearest_0_5':  return Math.round(value * 2) / 2
    case 'half_down':    return Math.floor(value * factor + 0.5 - Number.EPSILON) / factor
    case 'half_up':
    default:             return Math.round(value * factor) / factor
  }
}

function emptyBreakdown(): DurationBreakdown {
  return {
    working_days: 0, holidays: 0, weekoffs: 0, sandwich_days: 0,
    attendance_overlap: 0, hourly_equivalent: 0, fractional_adjustment: 0,
    per_day: [],
  }
}

// ── Main computation entry point ──────────────────────────────────────────────

/**
 * computeLeaveDuration — the engine's public API.
 *
 * @param span    - The leave span being requested
 * @param dayInfo - Per-day context (holiday calendar + attendance data)
 * @param policy  - Effective policy rules for this employee+leave_type
 * @returns       - DurationResult with calculated_days, breakdown, explain
 *
 * The caller is responsible for resolving dayInfo and policy before calling.
 * The engine is pure: it performs no I/O.
 */
export function computeLeaveDuration(
  span:    LeaveSessionSpan,
  dayInfo: DayContext[],
  policy:  DurationPolicy = DEFAULT_POLICY,
): DurationResult {
  const errors:   string[] = []
  const warnings: string[] = []
  const explain:  string[] = []

  // ── Gate: policy permission checks ────────────────────────────────────────

  const isHalfDaySession =
    span.start_session === 'first_half'  || span.start_session === 'second_half' ||
    span.end_session   === 'first_half'  || span.end_session   === 'second_half'

  const isHourly = span.start_session === 'hourly'

  if (isHalfDaySession && !policy.allow_half_day) {
    errors.push('Half-day leave not permitted by policy for this leave type.')
  }

  if (isHourly && !policy.allow_hourly_leave) {
    errors.push('Hourly leave not permitted by policy for this leave type.')
  }

  // Cross-session: start and end sessions differ across a multi-day span
  const isCrossSession = dayInfo.length > 1 && (
    span.start_session !== span.end_session ||
    span.start_session !== 'full_day'
  )
  if (isCrossSession && !policy.allow_cross_session) {
    errors.push('Cross-session leave (different start/end sessions across days) is not permitted by policy.')
  }

  if (errors.length > 0) {
    return {
      calculated_days: 0, raw_days: 0,
      breakdown: emptyBreakdown(), precision: policy.maximum_fractional_precision,
      is_valid: false, errors, warnings,
      policy_applied: 'blocked_by_policy',
      explain: errors, engine_version: ENGINE_VERSION,
    }
  }

  // ── Special path: hourly leave ─────────────────────────────────────────────

  if (isHourly) {
    const hours       = span.requested_hours ?? 0
    const shiftHours  = policy.hours_per_shift || 8
    if (hours <= 0) {
      errors.push('Hourly leave requires requested_hours > 0.')
      return {
        calculated_days: 0, raw_days: 0,
        breakdown: emptyBreakdown(), precision: 2,
        is_valid: false, errors, warnings,
        policy_applied: 'hourly_engine',
        explain, engine_version: ENGINE_VERSION,
      }
    }

    const rawDays = hours / shiftHours
    const rounded = roundToPrecision(rawDays, policy.fractional_rounding_mode, policy.maximum_fractional_precision)
    const fracAdj = parseFloat((rounded - rawDays).toFixed(4))

    explain.push(`Hourly leave: ${hours}h ÷ ${shiftHours}h/shift = ${rawDays.toFixed(4)} raw days`)
    explain.push(`Rounding (${policy.fractional_rounding_mode}, precision=${policy.maximum_fractional_precision}): ${rawDays.toFixed(4)} → ${rounded} days`)
    explain.push(`Final: ${rounded} day(s) charged`)

    if (rounded < policy.minimum_leave_unit) {
      warnings.push(`Calculated ${rounded} days is below the minimum leave unit (${policy.minimum_leave_unit} days). The request will be treated as ${policy.minimum_leave_unit} day(s).`)
    }

    const bd: DurationBreakdown = {
      working_days: rounded, holidays: 0, weekoffs: 0,
      sandwich_days: 0, attendance_overlap: 0,
      hourly_equivalent: rawDays, fractional_adjustment: fracAdj, per_day: [],
    }
    return {
      calculated_days: rounded, raw_days: rawDays, breakdown: bd,
      precision: policy.maximum_fractional_precision,
      is_valid: true, errors: [], warnings,
      policy_applied: 'hourly_engine', explain, engine_version: ENGINE_VERSION,
    }
  }

  // ── Standard / shift-aware / attendance-aware path ────────────────────────

  const sortedDays = [...dayInfo].sort((a, b) => a.date.localeCompare(b.date))
  const n          = sortedDays.length

  explain.push(`=== Leave Duration Engine (${ENGINE_VERSION}) ===`)
  explain.push(`Span: ${span.start_date} [${span.start_session}] → ${span.end_date} [${span.end_session}]`)
  explain.push(`Policy: sandwich=${policy.sandwich_mode}, holiday=${policy.holiday_session_handling}, weekoff=${policy.weekoff_session_handling}`)
  explain.push(`Rounding: ${policy.fractional_rounding_mode} (precision=${policy.maximum_fractional_precision})`)
  explain.push(`Days in span: ${n}`)
  explain.push('─────────────────────────────────────────────')

  let workingDays        = 0
  let holidayDays        = 0
  let weekoffDays        = 0
  let sandwichDays       = 0
  let attendanceOverlap  = 0

  const perDay: PerDayEntry[] = []

  for (let i = 0; i < n; i++) {
    const day    = sortedDays[i]
    const isFirst  = i === 0
    const isLast   = i === n - 1
    const isSingle = n === 1

    // Determine the session (full/half) that applies to this specific day
    let daySession: 'full_day' | 'first_half' | 'second_half' | 'none'
    let rawCharge: number

    if (isSingle) {
      // Single-day request — use start_session directly
      daySession = span.start_session as 'full_day' | 'first_half' | 'second_half'
      rawCharge  = daySession === 'full_day' ? 1.0 : 0.5
    } else if (isFirst) {
      const mult = startDayMultiplier(span.start_session)
      rawCharge  = mult
      daySession = mult < 1 ? 'second_half' : 'full_day'
    } else if (isLast) {
      const mult = endDayMultiplier(span.end_session)
      rawCharge  = mult
      daySession = mult < 1 ? 'first_half' : 'full_day'
    } else {
      // Middle day — always full day
      rawCharge  = 1.0
      daySession = 'full_day'
    }

    // ── Attendance overlap (attendance_aware mode) ────────────────────────
    if (policy.session_calculation_mode === 'attendance_aware' && day.has_attendance) {
      // If employee already has attendance for this session, don't double-charge
      const attendSess = day.attendance_session ?? 'full_day'
      if (attendSess === daySession || attendSess === 'full_day') {
        attendanceOverlap += rawCharge
        perDay.push({
          date: day.date, day_of_week: getDow(day.date),
          is_holiday: day.is_holiday, is_weekly_off: day.is_weekly_off,
          is_sandwich: false, is_attendance_overlap: true,
          session: 'none', days_charged: 0,
          reason: `Attendance record present (${attendSess}) — leave not double-charged`,
        })
        explain.push(`  ${day.date} [${getDow(day.date)}]: Attendance overlap (${attendSess}) → 0 days`)
        continue
      }
    }

    // ── Determine if this is a sandwich day ───────────────────────────────
    // A sandwich day = a non-working day (holiday or weekoff) that falls
    // between two leave days (not at start or end of span)
    const isNonWorking  = day.is_holiday || day.is_weekly_off
    const isSandwich    = isNonWorking && !isFirst && !isLast

    // ── Holiday handling ─────────────────────────────────────────────────
    if (day.is_holiday && !isSandwich) {
      switch (policy.holiday_session_handling) {
        case 'skip':
          holidayDays += rawCharge
          perDay.push({
            date: day.date, day_of_week: getDow(day.date),
            is_holiday: true, is_weekly_off: false,
            is_sandwich: false, is_attendance_overlap: false,
            session: 'none', days_charged: 0,
            reason: `Holiday (${day.holiday_name ?? 'Public Holiday'}) — skipped (holiday_session_handling=skip)`,
          })
          explain.push(`  ${day.date} [${getDow(day.date)}]: Holiday "${day.holiday_name ?? 'holiday'}" → skipped, 0 days charged`)
          continue

        case 'include':
          // Fall through to charge as normal working day
          explain.push(`  ${day.date} [${getDow(day.date)}]: Holiday "${day.holiday_name ?? 'holiday'}" — included by policy`)
          break

        case 'block':
          errors.push(`Leave span includes holiday on ${day.date} (${day.holiday_name ?? 'Public Holiday'}) — blocked by policy.`)
          continue
      }
    }

    // ── Weekoff handling ─────────────────────────────────────────────────
    if (day.is_weekly_off && !isSandwich) {
      switch (policy.weekoff_session_handling) {
        case 'skip':
          weekoffDays += rawCharge
          perDay.push({
            date: day.date, day_of_week: getDow(day.date),
            is_holiday: false, is_weekly_off: true,
            is_sandwich: false, is_attendance_overlap: false,
            session: 'none', days_charged: 0,
            reason: `Weekly off — skipped (weekoff_session_handling=skip)`,
          })
          explain.push(`  ${day.date} [${getDow(day.date)}]: Weekly off → skipped, 0 days charged`)
          continue

        case 'include':
          explain.push(`  ${day.date} [${getDow(day.date)}]: Weekly off — included by policy`)
          break

        case 'sandwich_only':
          // Only include if it's a sandwich day — handle below in sandwich section
          weekoffDays += rawCharge
          perDay.push({
            date: day.date, day_of_week: getDow(day.date),
            is_holiday: false, is_weekly_off: true,
            is_sandwich: false, is_attendance_overlap: false,
            session: 'none', days_charged: 0,
            reason: `Weekly off at span boundary — not charged (weekoff_session_handling=sandwich_only)`,
          })
          explain.push(`  ${day.date} [${getDow(day.date)}]: Weekly off at boundary — skipped, 0 days charged`)
          continue
      }
    }

    // ── Sandwich logic ────────────────────────────────────────────────────
    if (isSandwich) {
      const sandwichLabel = day.is_holiday
        ? `Holiday sandwich (${day.holiday_name ?? 'holiday'})`
        : 'Weekend sandwich'

      switch (policy.sandwich_mode) {
        case 'include': {
          // How many days to charge for the sandwiched non-working day
          let sandwichCharge: number
          switch (policy.sandwich_session_handling) {
            case 'prorate':
              // Charge proportional to surrounding sessions
              sandwichCharge = (startDayMultiplier(span.start_session) + endDayMultiplier(span.end_session)) / 2
              sandwichCharge = Math.min(1.0, sandwichCharge)
              break
            case 'exclude':
              sandwichCharge = 0
              break
            case 'full_day':
            default:
              sandwichCharge = 1.0
          }
          sandwichDays  += sandwichCharge
          workingDays   += sandwichCharge
          perDay.push({
            date: day.date, day_of_week: getDow(day.date),
            is_holiday: day.is_holiday, is_weekly_off: day.is_weekly_off,
            is_sandwich: true, is_attendance_overlap: false,
            session: sandwichCharge > 0 ? 'full_day' : 'none',
            days_charged: sandwichCharge,
            reason: `${sandwichLabel} — included by sandwich policy (${sandwichCharge} day)`,
          })
          explain.push(`  ${day.date} [${getDow(day.date)}]: ${sandwichLabel} → SANDWICH included = ${sandwichCharge} day(s)`)
          break
        }

        case 'exclude': {
          if (day.is_holiday) holidayDays += 1
          else weekoffDays += 1
          perDay.push({
            date: day.date, day_of_week: getDow(day.date),
            is_holiday: day.is_holiday, is_weekly_off: day.is_weekly_off,
            is_sandwich: true, is_attendance_overlap: false,
            session: 'none', days_charged: 0,
            reason: `${sandwichLabel} — excluded by sandwich policy (sandwich_mode=exclude)`,
          })
          explain.push(`  ${day.date} [${getDow(day.date)}]: ${sandwichLabel} → excluded, 0 days`)
          break
        }

        case 'block': {
          errors.push(`Leave span creates a sandwich with a ${day.is_holiday ? 'holiday' : 'weekend'} on ${day.date} — blocked by policy (sandwich_mode=block).`)
          continue
        }
      }
      continue  // sandwich days handled — do not fall through to normal charge
    }

    // ── Normal working day ────────────────────────────────────────────────
    workingDays += rawCharge
    perDay.push({
      date: day.date, day_of_week: getDow(day.date),
      is_holiday: day.is_holiday && policy.holiday_session_handling === 'include',
      is_weekly_off: day.is_weekly_off && policy.weekoff_session_handling === 'include',
      is_sandwich: false, is_attendance_overlap: false,
      session: daySession,
      days_charged: rawCharge,
      reason: `Working day — ${daySession} = ${rawCharge} day(s)`,
    })
    explain.push(`  ${day.date} [${getDow(day.date)}]: Working day (${daySession}) = ${rawCharge} day(s)`)
  }

  // ── Post-loop: validation and rounding ────────────────────────────────────

  explain.push('─────────────────────────────────────────────')
  explain.push(`Sub-total: working=${workingDays}, holidays_skipped=${holidayDays}, weekoffs_skipped=${weekoffDays}, sandwich_included=${sandwichDays}`)

  // Minimum leave unit check (before rounding)
  if (workingDays > 0 && workingDays < policy.minimum_leave_unit) {
    warnings.push(`Calculated ${workingDays} days is below the minimum leave unit (${policy.minimum_leave_unit} days).`)
    explain.push(`⚠ Below minimum leave unit (${policy.minimum_leave_unit} days) — warning raised.`)
  }

  // Payroll-safe rounding
  const rawTotal  = workingDays
  const rounded   = errors.length > 0 ? 0
    : roundToPrecision(rawTotal, policy.fractional_rounding_mode, policy.maximum_fractional_precision)
  const fracAdj   = parseFloat((rounded - rawTotal).toFixed(4))

  if (fracAdj !== 0) {
    explain.push(`Rounding (${policy.fractional_rounding_mode}, step=${policy.maximum_fractional_precision}): ${rawTotal} → ${rounded} days (adj=${fracAdj})`)
  }
  explain.push(`✓ Final calculated_days: ${rounded}`)

  const breakdown: DurationBreakdown = {
    working_days:       rawTotal,
    holidays:           holidayDays,
    weekoffs:           weekoffDays,
    sandwich_days:      sandwichDays,
    attendance_overlap: attendanceOverlap,
    hourly_equivalent:  0,
    fractional_adjustment: fracAdj,
    per_day:            perDay,
  }

  return {
    calculated_days:  rounded,
    raw_days:         rawTotal,
    breakdown,
    precision:        policy.maximum_fractional_precision,
    is_valid:         errors.length === 0 && rounded > 0,
    errors,
    warnings,
    policy_applied:   `${policy.session_calculation_mode}_engine_${ENGINE_VERSION}`,
    explain,
    engine_version:   ENGINE_VERSION,
  }
}

// ── Policy builder helpers ────────────────────────────────────────────────────

/**
 * Build a DurationPolicy from a resolved leave_policy_rules row.
 * Falls back to DEFAULT_POLICY fields for any missing columns.
 */
export function buildPolicyFromRule(rule: Record<string, unknown>): DurationPolicy {
  return {
    allow_half_day:               (rule.allow_half_day              as boolean) ?? DEFAULT_POLICY.allow_half_day,
    allow_hourly_leave:           (rule.allow_hourly_leave          as boolean) ?? DEFAULT_POLICY.allow_hourly_leave,
    allow_cross_session:          (rule.allow_cross_session         as boolean) ?? DEFAULT_POLICY.allow_cross_session,
    allow_mixed_sessions:         (rule.allow_mixed_sessions        as boolean) ?? DEFAULT_POLICY.allow_mixed_sessions,
    minimum_leave_unit:           Number(rule.minimum_leave_unit)               || DEFAULT_POLICY.minimum_leave_unit,
    maximum_sessions_per_day:     Number(rule.maximum_sessions_per_day)         || DEFAULT_POLICY.maximum_sessions_per_day,
    session_calculation_mode:     (rule.session_calculation_mode    as 'standard' | 'shift_aware' | 'attendance_aware') ?? DEFAULT_POLICY.session_calculation_mode,
    sandwich_mode:                (rule.sandwich_mode               as SandwichMode)                ?? DEFAULT_POLICY.sandwich_mode,
    sandwich_session_handling:    (rule.sandwich_session_handling   as 'full_day' | 'prorate' | 'exclude') ?? DEFAULT_POLICY.sandwich_session_handling,
    holiday_session_handling:     (rule.holiday_session_handling    as HolidaySessionHandling)      ?? DEFAULT_POLICY.holiday_session_handling,
    weekoff_session_handling:     (rule.weekoff_session_handling    as WeekoffSessionHandling)      ?? DEFAULT_POLICY.weekoff_session_handling,
    collision_on_holiday:         (rule.collision_on_holiday        as 'block' | 'allow' | 'convert_to_holiday') ?? DEFAULT_POLICY.collision_on_holiday,
    collision_on_weekly_off:      (rule.collision_on_weekly_off     as 'block' | 'allow' | 'convert_to_weekly_off') ?? DEFAULT_POLICY.collision_on_weekly_off,
    fractional_rounding_mode:     (rule.fractional_rounding_mode    as RoundingMode)                ?? DEFAULT_POLICY.fractional_rounding_mode,
    maximum_fractional_precision: Number(rule.maximum_fractional_precision)     || DEFAULT_POLICY.maximum_fractional_precision,
    hours_per_shift:              Number(rule.hours_per_shift)                  || DEFAULT_POLICY.hours_per_shift,
  }
}

/**
 * Build a DurationPolicy from a legacy leave_policies row.
 */
export function buildPolicyFromLegacy(row: Record<string, unknown>): DurationPolicy {
  return {
    ...DEFAULT_POLICY,
    allow_half_day:               (row.allow_half_day              as boolean) ?? true,
    allow_hourly_leave:           (row.allow_hourly_leave          as boolean) ?? false,
    minimum_leave_unit:           Number(row.minimum_leave_unit)               || 0.5,
    session_calculation_mode:     (row.session_calculation_mode    as 'standard' | 'shift_aware' | 'attendance_aware') ?? 'standard',
    sandwich_mode:                (row.sandwich_mode               as SandwichMode) ?? 'exclude',
    holiday_session_handling:     (row.holiday_session_handling    as HolidaySessionHandling) ?? 'skip',
    weekoff_session_handling:     (row.weekoff_session_handling    as WeekoffSessionHandling) ?? 'skip',
    collision_on_holiday:         (row.collision_on_holiday        as 'block' | 'allow' | 'convert_to_holiday') ?? 'allow',
    collision_on_weekly_off:      (row.collision_on_weekly_off     as 'block' | 'allow' | 'convert_to_weekly_off') ?? 'allow',
    fractional_rounding_mode:     (row.fractional_rounding_mode    as RoundingMode) ?? 'nearest_0_5',
    maximum_fractional_precision: Number(row.maximum_fractional_precision) || 0.5,
    hours_per_shift:              Number(row.hours_per_shift) || 8,
  }
}

// ── Day context builder ───────────────────────────────────────────────────────

/**
 * Build a date range array for the given span.
 * Returns dates in YYYY-MM-DD format, inclusive.
 */
export function buildDateRange(startDate: string, endDate: string): string[] {
  const dates: string[] = []
  const cur = new Date(`${startDate}T12:00:00Z`)
  const end = new Date(`${endDate}T12:00:00Z`)
  while (cur <= end) {
    dates.push(cur.toISOString().slice(0, 10))
    cur.setUTCDate(cur.getUTCDate() + 1)
  }
  return dates
}

/**
 * Classify a date as a weekoff based on tenant's week_off_days config.
 * Default: Saturday (6) and Sunday (0) are weekoffs.
 */
export function isDefaultWeekoff(date: string, weekOffDays: number[] = [0, 6]): boolean {
  const dow = new Date(`${date}T12:00:00Z`).getUTCDay()
  return weekOffDays.includes(dow)
}

// ── Validation helpers ────────────────────────────────────────────────────────

/** Validate session consistency before calling computeLeaveDuration. */
export function validateSessionSpan(span: LeaveSessionSpan): string[] {
  const errors: string[] = []

  if (span.start_date > span.end_date) {
    errors.push(`start_date (${span.start_date}) cannot be after end_date (${span.end_date}).`)
  }

  const isSingleDay = span.start_date === span.end_date
  if (isSingleDay) {
    // For single-day hourly: start_session must be hourly
    if (span.start_session === 'hourly' && !span.requested_hours) {
      errors.push('Hourly single-day leave requires requested_hours.')
    }
    // For single-day full sessions: end_session should match start or be full_day
    if (span.start_session !== 'hourly' && span.end_session !== 'full_day' && span.end_session !== span.start_session) {
      errors.push(`Single-day request: end_session (${span.end_session}) is inconsistent with start_session (${span.start_session}).`)
    }
  } else {
    // Multi-day: hourly session only allowed on single-day
    if (span.start_session === 'hourly' || span.end_session === 'hourly') {
      errors.push('Hourly leave is only supported for single-day requests.')
    }
    // first_half on start = "you start leave from morning" which is the same as full_day
    // — this is valid but unusual; emit a warning via the engine
  }

  return errors
}

// ── Year-boundary balance-bucket split (PEND-103) ───────────────────────────

export interface YearBucket {
  year: number
  days: number
}

/**
 * Group a leave request's per-day breakdown by calendar year, summing
 * days_charged within each year. A request that doesn't straddle Dec 31 →
 * Jan 1 still produces a single-element array — this is the general case,
 * not a special one.
 *
 * `employee_leave_balance`/`leave_accrual_ledger` are bucketed by CALENDAR
 * year only (`year INT NOT NULL DEFAULT EXTRACT(YEAR FROM CURRENT_DATE)`,
 * migration 036) — there is no fiscal-year concept anywhere in this engine,
 * so calendar-year grouping is the correct and only split needed.
 *
 * Falls back to a single bucket keyed on `fallbackDate`'s year, carrying
 * `fallbackDays`, when `perDay` is empty/missing — e.g. rows created before
 * the duration engine existed, or any future `duration_breakdown` shape gap.
 * This must never hard-fail approval for legacy data.
 */
export function splitByCalendarYear(
  perDay:        PerDayEntry[] | null | undefined,
  fallbackDate:  string,
  fallbackDays:  number,
): YearBucket[] {
  if (!perDay || perDay.length === 0) {
    return [{ year: new Date(fallbackDate).getFullYear(), days: fallbackDays }]
  }

  const byYear = new Map<number, number>()
  for (const entry of perDay) {
    if (!entry.days_charged) continue // holidays/weekly-offs/etc. charge 0 — skip, no bucket needed
    const year = Number(entry.date.slice(0, 4))
    byYear.set(year, (byYear.get(year) ?? 0) + entry.days_charged)
  }

  if (byYear.size === 0) {
    // Every day charged 0 (shouldn't happen for an approved/payable request,
    // but don't produce an empty bucket array — fall back rather than skip
    // the balance step entirely).
    return [{ year: new Date(fallbackDate).getFullYear(), days: fallbackDays }]
  }

  return [...byYear.entries()]
    .sort(([a], [b]) => a - b)
    .map(([year, days]) => ({ year, days: Math.round(days * 100) / 100 }))
}
