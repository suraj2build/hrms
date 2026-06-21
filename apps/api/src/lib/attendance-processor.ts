/**
 * attendance-processor.ts
 *
 * Converts raw punch logs into structured attendance records.
 *
 * Pipeline for a given date:
 *   1. Load UNPROCESSED raw_logs for that date (processed = false)
 *   2. Map employee_code → employee_id — unmatched codes go to skipped_codes[]
 *   3. Sort each employee's logs by timestamp ASC
 *   4. Pair IN/OUT punches → attendance_logs rows (Step 2: improved safety)
 *   5. Compute work_hours, late_minutes, overtime_minutes → attendance_daily
 *   6. Delete-then-insert attendance_logs for matched employees (idempotent)
 *   7. Upsert attendance_daily rows
 *   8. Mark matched raw log IDs as processed = true (Step 1)
 *      Skipped-code raw logs remain processed = false → retried next run (Step 3)
 *
 * Idempotency guarantee:
 *   - Re-running for a date only picks up NEW unprocessed logs.
 *   - Skipped logs (unknown employee_code) are never silently dropped —
 *     they stay unprocessed and are retried automatically once the employee
 *     code is registered.
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import type { FastifyBaseLogger } from 'fastify'
import { eventBus } from './event-bus.js'
import {
  resolveEmployeeOrgContextBatch,
  resolveEmployeeOrgContext,
  getWeeklyOffDays     as orgGetWeeklyOffDays,
  isHolidayForEmployee as orgIsHoliday,
  getLocalDayOfWeek,
  getLocalTimeMinutes,
  getLocalDate,
  localDayBoundsUtc,
  type EmployeeOrgContext,
} from './org-context.js'
import { resolveShiftBatch, toShiftMeta, type ResolvedShift } from './shift-resolution-engine.js'
import { isShiftAttributionEnabled } from './attendance-flags.js'

// ── Shift defaults (no shift master yet) ──────────────────────────────────────
const SHIFT_START_HOUR   = 9   // 09:00
const SHIFT_HOURS        = 9   // standard working day
const LATE_GRACE_MINUTES = 15  // grace period before marking late

// ── Public result type ────────────────────────────────────────────────────────

export interface ProcessResult {
  date:                    string
  tenant_id:               string
  processed_employees:     number
  attendance_logs_created: number
  daily_records_upserted:  number
  raw_logs_marked:         number
  skipped_codes:           string[]
  incomplete_sessions:     number
  run_id:                  string   // Step 3: audit run UUID
}

// ── Internal types ────────────────────────────────────────────────────────────

interface RawLog {
  id:            string
  employee_code: string
  timestamp:     string
  direction:     'in' | 'out'
}

interface AttendanceLogRow {
  tenant_id:   string
  employee_id: string
  check_in:    string | null
  check_out:   string | null
  is_complete: boolean   // Step 2: false when OUT punch is missing
}

interface ShiftMeta {
  startTime:    string    // "HH:MM:SS"
  endTime:      string    // "HH:MM:SS"
  graceMinutes: number
  isNightShift: boolean   // if true, shift may cross midnight
  // NOTE: weeklyOffDays has been removed from ShiftMeta.
  // Weekly-off information belongs exclusively to Roster entities.
  // Use EmployeeOrgContext.emp_roster_weekly_off / site_default_roster_weekly_off.
}

interface HolidayRow {
  name:        string
  is_optional: boolean
  location_id: string | null
  site_id:     string | null
}

interface DailyRow {
  tenant_id:            string
  employee_id:          string
  date:                 string
  work_hours:           number
  late_minutes:         number
  overtime_minutes:     number
  status:               'present' | 'absent' | 'half_day' | 'late' | 'holiday' | 'weekend' | 'weekly_off' | 'leave'
  worked_on_weekly_off: boolean   // true when employee punched in on their weekly off day
  worked_on_holiday:    boolean   // true when employee punched in on a holiday
  is_payable:           boolean   // payroll eligibility flag
  day_fraction:         number    // 0.0 | 0.5 | 1.0 — direct payroll input
  // Shift attribution snapshot (migration 260) — written at compute time for audit integrity
  expected_shift_id?:        string | null
  shift_start_time?:         string | null
  shift_end_time?:           string | null
  shift_grace_minutes?:      number | null
  shift_is_night_shift?:     boolean | null
  shift_duration_minutes?:   number | null
  resolution_source?:        string | null
  rotation_policy_id?:       string | null
  rotation_condition_type?:  string | null
}

// ── Step 2: Improved pairing algorithm ───────────────────────────────────────

/**
 * Pairs sorted (ASC) punch logs for ONE employee on ONE day.
 *
 * Safety rules:
 * - Consecutive IN without OUT → only the FIRST IN opens a session; subsequent
 *   INs before an OUT are ignored (device retry / duplicate tap).
 * - Consecutive OUT without IN → ignored (no open session to close).
 * - Only the NEAREST OUT after an IN closes the session.
 * - If an IN has no matching OUT → session recorded with is_complete = false.
 *   These rows are queryable via the idx_attendance_logs_incomplete index.
 */
function pairPunches(
  logs:       { timestamp: string; direction: 'in' | 'out' }[],
  employeeId: string,
  tenantId:   string,
): AttendanceLogRow[] {
  const sessions: AttendanceLogRow[] = []
  let openIn: string | null = null

  for (const punch of logs) {
    if (punch.direction === 'in') {
      // Only open a session if none is currently open (ignore consecutive INs)
      if (openIn === null) {
        openIn = punch.timestamp
      }
      // else: consecutive IN — device retry or duplicate tap, skip silently
    } else {
      // direction === 'out'
      if (openIn !== null) {
        // Nearest OUT closes the open session → complete pair
        sessions.push({
          tenant_id:   tenantId,
          employee_id: employeeId,
          check_in:    openIn,
          check_out:   punch.timestamp,
          is_complete: true,
        })
        openIn = null
      }
      // else: OUT with no open session → stray punch, ignore
    }
  }

  // Unclosed session — IN with no OUT (Step 2: mark incomplete)
  if (openIn !== null) {
    sessions.push({
      tenant_id:   tenantId,
      employee_id: employeeId,
      check_in:    openIn,
      check_out:   null,
      is_complete: false,
    })
  }

  return sessions
}

// ── Daily summary computation ─────────────────────────────────────────────────

function computeDaily(
  sessions:   AttendanceLogRow[],
  employeeId: string,
  tenantId:   string,
  date:       string,
  shiftMeta?: ShiftMeta,
  timezone:   string = 'Asia/Kolkata',   // ← new
): DailyRow {
  // Only sum COMPLETE sessions for work hours (incomplete = still in progress)
  let totalMinutes = 0
  for (const s of sessions) {
    if (s.is_complete && s.check_in && s.check_out) {
      const ms = new Date(s.check_out).getTime() - new Date(s.check_in).getTime()
      totalMinutes += Math.max(0, ms / 60_000)
    }
  }

  // ── Step 3: Sanitize totalMinutes to [0, 24 × 60] ──────────────────────────
  // Guards against clock skew, bad device timestamps, or wrap-around edge cases.
  totalMinutes = Math.max(0, Math.min(totalMinutes, 1440))

  const workHours = parseFloat((totalMinutes / 60).toFixed(2))

  // ── Step 1: Late minutes — shift-aware, night-shift-safe ────────────────────
  // No shift assigned → 0 (cannot determine lateness).
  // No check_in       → 0 (nothing to evaluate).
  let lateMinutes = 0
  const firstIn   = sessions.find((s) => s.check_in)?.check_in

  if (firstIn && shiftMeta) {
    const [sh, sm]      = shiftMeta.startTime.split(':').map(Number)
    const shiftStartMin = sh * 60 + sm
    const allowedMin    = shiftStartMin + shiftMeta.graceMinutes

    if (!shiftMeta.isNightShift) {
      // Day shift: compare local punch time against shift start in same timezone
      const punchLocalMin = getLocalTimeMinutes(firstIn, timezone)
      lateMinutes = Math.max(0, Math.floor(punchLocalMin - allowedMin))
    } else {
      // Night shift: punch on the calendar-next local day means shift crossed midnight
      const punchLocalDate = getLocalDate(firstIn, timezone)
      const punchLocalMin  = getLocalTimeMinutes(firstIn, timezone)
      // If punch date ≠ processing date in local time, punch is after midnight → add 24 h
      const effectiveMin = punchLocalDate !== date ? punchLocalMin + 1440 : punchLocalMin
      lateMinutes = Math.max(0, Math.floor(effectiveMin - allowedMin))
    }
  }

  // ── Step 2: Cap late minutes at 240 (4 h) ────────────────────────────────────
  lateMinutes = Math.min(lateMinutes, 240)

  // Overtime — work beyond SHIFT_HOURS
  const overtimeMinutes = Math.max(0, Math.floor(totalMinutes - SHIFT_HOURS * 60))

  // ── Step 5: Shift-aware half_day threshold ────────────────────────────────────
  // Compute shift duration in minutes.
  // Falls back to SHIFT_HOURS constant when no shiftMeta is available.
  let durationMin: number
  if (shiftMeta) {
    const [sh, sm] = shiftMeta.startTime.split(':').map(Number)
    const [eh, em] = shiftMeta.endTime.split(':').map(Number)
    const startMin = sh * 60 + sm
    const endMin   = eh * 60 + em
    // Night shifts cross midnight → add 24 h when end ≤ start
    durationMin = endMin > startMin ? endMin - startMin : endMin + 1440 - startMin
  } else {
    durationMin = SHIFT_HOURS * 60
  }
  const halfDayThresholdMin = durationMin / 2

  // Status derivation (priority: absent → half_day → present/late)
  let status: DailyRow['status'] = 'absent'
  if (sessions.length > 0) {
    if (totalMinutes >= durationMin * 0.75) {
      status = lateMinutes > 0 ? 'late' : 'present'
    } else if (totalMinutes >= halfDayThresholdMin) {
      status = 'half_day'
    } else {
      // Punched in but very short session — still counts as present
      status = 'present'
    }
  }

  // ── Steps 2 & 3: Payable flag + day fraction ──────────────────────────────
  // 'leave' is never set here (handled by the leave approval route).
  // Holiday, weekend, weekly_off: employee is on a scheduled rest day — paid.
  const PAYABLE_STATUSES = new Set<DailyRow['status']>(
    ['present', 'late', 'half_day', 'holiday', 'weekend', 'weekly_off']
  )
  const isPayable   = PAYABLE_STATUSES.has(status)
  const dayFraction = status === 'half_day' ? 0.5
                    : isPayable             ? 1.0
                    : 0.0

  return {
    tenant_id:            tenantId,
    employee_id:          employeeId,
    date,
    work_hours:           workHours,
    late_minutes:         lateMinutes,
    overtime_minutes:     overtimeMinutes,
    status,
    worked_on_weekly_off: false,   // set to true in the priority chain when applicable
    worked_on_holiday:    false,   // set to true in the priority chain when applicable
    is_payable:           isPayable,
    day_fraction:         dayFraction,
  }
}

// ── Compute log writer ────────────────────────────────────────────────────────
//
// Stores per-employee inputs, result, and derivation reason for each
// computeDaily() invocation.  Fire-and-forget — never throws.

export async function writeComputeLogs(
  supabase:  SupabaseClient,
  tenantId:  string,
  rows: Array<{
    employee_id:  string
    date:         string
    inputs:       Record<string, unknown>
    result:       Record<string, unknown>
    reason:       string
    source:       'system' | 'recompute' | 'correction' | 'manual'
  }>,
  logger?: FastifyBaseLogger,
): Promise<void> {
  if (!rows.length) return
  const insertRows = rows.map((r) => ({
    tenant_id:   tenantId,
    employee_id: r.employee_id,
    date:        r.date,
    inputs:      r.inputs,
    result:      r.result,
    reason:      r.reason,
    source:      r.source,
  }))
  const { error } = await supabase.from('attendance_compute_log').insert(insertRows)
  if (error) {
    logger?.warn({ err: error, count: rows.length }, 'compute log write failed')
  }
}

/**
 * Derive a human-readable reason string for the computed status.
 * Used only for audit trail display — not performance-critical.
 */
function deriveComputeReason(
  daily:    DailyRow,
  sessions: AttendanceLogRow[],
  shiftMeta?: ShiftMeta,
): string {
  if (daily.status === 'holiday') {
    return daily.worked_on_holiday
      ? `Holiday — employee punched in (${sessions.length} session(s))`
      : 'Holiday — no punches recorded'
  }
  if (daily.status === 'weekly_off') {
    return 'Weekly off day — no punches recorded'
  }
  if (daily.status === 'absent') {
    return 'No punch records for the day'
  }
  const completeSessions = sessions.filter((s) => s.is_complete).length
  const incomplete       = sessions.length - completeSessions
  const parts: string[] = []
  if (daily.status === 'present')   parts.push('Present')
  if (daily.status === 'late')      parts.push(`Late by ${daily.late_minutes} min`)
  if (daily.status === 'half_day')  parts.push('Half day')
  if (daily.worked_on_weekly_off)   parts.push('worked on weekly off')
  parts.push(`${completeSessions} complete session(s)`)
  if (incomplete > 0) parts.push(`${incomplete} incomplete`)
  if (shiftMeta) parts.push(`shift ${shiftMeta.startTime}–${shiftMeta.endTime}`)
  else            parts.push('no shift assigned')
  return parts.join('; ')
}

// ── Audit log writer ──────────────────────────────────────────────────────────
//
// Non-fatal: logs a warning on failure but never throws.
// Exported so leave.ts and regularisation.ts can reuse the same helper.

export async function writeAuditLogs(
  supabase:   SupabaseClient,
  tenantId:   string,
  source:     'system' | 'regularisation' | 'leave',
  changes:    Array<{
    employee_id:   string
    date:          string
    before_status: string | null
    after_status:  string
  }>,
  changedBy:  string | null,
  metadata?:  Record<string, unknown>,
  logger?:    FastifyBaseLogger,
): Promise<void> {
  if (!changes.length) return
  const rows = changes.map((c) => ({
    tenant_id:     tenantId,
    employee_id:   c.employee_id,
    date:          c.date,
    source,
    before_status: c.before_status,
    after_status:  c.after_status,
    changed_by:    changedBy,
    metadata:      metadata ?? null,
  }))
  const { error } = await supabase.from('attendance_audit_log').insert(rows)
  if (error) {
    logger?.warn({ err: error, source, count: rows.length }, 'audit log write failed')
  }
}

// ── Phase 11: Attendance intelligence generation ──────────────────────────────

/**
 * Fire-and-forget intelligence generation.
 * Generates exceptions, confidence scores, and policy conflict logs for processed rows.
 * Never throws — all errors are caught and logged.
 */
async function generateAttendanceIntelligence(
  supabase:          SupabaseClient,
  tenantId:          string,
  dailyRows:         DailyRow[],
  byEmployee:        Map<string, RawLog[]>,
  resolvedShiftMap:  Map<string, ResolvedShift>,
  log?:              FastifyBaseLogger,
): Promise<void> {
  const exceptions: Record<string, unknown>[] = []
  const confidenceUpdates: Array<{ employee_id: string; date: string; confidence_score: number; confidence_level: string; confidence_factors: Record<string, number> }> = []

  for (const daily of dailyRows) {
    const sessions   = byEmployee.get(daily.employee_id) ?? []
    const hasShift   = resolvedShiftMap.has(daily.employee_id)
    const incomplete = sessions.filter((s: any) => !s.is_complete || s.check_out === null)

    // ── Confidence scoring ──────────────────────────────────────────────────
    let score = 100
    const factors: Record<string, number> = {}

    if (!hasShift) { score -= 15; factors.no_shift_assigned = 15 }
    if (daily.status === 'absent' && sessions.length === 0) { score -= 20; factors.absent_no_punch = 20 }
    if (incomplete.length > 0) { const d = Math.min(25, incomplete.length * 12); score -= d; factors.incomplete_sessions = d }
    if (daily.status === 'half_day') { score -= 10; factors.half_day = 10 }
    if (daily.worked_on_holiday || daily.worked_on_weekly_off) { score -= 5; factors.offday_work = 5 }
    if (daily.work_hours > 0 && daily.work_hours < 0.5) { score -= 20; factors.very_short_session = 20 }

    score = Math.max(0, Math.min(100, score))
    const level = score >= 80 ? 'high' : score >= 60 ? 'medium' : score >= 40 ? 'low' : 'critical'

    confidenceUpdates.push({ employee_id: daily.employee_id, date: daily.date, confidence_score: score, confidence_level: level, confidence_factors: factors })

    // ── Exception generation ────────────────────────────────────────────────
    const slaAt = (type: string) => {
      const slaHours = type === 'missing_out_punch' ? 24 : type === 'no_shift_assigned' ? 48 : 24
      const d = new Date()
      d.setHours(d.getHours() + slaHours)
      return d.toISOString()
    }

    if (incomplete.length > 0) {
      exceptions.push({
        tenant_id: tenantId, employee_id: daily.employee_id, date: daily.date,
        exception_type: 'missing_out_punch', category: 'punch', severity: 'medium',
        payroll_impacting: true, requires_investigation: false,
        confidence_impact: 0.25, sla_hours: 24, sla_due_at: slaAt('missing_out_punch'),
        status: 'open',
      })
    }
    if (!hasShift && sessions.length > 0) {
      exceptions.push({
        tenant_id: tenantId, employee_id: daily.employee_id, date: daily.date,
        exception_type: 'no_shift_assigned', category: 'shift', severity: 'high',
        payroll_impacting: true, requires_investigation: true,
        confidence_impact: 0.25, sla_hours: 48, sla_due_at: slaAt('no_shift_assigned'),
        status: 'open',
      })
    }
  }

  // Batch upsert confidence scores
  if (confidenceUpdates.length > 0) {
    const { error } = await supabase.from('attendance_daily')
      .upsert(
        confidenceUpdates.map(u => ({ ...u, tenant_id: tenantId })),
        { onConflict: 'tenant_id,employee_id,date' }
      )
    if (error) log?.warn({ err: error }, 'confidence score update failed')
  }

  // Insert exceptions (ignore conflicts — existing exceptions are not overwritten)
  if (exceptions.length > 0) {
    const { error } = await supabase.from('attendance_exceptions').insert(exceptions)
    if (error) log?.warn({ err: error, count: exceptions.length }, 'exception insert failed')
  }
}

// ── Main processor ────────────────────────────────────────────────────────────

export async function processAttendanceForDate(
  supabase:    SupabaseClient,
  tenantId:    string,
  date:        string,
  logger?:     FastifyBaseLogger,
  triggeredBy?: string,            // profiles.id of the caller (for audit)
): Promise<ProcessResult> {
  const log = logger?.child({ module: 'attendance-processor', tenant_id: tenantId, date })
  const runStartedAt = Date.now()   // Step 3: wall-clock timer for duration_ms

  // Load raw punches by the tenant-LOCAL day, not a naive UTC day — otherwise the
  // window is offset by the tenant's UTC offset and punches near local midnight
  // are processed into the wrong date (wrong status / hours / OT).
  const { data: tzRow } = await supabase
    .from('tenants')
    .select('timezone')
    .eq('id', tenantId)
    .maybeSingle()
  const tenantTz: string = (tzRow as { timezone?: string } | null)?.timezone ?? 'Asia/Kolkata'
  const { startUtc: dayStart, endUtc: dayEnd } = localDayBoundsUtc(date, tenantTz)

  // ── 0. Holiday check — runs before everything else ────────────────────────
  // If this date is in holiday_calendar, every employee who punched in will
  // get status='holiday', work_hours=0.  Employees with NO raw logs are
  // unaffected (we never create absence rows for them regardless).
  // Optional (restricted/RH) holidays are not automatic days off — exclude them
  // so this legacy engine converges with payroll / attendance-engine.
  const { data: holidayRows, error: holidayError } = await supabase
    .from('holiday_calendar')
    .select('name, is_optional, location_id, site_id, holiday_group_id')
    .eq('tenant_id', tenantId)
    .eq('date', date)
    .eq('is_optional', false)

  if (holidayError) {
    // Non-fatal — log and continue without holiday override
    log?.warn({ err: holidayError }, 'holiday_calendar query failed — proceeding without holiday check')
  }

  const holidays: HolidayRow[]     = (!holidayError && holidayRows) ? holidayRows : []
  // Global holidays: site_id IS NULL AND location_id IS NULL → apply to all.
  // Site-specific: site_id IS NOT NULL → apply to employees at that site.
  // Location-specific (legacy): location_id IS NOT NULL → apply to employees at that work_location.
  const globalHolidays             = holidays.filter((h) => h.location_id === null && h.site_id === null)
  const siteSpecificHols           = holidays.filter((h) => h.site_id !== null)
  const locationSpecificHols       = holidays.filter((h) => h.location_id !== null && h.site_id === null)
  const holidayNames               = holidays.map((h) => h.name)
  const holidayName                = holidayNames.length > 0 ? holidayNames.join(', ') : null

  if (holidays.length > 0) {
    log?.info({
      holiday_name:             holidayName,
      holiday_names:            holidayNames,
      global_count:             globalHolidays.length,
      site_specific_count:      siteSpecificHols.length,
      location_specific_count:  locationSpecificHols.length,
      count:                    holidays.length,
    }, 'holidays found for date — will be applied per employee site/location')
  }

  // ── 1. Load UNPROCESSED raw logs for the date (Step 1) ───────────────────
  const { data: rawLogs, error: rawError } = await supabase
    .from('attendance_raw_logs')
    .select('id, employee_code, timestamp, direction')
    .eq('tenant_id', tenantId)
    .eq('processed', false)          // ← only unprocessed
    .gte('timestamp', dayStart)
    .lte('timestamp', dayEnd)
    .order('timestamp', { ascending: true })

  if (rawError) throw new Error(`Failed to load raw logs: ${rawError.message}`)

  if (!rawLogs || rawLogs.length === 0) {
    log?.info('no unprocessed raw logs found for date')
    // Step 3: still write an audit row so operators can confirm the run happened
    const { data: emptyRun } = await supabase
      .from('attendance_processing_runs')
      .insert({
        tenant_id: tenantId, date,
        processed_count: 0, skipped_count: 0, incomplete_count: 0,
        raw_logs_marked: 0, logs_created: 0, daily_upserted: 0,
        skipped_codes: [],
        triggered_by: triggeredBy ?? null,
        completed_at: new Date().toISOString(),
        duration_ms: Date.now() - runStartedAt,
      })
      .select('id')
      .single()
    return {
      date, tenant_id: tenantId,
      processed_employees: 0, attendance_logs_created: 0,
      daily_records_upserted: 0, raw_logs_marked: 0,
      skipped_codes: [], incomplete_sessions: 0,
      run_id: emptyRun?.id ?? '',
    }
  }

  // ── 2. Map employee_code → employee_id ────────────────────────────────────
  const uniqueCodes = [...new Set((rawLogs as RawLog[]).map((r) => r.employee_code))]

  const { data: employees, error: empError } = await supabase
    .from('employees')
    .select('id, employee_code')
    .eq('tenant_id', tenantId)
    .in('employee_code', uniqueCodes)

  if (empError) throw new Error(`Failed to load employees: ${empError.message}`)

  const codeToId = new Map<string, string>(
    (employees ?? []).map((e: { id: string; employee_code: string }) => [e.employee_code, e.id])
  )

  // Step 3: collect skipped codes + their raw log IDs (kept unprocessed)
  const skippedCodes: string[] = uniqueCodes.filter((c) => !codeToId.has(c))
  const skippedCodeSet = new Set(skippedCodes)

  if (skippedCodes.length > 0) {
    log?.warn(
      { skipped_codes: skippedCodes, count: skippedCodes.length },
      'employee codes not found — raw logs retained for retry on next run',
    )
  }

  // ── 3. Separate matched vs skipped raw log IDs ────────────────────────────
  const matchedRawIds: string[] = []

  // Group matched logs per employee
  const byEmployee = new Map<string, RawLog[]>()
  for (const raw of rawLogs as RawLog[]) {
    const empId = codeToId.get(raw.employee_code)
    if (!empId) {
      // Belongs to a skipped code — do NOT add to matchedRawIds
      continue
    }
    matchedRawIds.push(raw.id)
    if (!byEmployee.has(empId)) byEmployee.set(empId, [])
    byEmployee.get(empId)!.push(raw)
  }

  // Nothing matched — return early without marking anything processed
  if (byEmployee.size === 0) {
    const { data: noMatchRun } = await supabase
      .from('attendance_processing_runs')
      .insert({
        tenant_id: tenantId, date,
        processed_count: 0, skipped_count: skippedCodes.length, incomplete_count: 0,
        raw_logs_marked: 0, logs_created: 0, daily_upserted: 0,
        skipped_codes: skippedCodes,
        triggered_by: triggeredBy ?? null,
        completed_at: new Date().toISOString(),
        duration_ms: Date.now() - runStartedAt,
      })
      .select('id')
      .single()
    return {
      date, tenant_id: tenantId,
      processed_employees: 0, attendance_logs_created: 0,
      daily_records_upserted: 0, raw_logs_marked: 0,
      skipped_codes: skippedCodes, incomplete_sessions: 0,
      run_id: noMatchRun?.id ?? '',
    }
  }

  // ── 3.6. Batch-resolve shifts for every matched employee ─────────────────────
  // Single call to the unified shift-resolution-engine — full priority chain:
  //   shift_roster › rotation_policy › employee_shifts (temporal) › site_default
  // Returns full attribution (shift_id, source, rotation_policy_id, etc.)

  const matchedEmpIds = [...byEmployee.keys()]

  const resolvedShiftMap = await resolveShiftBatch(supabase, tenantId, matchedEmpIds, date)

  // ── 3.7. Resolve org context (site, roster, timezone, location) ──────────────
  const empOrgCtxMap = await resolveEmployeeOrgContextBatch(
    supabase, tenantId, matchedEmpIds, date,
  )

  function shiftMetaForEmployee(empId: string): ShiftMeta | undefined {
    const r = resolvedShiftMap.get(empId)
    return r ? toShiftMeta(r) : undefined
  }

  function shiftAttrForEmployee(empId: string): Partial<ResolvedShift> {
    const r = resolvedShiftMap.get(empId)
    if (!r) return {}
    return {
      shift_id:               r.shift_id,
      start_time:             r.start_time,
      end_time:               r.end_time,
      grace_minutes:          r.grace_minutes,
      is_night_shift:         r.is_night_shift,
      duration_minutes:       r.duration_minutes,
      resolution_source:      r.resolution_source,
      rotation_policy_id:     r.rotation_policy_id,
      rotation_condition_type: r.rotation_condition_type,
    }
  }

  // ── 4 & 5. Pair punches + compute daily per employee ─────────────────────

  const allLogRows:    AttendanceLogRow[] = []
  const allDailyRows:  DailyRow[]         = []
  let   incompleteSessions                = 0

  // Compute log accumulator (written fire-and-forget after daily upsert)
  type ComputeLogEntry = {
    employee_id: string; date: string
    inputs: Record<string, unknown>; result: Record<string, unknown>
    reason: string; source: 'system' | 'recompute' | 'correction' | 'manual'
  }
  const computeLogRows: ComputeLogEntry[] = []

  // AHI-1 rollout flag — when off, the shift-attribution snapshot is not
  // persisted (columns left null) and is omitted from the compute log. Shift
  // resolution above is unaffected; this only gates the new write behaviour.
  const attributionEnabled = isShiftAttributionEnabled()

  for (const [empId, logs] of byEmployee) {
    const sorted   = [...logs].sort(
      (a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
    )
    const sessions   = pairPunches(sorted, empId, tenantId)
    const shiftMeta  = shiftMetaForEmployee(empId)
    const shiftAttr  = shiftAttrForEmployee(empId)
    const empCtx     = empOrgCtxMap.get(empId) ?? {
      site_id: null, roster_id: null, work_location_id: null,
      site_timezone: 'Asia/Kolkata',
      emp_roster_weekly_off: [], site_default_roster_weekly_off: [],
      site_holiday_group_id: null,
      site_default_rotation_policy_id: null,
      site_default_shift_id: null,
    } satisfies EmployeeOrgContext
    const dayOfWeek = getLocalDayOfWeek(date, empCtx.site_timezone)
    const daily     = computeDaily(sessions, empId, tenantId, date, shiftMeta, empCtx.site_timezone)

    // ── Rule priority: Holiday (1) > Weekly Off (2) > Attendance (3) ────────
    // attendance_logs / raw_logs are never modified here — only the daily summary.
    if (orgIsHoliday(holidays, empCtx)) {
      // 1. Holiday — highest priority, overrides everything
      daily.status           = 'holiday'
      daily.work_hours       = 0
      daily.late_minutes     = 0
      daily.overtime_minutes = 0
      // Step 2: flag when employee actually punched in on a holiday
      if (sessions.length > 0) {
        daily.worked_on_holiday = true
      }
    } else if (orgGetWeeklyOffDays(
      [],   // shifts no longer carry weekly_off_days — roster is the sole source
      empCtx.emp_roster_weekly_off,
      empCtx.site_default_roster_weekly_off,
    ).includes(dayOfWeek)) {
      // 2. Weekly off day (from shift, roster, or standing shift)
      if (sessions.length === 0) {
        // No punch → clean weekly off
        daily.status           = 'weekly_off'
        daily.work_hours       = 0
        daily.late_minutes     = 0
        daily.overtime_minutes = 0
      } else {
        // Step 1: employee worked on their weekly off → present + flag it
        daily.status             = 'present'
        daily.worked_on_weekly_off = true
      }
    }
    // 3. Attendance: computeDaily result stands (present / late / half_day / absent)

    incompleteSessions += sessions.filter((s) => !s.is_complete).length

    allLogRows.push(...sessions)

    // Inject shift attribution snapshot into the daily row before persisting
    if (attributionEnabled && shiftAttr.shift_id) {
      daily.expected_shift_id       = shiftAttr.shift_id
      daily.shift_start_time        = shiftAttr.start_time ?? null
      daily.shift_end_time          = shiftAttr.end_time ?? null
      daily.shift_grace_minutes     = shiftAttr.grace_minutes ?? null
      daily.shift_is_night_shift    = shiftAttr.is_night_shift ?? null
      daily.shift_duration_minutes  = shiftAttr.duration_minutes ?? null
      daily.resolution_source       = shiftAttr.resolution_source ?? null
      daily.rotation_policy_id      = shiftAttr.rotation_policy_id ?? null
      daily.rotation_condition_type = shiftAttr.rotation_condition_type ?? null
    }

    allDailyRows.push(daily)

    // Accumulate compute log entry
    computeLogRows.push({
      employee_id: empId,
      date,
      inputs: {
        sessions_count:    sessions.length,
        complete_sessions: sessions.filter((s) => s.is_complete).length,
        shift_meta:        shiftMeta ? {
          shift_id:            attributionEnabled ? (shiftAttr.shift_id ?? null) : null,
          start_time:          shiftMeta.startTime,
          end_time:            shiftMeta.endTime,
          grace_minutes:       shiftMeta.graceMinutes,
          is_night_shift:      shiftMeta.isNightShift,
          resolution_source:   attributionEnabled ? (shiftAttr.resolution_source ?? null) : null,
          rotation_policy_id:  attributionEnabled ? (shiftAttr.rotation_policy_id ?? null) : null,
        } : null,
        day_of_week: dayOfWeek,
        is_holiday:       orgIsHoliday(holidays, empCtx),
        weekly_off_days:  orgGetWeeklyOffDays(
          [],   // shifts no longer carry weekly_off_days
          empCtx.emp_roster_weekly_off,
          empCtx.site_default_roster_weekly_off,
        ),
        emp_site_id:      empCtx.site_id,
      },
      result: {
        status:               daily.status,
        work_hours:           daily.work_hours,
        late_minutes:         daily.late_minutes,
        overtime_minutes:     daily.overtime_minutes,
        is_payable:           daily.is_payable,
        day_fraction:         daily.day_fraction,
        worked_on_holiday:    daily.worked_on_holiday,
        worked_on_weekly_off: daily.worked_on_weekly_off,
      },
      reason: deriveComputeReason(daily, sessions, shiftMeta),
      source: 'system',
    })
  }

  // ── 6. Delete existing attendance_logs for matched employees this date ─────
  // Scoped per-employee so we don't clobber other employees' already-processed data.
  // (matchedEmpIds was declared in step 3.6 above — used here again for clarity.)
  const { error: deleteError } = await supabase
    .from('attendance_logs')
    .delete()
    .eq('tenant_id', tenantId)
    .in('employee_id', matchedEmpIds)
    .gte('check_in', dayStart)
    .lte('check_in', dayEnd)

  if (deleteError) throw new Error(`Failed to clear old attendance_logs: ${deleteError.message}`)

  // Step 2: ON CONFLICT DO NOTHING on uq_attendance_logs_checkin
  // This prevents duplicates even if the delete above races with another insert.
  const { error: logInsertError } = await supabase
    .from('attendance_logs')
    .upsert(allLogRows, { onConflict: 'tenant_id,employee_id,check_in', ignoreDuplicates: true })

  if (logInsertError) throw new Error(`Failed to insert attendance_logs: ${logInsertError.message}`)

  // ── 7. Upsert attendance_daily ────────────────────────────────────────────
  if (allDailyRows.length > 0) {
    // Fetch pre-existing statuses so audit log can record before/after changes
    const { data: existingDaily } = await supabase
      .from('attendance_daily')
      .select('employee_id, date, status')
      .eq('tenant_id', tenantId)
      .in('employee_id', matchedEmpIds)
      .eq('date', date)

    const existingStatusMap = new Map<string, string>(
      (existingDaily ?? []).map((r: { employee_id: string; date: string; status: string }) =>
        [`${r.employee_id}:${r.date}`, r.status]
      )
    )

    const { error: dailyError } = await supabase
      .from('attendance_daily')
      .upsert(allDailyRows, { onConflict: 'tenant_id,employee_id,date' })

    if (dailyError) throw new Error(`Failed to upsert attendance_daily: ${dailyError.message}`)

    // ── Intelligence generation (fire-and-forget, non-fatal) ─────────────────
    // Generates exceptions, computes confidence scores, and detects policy conflicts
    // for each processed daily row. Failures are non-fatal.
    void generateAttendanceIntelligence(supabase, tenantId, allDailyRows, byEmployee, resolvedShiftMap, log).catch(
      (err) => log?.warn({ err }, 'attendance intelligence generation failed — non-fatal')
    )

    // Write audit entries for rows whose status changed (or were newly created)
    const auditChanges = allDailyRows
      .filter((r) => existingStatusMap.get(`${r.employee_id}:${r.date}`) !== r.status)
      .map((r) => ({
        employee_id:   r.employee_id,
        date:          r.date,
        before_status: existingStatusMap.get(`${r.employee_id}:${r.date}`) ?? null,
        after_status:  r.status,
      }))

    // Run audit log write in parallel with next step (non-fatal — don't await failure)
    writeAuditLogs(supabase, tenantId, 'system', auditChanges, triggeredBy ?? null, undefined, log)

    // Write compute logs (fire-and-forget — never blocks the main response)
    writeComputeLogs(supabase, tenantId, computeLogRows, log)
  }

  // ── 8. Mark matched raw logs as processed = true ───────────────────────────
  // Skipped-code logs stay processed = false — picked up on next run.
  const CHUNK = 500
  for (let i = 0; i < matchedRawIds.length; i += CHUNK) {
    const chunk = matchedRawIds.slice(i, i + CHUNK)
    const { error: markError } = await supabase
      .from('attendance_raw_logs')
      .update({ processed: true })
      .in('id', chunk)

    if (markError) throw new Error(`Failed to mark raw logs processed: ${markError.message}`)
  }

  // ── 9. Step 3: Write audit run row ────────────────────────────────────────
  const { data: auditRun, error: auditError } = await supabase
    .from('attendance_processing_runs')
    .insert({
      tenant_id:        tenantId,
      date,
      processed_count:  byEmployee.size,
      skipped_count:    skippedCodes.length,
      skipped_codes:    skippedCodes,
      incomplete_count: incompleteSessions,
      raw_logs_marked:  matchedRawIds.length,
      logs_created:     allLogRows.length,
      daily_upserted:   allDailyRows.length,
      triggered_by:     triggeredBy ?? null,
      completed_at:     new Date().toISOString(),
      duration_ms:      Date.now() - runStartedAt,
    })
    .select('id')
    .single()

  if (auditError) {
    // Non-fatal — log but don't fail the whole run
    log?.warn({ err: auditError }, 'failed to write audit run row')
  }

  const durationMs = Date.now() - runStartedAt
  const runId      = auditRun?.id ?? ''

  // ── Phase 2: Emit attendance.recomputed event to in-process event bus ─────
  eventBus.emit({
    type:          'attendance.recomputed',
    tenantId,
    correlationId: triggeredBy ?? 'system',
    payload: {
      tenantId,
      date,
      employeeCount: byEmployee.size,
      runId:         runId || null,
      triggeredBy:   triggeredBy ?? undefined,
    },
  })

  // ── Step 3: Alert on slow or failed runs ──────────────────────────────────
  const SLOW_THRESHOLD_MS = 5_000

  if (durationMs > SLOW_THRESHOLD_MS) {
    log?.warn(
      {
        run_id:      runId,
        duration_ms: durationMs,
        threshold_ms: SLOW_THRESHOLD_MS,
        tenant_id:   tenantId,
        date,
      },
      `attendance processing exceeded slow threshold (${durationMs} ms > ${SLOW_THRESHOLD_MS} ms)`,
    )
  }

  const result: ProcessResult = {
    date,
    tenant_id:               tenantId,
    processed_employees:     byEmployee.size,
    attendance_logs_created: allLogRows.length,
    daily_records_upserted:  allDailyRows.length,
    raw_logs_marked:         matchedRawIds.length,
    skipped_codes:           skippedCodes,
    incomplete_sessions:     incompleteSessions,
    run_id:                  runId,
  }

  log?.info({
    ...result,
    has_holidays:            holidays.length > 0,
    global_holiday_count:    globalHolidays.length,
    location_holiday_count:  locationSpecificHols.length,
    holiday_name:            holidayName,
    holiday_names:           holidayNames,
  }, 'attendance processing complete')
  return result
}

// ── Regularisation: recompute attendance_daily for a single employee+date ─────
//
// Called when an attendance_regularisation request is approved.
// Constructs a synthetic session from the requested check-in/check-out times,
// runs the same computeDaily logic, and upserts the result.
// Does NOT touch attendance_raw_logs or attendance_logs.

export async function recomputeDailyForEmployee(
  supabase:           SupabaseClient,
  tenantId:           string,
  employeeId:         string,
  date:               string,
  requestedCheckIn:   string | null,
  requestedCheckOut:  string | null,
  logger?:            FastifyBaseLogger,
  beforeStatus?:      string | null,   // pass from caller to avoid a second DB round-trip
  changedBy?:         string | null,
  auditMetadata?:     Record<string, unknown>,
): Promise<void> {
  const log = logger?.child({ module: 'attendance-recompute', employee_id: employeeId, date })

  // Build synthetic session from the approved regularisation times
  const synthSessions: AttendanceLogRow[] = []
  if (requestedCheckIn) {
    synthSessions.push({
      tenant_id:   tenantId,
      employee_id: employeeId,
      check_in:    requestedCheckIn,
      check_out:   requestedCheckOut ?? null,
      is_complete: requestedCheckOut !== null,
    })
  }

  // Resolve shift for this employee (priority: roster > standing > site default)
  const recomputeCtx = await resolveEmployeeOrgContext(supabase, tenantId, employeeId, date)
  const timezone     = recomputeCtx.site_timezone

  const { data: rosterRow } = await supabase
    .from('shift_roster')
    .select('shift_id')
    .eq('tenant_id', tenantId)
    .eq('employee_id', employeeId)
    .eq('date', date)
    .maybeSingle()

  let shiftId: string | null = rosterRow?.shift_id ?? null

  if (!shiftId) {
    const { data: standingRow } = await supabase
      .from('employee_shifts')
      .select('shift_id')
      .eq('tenant_id', tenantId)
      .eq('employee_id', employeeId)
      .eq('is_current', true)
      .maybeSingle()
    shiftId = standingRow?.shift_id ?? null
  }

  // 3rd fallback: site default shift
  if (!shiftId) {
    shiftId = recomputeCtx.site_default_shift_id
  }

  let shiftMeta: ShiftMeta | undefined
  if (shiftId) {
    const { data: shift } = await supabase
      .from('shifts')
      .select('start_time, end_time, grace_minutes, is_night_shift')
      .eq('id', shiftId)
      .single()
    if (shift) {
      shiftMeta = {
        startTime:    shift.start_time,
        endTime:      shift.end_time,
        graceMinutes: shift.grace_minutes,
        isNightShift: shift.is_night_shift,
      }
    }
  }

  const daily = computeDaily(synthSessions, employeeId, tenantId, date, shiftMeta, timezone)

  const { error } = await supabase
    .from('attendance_daily')
    .upsert(daily, { onConflict: 'tenant_id,employee_id,date' })

  if (error) {
    log?.error({ err: error }, 'recomputeDailyForEmployee upsert failed')
    throw new Error(`Failed to recompute attendance_daily: ${error.message}`)
  }

  // Write audit entry (non-fatal)
  await writeAuditLogs(
    supabase, tenantId, 'regularisation',
    [{ employee_id: employeeId, date, before_status: beforeStatus ?? null, after_status: daily.status }],
    changedBy ?? null,
    auditMetadata,
    log,
  )

  log?.info('attendance_daily recomputed from regularisation')
}

// ── Step 3: Write a failure audit row when the processor throws ───────────────
// Called from the process route so that every run (success or error) has a row.

export async function writeFailedAuditRun(
  supabase:     SupabaseClient,
  tenantId:     string,
  date:         string,
  errorMessage: string,
  durationMs:   number,
  triggeredBy?: string,
  logger?:      FastifyBaseLogger,
): Promise<string> {
  const { data, error } = await supabase
    .from('attendance_processing_runs')
    .insert({
      tenant_id:        tenantId,
      date,
      processed_count:  0,
      skipped_count:    0,
      skipped_codes:    [],
      incomplete_count: 0,
      raw_logs_marked:  0,
      logs_created:     0,
      daily_upserted:   0,
      triggered_by:     triggeredBy ?? null,
      completed_at:     new Date().toISOString(),
      duration_ms:      durationMs,
      error_message:    errorMessage,
    })
    .select('id')
    .single()

  if (error) {
    logger?.warn({ err: error }, 'failed to write error audit run row')
    return ''
  }

  // Step 3: always warn on failed runs, regardless of duration
  logger?.warn(
    { run_id: data?.id, duration_ms: durationMs, error_message: errorMessage, tenant_id: tenantId, date },
    'attendance processing run failed — audit row written',
  )

  return data?.id ?? ''
}
