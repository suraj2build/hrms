/**
 * Attendance Reconciliation Engine
 *
 * Non-destructive integrity scanner that detects divergence between the three
 * layers of attendance data:
 *
 *   Layer 1 — attendance_raw_logs   (immutable device punches)
 *   Layer 2 — attendance_logs       (processed IN/OUT sessions)
 *   Layer 3 — attendance_daily      (computed daily summaries)
 *
 * Issue types detected:
 *
 *   orphan_raw_log         — raw_log with processed=false older than STALE_RAW_HOURS
 *   incomplete_session     — attendance_log with no check_out after INCOMPLETE_SESSION_HOURS
 *   missing_daily_row      — employee has session(s) on a date but no attendance_daily row
 *   duplicate_session      — multiple attendance_logs for same employee on the same date
 *   cross_day_session      — check_in/check_out span midnight (potential cross-day error)
 *   stale_processing_gap   — no attendance_processing_runs completed for a date range
 *   missing_raw_source     — attendance_daily row exists but no raw_logs for that date
 *
 * The engine NEVER modifies source data. All results are written to
 * attendance_reconciliation_runs / attendance_reconciliation_issues.
 *
 * Each issue carries a structured `detail` JSONB object and a human-readable
 * `suggestion` so operators know exactly what to fix and how.
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import { fetchAllRows } from './supabase-paginate.js'
import { fetchTenantTz, utcToLocalDate } from './attendance-engine.js'
import { logger } from './logger.js'

// ── Constants ──────────────────────────────────────────────────────────────────

/** Unprocessed raw logs older than this many hours are flagged as orphans. */
const STALE_RAW_HOURS = 8

/**
 * Sessions with no check_out after this many hours are flagged as incomplete.
 * 14 hours covers any normal working day + reasonable overtime.
 */
const INCOMPLETE_SESSION_HOURS = 14

/** Max issues written per run (prevents runaway scans on very dirty data). */
const MAX_ISSUES_PER_RUN = 2_000

// ── Types ──────────────────────────────────────────────────────────────────────

export type IssueType =
  | 'orphan_raw_log'
  | 'incomplete_session'
  | 'missing_daily_row'
  | 'duplicate_session'
  | 'cross_day_session'
  | 'stale_processing_gap'
  | 'missing_raw_source'

export type IssueSeverity = 'info' | 'warning' | 'error' | 'critical'

export interface ReconciliationIssue {
  issue_type:   IssueType
  severity:     IssueSeverity
  employee_id:  string | null
  date:         string | null   // ISO date string YYYY-MM-DD
  detail:       Record<string, unknown>
  suggestion:   string
}

export interface ReconciliationRunResult {
  run_id:          string
  tenant_id:       string
  scan_from:       string
  scan_to:         string
  total_issues:    number
  critical_count:  number
  error_count:     number
  warning_count:   number
  issue_breakdown: Record<IssueType, number>
  duration_ms:     number
}

// ── Helpers ────────────────────────────────────────────────────────────────────

function hoursAgo(hours: number): string {
  return new Date(Date.now() - hours * 60 * 60 * 1_000).toISOString()
}

/** Returns the date part (YYYY-MM-DD) of an ISO timestamp string. */
function dateOf(ts: string): string {
  return ts.slice(0, 10)
}

/** Batch-insert issues in chunks to stay within Supabase payload limits. */
async function flushIssues(
  supabase:  SupabaseClient,
  runId:     string,
  tenantId:  string,
  issues:    ReconciliationIssue[],
): Promise<void> {
  if (issues.length === 0) return
  const CHUNK = 200
  for (let i = 0; i < issues.length; i += CHUNK) {
    const chunk = issues.slice(i, i + CHUNK).map(iss => ({
      run_id:     runId,
      tenant_id:  tenantId,
      ...iss,
    }))
    const { error } = await supabase
      .from('attendance_reconciliation_issues')
      .insert(chunk)
    if (error) {
      logger.error({ err: error }, '[attendance-reconciliation] issue flush error')
    }
  }
}

// ── Check functions ────────────────────────────────────────────────────────────

/**
 * Check 1 — Orphan raw logs
 * Raw logs with processed=false older than STALE_RAW_HOURS.
 * Severity: error (blocking — data is stuck in pipeline).
 */
async function checkOrphanRawLogs(
  supabase:  SupabaseClient,
  tenantId:  string,
  scanFrom:  string,
  scanTo:    string,
): Promise<ReconciliationIssue[]> {
  const cutoff = hoursAgo(STALE_RAW_HOURS)

  // This scanner exists to find every current backlog item, not a sample —
  // a fixed .limit(500) would silently hide the rest of a real backlog (e.g.
  // after a processor outage) from both the issue log and whoever is fixing it.
  const data = await fetchAllRows((from, to) =>
    supabase
      .from('attendance_raw_logs')
      .select('id, employee_code, timestamp, direction, device_id')
      .eq('tenant_id', tenantId)
      .eq('processed', false)
      .gte('timestamp', `${scanFrom}T00:00:00Z`)
      .lte('timestamp', `${scanTo}T23:59:59Z`)
      .lt('timestamp', cutoff)
      .range(from, to),
  ).catch(() => [])

  if (!data.length) return []

  return data.map((row: any) => {
    const ageHours = Math.round((Date.now() - new Date(row.timestamp).getTime()) / 3_600_000)
    return {
      issue_type:  'orphan_raw_log' as IssueType,
      severity:    ageHours > 24 ? 'critical' : ('error' as IssueSeverity),
      employee_id: null,   // raw logs don't have employee_id — only employee_code
      date:        dateOf(row.timestamp),
      detail: {
        raw_log_id:    row.id,
        employee_code: row.employee_code,
        timestamp:     row.timestamp,
        direction:     row.direction,
        device_id:     row.device_id,
        age_hours:     ageHours,
      },
      suggestion: `Raw punch log for employee_code=${row.employee_code} (${row.direction} at ${row.timestamp}) has not been processed after ${ageHours}h. Run POST /attendance/process to re-trigger the processor, or check if the employee_code maps to an active employee.`,
    }
  })
}

/**
 * Check 2 — Incomplete sessions
 * attendance_logs with is_complete=false where check_in is older than INCOMPLETE_SESSION_HOURS.
 * Severity: warning (missing check_out; employee still "clocked in").
 */
async function checkIncompleteSessions(
  supabase:  SupabaseClient,
  tenantId:  string,
  scanFrom:  string,
  scanTo:    string,
): Promise<ReconciliationIssue[]> {
  const cutoff = hoursAgo(INCOMPLETE_SESSION_HOURS)

  // Same reasoning as checkOrphanRawLogs above — this must catch every open
  // session, not just the first 500.
  const data = await fetchAllRows((from, to) =>
    supabase
      .from('attendance_logs')
      .select('id, employee_id, check_in, check_out')
      .eq('tenant_id', tenantId)
      .eq('is_complete', false)
      .gte('check_in', `${scanFrom}T00:00:00Z`)
      .lte('check_in', `${scanTo}T23:59:59Z`)
      .lt('check_in', cutoff)
      .range(from, to),
  ).catch(() => [])

  if (!data.length) return []

  return data.map((row: any) => {
    const hoursOpen = Math.round((Date.now() - new Date(row.check_in).getTime()) / 3_600_000)
    return {
      issue_type:  'incomplete_session' as IssueType,
      severity:    hoursOpen > 24 ? 'error' : ('warning' as IssueSeverity),
      employee_id: row.employee_id,
      date:        dateOf(row.check_in),
      detail: {
        session_id: row.id,
        check_in:   row.check_in,
        hours_open: hoursOpen,
      },
      suggestion: `Session for employee ${row.employee_id} clocked in at ${row.check_in} has no check_out punch after ${hoursOpen}h. Check device logs for a missed OUT punch, or use POST /attendance/regularisation to supply a manual check_out time.`,
    }
  })
}

/**
 * Check 3 — Missing daily rows
 * Employees have attendance_logs sessions on a date but no attendance_daily row.
 * Severity: error (payroll will use 0-hours defaults).
 */
async function checkMissingDailyRows(
  supabase:  SupabaseClient,
  tenantId:  string,
  scanFrom:  string,
  scanTo:    string,
): Promise<ReconciliationIssue[]> {
  // Get all employee+date combos that have sessions
  const sessions = await fetchAllRows((from, to) =>
    supabase
      .from('attendance_logs')
      .select('employee_id, check_in')
      .eq('tenant_id', tenantId)
      .gte('check_in', `${scanFrom}T00:00:00Z`)
      .lte('check_in', `${scanTo}T23:59:59Z`)
      .range(from, to)
  ).catch(() => [])

  if (!sessions?.length) return []

  // Build set of employee+date from sessions
  const sessionDates = new Map<string, string>()  // key: empId|date, value: date
  for (const s of sessions as any[]) {
    const d = dateOf(s.check_in)
    sessionDates.set(`${s.employee_id}|${d}`, d)
  }

  if (sessionDates.size === 0) return []

  // Get all employee+date combos in attendance_daily for the same range
  const empIds = [...new Set((sessions as any[]).map((s: any) => s.employee_id))]
  const dailyRows = await fetchAllRows((from, to) =>
    supabase
      .from('attendance_daily')
      .select('employee_id, date')
      .eq('tenant_id', tenantId)
      .in('employee_id', empIds)
      .gte('date', scanFrom)
      .lte('date', scanTo)
      .range(from, to)
  ).catch(() => [])

  const dailySet = new Set<string>(
    (dailyRows ?? []).map((r: any) => `${r.employee_id}|${r.date}`)
  )

  const issues: ReconciliationIssue[] = []
  for (const [key, date] of sessionDates) {
    if (!dailySet.has(key)) {
      const empId = key.split('|')[0]
      issues.push({
        issue_type:  'missing_daily_row',
        severity:    'error',
        employee_id: empId,
        date,
        detail: { employee_id: empId, date },
        suggestion: `Employee ${empId} has attendance session(s) on ${date} but no attendance_daily row. Run POST /attendance/process?date=${date} or POST /attendance/recompute for this employee to regenerate the daily summary.`,
      })
    }
    if (issues.length >= 500) break
  }
  return issues
}

/**
 * Check 4 — Duplicate sessions
 * Multiple attendance_logs records for the same employee on the same calendar date.
 * Severity: warning (double-counted hours; payroll may inflate).
 */
async function checkDuplicateSessions(
  supabase:  SupabaseClient,
  tenantId:  string,
  scanFrom:  string,
  scanTo:    string,
): Promise<ReconciliationIssue[]> {
  const data = await fetchAllRows((from, to) =>
    supabase
      .from('attendance_logs')
      .select('id, employee_id, check_in, check_out, is_complete')
      .eq('tenant_id', tenantId)
      .gte('check_in', `${scanFrom}T00:00:00Z`)
      .lte('check_in', `${scanTo}T23:59:59Z`)
      .order('employee_id')
      .order('check_in')
      .range(from, to)
  )

  if (!data?.length) return []

  // Group by employee+date
  const byEmpDate = new Map<string, any[]>()
  for (const row of data as any[]) {
    const key = `${row.employee_id}|${dateOf(row.check_in)}`
    const arr = byEmpDate.get(key) ?? []
    arr.push(row)
    byEmpDate.set(key, arr)
  }

  const issues: ReconciliationIssue[] = []
  for (const [key, rows] of byEmpDate) {
    if (rows.length > 1) {
      const [empId, date] = key.split('|')
      issues.push({
        issue_type:  'duplicate_session',
        severity:    'warning',
        employee_id: empId,
        date,
        detail: {
          count:          rows.length,
          session_ids:    rows.map((r: any) => r.id),
          check_in_times: rows.map((r: any) => r.check_in),
        },
        suggestion: `Employee ${empId} has ${rows.length} attendance_logs sessions on ${date}. Review for duplicate device punches or device clock issues. Retain the most accurate session and delete duplicates via the attendance corrections API.`,
      })
      if (issues.length >= 500) break
    }
  }
  return issues
}

/**
 * Check 5 — Cross-day sessions
 * Sessions where check_out is on a different calendar date than check_in.
 * Severity: info (may be legitimate night shifts; flagged for review).
 */
async function checkCrossDaySessions(
  supabase:  SupabaseClient,
  tenantId:  string,
  scanFrom:  string,
  scanTo:    string,
): Promise<ReconciliationIssue[]> {
  const data = await fetchAllRows((from, to) =>
    supabase
      .from('attendance_logs')
      .select('id, employee_id, check_in, check_out')
      .eq('tenant_id', tenantId)
      .eq('is_complete', true)
      .gte('check_in', `${scanFrom}T00:00:00Z`)
      .lte('check_in', `${scanTo}T23:59:59Z`)
      .not('check_out', 'is', null)
      .range(from, to)
  )

  if (!data?.length) return []

  const issues: ReconciliationIssue[] = []
  for (const row of data as any[]) {
    if (dateOf(row.check_in) !== dateOf(row.check_out)) {
      const inDate  = dateOf(row.check_in)
      const outDate = dateOf(row.check_out)
      const spanHours = Math.round(
        (new Date(row.check_out).getTime() - new Date(row.check_in).getTime()) / 3_600_000
      )
      issues.push({
        issue_type:  'cross_day_session',
        severity:    spanHours > 16 ? 'warning' : ('info' as IssueSeverity),
        employee_id: row.employee_id,
        date:        inDate,
        detail: {
          session_id: row.id,
          check_in:   row.check_in,
          check_out:  row.check_out,
          span_hours: spanHours,
          out_date:   outDate,
        },
        suggestion: `Session for employee ${row.employee_id} spans midnight (${inDate} → ${outDate}, ${spanHours}h). If this is not a night-shift employee, verify the check_out timestamp is not a device clock error.`,
      })
      if (issues.length >= 300) break
    }
  }
  return issues
}

/**
 * Check 6 — Stale processing gap
 * Date ranges within [scanFrom, scanTo] with no completed attendance_processing_runs.
 * Severity: critical (entire dates missing from computed summaries).
 */
async function checkStaleProcessingGap(
  supabase:  SupabaseClient,
  tenantId:  string,
  scanFrom:  string,
  scanTo:    string,
): Promise<ReconciliationIssue[]> {
  const { data, error } = await supabase
    .from('attendance_processing_runs')
    .select('date, completed_at, error_message')
    .eq('tenant_id', tenantId)
    .gte('date', scanFrom)
    .lte('date', scanTo)
    .not('completed_at', 'is', null)
    .is('error_message', null)   // only successful runs

  if (error) return []

  const processedDates = new Set<string>(
    (data ?? []).map((r: any) => r.date as string)
  )

  // Generate expected date range
  const from  = new Date(scanFrom)
  const to    = new Date(scanTo)
  // Exclude the current day (may not have been processed yet) — computed in the
  // tenant's local timezone, since a UTC "today" near IST midnight is off by one.
  const tenantTz = await fetchTenantTz(supabase, tenantId)
  const today = utcToLocalDate(new Date(), tenantTz)

  const gaps: string[] = []
  const cursor = new Date(from)
  while (cursor < to) {
    const d = cursor.toISOString().slice(0, 10)
    if (d < today && !processedDates.has(d)) {
      gaps.push(d)
    }
    cursor.setDate(cursor.getDate() + 1)
  }

  if (gaps.length === 0) return []

  // Collapse consecutive gaps into ranges for readability
  const ranges: Array<{ from: string; to: string; days: number }> = []
  let rangeStart = gaps[0]
  let rangeEnd   = gaps[0]
  for (let i = 1; i < gaps.length; i++) {
    const prev = new Date(rangeEnd)
    prev.setDate(prev.getDate() + 1)
    if (prev.toISOString().slice(0, 10) === gaps[i]) {
      rangeEnd = gaps[i]
    } else {
      ranges.push({ from: rangeStart, to: rangeEnd, days: gaps.filter(g => g >= rangeStart && g <= rangeEnd).length })
      rangeStart = gaps[i]
      rangeEnd   = gaps[i]
    }
  }
  ranges.push({ from: rangeStart, to: rangeEnd, days: gaps.filter(g => g >= rangeStart && g <= rangeEnd).length })

  return ranges.map(r => ({
    issue_type:  'stale_processing_gap' as IssueType,
    severity:    (r.days >= 3 ? 'critical' : 'error') as IssueSeverity,
    employee_id: null,
    date:        r.from,
    detail: {
      gap_from:   r.from,
      gap_to:     r.to,
      gap_days:   r.days,
      all_dates:  gaps.filter(g => g >= r.from && g <= r.to),
    },
    suggestion: `No successful attendance processing run found for ${r.days} date(s) from ${r.from} to ${r.to}. POST /attendance/process for each missing date, or investigate why the scheduler skipped these dates.`,
  }))
}

/**
 * Check 7 — Missing raw source
 * attendance_daily rows that have no corresponding raw_logs for the same date.
 * Severity: info (daily row may have been created manually or via leave engine).
 */
async function checkMissingRawSource(
  supabase:  SupabaseClient,
  tenantId:  string,
  scanFrom:  string,
  scanTo:    string,
): Promise<ReconciliationIssue[]> {
  // Only check rows where computed_source = 'engine' — leave/manual sources are expected.
  // Paginated — a fixed .limit(1000) silently missed engine-computed rows
  // past the cap for a large tenant/date range, the same CLAUDE.md-documented
  // attendance_daily truncation class fixed elsewhere in this codebase.
  const dailyRows = await fetchAllRows((from, to) =>
    supabase
      .from('attendance_daily')
      .select('employee_id, date, computed_source')
      .eq('tenant_id', tenantId)
      .eq('computed_source', 'engine')
      .gte('date', scanFrom)
      .lte('date', scanTo)
      .range(from, to),
  ).catch(() => [])

  if (!dailyRows.length) return []

  // Get all employees with at least one raw log in the range
  const rawRows = await fetchAllRows((from, to) =>
    supabase
      .from('attendance_raw_logs')
      .select('employee_code, timestamp')
      .eq('tenant_id', tenantId)
      .gte('timestamp', `${scanFrom}T00:00:00Z`)
      .lte('timestamp', `${scanTo}T23:59:59Z`)
      .range(from, to)
  )

  // Map employee_code → dates with raw logs
  // We don't have employee_id on raw_logs, so we need to join via employees
  // For this check, we approximate: count of raw logs per date as a proxy.
  const rawDateSet = new Set<string>(
    (rawRows ?? []).map((r: any) => dateOf(r.timestamp))
  )

  // Flag engine-computed daily rows on dates with zero raw logs at all
  const issues: ReconciliationIssue[] = []
  for (const row of dailyRows as any[]) {
    if (!rawDateSet.has(row.date)) {
      issues.push({
        issue_type:  'missing_raw_source',
        severity:    'info',
        employee_id: row.employee_id,
        date:        row.date,
        detail: {
          employee_id:     row.employee_id,
          date:            row.date,
          computed_source: row.computed_source,
        },
        suggestion: `attendance_daily row for employee ${row.employee_id} on ${row.date} was computed by the engine but no raw_logs exist for this date (entire tenant has no device punches). This may be a device connectivity gap. Verify biometric device logs.`,
      })
      if (issues.length >= 200) break
    }
  }
  return issues
}

// ── Main reconciliation runner ─────────────────────────────────────────────────

export async function runAttendanceReconciliation(
  supabase:    SupabaseClient,
  tenantId:    string,
  scanFrom:    string,
  scanTo:      string,
  triggeredBy: string | null = null,
  source:      'manual' | 'scheduler' | 'api' = 'api',
): Promise<ReconciliationRunResult> {
  const startMs = Date.now()

  // Create run record
  const { data: run, error: runErr } = await supabase
    .from('attendance_reconciliation_runs')
    .insert({
      tenant_id:     tenantId,
      status:        'running',
      scan_from:     scanFrom,
      scan_to:       scanTo,
      triggered_by:  triggeredBy,
      trigger_source: source,
    })
    .select('id')
    .single()

  if (runErr || !run) {
    throw new Error(`Failed to create reconciliation run: ${runErr?.message}`)
  }

  const runId = run.id as string

  try {
    // Run all checks in parallel (they read disjoint tables)
    const [
      orphans,
      incomplete,
      missingDaily,
      duplicates,
      crossDay,
      gaps,
      missingRaw,
    ] = await Promise.all([
      checkOrphanRawLogs(supabase, tenantId, scanFrom, scanTo),
      checkIncompleteSessions(supabase, tenantId, scanFrom, scanTo),
      checkMissingDailyRows(supabase, tenantId, scanFrom, scanTo),
      checkDuplicateSessions(supabase, tenantId, scanFrom, scanTo),
      checkCrossDaySessions(supabase, tenantId, scanFrom, scanTo),
      checkStaleProcessingGap(supabase, tenantId, scanFrom, scanTo),
      checkMissingRawSource(supabase, tenantId, scanFrom, scanTo),
    ])

    // Combine and cap
    let allIssues = [
      ...orphans, ...incomplete, ...missingDaily, ...duplicates,
      ...crossDay, ...gaps, ...missingRaw,
    ].slice(0, MAX_ISSUES_PER_RUN)

    // Write issues to DB
    await flushIssues(supabase, runId, tenantId, allIssues)

    // Compute breakdown
    const breakdown: Record<string, number> = {}
    let critical = 0, error = 0, warning = 0
    for (const iss of allIssues) {
      breakdown[iss.issue_type] = (breakdown[iss.issue_type] ?? 0) + 1
      if (iss.severity === 'critical') critical++
      else if (iss.severity === 'error') error++
      else if (iss.severity === 'warning') warning++
    }

    const durationMs = Date.now() - startMs

    // Finalize run
    await supabase
      .from('attendance_reconciliation_runs')
      .update({
        status:          'completed',
        completed_at:    new Date().toISOString(),
        duration_ms:     durationMs,
        total_issues:    allIssues.length,
        critical_count:  critical,
        error_count:     error,
        warning_count:   warning,
        issue_breakdown: breakdown,
      })
      .eq('id', runId)

    return {
      run_id:          runId,
      tenant_id:       tenantId,
      scan_from:       scanFrom,
      scan_to:         scanTo,
      total_issues:    allIssues.length,
      critical_count:  critical,
      error_count:     error,
      warning_count:   warning,
      issue_breakdown: breakdown as Record<IssueType, number>,
      duration_ms:     durationMs,
    }
  } catch (err: any) {
    await supabase
      .from('attendance_reconciliation_runs')
      .update({ status: 'failed', error: err.message, completed_at: new Date().toISOString() })
      .eq('id', runId)
    throw err
  }
}
