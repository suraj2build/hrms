/**
 * work-session-engine.ts
 *
 * Attendance Session Intelligence & Temporal Ownership Engine.
 *
 * Responsible for:
 *   - Pairing raw IN/OUT punches into logical work sessions
 *   - Resolving the BUSINESS DATE that owns each session (cross-midnight aware)
 *   - Repairing incomplete sessions with shift-based estimates
 *   - Merging adjacent sessions separated by biometric-retry noise
 *   - Classifying daily attendance state (PRESENT, LATE, HALF_DAY, …)
 *   - Detecting compliance anomalies (missing punch, excessive OT, etc.)
 *   - Batch-building WorkSession payloads ready for upsert to work_sessions table
 *
 * Design constraints:
 *   - Pure functions have NO side effects and do NOT touch the database.
 *   - Database access is confined to the four async functions at the bottom.
 *   - No external date library dependencies — uses vanilla JS Date math only.
 *   - No `any` types except for raw Supabase query results (explicitly cast).
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import { localToUtc, utcToLocalDate as tzDateStr, fetchTenantTz } from './attendance-engine.js'

// ─────────────────────────────────────────────────────────────────────────────
// Exported types
// ─────────────────────────────────────────────────────────────────────────────

export type AttendanceState =
  | 'PRESENT'
  | 'LATE'
  | 'HALF_DAY'
  | 'ABSENT'
  | 'HOLIDAY'
  | 'WEEKLY_OFF'
  | 'WORKED_ON_OFF'
  | 'WORKED_ON_HOLIDAY'
  | 'INCOMPLETE_PUNCH'
  | 'MANUAL_REVIEW'
  | 'AUTO_REGULARIZED'

export type AnomalyType =
  | 'missing_punch'
  | 'excessive_ot'
  | 'insufficient_rest'
  | 'double_shift'
  | 'unauthorized_source'
  | 'suspicious_timing'
  | 'excessive_consecutive_days'
  | 'early_punch'
  | 'late_punch'
  | 'duplicate_punch'
  | 'cross_midnight_unresolved'

export interface PunchRecord {
  id: string
  employee_id: string
  punch_time: string          // ISO timestamp (UTC)
  punch_type: 'in' | 'out'
  source: string
  device_id?: string | null
  is_manual: boolean
  location?: { lat: number; lng: number } | null
}

export interface PairedSession {
  in_punch: PunchRecord
  out_punch: PunchRecord | null
  work_minutes: number | null
  is_complete: boolean
  is_cross_midnight: boolean
  attendance_date: string     // YYYY-MM-DD — business date that owns this session
  source: string
  compliance_flags?: Record<string, unknown>
}

export interface WorkSession {
  id?: string
  employee_id: string
  attendance_date: string
  session_start: string
  session_end: string | null
  work_minutes: number | null
  overtime_minutes: number
  late_minutes: number
  early_exit_minutes: number
  source: string
  source_punch_ids: string[]
  shift_id: string | null
  is_cross_midnight: boolean
  approval_status: 'auto' | 'pending' | 'approved' | 'rejected' | 'flagged'
  payroll_locked: boolean
  compliance_flags: Record<string, unknown>
}

export interface ShiftWindow {
  shift_id: string
  shift_name: string
  start_time: string          // HH:MM:SS
  end_time: string            // HH:MM:SS
  crosses_midnight: boolean
  shift_day_offset: number
  max_shift_span_hours: number
  grace_minutes: number
}

export interface SessionAnomaly {
  anomaly_type: AnomalyType
  severity: 'info' | 'warning' | 'critical'
  session_id?: string
  punch_ids: string[]
  detail: Record<string, unknown>
}

export interface DaySessionReport {
  employee_id: string
  date: string
  raw_punches: PunchRecord[]
  pairing_decisions: Array<{
    in_punch_id: string
    out_punch_id: string | null
    decision: string
    attendance_date: string
    is_cross_midnight: boolean
  }>
  sessions: PairedSession[]
  ownership_decision: {
    attendance_date: string
    payroll_month: string
    shift_id: string | null
    shift_name?: string
    is_cross_midnight: boolean
    ownership_source: 'shift_window' | 'punch_time' | 'default'
  }
  anomalies: SessionAnomaly[]
  attendance_state: AttendanceState
  state_reason: string
  work_minutes_total: number
  overtime_minutes: number
  late_minutes: number
  early_exit_minutes: number
}

// ─────────────────────────────────────────────────────────────────────────────
// Internal helpers — vanilla JS Date math, no external deps
// ─────────────────────────────────────────────────────────────────────────────

/** Format a Date object as YYYY-MM-DD using its UTC components. */
function toDateStringUTC(d: Date): string {
  const y = d.getUTCFullYear()
  const m = String(d.getUTCMonth() + 1).padStart(2, '0')
  const dd = String(d.getUTCDate()).padStart(2, '0')
  return `${y}-${m}-${dd}`
}

/** Format a Date object as YYYY-MM-DD in the tenant's local timezone. */
function toDateStringLocal(d: Date, tz: string): string {
  return tzDateStr(d, tz)
}

/** Hour/minute of a Date object as displayed in the tenant's local timezone. */
function localHourMinute(d: Date, tz: string): { hour: number; minute: number } {
  const formatted = new Intl.DateTimeFormat('sv-SE', {
    timeZone: tz,
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).format(d) // "HH:MM"
  const [hour, minute] = formatted.split(':').map(Number)
  return { hour, minute }
}

/**
 * Parse HH:MM:SS into { hours, minutes, seconds }.
 * Accepts HH:MM as well.
 */
function parseTimeStr(t: string): { hours: number; minutes: number; seconds: number } {
  const parts = t.split(':').map(Number)
  return {
    hours: parts[0] ?? 0,
    minutes: parts[1] ?? 0,
    seconds: parts[2] ?? 0,
  }
}

/**
 * Shift total duration in minutes (end_time − start_time, adjusted for crossing midnight).
 */
function shiftDurationMinutes(shift: ShiftWindow): number {
  const s = parseTimeStr(shift.start_time)
  const e = parseTimeStr(shift.end_time)
  const startMin = s.hours * 60 + s.minutes
  let endMin = e.hours * 60 + e.minutes
  if (shift.crosses_midnight && endMin <= startMin) {
    endMin += 1440 // add 24 h
  }
  return endMin - startMin
}

/**
 * Given a date string YYYY-MM-DD and the shift's end_time (HH:MM:SS),
 * return the UTC instant at which that shift's end falls.
 *
 * For non-cross-midnight: end is on the same calendar day.
 * For cross-midnight: end is on the next calendar day.
 */
function shiftEndUTC(attendanceDate: string, shift: ShiftWindow, tz: string): Date {
  const endLocalDate = shift.crosses_midnight ? nextDate(attendanceDate) : attendanceDate
  return localToUtc(endLocalDate, shift.end_time, tz)
}

/**
 * Given a date string YYYY-MM-DD and the shift's start_time, return the UTC
 * instant of that shift's start.
 */
function shiftStartUTC(attendanceDate: string, shift: ShiftWindow, tz: string): Date {
  return localToUtc(attendanceDate, shift.start_time, tz)
}

/** Difference in minutes between two ISO timestamps. Result may be negative. */
function diffMinutes(earlier: string, later: string): number {
  return (new Date(later).getTime() - new Date(earlier).getTime()) / 60_000
}

/** Add `minutes` to an ISO timestamp and return new ISO string. */
function addMinutesToISO(iso: string, minutes: number): string {
  return new Date(new Date(iso).getTime() + minutes * 60_000).toISOString()
}

/** Return YYYY-MM-DD of the day before the given YYYY-MM-DD string. */
function previousDate(dateStr: string): string {
  const d = new Date(`${dateStr}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() - 1)
  return toDateStringUTC(d)
}

/** Return YYYY-MM-DD of the day after the given YYYY-MM-DD string. */
function nextDate(dateStr: string): string {
  const d = new Date(`${dateStr}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + 1)
  return toDateStringUTC(d)
}

/** First date of a month given YYYY-MM. */
function monthStart(month: string): string {
  return `${month}-01`
}

/** Last date of a month given YYYY-MM (accounts for leap years). */
function monthEnd(month: string): string {
  const [y, m] = month.split('-').map(Number)
  const d = new Date(y, m, 0) // day 0 of next month = last day of this month
  return `${y}-${String(m).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

/** All YYYY-MM-DD dates in a month. */
function datesInMonth(month: string): string[] {
  const start = new Date(`${monthStart(month)}T00:00:00Z`)
  const end = new Date(`${monthEnd(month)}T00:00:00Z`)
  const dates: string[] = []
  const cur = new Date(start)
  while (cur <= end) {
    dates.push(toDateStringUTC(cur))
    cur.setUTCDate(cur.getUTCDate() + 1)
  }
  return dates
}

// ─────────────────────────────────────────────────────────────────────────────
// 1. resolveAttendanceBusinessDate
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Pure function.
 *
 * Returns the YYYY-MM-DD business date that OWNS a given punch for payroll
 * and attendance purposes.
 *
 * Rules:
 * - Non-cross-midnight shift (or no shift): return local calendar date of the punch.
 * - Cross-midnight shift: if the punch falls between 00:00 and the shift's end_time
 *   on the SAME calendar day, the business date is the PREVIOUS calendar day
 *   (the session started the night before and this punch is the tail end of it).
 */
export function resolveAttendanceBusinessDate(
  punchTime: string,
  shift: ShiftWindow | null,
  tz: string,
): string {
  const d = new Date(punchTime)
  const localDateStr = toDateStringLocal(d, tz)

  if (!shift || !shift.crosses_midnight) {
    return localDateStr
  }

  // Cross-midnight: check if punch is in the "tail" window (00:00 → shift end_time)
  const e = parseTimeStr(shift.end_time)
  const { hour: localHour, minute: localMinute } = localHourMinute(d, tz)
  const localTotalMin = localHour * 60 + localMinute
  const shiftEndMin = e.hours * 60 + e.minutes

  // If punch time (local clock) is between midnight and shift end, it belongs
  // to the PREVIOUS business date.
  if (localTotalMin < shiftEndMin) {
    return previousDate(localDateStr)
  }

  return localDateStr
}

// ─────────────────────────────────────────────────────────────────────────────
// 2. resolvePayrollOwnership
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Pure function.
 *
 * Returns the YYYY-MM payroll month that owns the given attendance date.
 * The business rule is simple: the payroll month is just the year-month of
 * the attendance date.  (Custom cut-off dates — e.g. "month closes on 25th" —
 * would be applied at the payroll-run level, not here.)
 */
export function resolvePayrollOwnership(attendanceDate: string): string {
  return attendanceDate.slice(0, 7) // YYYY-MM
}

// ─────────────────────────────────────────────────────────────────────────────
// 3. pairPunches
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Pure function.
 *
 * Pairs a flat list of raw punch records into logical work sessions.
 *
 * Algorithm:
 * 1. Sort punches ASC by punch_time.
 * 2. Deduplicate: same type within DEDUP_WINDOW_MS — keep first occurrence.
 * 3. Walk the sorted list with a state machine (expecting IN → OUT → IN → …).
 * 4. Cross-midnight: an IN before midnight paired with an OUT after midnight is
 *    one session — attendance_date = business date of the IN punch.
 * 5. Stray OUT with no prior open IN: skip (logged in returned compliance_flags).
 * 6. Unpaired IN at end of list: open session (out_punch = null, is_complete = false).
 */
export function pairPunches(punches: PunchRecord[], shift: ShiftWindow | null, tz: string): PairedSession[] {
  const DEDUP_WINDOW_MS = 3 * 60 * 1000 // 3 minutes

  // Step 1: sort ascending
  const sorted = [...punches].sort(
    (a, b) => new Date(a.punch_time).getTime() - new Date(b.punch_time).getTime(),
  )

  // Step 2: deduplicate same punch_type within window
  const deduped: PunchRecord[] = []
  for (const punch of sorted) {
    const last = [...deduped].reverse().find((p: PunchRecord) => p.punch_type === punch.punch_type)
    if (
      last &&
      Math.abs(new Date(punch.punch_time).getTime() - new Date(last.punch_time).getTime()) <
        DEDUP_WINDOW_MS
    ) {
      // duplicate — skip
      continue
    }
    deduped.push(punch)
  }

  // Step 3–6: pair IN → OUT
  const sessions: PairedSession[] = []
  let openIn: PunchRecord | null = null

  for (const punch of deduped) {
    if (punch.punch_type === 'in') {
      if (openIn !== null) {
        // Consecutive IN without OUT — close previous as incomplete
        const attendanceDate = resolveAttendanceBusinessDate(openIn.punch_time, shift, tz)
        sessions.push({
          in_punch: openIn,
          out_punch: null,
          work_minutes: null,
          is_complete: false,
          is_cross_midnight: false,
          attendance_date: attendanceDate,
          source: openIn.source,
          compliance_flags: { consecutive_in_without_out: true },
        })
      }
      openIn = punch
    } else {
      // punch_type === 'out'
      if (openIn === null) {
        // Stray OUT — skip; the caller can inspect via anomaly detection
        continue
      }
      const inDate = toDateStringLocal(new Date(openIn.punch_time), tz)
      const outDate = toDateStringLocal(new Date(punch.punch_time), tz)
      const isCrossMidnight = inDate !== outDate
      const attendanceDate = resolveAttendanceBusinessDate(openIn.punch_time, shift, tz)
      const workMin = Math.round(diffMinutes(openIn.punch_time, punch.punch_time))

      sessions.push({
        in_punch: openIn,
        out_punch: punch,
        work_minutes: workMin,
        is_complete: true,
        is_cross_midnight: isCrossMidnight,
        attendance_date: attendanceDate,
        source: openIn.source,
        compliance_flags: {},
      })
      openIn = null
    }
  }

  // Leftover open IN → incomplete session
  if (openIn !== null) {
    const attendanceDate = resolveAttendanceBusinessDate(openIn.punch_time, shift, tz)
    sessions.push({
      in_punch: openIn,
      out_punch: null,
      work_minutes: null,
      is_complete: false,
      is_cross_midnight: false,
      attendance_date: attendanceDate,
      source: openIn.source,
      compliance_flags: {},
    })
  }

  return sessions
}

// ─────────────────────────────────────────────────────────────────────────────
// 4. repairIncompletePunches
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Pure function.
 *
 * For sessions where out_punch is null, estimate an end time using the shift
 * schedule (if available) or the max_shift_span_hours cap.
 *
 * The session is NOT marked is_complete = true — it is still flagged as
 * estimated so downstream processes can distinguish it from confirmed data.
 */
export function repairIncompletePunches(
  sessions: PairedSession[],
  shift: ShiftWindow | null,
  fatigueRules?: Record<string, number> | null,
): PairedSession[] {
  return sessions.map((session) => {
    if (session.out_punch !== null) return session

    const maxHours = shift?.max_shift_span_hours ?? fatigueRules?.max_daily_hours ?? 12
    const capMinutes = maxHours * 60

    let estimatedMinutes: number
    if (shift) {
      const duration = shiftDurationMinutes(shift)
      estimatedMinutes = Math.min(duration, capMinutes)
    } else {
      // Default: 9-hour workday as a reasonable estimate
      estimatedMinutes = Math.min(540, capMinutes)
    }

    const estimatedEnd = addMinutesToISO(session.in_punch.punch_time, estimatedMinutes)

    return {
      ...session,
      work_minutes: estimatedMinutes,
      compliance_flags: {
        ...(session.compliance_flags ?? {}),
        estimated_out: true,
        reason: 'missing_out_punch',
        estimated_end_iso: estimatedEnd,
        cap_minutes: capMinutes,
      },
    }
  })
}

// ─────────────────────────────────────────────────────────────────────────────
// 5. mergeAdjacentSessions
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Pure function.
 *
 * Merges consecutive sessions of the same source type where the gap between
 * session_end and the next session_start is less than gapMinutes (default 5).
 *
 * This handles biometric retries: device rejects the first punch, employee
 * retries seconds later — the two sessions should be treated as one.
 *
 * On merge: keep first in_punch, last out_punch, sum work_minutes.
 */
export function mergeAdjacentSessions(
  sessions: PairedSession[],
  tz: string,
  gapMinutes = 5,
): PairedSession[] {
  if (sessions.length === 0) return sessions

  const sorted = [...sessions].sort(
    (a, b) =>
      new Date(a.in_punch.punch_time).getTime() - new Date(b.in_punch.punch_time).getTime(),
  )

  const merged: PairedSession[] = [sorted[0]]

  for (let i = 1; i < sorted.length; i++) {
    const current = sorted[i]
    const last = merged[merged.length - 1]

    // Only merge complete sessions of the same source on the same business date
    if (
      !last.is_complete ||
      !current.is_complete ||
      last.source !== current.source ||
      last.attendance_date !== current.attendance_date ||
      last.out_punch === null
    ) {
      merged.push(current)
      continue
    }

    const gapMs = gapMinutes * 60 * 1000
    const gap =
      new Date(current.in_punch.punch_time).getTime() -
      new Date(last.out_punch.punch_time).getTime()

    if (gap >= 0 && gap < gapMs) {
      // Merge: replace last with a combined session
      const combinedWorkMinutes = (last.work_minutes ?? 0) + (current.work_minutes ?? 0)
      const isCrossMidnight =
        toDateStringLocal(new Date(last.in_punch.punch_time), tz) !==
        toDateStringLocal(new Date(current.out_punch!.punch_time), tz)

      merged[merged.length - 1] = {
        ...last,
        out_punch: current.out_punch,
        work_minutes: combinedWorkMinutes,
        is_cross_midnight: isCrossMidnight,
        compliance_flags: {
          ...(last.compliance_flags ?? {}),
          merged_sessions: true,
          merged_count: ((last.compliance_flags?.merged_count as number) ?? 1) + 1,
        },
      }
    } else {
      merged.push(current)
    }
  }

  return merged
}

// ─────────────────────────────────────────────────────────────────────────────
// 6. determineAttendanceState
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Pure function.
 *
 * Applies the attendance state machine to produce the canonical status for a
 * single business day.
 */
export function determineAttendanceState(
  sessions: PairedSession[],
  isHoliday: boolean,
  isWeeklyOff: boolean,
  shift: ShiftWindow | null,
  expectedWorkMinutes: number,
  tz: string,
): {
  state: AttendanceState
  reason: string
  lateMinutes: number
  earlyExitMinutes: number
  overtimeMinutes: number
} {
  const completeSessions = sessions.filter((s) => s.is_complete)
  const totalWorkMinutes = completeSessions.reduce((sum, s) => sum + (s.work_minutes ?? 0), 0)
  const hasAnyWork = totalWorkMinutes > 0

  // ── Holiday / Weekly-off priority ──────────────────────────────────────────
  if (isHoliday) {
    if (hasAnyWork) {
      return {
        state: 'WORKED_ON_HOLIDAY',
        reason: 'Employee worked on a declared holiday',
        lateMinutes: 0,
        earlyExitMinutes: 0,
        overtimeMinutes: Math.max(0, totalWorkMinutes - expectedWorkMinutes),
      }
    }
    return {
      state: 'HOLIDAY',
      reason: 'Declared holiday with no attendance',
      lateMinutes: 0,
      earlyExitMinutes: 0,
      overtimeMinutes: 0,
    }
  }

  if (isWeeklyOff) {
    if (hasAnyWork) {
      return {
        state: 'WORKED_ON_OFF',
        reason: 'Employee worked on a weekly off day',
        lateMinutes: 0,
        earlyExitMinutes: 0,
        overtimeMinutes: Math.max(0, totalWorkMinutes - expectedWorkMinutes),
      }
    }
    return {
      state: 'WEEKLY_OFF',
      reason: 'Weekly off day with no attendance',
      lateMinutes: 0,
      earlyExitMinutes: 0,
      overtimeMinutes: 0,
    }
  }

  // ── No sessions ────────────────────────────────────────────────────────────
  if (sessions.length === 0) {
    return {
      state: 'ABSENT',
      reason: 'No punch records found for this day',
      lateMinutes: 0,
      earlyExitMinutes: 0,
      overtimeMinutes: 0,
    }
  }

  // ── All sessions incomplete (no OUT punches) ───────────────────────────────
  if (completeSessions.length === 0) {
    return {
      state: 'INCOMPLETE_PUNCH',
      reason: 'Punch records found but no complete IN/OUT pair',
      lateMinutes: 0,
      earlyExitMinutes: 0,
      overtimeMinutes: 0,
    }
  }

  // ── Compute deviations ─────────────────────────────────────────────────────
  let lateMinutes = 0
  let earlyExitMinutes = 0

  if (shift) {
    const firstSession = completeSessions.reduce((earliest, s) =>
      new Date(s.in_punch.punch_time) < new Date(earliest.in_punch.punch_time) ? s : earliest,
    )
    const lastSession = completeSessions.reduce((latest, s) =>
      new Date(s.out_punch!.punch_time) > new Date(latest.out_punch!.punch_time) ? s : latest,
    )

    // Late minutes: how many minutes AFTER (shift start + grace) did the first punch arrive?
    const shiftStartMs = shiftStartUTC(firstSession.attendance_date, shift, tz).getTime()
    const graceMs = (shift.grace_minutes ?? 0) * 60_000
    const firstPunchMs = new Date(firstSession.in_punch.punch_time).getTime()
    lateMinutes = Math.max(0, Math.round((firstPunchMs - (shiftStartMs + graceMs)) / 60_000))

    // Early exit: if less than 80% of shift was worked AND employee left before shift end
    if (totalWorkMinutes < expectedWorkMinutes * 0.8) {
      const shiftEndMs = shiftEndUTC(firstSession.attendance_date, shift, tz).getTime()
      const lastOutMs = new Date(lastSession.out_punch!.punch_time).getTime()
      earlyExitMinutes = Math.max(0, Math.round((shiftEndMs - lastOutMs) / 60_000))
    }
  }

  const overtimeMinutes = Math.max(0, totalWorkMinutes - expectedWorkMinutes)

  // ── State thresholds ───────────────────────────────────────────────────────
  const effectiveWork = expectedWorkMinutes > 0 ? expectedWorkMinutes : 480 // fallback 8 h

  if (totalWorkMinutes >= effectiveWork * 0.9) {
    const state: AttendanceState = lateMinutes > 0 ? 'LATE' : 'PRESENT'
    const reason =
      lateMinutes > 0
        ? `Employee present but arrived ${lateMinutes} min late`
        : 'Employee worked full shift'
    return { state, reason, lateMinutes, earlyExitMinutes, overtimeMinutes }
  }

  if (totalWorkMinutes >= effectiveWork * 0.5) {
    return {
      state: 'HALF_DAY',
      reason: `Employee worked ${totalWorkMinutes} min (${Math.round((totalWorkMinutes / effectiveWork) * 100)}% of shift)`,
      lateMinutes,
      earlyExitMinutes,
      overtimeMinutes,
    }
  }

  if (totalWorkMinutes > 0) {
    return {
      state: 'HALF_DAY',
      reason: `Minimal attendance — ${totalWorkMinutes} min worked, below 50% threshold`,
      lateMinutes,
      earlyExitMinutes,
      overtimeMinutes,
    }
  }

  return {
    state: 'ABSENT',
    reason: 'Sessions present but no work minutes recorded',
    lateMinutes: 0,
    earlyExitMinutes: 0,
    overtimeMinutes: 0,
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// 7. detectAttendanceAnomalies
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Pure function.
 *
 * Scans sessions against policy rules and returns all detected anomalies.
 */
export function detectAttendanceAnomalies(
  sessions: PairedSession[],
  prevDaySessions: PairedSession[],
  consecutiveWorkDays: number,
  fatigueRules: Record<string, number> | null,
  authorizedSources: string[],
): SessionAnomaly[] {
  const anomalies: SessionAnomaly[] = []

  const maxOtHours = fatigueRules?.max_ot_hours ?? 4
  const minRestHours = fatigueRules?.min_rest_hours ?? 8
  const maxConsecutive = fatigueRules?.max_consecutive_workdays ?? 6

  // ── missing_punch ──────────────────────────────────────────────────────────
  for (const session of sessions) {
    if (!session.is_complete) {
      anomalies.push({
        anomaly_type: 'missing_punch',
        severity: 'warning',
        punch_ids: [session.in_punch.id],
        detail: {
          in_punch_time: session.in_punch.punch_time,
          attendance_date: session.attendance_date,
        },
      })
    }
  }

  // ── excessive_ot ──────────────────────────────────────────────────────────
  for (const session of sessions) {
    const sessionWorkMin = session.work_minutes ?? 0
    const maxOtMinutes = maxOtHours * 60
    if (session.is_complete && sessionWorkMin > maxOtMinutes) {
      anomalies.push({
        anomaly_type: 'excessive_ot',
        severity: 'warning',
        punch_ids: [
          session.in_punch.id,
          ...(session.out_punch ? [session.out_punch.id] : []),
        ],
        detail: {
          work_minutes: sessionWorkMin,
          threshold_minutes: maxOtMinutes,
          excess_minutes: sessionWorkMin - maxOtMinutes,
        },
      })
    }
  }

  // ── insufficient_rest ─────────────────────────────────────────────────────
  const prevComplete = prevDaySessions.filter((s) => s.is_complete && s.out_punch)
  const todayComplete = sessions.filter((s) => s.is_complete)

  if (prevComplete.length > 0 && todayComplete.length > 0) {
    const lastPrevOut = prevComplete.reduce((latest, s) =>
      new Date(s.out_punch!.punch_time) > new Date(latest.out_punch!.punch_time) ? s : latest,
    )
    const firstTodayIn = todayComplete.reduce((earliest, s) =>
      new Date(s.in_punch.punch_time) < new Date(earliest.in_punch.punch_time) ? s : earliest,
    )

    const restMinutes = diffMinutes(lastPrevOut.out_punch!.punch_time, firstTodayIn.in_punch.punch_time)
    const minRestMinutes = minRestHours * 60

    if (restMinutes < minRestMinutes) {
      anomalies.push({
        anomaly_type: 'insufficient_rest',
        severity: 'critical',
        punch_ids: [firstTodayIn.in_punch.id],
        detail: {
          rest_minutes: Math.round(restMinutes),
          required_minutes: minRestMinutes,
          prev_day_out: lastPrevOut.out_punch!.punch_time,
          today_in: firstTodayIn.in_punch.punch_time,
        },
      })
    }
  }

  // ── double_shift ──────────────────────────────────────────────────────────
  const completeSessions = sessions.filter((s) => s.is_complete)
  if (completeSessions.length > 2) {
    anomalies.push({
      anomaly_type: 'double_shift',
      severity: 'warning',
      punch_ids: completeSessions.flatMap((s) => [
        s.in_punch.id,
        ...(s.out_punch ? [s.out_punch.id] : []),
      ]),
      detail: {
        session_count: completeSessions.length,
        threshold: 2,
      },
    })
  }

  // ── unauthorized_source ───────────────────────────────────────────────────
  if (authorizedSources.length > 0) {
    for (const session of sessions) {
      if (!authorizedSources.includes(session.source)) {
        anomalies.push({
          anomaly_type: 'unauthorized_source',
          severity: 'warning',
          punch_ids: [session.in_punch.id],
          detail: {
            source: session.source,
            authorized_sources: authorizedSources,
          },
        })
      }
    }
  }

  // ── suspicious_timing ─────────────────────────────────────────────────────
  // Punch before 04:00 local time is likely a device clock sync artefact
  for (const session of sessions) {
    const inLocal = new Date(session.in_punch.punch_time)
    if (inLocal.getHours() < 4) {
      anomalies.push({
        anomaly_type: 'suspicious_timing',
        severity: 'info',
        punch_ids: [session.in_punch.id],
        detail: {
          punch_time: session.in_punch.punch_time,
          local_hour: inLocal.getHours(),
          reason: 'Punch before 04:00 local — possible device clock error',
        },
      })
    }
  }

  // ── excessive_consecutive_days ────────────────────────────────────────────
  if (consecutiveWorkDays > maxConsecutive) {
    anomalies.push({
      anomaly_type: 'excessive_consecutive_days',
      severity: 'warning',
      punch_ids: [],
      detail: {
        consecutive_days: consecutiveWorkDays,
        threshold: maxConsecutive,
      },
    })
  }

  // ── cross_midnight_unresolved ─────────────────────────────────────────────
  for (const session of sessions) {
    if (session.is_cross_midnight && !session.out_punch) {
      anomalies.push({
        anomaly_type: 'cross_midnight_unresolved',
        severity: 'critical',
        punch_ids: [session.in_punch.id],
        detail: {
          in_punch_time: session.in_punch.punch_time,
          attendance_date: session.attendance_date,
        },
      })
    }
  }

  return anomalies
}

// ─────────────────────────────────────────────────────────────────────────────
// Internal: shift lookup (used by async functions)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Resolve shift for an employee on a given date.
 * Priority: shift_roster override → employee_shifts is_current → site default.
 * Returns null if no shift is assigned.
 */
async function resolveShiftForDate(
  supabase: SupabaseClient,
  tenantId: string,
  employeeId: string,
  dateStr: string,
): Promise<ShiftWindow | null> {
  // 1. Roster override (shift_roster assignments for the exact date)
  const { data: rosterRow } = await supabase
    .from('shift_roster')
    .select(
      `shift_id, shifts!inner(
        id, name, start_time, end_time, crosses_midnight,
        shift_day_offset, max_shift_span_hours, grace_minutes
      )`,
    )
    .eq('tenant_id', tenantId)
    .eq('employee_id', employeeId)
    .eq('date', dateStr)
    .maybeSingle()

  if (rosterRow) {
    const s = (rosterRow as Record<string, unknown>).shifts as Record<string, unknown>
    if (s) return mapShiftRow(s)
  }

  // 2. Current employee_shifts assignment
  const { data: empShiftRow } = await supabase
    .from('employee_shifts')
    .select(
      `shift_id, shifts!inner(
        id, name, start_time, end_time, crosses_midnight,
        shift_day_offset, max_shift_span_hours, grace_minutes
      )`,
    )
    .eq('tenant_id', tenantId)
    .eq('employee_id', employeeId)
    .eq('is_current', true)
    .lte('effective_from', dateStr)
    .order('effective_from', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (empShiftRow) {
    const s = (empShiftRow as Record<string, unknown>).shifts as Record<string, unknown>
    if (s) return mapShiftRow(s)
  }

  // 3. Site/department default shift (via employee → site → default_shift_id)
  // Both lookups below must also scope by tenant_id — without it, an
  // employee_id belonging to a different tenant (no tenant_id filter earlier
  // in the resolution chain would ever match, so this fallback is reached)
  // still resolves that other tenant's real site_id → real default shift,
  // leaking cross-tenant shift configuration into this tenant's reports.
  const { data: empRow } = await supabase
    .from('employees')
    .select('site_id, job_history!job_history_employee_id_fkey(department_id, is_current)')
    .eq('id', employeeId)
    .eq('tenant_id', tenantId)
    .maybeSingle()

  if (empRow) {
    const _jh = ((empRow as any).job_history ?? []).find((j: any) => j.is_current) ?? ((empRow as any).job_history ?? [])[0] ?? null
    ;(empRow as any).department_id = _jh?.department_id ?? null
    const ep = empRow as { site_id?: string; department_id?: string }
    if (ep.site_id) {
      const { data: siteRow } = await supabase
        .from('sites')
        .select(
          `default_shift_id, shifts!inner(
            id, name, start_time, end_time, crosses_midnight,
            shift_day_offset, max_shift_span_hours, grace_minutes
          )`,
        )
        .eq('id', ep.site_id)
        .eq('tenant_id', tenantId)
        .maybeSingle()

      if (siteRow) {
        const s = (siteRow as Record<string, unknown>).shifts as Record<string, unknown>
        if (s) return mapShiftRow(s)
      }
    }
  }

  return null
}

function mapShiftRow(row: Record<string, unknown>): ShiftWindow {
  return {
    shift_id: row.id as string,
    shift_name: row.name as string,
    start_time: row.start_time as string,
    end_time: row.end_time as string,
    crosses_midnight: (row.crosses_midnight as boolean) ?? false,
    shift_day_offset: (row.shift_day_offset as number) ?? 1,
    max_shift_span_hours: (row.max_shift_span_hours as number) ?? 12,
    grace_minutes: (row.grace_minutes as number) ?? 0,
  }
}

/**
 * Fetch raw punches for an employee within a time range (inclusive).
 */
async function fetchPunches(
  supabase: SupabaseClient,
  tenantId: string,
  employeeId: string,
  fromIso: string,
  toIso: string,
): Promise<PunchRecord[]> {
  // Source table is attendance_punch_logs; columns: punched_at, direction ('IN'/'OUT').
  const { data, error } = await supabase
    .from('attendance_punch_logs')
    .select('id, employee_id, punched_at, direction, source, device_id')
    .eq('tenant_id', tenantId)
    .eq('employee_id', employeeId)
    .gte('punched_at', fromIso)
    .lte('punched_at', toIso)
    .order('punched_at', { ascending: true })

  if (error) throw new Error(`fetchPunches: ${error.message}`)
  return (data ?? []).map((p: any): PunchRecord => ({
    id:          p.id,
    employee_id: p.employee_id,
    punch_time:  p.punched_at,
    punch_type:  p.direction === 'IN' ? 'in' : 'out',
    source:      p.source,
    device_id:   p.device_id ?? null,
    is_manual:   false,
    location:    null,
  }))
}

/**
 * Check if a date is a holiday for the employee's tenant/site.
 */
async function isHolidayDate(
  supabase: SupabaseClient,
  tenantId: string,
  dateStr: string,
): Promise<boolean> {
  const { count, error } = await supabase
    .from('holiday_calendar')
    .select('id', { count: 'exact', head: true })
    .eq('tenant_id', tenantId)
    .eq('date', dateStr)

  if (error) throw new Error(`isHolidayDate: ${error.message}`)
  return (count ?? 0) > 0
}

/**
 * Determine weekday (0=Sun … 6=Sat) and check against simple fixed weekly-off
 * rules.  Full roster-based weekly-off resolution lives in roster-calendar-engine.ts;
 * this is the lightweight inline version for the session report.
 */
function isDefaultWeeklyOff(dateStr: string, weeklyOffDays: number[]): boolean {
  const dow = new Date(`${dateStr}T12:00:00Z`).getUTCDay()
  return weeklyOffDays.includes(dow)
}

// ─────────────────────────────────────────────────────────────────────────────
// 8. buildDaySessionReport
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Async.  Builds a full DaySessionReport for one employee / one business date.
 *
 * Includes: raw punch fetch, shift resolution, pairing, repair, merge,
 * state classification and anomaly detection.
 */
export async function buildDaySessionReport(
  supabase: SupabaseClient,
  tenantId: string,
  employeeId: string,
  dateStr: string,
): Promise<DaySessionReport> {
  // Tenant-local timezone drives every shift/date boundary below — the server
  // process's own local time (or UTC) is not the tenant's local time.
  const tz = await fetchTenantTz(supabase, tenantId)

  // ── 1. Resolve shift ────────────────────────────────────────────────────────
  const shift = await resolveShiftForDate(supabase, tenantId, employeeId, dateStr)

  // ── 2. Fetch punches — include previous day for cross-midnight ───────────
  const prevDay = previousDate(dateStr)
  const dayAfter = nextDate(dateStr)
  const fromIso = `${prevDay}T00:00:00.000Z`
  const toIso = `${dayAfter}T23:59:59.999Z`
  const allPunches = await fetchPunches(supabase, tenantId, employeeId, fromIso, toIso)

  // Keep only punches whose business date resolves to dateStr
  const rawPunches = allPunches.filter(
    (p) => resolveAttendanceBusinessDate(p.punch_time, shift, tz) === dateStr,
  )

  // ── 3–5. Pair → repair → merge ─────────────────────────────────────────────
  const paired = pairPunches(rawPunches, shift, tz)

  // Fetch fatigue rules from roster (best effort)
  let fatigueRules: Record<string, number> | null = null
  try {
    const { data: rosterData } = await supabase
      .from('rosters')
      .select('fatigue_rules')
      .eq('tenant_id', tenantId)
      .maybeSingle()
    if (rosterData) {
      fatigueRules = (rosterData as { fatigue_rules?: Record<string, number> }).fatigue_rules ?? null
    }
  } catch {
    // non-fatal — proceed without fatigue rules
  }

  const repaired = repairIncompletePunches(paired, shift, fatigueRules)
  const sessions = mergeAdjacentSessions(repaired, tz)

  // ── 6. Holiday + weekly-off check ─────────────────────────────────────────
  const isHoliday = await isHolidayDate(supabase, tenantId, dateStr)
  // Default: Sat (6) + Sun (0) off if no roster config available
  const isWeeklyOff = isDefaultWeeklyOff(dateStr, [0, 6])

  // ── 7. Attendance state ────────────────────────────────────────────────────
  const shiftDurMin = shift ? shiftDurationMinutes(shift) : 480
  const stateResult = determineAttendanceState(
    sessions,
    isHoliday,
    isWeeklyOff,
    shift,
    shiftDurMin,
    tz,
  )

  // ── 8. Anomaly detection ──────────────────────────────────────────────────
  // Fetch previous day sessions for insufficient-rest check
  const prevPunches = allPunches.filter(
    (p) => resolveAttendanceBusinessDate(p.punch_time, shift, tz) === prevDay,
  )
  const prevPaired = pairPunches(prevPunches, shift, tz)
  const prevRepaired = repairIncompletePunches(prevPaired, shift, fatigueRules)
  const prevSessions = mergeAdjacentSessions(prevRepaired, tz)

  // Consecutive work days: simple DB count (last N calendar days with work_minutes > 0)
  let consecutiveWorkDays = 0
  try {
    const windowStart = (() => {
      const d = new Date(`${dateStr}T00:00:00Z`)
      d.setUTCDate(d.getUTCDate() - 30)
      return toDateStringUTC(d)
    })()
    const { data: recentDays } = await supabase
      .from('work_sessions')
      .select('attendance_date, work_minutes')
      .eq('tenant_id', tenantId)
      .eq('employee_id', employeeId)
      .gte('attendance_date', windowStart)
      .lt('attendance_date', dateStr)
      .gt('work_minutes', 0)
      .order('attendance_date', { ascending: false })

    if (recentDays) {
      // Count consecutive days going backwards from dateStr
      let cursor = previousDate(dateStr)
      const datesWithWork = new Set(
        (recentDays as Array<{ attendance_date: string }>).map((r) => r.attendance_date),
      )
      while (datesWithWork.has(cursor)) {
        consecutiveWorkDays++
        cursor = previousDate(cursor)
        if (consecutiveWorkDays > 60) break // safety cap
      }
    }
  } catch {
    // non-fatal
  }

  const anomalies = detectAttendanceAnomalies(
    sessions,
    prevSessions,
    consecutiveWorkDays,
    fatigueRules,
    ['biometric', 'mobile', 'manual', 'kiosk', 'import'],
  )

  // ── 9. Assemble report ─────────────────────────────────────────────────────
  const workMinutesTotal = sessions
    .filter((s) => s.is_complete)
    .reduce((sum, s) => sum + (s.work_minutes ?? 0), 0)

  const ownershipSource: 'shift_window' | 'punch_time' | 'default' = shift
    ? 'shift_window'
    : rawPunches.length > 0
    ? 'punch_time'
    : 'default'

  return {
    employee_id: employeeId,
    date: dateStr,
    raw_punches: rawPunches,
    pairing_decisions: sessions.map((s) => ({
      in_punch_id: s.in_punch.id,
      out_punch_id: s.out_punch?.id ?? null,
      decision: s.is_complete ? 'paired' : 'unpaired_in',
      attendance_date: s.attendance_date,
      is_cross_midnight: s.is_cross_midnight,
    })),
    sessions,
    ownership_decision: {
      attendance_date: dateStr,
      payroll_month: resolvePayrollOwnership(dateStr),
      shift_id: shift?.shift_id ?? null,
      shift_name: shift?.shift_name,
      is_cross_midnight: shift?.crosses_midnight ?? false,
      ownership_source: ownershipSource,
    },
    anomalies,
    attendance_state: stateResult.state,
    state_reason: stateResult.reason,
    work_minutes_total: workMinutesTotal,
    overtime_minutes: stateResult.overtimeMinutes,
    late_minutes: stateResult.lateMinutes,
    early_exit_minutes: stateResult.earlyExitMinutes,
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// 9. buildMonthSessionBatch
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Async.  Batch-builds WorkSession payloads for every day in a calendar month.
 *
 * Uses a single pre-fetch query for all punches in the month (+ 1 day buffer
 * for cross-midnight sessions).  No N+1 queries.
 *
 * Returns an array ready for bulk upsert into work_sessions.
 */
export async function buildMonthSessionBatch(
  supabase: SupabaseClient,
  tenantId: string,
  employeeId: string,
  month: string,
): Promise<WorkSession[]> {
  // Tenant-local timezone drives every shift/date boundary below.
  const tz = await fetchTenantTz(supabase, tenantId)

  // ── Pre-fetch shift ─────────────────────────────────────────────────────────
  const firstDay = monthStart(month)
  const shift = await resolveShiftForDate(supabase, tenantId, employeeId, firstDay)

  // ── Pre-fetch all punches (month + 1-day tail for cross-midnight) ─────────
  const rangeEnd = nextDate(monthEnd(month))
  const fromIso = `${previousDate(firstDay)}T00:00:00.000Z`
  const toIso = `${rangeEnd}T23:59:59.999Z`
  const allPunches = await fetchPunches(supabase, tenantId, employeeId, fromIso, toIso)

  // ── Pre-fetch holidays for the month ─────────────────────────────────────
  const { data: holidayRows, error: holidayErr } = await supabase
    .from('holiday_calendar')
    .select('date')
    .eq('tenant_id', tenantId)
    .gte('date', firstDay)
    .lte('date', monthEnd(month))

  if (holidayErr) throw new Error(`buildMonthSessionBatch: holiday fetch failed: ${holidayErr.message}`)

  const holidaySet = new Set<string>(
    ((holidayRows ?? []) as Array<{ date: string }>).map((h) => h.date),
  )

  // ── Fetch fatigue rules ───────────────────────────────────────────────────
  let fatigueRules: Record<string, number> | null = null
  try {
    const { data: rosterData } = await supabase
      .from('rosters')
      .select('fatigue_rules')
      .eq('tenant_id', tenantId)
      .maybeSingle()
    if (rosterData) {
      fatigueRules = (rosterData as { fatigue_rules?: Record<string, number> }).fatigue_rules ?? null
    }
  } catch {
    // non-fatal
  }

  // ── Group punches by business date ────────────────────────────────────────
  const punchesByDate = new Map<string, PunchRecord[]>()
  for (const punch of allPunches) {
    const bdate = resolveAttendanceBusinessDate(punch.punch_time, shift, tz)
    if (!punchesByDate.has(bdate)) punchesByDate.set(bdate, [])
    punchesByDate.get(bdate)!.push(punch)
  }

  // ── Build sessions for each day in the month ──────────────────────────────
  const dates = datesInMonth(month)
  const shiftDurMin = shift ? shiftDurationMinutes(shift) : 480
  const workSessions: WorkSession[] = []

  for (const dateStr of dates) {
    const dayPunches = punchesByDate.get(dateStr) ?? []
    const isHoliday = holidaySet.has(dateStr)
    const isWeeklyOff = isDefaultWeeklyOff(dateStr, [0, 6])

    const paired = pairPunches(dayPunches, shift, tz)
    const repaired = repairIncompletePunches(paired, shift, fatigueRules)
    const sessions = mergeAdjacentSessions(repaired, tz)

    const stateResult = determineAttendanceState(
      sessions,
      isHoliday,
      isWeeklyOff,
      shift,
      shiftDurMin,
      tz,
    )

    // Emit one WorkSession per paired session
    for (const session of sessions) {
      workSessions.push({
        employee_id: employeeId,
        attendance_date: dateStr,
        session_start: session.in_punch.punch_time,
        session_end: session.out_punch?.punch_time ?? null,
        work_minutes: session.work_minutes ?? null,
        overtime_minutes: stateResult.overtimeMinutes,
        late_minutes: stateResult.lateMinutes,
        early_exit_minutes: stateResult.earlyExitMinutes,
        source: session.source,
        source_punch_ids: [
          session.in_punch.id,
          ...(session.out_punch ? [session.out_punch.id] : []),
        ],
        shift_id: shift?.shift_id ?? null,
        is_cross_midnight: session.is_cross_midnight,
        approval_status: 'auto',
        payroll_locked: false,
        compliance_flags: session.compliance_flags ?? {},
      })
    }

    // If no sessions exist for the day, emit a placeholder only for work days
    if (sessions.length === 0 && !isHoliday && !isWeeklyOff) {
      workSessions.push({
        employee_id: employeeId,
        attendance_date: dateStr,
        session_start: `${dateStr}T00:00:00.000Z`,
        session_end: null,
        work_minutes: 0,
        overtime_minutes: 0,
        late_minutes: 0,
        early_exit_minutes: 0,
        source: 'biometric',
        source_punch_ids: [],
        shift_id: shift?.shift_id ?? null,
        is_cross_midnight: false,
        approval_status: 'auto',
        payroll_locked: false,
        compliance_flags: { absent: true },
      })
    }
  }

  return workSessions
}

// ─────────────────────────────────────────────────────────────────────────────
// 10. detectMonthAnomalies
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Async.  Scans persisted work_sessions for the month and surfaces anomalies.
 *
 * Checks:
 * - Consecutive work days across the whole month.
 * - Insufficient rest between consecutive days.
 * - Per-session anomalies (missing punch, excessive OT, etc.) re-evaluated
 *   from the stored session data.
 *
 * Returns a flat list of SessionAnomaly records ready for insert into
 * work_session_anomalies.
 */
export async function detectMonthAnomalies(
  supabase: SupabaseClient,
  tenantId: string,
  employeeId: string,
  month: string,
): Promise<SessionAnomaly[]> {
  // Fetch all sessions for the month
  const { data: rows, error } = await supabase
    .from('work_sessions')
    .select(
      'id, attendance_date, session_start, session_end, work_minutes, source, is_cross_midnight, compliance_flags',
    )
    .eq('tenant_id', tenantId)
    .eq('employee_id', employeeId)
    .gte('attendance_date', monthStart(month))
    .lte('attendance_date', monthEnd(month))
    .order('attendance_date', { ascending: true })
    .order('session_start', { ascending: true })

  if (error) throw new Error(`detectMonthAnomalies: ${error.message}`)

  type StoredSession = {
    id: string
    attendance_date: string
    session_start: string
    session_end: string | null
    work_minutes: number | null
    source: string
    is_cross_midnight: boolean
    compliance_flags: Record<string, unknown>
  }

  const sessions = (rows ?? []) as StoredSession[]

  // Group by attendance_date
  const byDate = new Map<string, StoredSession[]>()
  for (const s of sessions) {
    if (!byDate.has(s.attendance_date)) byDate.set(s.attendance_date, [])
    byDate.get(s.attendance_date)!.push(s)
  }

  // Fetch fatigue rules once
  let fatigueRules: Record<string, number> | null = null
  try {
    const { data: rosterData } = await supabase
      .from('rosters')
      .select('fatigue_rules')
      .eq('tenant_id', tenantId)
      .maybeSingle()
    if (rosterData) {
      fatigueRules = (rosterData as { fatigue_rules?: Record<string, number> }).fatigue_rules ?? null
    }
  } catch {
    // non-fatal
  }

  const maxOtHours = fatigueRules?.max_ot_hours ?? 4
  const minRestHours = fatigueRules?.min_rest_hours ?? 8
  const maxConsecutive = fatigueRules?.max_consecutive_workdays ?? 6
  const maxOtMinutes = maxOtHours * 60
  const minRestMinutes = minRestHours * 60

  const anomalies: SessionAnomaly[] = []
  const dates = datesInMonth(month)

  let consecutiveWorkDays = 0
  let prevDateLastOut: string | null = null

  for (const dateStr of dates) {
    const daySessions = byDate.get(dateStr) ?? []
    const hasWork = daySessions.some((s) => (s.work_minutes ?? 0) > 0)

    if (hasWork) {
      consecutiveWorkDays++
    } else {
      consecutiveWorkDays = 0
      prevDateLastOut = null
      continue
    }

    // Sort by session_start
    const sorted = [...daySessions].sort(
      (a, b) => new Date(a.session_start).getTime() - new Date(b.session_start).getTime(),
    )

    // ── Insufficient rest from previous day ─────────────────────────────────
    if (prevDateLastOut !== null) {
      const firstIn = sorted[0]?.session_start
      if (firstIn) {
        const restMin = diffMinutes(prevDateLastOut, firstIn)
        if (restMin < minRestMinutes) {
          anomalies.push({
            anomaly_type: 'insufficient_rest',
            severity: 'critical',
            punch_ids: [],
            detail: {
              date: dateStr,
              rest_minutes: Math.round(restMin),
              required_minutes: minRestMinutes,
              prev_out: prevDateLastOut,
              today_in: firstIn,
            },
          })
        }
      }
    }

    // ── Excessive consecutive days ──────────────────────────────────────────
    if (consecutiveWorkDays > maxConsecutive) {
      anomalies.push({
        anomaly_type: 'excessive_consecutive_days',
        severity: 'warning',
        punch_ids: [],
        detail: {
          date: dateStr,
          consecutive_days: consecutiveWorkDays,
          threshold: maxConsecutive,
        },
      })
    }

    // ── Per-session checks ──────────────────────────────────────────────────
    const completeSessions = sorted.filter((s) => s.session_end !== null)

    // Double shift
    if (completeSessions.length > 2) {
      anomalies.push({
        anomaly_type: 'double_shift',
        severity: 'warning',
        punch_ids: [],
        detail: {
          date: dateStr,
          session_count: completeSessions.length,
          session_ids: completeSessions.map((s) => s.id),
        },
      })
    }

    for (const session of sorted) {
      // Missing punch (no session_end)
      if (session.session_end === null) {
        anomalies.push({
          anomaly_type: 'missing_punch',
          severity: 'warning',
          session_id: session.id,
          punch_ids: [],
          detail: {
            date: dateStr,
            session_start: session.session_start,
            compliance_flags: session.compliance_flags,
          },
        })
      }

      // Excessive OT
      if (session.session_end !== null && (session.work_minutes ?? 0) > maxOtMinutes) {
        anomalies.push({
          anomaly_type: 'excessive_ot',
          severity: 'warning',
          session_id: session.id,
          punch_ids: [],
          detail: {
            date: dateStr,
            work_minutes: session.work_minutes,
            threshold_minutes: maxOtMinutes,
            excess_minutes: (session.work_minutes ?? 0) - maxOtMinutes,
          },
        })
      }

      // Cross-midnight unresolved
      if (session.is_cross_midnight && session.session_end === null) {
        anomalies.push({
          anomaly_type: 'cross_midnight_unresolved',
          severity: 'critical',
          session_id: session.id,
          punch_ids: [],
          detail: {
            date: dateStr,
            session_start: session.session_start,
          },
        })
      }
    }

    // Track last session_end for next-day rest check
    const lastComplete = sorted.filter((s) => s.session_end !== null).pop()
    prevDateLastOut = lastComplete?.session_end ?? null
  }

  return anomalies
}
