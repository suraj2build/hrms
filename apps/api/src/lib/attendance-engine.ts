/**
 * attendance-engine.ts
 *
 * Deterministic, canonical attendance computation service.
 *
 * Data source: attendance_punch_logs (migration 043).
 * Data sink:   attendance_daily (via upsertAttendanceDaily — the single writer).
 *
 * ── Timezone handling ──────────────────────────────────────────────────────────
 *
 * Shift times stored in the DB (shifts.start_time, shifts.end_time) are in the
 * TENANT'S LOCAL time, not UTC.  Punch timestamps (attendance_punch_logs.punched_at)
 * are TIMESTAMPTZ — always stored as UTC.
 *
 * The engine fetches the tenant's IANA timezone from tenants.timezone (migration 045,
 * default 'UTC') and uses it to:
 *
 *   1. Convert shift start/end local times → UTC for window arithmetic.
 *   2. Compute the shift-aware punch-fetch window correctly across DST transitions.
 *   3. Compute late-minutes against the real UTC instant of the shift start.
 *   4. Determine the shift-end fallback for unclosed IN punches in UTC.
 *
 * All of this is done with Node's built-in Intl API — zero external dependencies.
 *
 * ── Priority chain ─────────────────────────────────────────────────────────────
 *
 *   1. Approved leave                  → LEAVE
 *   2. Holiday, no punches             → HOLIDAY
 *   2b. Holiday + punches              → PRESENT, worked_on_holiday = true
 *   3. Weekly off, no punches          → WEEKLY_OFF
 *   3b. Weekly off + punches           → PRESENT, worked_on_weekly_off = true
 *   4. No punches at all               → ABSENT
 *   5. Punches present — thresholds:
 *        ≥ 75 % shift duration         → PRESENT (or LATE if arrived after grace)
 *        ≥ 50 % shift duration         → HALF_DAY
 *        < 50 % shift duration         → ABSENT
 *
 * ── Punch fetch window ─────────────────────────────────────────────────────────
 *
 *   With shift:    localShiftStart − 2 h  …  localShiftEnd + 4 h  (both in UTC)
 *                  Night shifts: localShiftEnd is on the NEXT calendar day.
 *   Without shift: local midnight of `date`  …  local 23:59:59 of `date+1`
 *
 * ── Unclosed IN fallback ───────────────────────────────────────────────────────
 *
 *   If the last IN punch has no matching OUT and the shift-end UTC instant is
 *   strictly after the check-in time, the session is closed at shift-end.
 *   Otherwise the unclosed session contributes 0 minutes.
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import { writeAuditLogs }                    from './attendance-processor.js'
import { eventService }                      from './event-service.js'
import { policyService, type AttendancePolicy, DEFAULT_POLICY } from './policy-service.js'
import { resolveEmployeeOrgContext, getWeeklyOffDays } from './org-context.js'
import { resolveIsWeeklyOff }                          from './roster-calendar-engine.js'
import { resolveViaRotationPolicy }                    from './rotation-engine.js'
import { generateCompOffRequests }                     from './comp-off-service.js'
import { resolveLeaveDayFraction }                      from './leave-engine.js'

// ── Constants ─────────────────────────────────────────────────────────────────

/** Used when no shift is assigned and no shift-aware duration is available. */
const DEFAULT_START_HOUR   = 9
const DEFAULT_SHIFT_HOURS  = 9
const DEFAULT_DURATION_MIN = DEFAULT_SHIFT_HOURS * 60

// ── Public types ──────────────────────────────────────────────────────────────

export type AttendanceStatus =
  | 'present'
  | 'absent'
  | 'half_day'
  | 'late'
  | 'leave'
  | 'holiday'
  | 'weekly_off'

/**
 * Ownership source for an attendance_daily row.
 *
 * 'engine'          — written by the automated attendance processing engine (default)
 * 'leave_approval'  — set by the leave-approval pipeline (PROTECTED from engine recompute)
 * 'regularization'  — set by an HR regularisation action
 * 'manual'          — set by a direct HR manual override (PROTECTED from engine recompute)
 *
 * The engine MUST NOT overwrite rows with source 'leave_approval' or 'manual'.
 * See recomputeRange for the enforcement filter.
 */
export type AttendanceComputedSource = 'engine' | 'leave_approval' | 'regularization' | 'manual'

/** DB-shaped row — exactly what is written to attendance_daily. */
export interface AttendanceDailyRecord {
  tenant_id:            string
  employee_id:          string
  date:                 string       // YYYY-MM-DD in TENANT local time
  status:               AttendanceStatus
  work_hours:           number
  late_minutes:         number
  overtime_minutes:     number
  is_payable:           boolean
  day_fraction:         number       // 0.0 | 0.5 | 1.0
  worked_on_weekly_off: boolean
  worked_on_holiday:    boolean
  /** Ownership: identifies the subsystem that last wrote this row. Default 'engine'. */
  computed_source:      AttendanceComputedSource
}

/**
 * Internal engine metadata — NOT written to attendance_daily, NOT exposed in
 * the API response.  Used by the anomaly detection layer before the row is
 * upserted.
 */
export interface AttendanceDailyMeta {
  /** Number of punch log entries within the fetch window. */
  punchesCount:    number
  /** True if the last IN punch in the session list has no OUT match. */
  hasUnpunchedOut: boolean
}

/**
 * Engine output — extends the DB record with a human-readable reason string
 * and internal metadata for anomaly detection.
 *
 * `reason` and `meta` are stripped before writing to attendance_daily.
 */
export interface AttendanceDaily extends AttendanceDailyRecord {
  reason: string
  meta:   AttendanceDailyMeta
}

// ── Anomaly types ──────────────────────────────────────────────────────────────

export type AnomalyType = 'missing_out' | 'no_punch' | 'late' | 'excessive_hours'
export type AnomalySeverity = 'low' | 'medium' | 'high'

export interface AttendanceAnomaly {
  tenant_id:   string
  employee_id: string
  date:        string   // YYYY-MM-DD
  type:        AnomalyType
  message:     string
  severity:    AnomalySeverity
}

export interface ComputeDayOpts {
  tenant_id:   string
  employee_id: string
  /** YYYY-MM-DD in the tenant's local timezone */
  date:        string
  /**
   * Pre-fetched IANA timezone string.  When provided, computeDay skips the
   * tenants DB query.  recomputeRange always supplies this to avoid N extra
   * round-trips.
   */
  tenantTz?:   string
  /**
   * Pre-fetched attendance policy for this employee.  When provided,
   * computeDay skips the policy DB queries.  recomputeRange always supplies
   * this to avoid N extra round-trips (one pre-fetch per employee per range).
   */
  policy?:     AttendancePolicy
}

export interface RecomputeRangeOpts {
  tenant_id:   string
  employee_id: string
  from_date:   string   // YYYY-MM-DD in tenant local time
  to_date:     string   // YYYY-MM-DD in tenant local time
  changed_by?: string | null
}

export interface RecomputeResult {
  rows_computed:  number
  rows_upserted:  number
  /** Dates skipped because existing rows have a protected computed_source (leave_approval | manual). */
  rows_protected: number
  dates:          string[]
}

export interface UpsertOpts {
  changed_by?: string | null
  source?:     'system' | 'regularisation' | 'leave'
  metadata?:   Record<string, unknown>
}

// ── Internal types ─────────────────────────────────────────────────────────────

interface ShiftMeta {
  startTime:     string    // "HH:MM:SS" — tenant local time
  endTime:       string    // "HH:MM:SS" — tenant local time
  graceMinutes:  number
  isNightShift:  boolean
  // NOTE: weeklyOffDays removed — shifts carry timing rules only.
  // Weekly-off days belong exclusively to Roster entities.
  durationMin:   number
}

interface PunchLog {
  id:         string
  punched_at: string   // ISO 8601 UTC
  direction:  'IN' | 'OUT'
  source:     string
}

interface PairedSession {
  checkIn:       Date
  checkOut:      Date | null
  complete:      boolean
  minutesWorked: number
}

interface PairResult {
  sessions:       PairedSession[]
  workedMinutes:  number       // sum of complete sessions, clamped to [0, 1440]
  firstInTime:    Date | null  // check-in of the first session (UTC Date)
  lastOutTime:    Date | null  // check-out of the last complete session (UTC Date)
  hasUnpunchedOut: boolean     // true if any session has no OUT (incomplete)
}

// ── Timezone helpers (pure, no external deps) ─────────────────────────────────

/**
 * Normalise a time string to exactly "HH:MM:SS".
 * Accepts "HH:MM" or "HH:MM:SS".
 */
function normalizeTime(t: string): string {
  return t.length === 5 ? `${t}:00` : t
}

/**
 * Parse the date+time portion of an sv-SE Intl format result into a Date.
 *
 * Intl.DateTimeFormat with locale 'sv-SE' produces "YYYY-MM-DD HH:MM:SS",
 * which is reliably parseable by treating it as a UTC instant (append "Z").
 */
function parseSvSe(formatted: string): Date {
  return new Date(formatted.replace(' ', 'T') + 'Z')
}

/**
 * The sv-SE formatter used for timezone reflection.
 * Cached at module level — Intl object construction is expensive when called
 * thousands of times (one per computeDay call during bulk recompute).
 * The formatter is stateless so safe to share.
 *
 * NOTE: we cannot pre-bake the timezone because each tenant may have a
 * different one.  We create one per unique timezone string encountered during
 * a request and discard it afterward.  For a typical recompute-range
 * (one tenant, one timezone), this means a single construction.
 */
const fmtCache = new Map<string, Intl.DateTimeFormat>()

function getFormatter(tz: string): Intl.DateTimeFormat {
  let fmt = fmtCache.get(tz)
  if (!fmt) {
    fmt = new Intl.DateTimeFormat('sv-SE', {
      timeZone: tz,
      year:     'numeric',
      month:    '2-digit',
      day:      '2-digit',
      hour:     '2-digit',
      minute:   '2-digit',
      second:   '2-digit',
    })
    fmtCache.set(tz, fmt)
  }
  return fmt
}

/**
 * Convert a local date+time string in `tz` to a UTC Date.
 *
 * Uses the "reflection" technique:
 *   1. Parse localDate+localTime as if it were UTC (the "naive" instant).
 *   2. Format the naive instant in `tz` to get what the timezone "displays".
 *   3. Parse that display string as UTC → tzRepr.
 *   4. t_utc = 2 × naive − tzRepr  (reverses the timezone offset).
 *
 * Works correctly across DST transitions as long as the local time is not
 * ambiguous (i.e., does not fall in a "fall back" gap).  Shift boundaries
 * are highly unlikely to be scheduled at DST-ambiguous times.
 *
 * @param date     YYYY-MM-DD   (tenant local calendar date)
 * @param time     HH:MM or HH:MM:SS  (tenant local time)
 * @param tz       IANA timezone identifier
 */
export function localToUtc(date: string, time: string, tz: string): Date {
  const t  = normalizeTime(time)
  const naive  = new Date(`${date}T${t}Z`)           // treat local time as UTC
  const tzRepr = parseSvSe(getFormatter(tz).format(naive))  // what tz displays for naive
  return new Date(2 * naive.getTime() - tzRepr.getTime())   // reflection correction
}

/**
 * Convert a UTC Date to the tenant-local YYYY-MM-DD string.
 *
 * Used by callers to determine which tenant-local date a punch belongs to.
 * (Not used inside computeDay itself — the caller is responsible for passing
 * the correct local date.)
 */
export function utcToLocalDate(utcDate: Date, tz: string): string {
  return new Intl.DateTimeFormat('sv-SE', {
    timeZone: tz,
    year:     'numeric',
    month:    '2-digit',
    day:      '2-digit',
  }).format(utcDate)   // "YYYY-MM-DD"
}

/** Advance a YYYY-MM-DD string by one calendar day (UTC-safe). */
function addOneDay(date: string): string {
  const d = new Date(`${date}T12:00:00.000Z`)
  d.setUTCDate(d.getUTCDate() + 1)
  return d.toISOString().slice(0, 10)
}

// ── Shift math ────────────────────────────────────────────────────────────────

function parseTimeHHMM(timeStr: string): { h: number; m: number } {
  const parts = timeStr.split(':').map(Number)
  return { h: parts[0] ?? 0, m: parts[1] ?? 0 }
}

function shiftDurationMinutes(startTime: string, endTime: string, isNightShift: boolean): number {
  const { h: sh, m: sm } = parseTimeHHMM(startTime)
  const { h: eh, m: em } = parseTimeHHMM(endTime)
  const startMin = sh * 60 + sm
  const endMin   = eh * 60 + em
  return (isNightShift || endMin <= startMin)
    ? endMin + 1440 - startMin   // crosses midnight
    : endMin - startMin
}

/**
 * Compute the UTC Date at which a shift ends, given the tenant-local `date`
 * on which the shift STARTS.
 *
 * Night shifts (isNightShift=true OR end_time ≤ start_time) end on the NEXT
 * calendar day in tenant local time.
 */
function computeShiftEndUtc(date: string, shift: ShiftMeta, tz: string): Date {
  const { h: sh, m: sm } = parseTimeHHMM(shift.startTime)
  const { h: eh, m: em } = parseTimeHHMM(shift.endTime)
  const crossesMidnight = shift.isNightShift || (eh * 60 + em) <= (sh * 60 + sm)
  const endLocalDate    = crossesMidnight ? addOneDay(date) : date
  return localToUtc(endLocalDate, shift.endTime, tz)
}

// ── Punch pairing ─────────────────────────────────────────────────────────────

/**
 * Pair IN/OUT punches into sessions.
 *
 * - Consecutive INs → only the first opens a session; rest are ignored.
 * - Consecutive OUTs → ignored (no open session to close).
 * - Unclosed IN: if `shiftEndFallback` is provided and is strictly after the
 *   IN time, the session is closed at shift-end; otherwise 0 minutes.
 *
 * Returns aggregate stats alongside the sessions array.
 */
function pairPunches(punches: PunchLog[], shiftEndFallback: Date | null = null): PairResult {
  const sessions: PairedSession[] = []
  let openIn: Date | null = null

  for (const punch of punches) {
    if (punch.direction === 'IN') {
      if (!openIn) openIn = new Date(punch.punched_at)
      // Duplicate IN → ignore
    } else {
      // OUT punch
      if (openIn) {
        const checkOut      = new Date(punch.punched_at)
        const minutesWorked = Math.max(0, (checkOut.getTime() - openIn.getTime()) / 60_000)
        sessions.push({ checkIn: openIn, checkOut, complete: true, minutesWorked })
        openIn = null
      }
      // OUT without open IN → ignore
    }
  }

  // Unclosed IN
  if (openIn) {
    if (shiftEndFallback && shiftEndFallback > openIn) {
      const minutesWorked = Math.max(0, (shiftEndFallback.getTime() - openIn.getTime()) / 60_000)
      sessions.push({ checkIn: openIn, checkOut: shiftEndFallback, complete: true, minutesWorked })
    } else {
      sessions.push({ checkIn: openIn, checkOut: null, complete: false, minutesWorked: 0 })
    }
  }

  const workedMinutes = Math.max(
    0,
    Math.min(1440, sessions.filter((s) => s.complete).reduce((sum, s) => sum + s.minutesWorked, 0)),
  )

  const firstInTime = sessions.length > 0 ? sessions[0]!.checkIn : null
  const lastOutTime = (() => {
    for (let i = sessions.length - 1; i >= 0; i--) {
      const s = sessions[i]!
      if (s.complete && s.checkOut) return s.checkOut
    }
    return null
  })()

  const hasUnpunchedOut = sessions.some((s) => !s.complete)

  return { sessions, workedMinutes, firstInTime, lastOutTime, hasUnpunchedOut }
}

// ── Anomaly detection ──────────────────────────────────────────────────────────

/**
 * Derive the set of anomalies for a computed attendance day.
 *
 * Called immediately after computeDay returns, before the row is upserted.
 * Only raises anomalies on working days (leave, holiday, weekly_off → none).
 *
 * @param result   The AttendanceDaily returned by computeDay.
 * @param policy   The effective policy (used for excessive_hours threshold).
 */
function detectAnomalies(
  result: AttendanceDaily,
  policy: AttendancePolicy,
): AttendanceAnomaly[] {
  // No anomalies for non-working days
  if (['leave', 'holiday', 'weekly_off'].includes(result.status)) return []

  const anomalies: AttendanceAnomaly[] = []
  const base = {
    tenant_id:   result.tenant_id,
    employee_id: result.employee_id,
    date:        result.date,
  }

  // 1. No punch at all on a working day
  if (result.meta.punchesCount === 0 && result.status === 'absent') {
    anomalies.push({
      ...base,
      type:     'no_punch',
      message:  `No punch recorded on ${result.date}`,
      severity: 'medium',
    })
  }

  // 2. Unclosed IN punch (missing OUT)
  if (result.meta.hasUnpunchedOut) {
    anomalies.push({
      ...base,
      type:     'missing_out',
      message:  `Missing OUT punch on ${result.date} — session closed at shift-end`,
      severity: 'low',
    })
  }

  // 3. Late arrival
  if (result.late_minutes > 0 && (result.status === 'late' || result.status === 'present')) {
    anomalies.push({
      ...base,
      type:     'late',
      message:  `Late by ${result.late_minutes} min on ${result.date}`,
      severity: result.late_minutes >= 60 ? 'medium' : 'low',
    })
  }

  // 4. Excessive hours (disabled if threshold = 0)
  if (
    policy.excessive_hours_threshold > 0 &&
    result.work_hours > policy.excessive_hours_threshold
  ) {
    anomalies.push({
      ...base,
      type:     'excessive_hours',
      message:  `Worked ${result.work_hours}h on ${result.date} (threshold: ${policy.excessive_hours_threshold}h)`,
      severity: 'medium',
    })
  }

  return anomalies
}

/**
 * Synchronise anomalies for one employee on one date.
 *
 * - Upserts each new anomaly (UNIQUE on tenant+employee+date+type prevents dups).
 * - Deletes any UNRESOLVED anomaly whose type is no longer in the new set
 *   (i.e., the condition was fixed by the recompute).
 * - Resolved anomalies are never deleted — they stay as audit history.
 *
 * Failures are non-fatal: a warning is logged and the calling function
 * continues.  Anomaly sync should never block attendance computation.
 */
async function syncAnomalies(
  supabase:     SupabaseClient,
  tenantId:     string,
  employeeId:   string,
  date:         string,
  newAnomalies: AttendanceAnomaly[],
): Promise<void> {
  // Upsert all new/updated anomalies (update message + severity if type exists)
  if (newAnomalies.length > 0) {
    const rows = newAnomalies.map((a) => ({
      tenant_id:   a.tenant_id,
      employee_id: a.employee_id,
      date:        a.date,
      type:        a.type,
      message:     a.message,
      severity:    a.severity,
      resolved:    false,
      updated_at:  new Date().toISOString(),
    }))

    const { error: upsertErr } = await supabase
      .from('attendance_anomalies')
      .upsert(rows, { onConflict: 'tenant_id,employee_id,date,type' })

    if (upsertErr) {
      console.warn(JSON.stringify({
        level:   'warn',
        service: 'attendance-engine',
        action:  'sync_anomalies_upsert_failed',
        tenant_id:   tenantId,
        employee_id: employeeId,
        date,
        error: upsertErr.message,
      }))
      return
    }
  }

  // Delete unresolved anomalies whose type is no longer present.
  //
  // ── Empty-array guard ──────────────────────────────────────────────────────
  // When newAnomalies = [] (all clear — e.g. CSV recomputed a previously-absent
  // row to present/late), we must delete ALL unresolved anomalies for this
  // employee+date.
  //
  // The previous approach of `.not('type', 'in', '()')` (empty IN list) is
  // invalid SQL and a silent no-op in PostgREST — stale no_punch anomalies were
  // never cleaned up after a CSV recompute, producing false positives.
  //
  // Fix: branch explicitly on whether there are active types to retain.
  const activeTypes = newAnomalies.map((a) => a.type)

  let deleteQ = supabase
    .from('attendance_anomalies')
    .delete()
    .eq('tenant_id', tenantId)
    .eq('employee_id', employeeId)
    .eq('date', date)
    .eq('resolved', false)

  if (activeTypes.length > 0) {
    // Keep anomaly types that are still valid — delete the rest
    deleteQ = deleteQ.not('type', 'in', `(${activeTypes.map((t) => `"${t}"`).join(',')})`)
  }
  // When activeTypes.length === 0 the query has no extra filter, so it deletes
  // ALL unresolved anomalies for this employee+date — which is exactly correct
  // (no active anomalies means the day is clean).

  const { error: deleteErr } = await deleteQ

  if (deleteErr) {
    console.warn(JSON.stringify({
      level:   'warn',
      service: 'attendance-engine',
      action:  'sync_anomalies_delete_stale_failed',
      tenant_id:   tenantId,
      employee_id: employeeId,
      date,
      active_types: activeTypes,
      error: deleteErr.message,
    }))
  }
}

// ── DB fetch helpers ──────────────────────────────────────────────────────────

/**
 * Fetch the IANA timezone string for a tenant.
 * Falls back to 'UTC' if the row or column is missing.
 */
async function fetchTenantTz(supabase: SupabaseClient, tenantId: string): Promise<string> {
  const { data } = await supabase
    .from('tenants')
    .select('timezone')
    .eq('id', tenantId)
    .maybeSingle()
  return (data as { timezone?: string } | null)?.timezone ?? 'UTC'
}

async function resolveShift(
  supabase:   SupabaseClient,
  tenantId:   string,
  employeeId: string,
  date:       string,
): Promise<ShiftMeta | null> {
  // 1. Roster override for the specific local date
  const { data: rosterRow } = await supabase
    .from('shift_roster')
    .select('shift_id')
    .eq('tenant_id', tenantId)
    .eq('employee_id', employeeId)
    .eq('date', date)
    .maybeSingle()

  let shiftId: string | null = (rosterRow as { shift_id: string } | null)?.shift_id ?? null

  // 2. Rotation Policy — employee override → site default → condition from date
  if (!shiftId) {
    const rotMeta = await resolveViaRotationPolicy(supabase, tenantId, employeeId, date)
    if (rotMeta) {
      return {
        startTime:    rotMeta.startTime,
        endTime:      rotMeta.endTime,
        graceMinutes: rotMeta.graceMinutes,
        isNightShift: rotMeta.isNightShift,
        durationMin:  rotMeta.durationMin,
      }
    }
  }

  // 3. Fall back to standing assignment
  if (!shiftId) {
    const { data: standing } = await supabase
      .from('employee_shifts')
      .select('shift_id')
      .eq('tenant_id', tenantId)
      .eq('employee_id', employeeId)
      .eq('is_current', true)
      .maybeSingle()
    shiftId = (standing as { shift_id: string } | null)?.shift_id ?? null
  }

  if (!shiftId) return null

  // 4. Fetch shift details
  const { data: shift } = await supabase
    .from('shifts')
    .select('id, start_time, end_time, grace_minutes, is_night_shift')
    .eq('id', shiftId)
    .maybeSingle()

  if (!shift) return null

  const s = shift as {
    start_time:     string
    end_time:       string
    grace_minutes:  number
    is_night_shift: boolean
  }

  return {
    startTime:    s.start_time,
    endTime:      s.end_time,
    graceMinutes: s.grace_minutes ?? DEFAULT_POLICY.grace_minutes,
    isNightShift: s.is_night_shift ?? false,
    // weeklyOffDays removed — shifts carry timing rules only; use roster for weekly-off
    durationMin:  shiftDurationMinutes(s.start_time, s.end_time, s.is_night_shift ?? false),
  }
}

/**
 * Fetch punch logs for a given employee on a given tenant-local date.
 *
 * The query window is shift-aware and timezone-correct:
 *
 *   With shift:
 *     windowStart = UTC(shiftStart) − 2 h
 *     windowEnd   = UTC(shiftEnd)   + 4 h
 *     Night shifts: shiftEnd is on the next local calendar day.
 *
 *   Without shift:
 *     windowStart = UTC(local midnight of `date`)
 *     windowEnd   = UTC(local 23:59:59 of `date+1`)
 *     ≈ 48 local hours — broad fallback that captures any overnight pattern.
 */
async function fetchPunches(
  supabase:   SupabaseClient,
  tenantId:   string,
  employeeId: string,
  date:       string,
  shift:      ShiftMeta | null,
  tz:         string,
): Promise<PunchLog[]> {
  let windowStart: string
  let windowEnd:   string

  if (shift) {
    const shiftStartUtc = localToUtc(date, shift.startTime, tz)
    const shiftEndUtc   = computeShiftEndUtc(date, shift, tz)
    windowStart = new Date(shiftStartUtc.getTime() - 2 * 60 * 60_000).toISOString()
    windowEnd   = new Date(shiftEndUtc.getTime()   + 4 * 60 * 60_000).toISOString()
  } else {
    // No shift — capture from local midnight of `date` through end of `date+1`
    windowStart = localToUtc(date,          '00:00:00', tz).toISOString()
    windowEnd   = localToUtc(addOneDay(date), '23:59:59', tz).toISOString()
  }

  const { data } = await supabase
    .from('attendance_punch_logs')
    .select('id, punched_at, direction, source')
    .eq('tenant_id', tenantId)
    .eq('employee_id', employeeId)
    .gte('punched_at', windowStart)
    .lte('punched_at', windowEnd)
    .order('punched_at', { ascending: true })

  return ((data ?? []) as Array<{ id: string; punched_at: string; direction: string; source: string }>)
    .map((r) => ({
      id:         r.id,
      punched_at: r.punched_at,
      direction:  r.direction as 'IN' | 'OUT',
      source:     r.source,
    }))
}

async function fetchApprovedLeave(
  supabase:   SupabaseClient,
  tenantId:   string,
  employeeId: string,
  date:       string,
): Promise<{ leave_type_id: string; is_paid: boolean; half_day: boolean } | null> {
  const { data } = await supabase
    .from('leave_requests')
    .select('leave_type_id, half_day, leave_types(is_paid)')
    .eq('tenant_id', tenantId)
    .eq('employee_id', employeeId)
    .eq('status', 'APPROVED')
    .lte('from_date', date)
    .gte('to_date', date)
    .maybeSingle()

  if (!data) return null

  const row = data as unknown as {
    leave_type_id: string
    half_day:      boolean | null
    leave_types:   { is_paid: boolean } | { is_paid: boolean }[] | null
  }

  const lt = Array.isArray(row.leave_types) ? row.leave_types[0] : row.leave_types

  return {
    leave_type_id: row.leave_type_id,
    is_paid:       lt?.is_paid ?? false,
    half_day:      row.half_day ?? false,
  }
}

async function fetchHoliday(
  supabase:   SupabaseClient,
  tenantId:   string,
  date:       string,
  ctx:        { site_id: string | null; work_location_id: string | null; site_holiday_group_id: string | null },
): Promise<{ name: string; is_optional: boolean } | null> {
  const { data: holidays } = await supabase
    .from('holiday_calendar')
    .select('name, is_optional, site_id, location_id, holiday_group_id')
    .eq('tenant_id', tenantId)
    .eq('date', date)

  if (!holidays?.length) return null

  const hols = holidays as Array<{
    name: string; is_optional: boolean
    site_id: string | null; location_id: string | null; holiday_group_id: string | null
  }>

  // Applicability priority: location > site > holiday-group > global (all-India).
  const loc = hols.find((h) => h.location_id && h.location_id === ctx.work_location_id)
  if (loc) return { name: loc.name, is_optional: loc.is_optional }

  const site = hols.find((h) => h.site_id && h.site_id === ctx.site_id)
  if (site) return { name: site.name, is_optional: site.is_optional }

  const grp = hols.find((h) => h.holiday_group_id && h.holiday_group_id === ctx.site_holiday_group_id)
  if (grp) return { name: grp.name, is_optional: grp.is_optional }

  const global = hols.find((h) => !h.site_id && !h.location_id && !h.holiday_group_id)
  return global ? { name: global.name, is_optional: global.is_optional } : null
}

// ── computeDay ────────────────────────────────────────────────────────────────

/**
 * Compute the attendance status for one employee on one tenant-local date.
 *
 * Reads from:
 *   tenants, shift_roster, employee_shifts, shifts,
 *   attendance_punch_logs, leave_requests, holiday_calendar, job_history.
 *
 * Timezone-aware:
 *   - Fetches tenants.timezone (or uses pre-supplied opts.tenantTz).
 *   - All shift-time → UTC conversions use localToUtc().
 *   - Late minutes are computed as firstIn − UTC(shiftStart + grace), which is
 *     correct across DST transitions without any special night-shift branching.
 *   - The `date` parameter and the value stored in attendance_daily.date are
 *     both the TENANT-LOCAL calendar date (YYYY-MM-DD), not UTC.
 *
 * @param supabase  Service-role Supabase client.
 * @param opts      ComputeDayOpts — required: tenant_id, employee_id, date.
 *                  Optional: tenantTz (pre-fetched; skips one DB query).
 */
export async function computeDay(
  supabase: SupabaseClient,
  opts:     ComputeDayOpts,
): Promise<AttendanceDaily> {
  const { tenant_id, employee_id, date } = opts

  // The tenant-local day-of-week (0 = Sun … 6 = Sat).
  // localToUtc(date, '12:00:00', tz) gives noon local — always unambiguous.
  // We compute this after we know tz, but we need it later; declare it here.
  let dayOfWeek: number

  // ── 1. Resolve shift + tenant timezone + policy + org context in parallel ───
  //    All are prerequisites for computation; resolve concurrently.
  const [shift, resolvedTz, policy, orgCtx] = await Promise.all([
    resolveShift(supabase, tenant_id, employee_id, date),
    opts.tenantTz ? Promise.resolve(opts.tenantTz) : fetchTenantTz(supabase, tenant_id),
    opts.policy   ? Promise.resolve(opts.policy)   : policyService.getPolicy(supabase, tenant_id, employee_id),
    resolveEmployeeOrgContext(supabase, tenant_id, employee_id, date),
  ])

  const tz = resolvedTz

  // Compute day-of-week in tenant local time
  dayOfWeek = new Date(localToUtc(date, '12:00:00', tz)).getUTCDay()

  // Shift-end in UTC — used as pairPunches fallback for unclosed IN sessions
  const shiftEndFallback: Date | null = shift ? computeShiftEndUtc(date, shift, tz) : null

  // ── 2. Parallel fetch: punches (tz-aware window), leave, holiday ───────────
  const [punches, approvedLeave, holiday] = await Promise.all([
    fetchPunches(supabase, tenant_id, employee_id, date, shift, tz),
    fetchApprovedLeave(supabase, tenant_id, employee_id, date),
    fetchHoliday(supabase, tenant_id, date, orgCtx),
  ])

  const shiftDurationMin = shift?.durationMin  ?? DEFAULT_DURATION_MIN
  // graceMinutes: shift.graceMinutes is the shift-specific override (set by HR
  // per shift); policy.grace_minutes is the tenant/employee-level default.
  // Shift grace takes precedence when explicitly configured.
  const graceMinutes     = shift?.graceMinutes ?? policy.grace_minutes

  // ── Priority chain ─────────────────────────────────────────────────────────

  // 1. Approved leave → LEAVE (session-aware)
  if (approvedLeave) {
    const { is_paid, half_day } = approvedLeave
    // For a HALF-DAY leave, the other half of the day may have been worked.
    // Treat the presence of punches as the worked half so the day merges to a
    // full payable day (0.5 leave + 0.5 worked) instead of losing the worked
    // half. For a full-day leave this is a no-op. resolveLeaveDayFraction also
    // fixes unpaid half-day handling (0.5 unpaid leave alone → 0 payable).
    const resolved = resolveLeaveDayFraction({
      session:        half_day ? 'first_half' : 'full_day',
      isPaid:         is_paid,
      existingStatus: half_day && punches.length > 0 ? 'present' : null,
    })
    return {
      tenant_id, employee_id, date,
      status:               resolved.status,
      work_hours:           0,
      late_minutes:         0,
      overtime_minutes:     0,
      is_payable:           resolved.is_payable,
      day_fraction:         resolved.day_fraction,
      worked_on_weekly_off: false,
      worked_on_holiday:    false,
      computed_source:      'engine' as const,
      reason:               half_day ? `Approved half-day leave on ${date}` : `Approved leave on ${date}`,
      meta:                 { punchesCount: punches.length, hasUnpunchedOut: false },
    }
  }

  // 2. Holiday
  if (holiday) {
    const workedOnHoliday = punches.length > 0
    if (!workedOnHoliday) {
      return {
        tenant_id, employee_id, date,
        status:               'holiday',
        work_hours:           0,
        late_minutes:         0,
        overtime_minutes:     0,
        is_payable:           true,
        day_fraction:         1.0,
        worked_on_weekly_off: false,
        worked_on_holiday:    false,
        computed_source:      'engine' as const,
        reason:               `Holiday: ${holiday.name}`,
        meta:                 { punchesCount: 0, hasUnpunchedOut: false },
      }
    }
    // Has punches → fall through to punch-based computation;
    // worked_on_holiday flag set at return site below.
  }

  // 3. Weekly off without punches → WEEKLY_OFF
  // Weekly-off days come exclusively from rosters (not shifts).
  // The advanced roster-calendar-engine evaluates rule-based off patterns
  // (alternate Saturdays, cyclic schedules, rotational offs, etc.) first;
  // falls back to the legacy pattern_json.weekly_off_days array if no rules exist.
  const legacyWeeklyOffDays = getWeeklyOffDays(
    [],   // shift weekly_off_days deprecated — roster is the sole source
    orgCtx.emp_roster_weekly_off,
    orgCtx.site_default_roster_weekly_off,
  )
  const weeklyOffStatus = await resolveIsWeeklyOff(
    supabase,
    tenant_id,
    orgCtx.roster_id,
    legacyWeeklyOffDays,
    date,
  )
  const isWeeklyOff = weeklyOffStatus.is_weekly_off

  if (isWeeklyOff && punches.length === 0) {
    return {
      tenant_id, employee_id, date,
      status:               'weekly_off',
      work_hours:           0,
      late_minutes:         0,
      overtime_minutes:     0,
      is_payable:           true,
      day_fraction:         1.0,
      worked_on_weekly_off: false,
      worked_on_holiday:    false,
      computed_source:      'engine' as const,
      reason:               'Weekly off — no punches',
      meta:                 { punchesCount: 0, hasUnpunchedOut: false },
    }
  }

  // ── 4. Punch-based computation ─────────────────────────────────────────────

  const { sessions: _sessions, workedMinutes, firstInTime, hasUnpunchedOut } = pairPunches(punches, shiftEndFallback)
  const totalMinutes    = workedMinutes   // already clamped to [0, 1440]
  const workHours       = parseFloat((totalMinutes / 60).toFixed(2))
  const overtimeMinutes = Math.max(0, Math.floor(totalMinutes - shiftDurationMin))

  // ── Late-minutes: fully timezone-aware ─────────────────────────────────────
  //
  // shiftStartUtc is the exact UTC instant the shift opens on this local date.
  // allowedUtc adds the grace period to that instant.
  // Comparing firstInTime (a UTC Date from the DB timestamp) against allowedUtc
  // is timezone-correct for all shift types including night shifts, without
  // any special UTC-hour / isNightShift branching.
  let lateMinutes = 0

  if (firstInTime && shift) {
    const shiftStartUtc = localToUtc(date, shift.startTime, tz)
    const allowedUtc    = new Date(shiftStartUtc.getTime() + graceMinutes * 60_000)
    lateMinutes = Math.min(
      policy.late_cap_minutes,
      Math.max(0, Math.floor((firstInTime.getTime() - allowedUtc.getTime()) / 60_000)),
    )
  } else if (firstInTime && !shift) {
    // No shift assigned → fall back to default start hour in tenant local time
    const defaultStartUtc = localToUtc(
      date,
      `${String(DEFAULT_START_HOUR).padStart(2, '0')}:00:00`,
      tz,
    )
    const allowedUtc = new Date(defaultStartUtc.getTime() + policy.grace_minutes * 60_000)
    lateMinutes = Math.min(
      policy.late_cap_minutes,
      Math.max(0, Math.floor((firstInTime.getTime() - allowedUtc.getTime()) / 60_000)),
    )
  }

  // ── Status derivation (strict thresholds) ──────────────────────────────────
  let status: AttendanceStatus
  let reason: string

  const presentThreshold = shiftDurationMin * (policy.present_threshold_pct  / 100)
  const halfDayThreshold = shiftDurationMin * (policy.half_day_threshold_pct / 100)

  if (punches.length === 0) {
    status = 'absent'
    reason = 'No punches recorded'
  } else if (totalMinutes >= presentThreshold) {
    status = lateMinutes > 0 ? 'late' : 'present'
    reason = lateMinutes > 0
      ? `Present — late by ${lateMinutes} min (${workHours}h worked)`
      : `Present — ${workHours}h worked`
  } else if (totalMinutes >= halfDayThreshold) {
    status = 'half_day'
    reason = `Half day — ${workHours}h worked (< ${policy.present_threshold_pct} % of ${Math.round(shiftDurationMin / 60)}h shift)`
  } else {
    status = 'absent'
    reason = `Absent — only ${workHours}h worked (< ${policy.half_day_threshold_pct} % of shift)`
  }

  // ── Payability ─────────────────────────────────────────────────────────────
  const PAYABLE = new Set<AttendanceStatus>(['present', 'late', 'half_day', 'holiday', 'weekly_off'])
  const isPayable   = PAYABLE.has(status)
  const dayFraction = status === 'half_day' ? 0.5 : (isPayable ? 1.0 : 0.0)

  const workedOnWeeklyOff = isWeeklyOff && punches.length > 0
  const workedOnHoliday   = holiday !== null && punches.length > 0

  const punchMeta: AttendanceDailyMeta = { punchesCount: punches.length, hasUnpunchedOut }

  // Worked on weekly off → PRESENT + flag
  if (workedOnWeeklyOff) {
    return {
      tenant_id, employee_id, date,
      status:               'present',
      work_hours:           workHours,
      late_minutes:         lateMinutes,
      overtime_minutes:     overtimeMinutes,
      is_payable:           true,
      day_fraction:         1.0,
      worked_on_weekly_off: true,
      worked_on_holiday:    false,
      computed_source:      'engine' as const,
      reason:               `Worked on weekly off — ${workHours}h`,
      meta:                 punchMeta,
    }
  }

  // Worked on holiday → PRESENT + flag (only if enough hours to not be ABSENT)
  if (workedOnHoliday && status !== 'absent') {
    return {
      tenant_id, employee_id, date,
      status:               'present',
      work_hours:           workHours,
      late_minutes:         lateMinutes,
      overtime_minutes:     overtimeMinutes,
      is_payable:           true,
      day_fraction:         1.0,
      worked_on_weekly_off: false,
      worked_on_holiday:    true,
      computed_source:      'engine' as const,
      reason:               `Worked on holiday (${holiday!.name}) — ${workHours}h`,
      meta:                 punchMeta,
    }
  }

  return {
    tenant_id, employee_id, date,
    status,
    work_hours:           workHours,
    late_minutes:         lateMinutes,
    overtime_minutes:     overtimeMinutes,
    is_payable:           isPayable,
    day_fraction:         dayFraction,
    worked_on_weekly_off: false,
    // Only flag worked-on-holiday when the day is actually payable. Previously a
    // sub-threshold holiday punch produced status='absent' AND worked_on_holiday=true
    // simultaneously — a contradictory state that could spuriously credit comp-off.
    worked_on_holiday:    isPayable && workedOnHoliday,
    computed_source:      'engine' as const,
    reason,
    meta:                 punchMeta,
  }
}

// ── upsertAttendanceDaily ─────────────────────────────────────────────────────

/**
 * Upsert one AttendanceDaily row into attendance_daily.
 *
 * - Strips `reason` and `meta` (not DB columns) before writing.
 * - Fetches before-status + before-day_fraction for delta detection.
 * - Writes an audit log row if status changed.
 * - Emits 'attendance.updated' if status OR day_fraction changed.
 * - Detects anomalies and syncs them via syncAnomalies.
 *
 * @param supabase  Service-role Supabase client
 * @param row       Engine output including reason and meta (both stripped)
 * @param opts      Optional audit / source metadata
 * @param policy    Optional pre-resolved policy (skips service lookup if provided)
 */
export async function upsertAttendanceDaily(
  supabase: SupabaseClient,
  row:      AttendanceDaily,
  opts?:    UpsertOpts,
  policy?:  AttendancePolicy,
): Promise<void> {
  // Strip non-DB fields
  const { reason, meta, ...dbRow } = row

  // Read existing row for delta detection
  const { data: existing } = await supabase
    .from('attendance_daily')
    .select('status, day_fraction')
    .eq('tenant_id', row.tenant_id)
    .eq('employee_id', row.employee_id)
    .eq('date', row.date)
    .maybeSingle()

  const existingRow       = existing as { status: string; day_fraction: number } | null
  const beforeStatus      = existingRow?.status      ?? null
  const beforeDayFraction = existingRow?.day_fraction ?? null

  const { error } = await supabase
    .from('attendance_daily')
    .upsert(dbRow, { onConflict: 'tenant_id,employee_id,date' })

  if (error) {
    throw new Error(`attendance_daily upsert failed: ${error.message}`)
  }

  // Audit on status change
  if (beforeStatus !== row.status) {
    await writeAuditLogs(
      supabase,
      row.tenant_id,
      opts?.source ?? 'system',
      [{ employee_id: row.employee_id, date: row.date, before_status: beforeStatus, after_status: row.status }],
      opts?.changed_by ?? null,
      { reason, ...opts?.metadata },
    )
  }

  // Event on status or day_fraction change
  if (beforeStatus !== row.status || beforeDayFraction !== row.day_fraction) {
    eventService.emit('attendance.updated', {
      tenant_id:    row.tenant_id,
      employee_id:  row.employee_id,
      date:         row.date,
      old_status:   beforeStatus,
      new_status:   row.status,
      day_fraction: row.day_fraction,
    })
  }

  // Anomaly sync — detect from computed result + meta, then upsert/delete
  // Resolve policy if not supplied by caller (single-row path)
  const effectivePolicy = policy ?? await policyService.getPolicy(supabase, row.tenant_id, row.employee_id)
  const anomalies = detectAnomalies(row, effectivePolicy)
  // Fire-and-forget — anomaly sync must never block attendance write
  setImmediate(() => {
    syncAnomalies(supabase, row.tenant_id, row.employee_id, row.date, anomalies).catch((err) => {
      console.warn(JSON.stringify({
        level:   'warn',
        service: 'attendance-engine',
        action:  'sync_anomalies_failed',
        tenant_id:   row.tenant_id,
        employee_id: row.employee_id,
        date:        row.date,
        error:       err instanceof Error ? err.message : String(err),
      }))
    })
  })
}

// ── recomputeRange ────────────────────────────────────────────────────────────

/**
 * Recompute attendance for one employee over a date range.
 *
 * Fetches the tenant timezone ONCE and passes it into every computeDay call
 * to avoid N extra DB round-trips.
 *
 * - Parallel computeDay for all dates.
 * - Batch-fetch before-{status, day_fraction} for efficient delta detection.
 * - Single batch upsert.
 * - One writeAuditLogs call for all status changes.
 * - One eventService.emit per row where status or day_fraction changed.
 */
export async function recomputeRange(
  supabase: SupabaseClient,
  opts:     RecomputeRangeOpts,
): Promise<RecomputeResult> {
  const { tenant_id, employee_id, from_date, to_date, changed_by } = opts

  // Build date array
  const dates: string[] = []
  {
    const cur = new Date(`${from_date}T12:00:00.000Z`)
    const end = new Date(`${to_date}T12:00:00.000Z`)
    while (cur <= end) {
      dates.push(cur.toISOString().slice(0, 10))
      cur.setUTCDate(cur.getUTCDate() + 1)
    }
  }

  if (dates.length === 0) {
    return { rows_computed: 0, rows_upserted: 0, rows_protected: 0, dates: [] }
  }

  // Pre-fetch shared values — timezone + policy — once per recomputeRange call.
  // Both are the same for all dates in the range (same employee, same tenant).
  const [tenantTz, policy] = await Promise.all([
    fetchTenantTz(supabase, tenant_id),
    policyService.getPolicy(supabase, tenant_id, employee_id),
  ])

  // Compute all dates in parallel, passing pre-fetched values to skip DB queries
  const computed = await Promise.all(
    dates.map((date) => computeDay(supabase, { tenant_id, employee_id, date, tenantTz, policy })),
  )

  // Batch-fetch existing {status, day_fraction, computed_source} for delta detection
  // and recompute-protection filtering.
  const { data: existing } = await supabase
    .from('attendance_daily')
    .select('employee_id, date, status, day_fraction, computed_source')
    .eq('tenant_id', tenant_id)
    .eq('employee_id', employee_id)
    .in('date', dates)

  const beforeMap = new Map<string, { status: string; day_fraction: number; computed_source: string }>(
    ((existing ?? []) as Array<{ employee_id: string; date: string; status: string; day_fraction: number; computed_source: string }>)
      .map((r) => [`${r.employee_id}:${r.date}`, {
        status:          r.status,
        day_fraction:    r.day_fraction,
        computed_source: r.computed_source ?? 'engine',
      }]),
  )

  // ── Recompute protection ────────────────────────────────────────────────────
  // Never overwrite rows owned by 'leave_approval' or 'manual'.
  // These rows were written by controlled pipelines (leave-approval, HR manual
  // entry) and reflect intentional human decisions. An automated engine recompute
  // MUST NOT silently undo them — that would create phantom LOP deductions on
  // the next payroll run.
  //
  // 'regularization' rows ARE re-evaluated: an HR regularisation submission
  // means the HR admin wants the engine to re-derive attendance from corrected
  // punch data.
  const PROTECTED_SOURCES = new Set(['leave_approval', 'manual'])

  const datesToSkip = new Set<string>()
  for (const [key, before] of beforeMap) {
    if (PROTECTED_SOURCES.has(before.computed_source)) {
      const date = key.split(':')[1]!
      datesToSkip.add(date)
    }
  }

  // Filter out protected dates before upsert
  const safeComputed = computed.filter(r => !datesToSkip.has(r.date))

  if (datesToSkip.size > 0) {
    // Log skipped dates so operators can audit the protection decisions
    const skippedDates = [...datesToSkip].sort()
    // Use a synchronous log call — this is inside an async function so we have
    // no logger reference; write to console and let the caller's try/catch wrap it
    console.info(
      `[recomputeRange] skipped ${datesToSkip.size} protected dates for employee ${employee_id} ` +
      `(computed_source in [leave_approval, manual]): ${skippedDates.join(', ')}`
    )
  }

  // Batch upsert — strip reason and meta (neither is a DB column)
  const dbRows = safeComputed.map(({ reason: _r, meta: _m, ...dbRow }) => dbRow)

  if (dbRows.length > 0) {
    const { error } = await supabase
      .from('attendance_daily')
      .upsert(dbRows, { onConflict: 'tenant_id,employee_id,date' })

    if (error) {
      throw new Error(`attendance_daily batch upsert failed: ${error.message}`)
    }

    // Auto-generate pending comp-off for any worked-on-weekly-off / worked-on-holiday
    // day. Idempotent (unique on tenant_id,employee_id,worked_date) and gated by HR
    // approval downstream, so it never changes pay directly. Non-blocking: a failure
    // here must never abort the attendance recompute.
    try {
      await generateCompOffRequests(
        supabase,
        tenant_id,
        safeComputed.map(r => ({
          employee_id:          r.employee_id,
          date:                 r.date,
          worked_on_weekly_off: r.worked_on_weekly_off,
          worked_on_holiday:    r.worked_on_holiday,
        })),
        changed_by ?? null,
      )
    } catch (e) {
      console.warn(`[recomputeRange] comp-off auto-generate failed for employee ${employee_id}:`, e)
    }
  }

  // Audit log — only for rows that were actually upserted (not skipped due to protection)
  const statusChanges = safeComputed
    .filter((r) => beforeMap.get(`${r.employee_id}:${r.date}`)?.status !== r.status)
    .map((r) => ({
      employee_id:   r.employee_id,
      date:          r.date,
      before_status: beforeMap.get(`${r.employee_id}:${r.date}`)?.status ?? null,
      after_status:  r.status,
    }))

  if (statusChanges.length > 0) {
    await writeAuditLogs(
      supabase,
      tenant_id,
      'system',
      statusChanges,
      changed_by ?? null,
      { from_date, to_date, source: 'engine' },
    )
  }

  // Events — only for rows that were actually written (not protected ones)
  for (const r of safeComputed) {
    const key    = `${r.employee_id}:${r.date}`
    const before = beforeMap.get(key)
    if (before?.status !== r.status || before?.day_fraction !== r.day_fraction) {
      eventService.emit('attendance.updated', {
        tenant_id,
        employee_id:  r.employee_id,
        date:         r.date,
        old_status:   before?.status ?? null,
        new_status:   r.status,
        day_fraction: r.day_fraction,
      })
    }
  }

  // Anomaly sync — fire-and-forget, errors must not block the recompute result
  setImmediate(() => {
    Promise.all(
      computed.map((r) => {
        const anomalies = detectAnomalies(r, policy)
        return syncAnomalies(supabase, tenant_id, r.employee_id, r.date, anomalies)
      }),
    ).catch((err) => {
      console.warn(JSON.stringify({
        level:   'warn',
        service: 'attendance-engine',
        action:  'batch_sync_anomalies_failed',
        tenant_id,
        employee_id,
        from_date,
        to_date,
        error: err instanceof Error ? err.message : String(err),
      }))
    })
  })

  return {
    rows_computed:  computed.length,
    rows_upserted:  dbRows.length,
    rows_protected: datesToSkip.size,   // how many dates were skipped due to ownership protection
    dates,
  }
}
