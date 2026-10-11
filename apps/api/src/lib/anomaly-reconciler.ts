/**
 * anomaly-reconciler.ts — shared core of attendance-anomaly auto-resolution.
 *
 * Scans UNRESOLVED anomalies for a period and auto-resolves any CONTRADICTED
 * by the current attendance_daily truth (e.g. a stale "no_punch" after
 * attendance was recomputed to present/leave via CSV or correction).
 *
 * Used by both routes/attendance/anomaly-reconcile.ts (the HR-admin
 * "Reconcile" button, with dry-run + per-row reasoning for ops debugging)
 * and a daily scheduled job (index.ts, registered alongside
 * detect-absconding/notice-overdue-scan) — anomalies are a detection
 * signal, not a second queue that should depend on an admin remembering
 * to click a button.
 *
 * Contradiction rules:
 *   no_punch    → contradicted when attendance_daily.status is an attended
 *                 status AND that row's own confidence is high/medium.
 *   missing_out → same, plus work_hours > 0 (the punch session completed).
 *   late / excessive_hours → never auto-resolved (may still be factually true).
 *
 * A daily row is only trustworthy enough to CONTRADICT (auto-resolve) an
 * anomaly when its own confidence is high/medium — a low/critical-confidence
 * row may itself be stale/inferred, so resolving against it would mask a
 * real gap. Such anomalies are kept for human review instead.
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import type { FastifyBaseLogger } from 'fastify'
import { normalizeAttendanceStatus } from './attendance-utils.js'
import { fetchAllRows } from './supabase-paginate.js'
import { fetchTenantTz } from './attendance-engine.js'
import { getLocalDate } from './org-context.js'

const ATTENDED_STATUSES = new Set<string>([
  'present', 'late', 'half_day', 'holiday', 'weekly_off', 'leave', 'overtime', 'weekend',
])
const TRUSTED_CONF = new Set(['high', 'medium'])

export interface ReconcileOpts {
  fromDate?:  string
  toDate?:    string
  /** null for an unattended/scheduled run — no human performed it. */
  resolvedBy: string | null
  /** Scan and classify without writing. Default false. */
  dryRun?:    boolean
}

export interface ReconcileDetail {
  anomaly_id:   string
  employee_id:  string
  date:         string
  type:         string
  daily_status: string | null
  action:       'auto_resolve' | 'keep'
  reason:       string
}

export interface ReconcileResult {
  from_date:     string
  to_date:       string
  scanned:       number
  auto_resolved: number
  would_resolve: number
  skipped:       number
  details:       ReconcileDetail[]
}

export async function reconcileAnomaliesForTenant(
  supabase: SupabaseClient,
  tenantId: string,
  opts:     ReconcileOpts,
  log?:     FastifyBaseLogger,
): Promise<ReconcileResult> {
  const tz = await fetchTenantTz(supabase, tenantId)
  const toDate   = opts.toDate   ?? getLocalDate(new Date().toISOString(), tz)
  const fromDate = opts.fromDate ?? (() => {
    const d = new Date(`${toDate}T12:00:00.000Z`)
    d.setUTCDate(d.getUTCDate() - 90)
    return d.toISOString().slice(0, 10)
  })()

  type AnomalyRow = { id: string; employee_id: string; date: string; type: string }
  const rows = await fetchAllRows<AnomalyRow>((from, to) =>
    supabase
      .from('attendance_anomalies')
      .select('id, employee_id, date, type')
      .eq('tenant_id', tenantId)
      .eq('resolved', false)
      .in('type', ['no_punch', 'missing_out'])
      .gte('date', fromDate)
      .lte('date', toDate)
      .range(from, to),
  )

  if (rows.length === 0) return { from_date: fromDate, to_date: toDate, scanned: 0, auto_resolved: 0, would_resolve: 0, skipped: 0, details: [] }

  const employeeIds = [...new Set(rows.map(r => r.employee_id))]
  type DailyRow = { employee_id: string; date: string; status: string; work_hours: number; confidence_level: string | null }
  const dailyRows = await fetchAllRows<DailyRow>((from, to) =>
    supabase
      .from('attendance_daily')
      .select('employee_id, date, status, work_hours, confidence_level')
      .eq('tenant_id', tenantId)
      .in('employee_id', employeeIds)
      .gte('date', fromDate)
      .lte('date', toDate)
      .range(from, to),
  )

  const dailyMap = new Map<string, { status: string | null; work_hours: number; confidence_level: string }>()
  for (const d of dailyRows) {
    dailyMap.set(`${d.employee_id}:${d.date}`, {
      status:           normalizeAttendanceStatus(d.status),
      work_hours:       Number(d.work_hours ?? 0),
      confidence_level: d.confidence_level ?? 'high',
    })
  }

  const toResolve: string[] = []
  const details: ReconcileDetail[] = []

  for (const anomaly of rows) {
    const daily   = dailyMap.get(`${anomaly.employee_id}:${anomaly.date}`)
    const status  = daily?.status ?? null
    const trusted = daily ? TRUSTED_CONF.has(daily.confidence_level) : false

    let action: 'auto_resolve' | 'keep' = 'keep'
    let reason = 'no attendance_daily row found'

    if (anomaly.type === 'no_punch') {
      if (status && ATTENDED_STATUSES.has(status) && trusted) {
        action = 'auto_resolve'
        reason = `attendance_daily.status = '${status}' (confidence ${daily?.confidence_level}) — attendance was recorded (CSV or engine)`
      } else if (status && ATTENDED_STATUSES.has(status)) {
        reason = `attendance_daily.status = '${status}' but confidence is '${daily?.confidence_level}' — kept for review`
      } else if (status) {
        reason = `attendance_daily.status = '${status}' — not an attended status`
      }
    } else if (anomaly.type === 'missing_out') {
      if (status && ATTENDED_STATUSES.has(status) && (daily?.work_hours ?? 0) > 0 && trusted) {
        action = 'auto_resolve'
        reason = `attendance_daily.status = '${status}', work_hours = ${daily?.work_hours} (confidence ${daily?.confidence_level}) — punch session completed`
      } else if (status && ATTENDED_STATUSES.has(status) && (daily?.work_hours ?? 0) > 0) {
        reason = `attendance_daily.status = '${status}', work_hours = ${daily?.work_hours} but confidence is '${daily?.confidence_level}' — kept for review`
      } else if (status) {
        reason = `attendance_daily.status = '${status}', work_hours = ${daily?.work_hours} — session may still be open`
      }
    }

    if (action === 'auto_resolve') toResolve.push(anomaly.id)
    details.push({ anomaly_id: anomaly.id, employee_id: anomaly.employee_id, date: anomaly.date, type: anomaly.type, daily_status: status, action, reason })
  }

  let actualResolved = 0
  if (!opts.dryRun && toResolve.length > 0) {
    const now = new Date().toISOString()
    const chunkSize = 100
    for (let i = 0; i < toResolve.length; i += chunkSize) {
      const chunk = toResolve.slice(i, i + chunkSize)
      const { error } = await supabase
        .from('attendance_anomalies')
        .update({ resolved: true, resolved_by: opts.resolvedBy, resolved_at: now, updated_at: now })
        .in('id', chunk)
        .eq('tenant_id', tenantId)
        .eq('resolved', false)
      if (error) {
        log?.error({ err: error, tenant: tenantId, chunk_size: chunk.length }, 'anomaly reconcile bulk-resolve chunk failed')
      } else {
        actualResolved += chunk.length
      }
    }
  }

  return {
    from_date: fromDate, to_date: toDate, scanned: rows.length,
    auto_resolved: opts.dryRun ? 0 : actualResolved, would_resolve: toResolve.length,
    skipped: rows.length - toResolve.length, details,
  }
}
