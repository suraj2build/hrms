/**
 * Attendance Freshness Engine
 *
 * Answers two operational questions:
 *
 *   1. "Is our attendance data up-to-date?"
 *      Compares the most recent attendance_daily row per employee against a
 *      staleness threshold. Employees with no data in the last N days are
 *      classified as "stale" or "missing".
 *
 *   2. "Is the raw log pipeline healthy?"
 *      Counts unprocessed raw_logs and measures how old the oldest one is.
 *      A growing backlog indicates the processor is not running.
 *
 * Results are written to `attendance_freshness_snapshots` (one row per tenant
 * per day, upserted). This allows trend queries without re-scanning raw tables.
 *
 * Health classification:
 *   healthy   — all employees fresh, no unprocessed raw log backlog
 *   degraded  — some employees stale OR small raw log backlog (< 100)
 *   critical  — many stale employees (> 20%) OR large backlog (> 500) OR
 *               no processing run in > 48h
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import { fetchAllRows } from './supabase-paginate.js'
import { fetchTenantTz } from './attendance-engine.js'
import { getLocalDate } from './org-context.js'

// ── Constants ──────────────────────────────────────────────────────────────────

/** Employees with their latest attendance_daily row older than this are stale. */
const DEFAULT_STALE_DAYS = 2

/** Raw log backlog thresholds for health classification. */
const BACKLOG_DEGRADED  = 100
const BACKLOG_CRITICAL  = 500

/** Percentage of stale employees that triggers critical status. */
const STALE_PCT_CRITICAL = 0.20

/** Hours without a processing run before declaring critical. */
const NO_RUN_CRITICAL_HOURS = 48

// ── Types ──────────────────────────────────────────────────────────────────────

export type FreshnessHealth = 'healthy' | 'degraded' | 'critical' | 'unknown'

export interface FreshnessSnapshot {
  tenant_id:                string
  snapshot_date:            string
  total_active_employees:   number
  employees_with_data:      number
  employees_stale:          number
  employees_missing:        number
  unprocessed_raw_logs:     number
  oldest_unprocessed_hours: number | null
  last_processing_run_at:   string | null
  hours_since_last_run:     number | null
  stale_threshold_days:     number
  health_status:            FreshnessHealth
}

export interface StaleEmployee {
  employee_id:   string
  last_date:     string | null   // most recent attendance_daily.date, or null if none
  days_stale:    number | null   // days since last row (null = no data)
  status:        'stale' | 'missing'
}

export interface FreshnessReport extends FreshnessSnapshot {
  stale_employees: StaleEmployee[]
}

// ── Compute health status ──────────────────────────────────────────────────────

function classifyHealth(snap: Omit<FreshnessSnapshot, 'health_status'>): FreshnessHealth {
  const {
    total_active_employees,
    employees_stale,
    employees_missing,
    unprocessed_raw_logs,
    oldest_unprocessed_hours,
    hours_since_last_run,
  } = snap

  // Any signal of a stalled pipeline is critical
  if (
    unprocessed_raw_logs > BACKLOG_CRITICAL ||
    (hours_since_last_run != null && hours_since_last_run > NO_RUN_CRITICAL_HOURS) ||
    (oldest_unprocessed_hours != null && oldest_unprocessed_hours > NO_RUN_CRITICAL_HOURS)
  ) {
    return 'critical'
  }

  const staleFraction =
    total_active_employees > 0
      ? (employees_stale + employees_missing) / total_active_employees
      : 0

  if (staleFraction >= STALE_PCT_CRITICAL) {
    return 'critical'
  }

  if (
    unprocessed_raw_logs > BACKLOG_DEGRADED ||
    employees_stale > 0 ||
    employees_missing > 0
  ) {
    return 'degraded'
  }

  return 'healthy'
}

/** Shift a YYYY-MM-DD date string by `deltaDays`, anchored at UTC noon to dodge DST. */
function shiftDateStr(dateStr: string, deltaDays: number): string {
  const [y, m, d] = dateStr.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, d + deltaDays, 12)).toISOString().slice(0, 10)
}

// ── Main scanner ───────────────────────────────────────────────────────────────

export async function scanAttendanceFreshness(
  supabase:          SupabaseClient,
  tenantId:          string,
  staleDays:         number = DEFAULT_STALE_DAYS,
  includeStaleList:  boolean = true,
): Promise<FreshnessReport> {
  const today       = new Date()
  const tenantTz    = await fetchTenantTz(supabase, tenantId)
  const snapshotDate = getLocalDate(today.toISOString(), tenantTz)
  const staleDateStr = shiftDateStr(snapshotDate, -staleDays)

  // ── 1. Active employee list ────────────────────────────────────────────────
  const empRows = await fetchAllRows((from, to) =>
    supabase
      .from('employees')
      .select('id')
      .eq('tenant_id', tenantId)
      .eq('status', 'active')
      .range(from, to),
  )
  const empIds = empRows.map((e: any) => e.id as string)
  const totalActive = empIds.length

  // ── 2. Most recent attendance_daily per employee ───────────────────────────
  // Query the latest date per employee in the last 90 days window
  const window90 = shiftDateStr(snapshotDate, -90)

  const latestRows = await fetchAllRows((from, to) =>
    supabase
      .from('attendance_daily')
      .select('employee_id, date')
      .eq('tenant_id', tenantId)
      .gte('date', window90)
      .order('date', { ascending: false })
      .range(from, to),
  )

  // Build map: employee_id → latest date
  const latestByEmp = new Map<string, string>()
  for (const row of latestRows as any[]) {
    if (!latestByEmp.has(row.employee_id)) {
      latestByEmp.set(row.employee_id, row.date as string)
    }
  }

  let withData    = 0
  let staleCount  = 0
  let missingCount= 0
  const staleList: StaleEmployee[] = []

  for (const empId of empIds) {
    const lastDate = latestByEmp.get(empId) ?? null
    if (!lastDate) {
      missingCount++
      if (includeStaleList) {
        staleList.push({ employee_id: empId, last_date: null, days_stale: null, status: 'missing' })
      }
    } else {
      withData++
      if (lastDate < staleDateStr) {
        staleCount++
        const daysStale = Math.floor(
          (today.getTime() - new Date(lastDate).getTime()) / 86_400_000
        )
        if (includeStaleList) {
          staleList.push({ employee_id: empId, last_date: lastDate, days_stale: daysStale, status: 'stale' })
        }
      }
    }
  }

  // ── 3. Unprocessed raw log backlog ─────────────────────────────────────────
  const [
    { count: unprocessedCount, error: unprocessedErr },
    { data: oldestRaw, error: oldestErr },
  ] = await Promise.all([
    supabase
      .from('attendance_raw_logs')
      .select('id', { count: 'exact', head: true })
      .eq('tenant_id', tenantId)
      .eq('processed', false),
    supabase
      .from('attendance_raw_logs')
      .select('timestamp')
      .eq('tenant_id', tenantId)
      .eq('processed', false)
      .order('timestamp', { ascending: true })
      .limit(1)
      .maybeSingle(),
  ])

  if (unprocessedErr) throw new Error(`Raw log backlog count failed: ${unprocessedErr.message}`)
  if (oldestErr) throw new Error(`Oldest raw log lookup failed: ${oldestErr.message}`)

  const unprocessedRawLogs    = unprocessedCount ?? 0
  const oldestUnprocessedHours = oldestRaw?.timestamp
    ? Math.round((today.getTime() - new Date(oldestRaw.timestamp).getTime()) / 3_600_000 * 10) / 10
    : null

  // ── 4. Last processing run ─────────────────────────────────────────────────
  const { data: lastRun, error: lastRunErr } = await supabase
    .from('attendance_processing_runs')
    .select('completed_at')
    .eq('tenant_id', tenantId)
    .not('completed_at', 'is', null)
    .is('error_message', null)
    .order('completed_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (lastRunErr) throw new Error(`Last processing run lookup failed: ${lastRunErr.message}`)

  const lastRunAt = lastRun?.completed_at ?? null
  const hoursSinceLastRun = lastRunAt
    ? Math.round((today.getTime() - new Date(lastRunAt).getTime()) / 3_600_000 * 10) / 10
    : null

  // ── 5. Classify health ─────────────────────────────────────────────────────
  const snapData = {
    tenant_id:                tenantId,
    snapshot_date:            snapshotDate,
    total_active_employees:   totalActive,
    employees_with_data:      withData,
    employees_stale:          staleCount,
    employees_missing:        missingCount,
    unprocessed_raw_logs:     unprocessedRawLogs,
    oldest_unprocessed_hours: oldestUnprocessedHours,
    last_processing_run_at:   lastRunAt,
    hours_since_last_run:     hoursSinceLastRun,
    stale_threshold_days:     staleDays,
  }
  const health = classifyHealth(snapData)

  // ── 6. Persist snapshot ───────────────────────────────────────────────────
  await supabase
    .from('attendance_freshness_snapshots')
    .upsert(
      { ...snapData, health_status: health },
      { onConflict: 'tenant_id,snapshot_date' }
    )
    .then(({ error: uErr }) => {
      if (uErr) console.warn('[attendance-freshness] snapshot upsert failed:', uErr.message)
    })

  return {
    ...snapData,
    health_status:   health,
    stale_employees: includeStaleList ? staleList.sort((a, b) => {
      // Sort: missing first, then by days_stale desc
      if (a.status === 'missing' && b.status !== 'missing') return -1
      if (b.status === 'missing' && a.status !== 'missing') return 1
      return (b.days_stale ?? 0) - (a.days_stale ?? 0)
    }) : [],
  }
}

/**
 * Fetch freshness snapshot history for a tenant.
 * Returns the last N snapshots for trend charts.
 */
export async function getFreshnessHistory(
  supabase:  SupabaseClient,
  tenantId:  string,
  days:      number = 30,
): Promise<FreshnessSnapshot[]> {
  const from = new Date()
  from.setDate(from.getDate() - days)
  const fromStr = from.toISOString().slice(0, 10)

  const { data, error } = await supabase
    .from('attendance_freshness_snapshots')
    .select(
      'tenant_id, snapshot_date, total_active_employees, employees_with_data, ' +
      'employees_stale, employees_missing, unprocessed_raw_logs, ' +
      'oldest_unprocessed_hours, last_processing_run_at, hours_since_last_run, ' +
      'stale_threshold_days, health_status'
    )
    .eq('tenant_id', tenantId)
    .gte('snapshot_date', fromStr)
    .order('snapshot_date', { ascending: false })

  if (error) throw new Error(`Freshness history query failed: ${error.message}`)
  return (data ?? []) as unknown as FreshnessSnapshot[]
}
