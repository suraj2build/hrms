/**
 * Workforce Intelligence Engine
 *
 * Rule-based heuristic analysis over `attendance_anomalies` and
 * `attendance_daily` for the last N days.  Produces:
 *   - A per-employee risk score (0–100)
 *   - Typed risk flags (chronic_late, frequent_no_punch, …)
 *   - Trend sparklines (unresolved anomalies per day)
 *   - Aggregated anomaly breakdown by type and severity
 *   - Repeat-offender list (employees with the most anomalies)
 *
 * All computation is done with two bulk DB queries — no N+1 loops.
 * Results are written atomically to `attendance_intelligence_snapshot`
 * and `employee_risk_flags` (upsert, not append).
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import { fetchAllRows } from './supabase-paginate.js'
import { fetchTenantTz, utcToLocalDate } from './attendance-engine.js'
import { logger } from './logger.js'

// ── Constants ─────────────────────────────────────────────────────────────────

/** Lookback window for the analysis (days). */
const LOOKBACK_DAYS = 30

/**
 * Risk score weights per anomaly type.
 * Scores are added per occurrence and then clamped to [0, 100].
 */
const ANOMALY_WEIGHT: Record<string, number> = {
  no_punch:        15,
  missing_out:     10,
  late:             5,
  excessive_hours:  8,
}

/** Minimum occurrences to trigger a flag. */
const FLAG_THRESHOLDS = {
  chronic_late:         3,   // ≥3 late anomalies in window
  frequent_no_punch:    2,   // ≥2 no_punch anomalies
  high_anomaly_rate:    5,   // ≥5 total anomalies
  absent_streak:        3,   // ≥3 consecutive absent days
  low_attendance:      50,   // attendance % < 50 %
}

// ── Types ────────────────────────────────────────────────────────────────────

export interface AtRiskEmployee {
  employee_id:   string
  name:          string
  employee_code: string
  risk_score:    number
  reasons:       string[]
  anomaly_count: number
  flag_types:    string[]
}

export interface IntelligenceSummary {
  period_from:         string
  period_to:           string
  total_employees:     number
  at_risk_count:       number
  open_anomalies:      number
  resolved_anomalies:  number
  avg_risk_score:      number
  computed_at:         string
}

export interface DailyTrend {
  date:      string
  open:      number
  resolved:  number
  total:     number
}

export interface IntelligenceResult {
  summary:   IntelligenceSummary
  at_risk:   AtRiskEmployee[]
  trends:    {
    daily:               DailyTrend[]
    anomaly_by_type:     Record<string, number>
    anomaly_by_severity: Record<string, number>
  }
  patterns: {
    repeat_offenders:  AtRiskEmployee[]
    top_anomaly_types: Array<{ type: string; count: number; pct: number }>
  }
}

// ── Core engine ───────────────────────────────────────────────────────────────

export async function computeIntelligence(
  supabase:  SupabaseClient,
  tenantId:  string,
): Promise<IntelligenceResult> {

  const now      = new Date()
  const tenantTz = await fetchTenantTz(supabase, tenantId)
  const periodTo = utcToLocalDate(now, tenantTz)
  const fromDate = new Date(`${periodTo}T12:00:00.000Z`)
  fromDate.setUTCDate(fromDate.getUTCDate() - LOOKBACK_DAYS)
  const periodFrom = fromDate.toISOString().slice(0, 10)

  // ── Query 1: all anomalies in the window ─────────────────────────────────────
  // attendance_anomalies is a high-cardinality table at enterprise scale — paginate.
  let anomalies: any[]
  try {
    anomalies = await fetchAllRows((from, to) =>
      supabase
        .from('attendance_anomalies')
        .select(`
          id, date, type, severity, resolved,
          employee_id,
          employees!inner(id, first_name, last_name, employee_code)
        `)
        .eq('tenant_id', tenantId)
        .gte('date', periodFrom)
        .lte('date', periodTo)
        .order('date', { ascending: true })
        .order('id', { ascending: true })
        .range(from, to),
    )
  } catch (aErr: any) {
    throw new Error(`intelligence: anomaly query failed — ${aErr.message}`)
  }

  // ── Query 2: attendance_daily for absent-streak detection ───────────────────
  let dailyRows: any[]
  try {
    dailyRows = await fetchAllRows((from, to) =>
      supabase
        .from('attendance_daily')
        .select('employee_id, date, status')
        .eq('tenant_id', tenantId)
        .gte('date', periodFrom)
        .lte('date', periodTo)
        .eq('status', 'absent')
        .order('employee_id')
        .order('date')
        .range(from, to),
    )
  } catch (dErr: any) {
    throw new Error(`intelligence: daily query failed — ${dErr.message}`)
  }

  // ── Query 3: total active employees ─────────────────────────────────────────
  const { count: totalEmps } = await supabase
    .from('employees')
    .select('id', { count: 'exact', head: true })
    .eq('tenant_id', tenantId)
    .eq('status', 'active')

  // ── Build per-employee anomaly maps ─────────────────────────────────────────

  type EmpMeta = { name: string; code: string }
  const empMeta    = new Map<string, EmpMeta>()
  const byTypeMap  = new Map<string, Map<string, number>>()    // empId → type → count
  const totalByEmp = new Map<string, number>()
  const openByEmp  = new Map<string, number>()

  for (const row of (anomalies ?? []) as Array<{
    id: string; date: string; type: string; severity: string; resolved: boolean
    employee_id: string
    employees: { id: string; first_name: string; last_name: string; employee_code: string } | Array<{ id: string; first_name: string; last_name: string; employee_code: string }>
  }>) {
    const emp = Array.isArray(row.employees) ? row.employees[0] : row.employees
    if (!emp) continue
    const eid = row.employee_id

    empMeta.set(eid, { name: `${emp.first_name} ${emp.last_name}`, code: emp.employee_code })

    totalByEmp.set(eid, (totalByEmp.get(eid) ?? 0) + 1)
    if (!row.resolved) openByEmp.set(eid, (openByEmp.get(eid) ?? 0) + 1)

    if (!byTypeMap.has(eid)) byTypeMap.set(eid, new Map())
    const tm = byTypeMap.get(eid)!
    tm.set(row.type, (tm.get(row.type) ?? 0) + 1)
  }

  // ── Absent-streak detection ──────────────────────────────────────────────────
  // Group absent days per employee and find consecutive run ≥ threshold
  const absentByEmp = new Map<string, string[]>()
  for (const row of (dailyRows ?? []) as Array<{ employee_id: string; date: string; status: string }>) {
    if (!absentByEmp.has(row.employee_id)) absentByEmp.set(row.employee_id, [])
    absentByEmp.get(row.employee_id)!.push(row.date)
  }

  const absentStreakEmp = new Set<string>()
  for (const [eid, dates] of absentByEmp) {
    const sorted = dates.sort()
    let streak = 1
    for (let i = 1; i < sorted.length; i++) {
      const prev = new Date(`${sorted[i-1]}T12:00:00Z`)
      const curr = new Date(`${sorted[i]}T12:00:00Z`)
      const diff = (curr.getTime() - prev.getTime()) / 86_400_000
      if (diff === 1) {
        streak++
        if (streak >= FLAG_THRESHOLDS.absent_streak) {
          absentStreakEmp.add(eid)
          break
        }
      } else {
        streak = 1
      }
    }
  }

  // ── Compute per-employee risk ────────────────────────────────────────────────
  const atRisk: AtRiskEmployee[] = []
  const allEmployees = new Set([...empMeta.keys(), ...absentStreakEmp])

  for (const eid of allEmployees) {
    const meta      = empMeta.get(eid) ?? { name: '—', code: '—' }
    const typeMap   = byTypeMap.get(eid) ?? new Map<string, number>()
    const total     = totalByEmp.get(eid) ?? 0
    const reasons:   string[] = []
    const flagTypes: string[] = []

    // Base score from anomaly weights
    let score = 0
    for (const [type, cnt] of typeMap) {
      score += cnt * (ANOMALY_WEIGHT[type] ?? 5)
    }

    // Flag: chronic late
    const lateCount = typeMap.get('late') ?? 0
    if (lateCount >= FLAG_THRESHOLDS.chronic_late) {
      reasons.push(`Late ${lateCount}× in ${LOOKBACK_DAYS} days`)
      flagTypes.push('chronic_late')
    }

    // Flag: frequent no-punch
    const noPunchCount = typeMap.get('no_punch') ?? 0
    if (noPunchCount >= FLAG_THRESHOLDS.frequent_no_punch) {
      reasons.push(`Missing punch ${noPunchCount}× in ${LOOKBACK_DAYS} days`)
      flagTypes.push('frequent_no_punch')
    }

    // Flag: high anomaly rate
    if (total >= FLAG_THRESHOLDS.high_anomaly_rate) {
      reasons.push(`${total} anomalies in ${LOOKBACK_DAYS} days`)
      flagTypes.push('high_anomaly_rate')
    }

    // Flag: absent streak
    if (absentStreakEmp.has(eid)) {
      score += 25
      reasons.push(`Consecutive absent streak ≥${FLAG_THRESHOLDS.absent_streak} days`)
      flagTypes.push('absent_streak')
    }

    const riskScore = Math.min(100, score)

    if (riskScore > 0 || flagTypes.length > 0) {
      atRisk.push({
        employee_id:   eid,
        name:          meta.name,
        employee_code: meta.code,
        risk_score:    riskScore,
        reasons,
        anomaly_count: total,
        flag_types:    flagTypes,
      })
    }
  }

  // Sort by risk score descending
  atRisk.sort((a, b) => b.risk_score - a.risk_score)

  // ── Trend sparklines (anomalies per day) ─────────────────────────────────────
  const trendMap = new Map<string, { open: number; resolved: number }>()
  for (const row of (anomalies ?? []) as Array<{ date: string; resolved: boolean }>) {
    if (!trendMap.has(row.date)) trendMap.set(row.date, { open: 0, resolved: 0 })
    const t = trendMap.get(row.date)!
    if (row.resolved) t.resolved++; else t.open++
  }
  const daily: DailyTrend[] = Array.from(trendMap.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, { open, resolved }]) => ({ date, open, resolved, total: open + resolved }))

  // ── Anomaly breakdown ─────────────────────────────────────────────────────────
  const byType: Record<string, number> = {}
  const bySev:  Record<string, number> = {}
  for (const row of (anomalies ?? []) as Array<{ type: string; severity: string }>) {
    byType[row.type]     = (byType[row.type] ?? 0) + 1
    bySev[row.severity]  = (bySev[row.severity] ?? 0) + 1
  }

  const totalAnomCount = Object.values(byType).reduce((a, b) => a + b, 0)
  const topTypes = Object.entries(byType)
    .sort(([, a], [, b]) => b - a)
    .map(([type, count]) => ({
      type,
      count,
      pct: totalAnomCount > 0 ? Math.round((count / totalAnomCount) * 100) : 0,
    }))

  // ── Summary ──────────────────────────────────────────────────────────────────
  const openTotal     = (anomalies ?? []).filter((r: any) => !r.resolved).length
  const resolvedTotal = (anomalies ?? []).filter((r: any) => r.resolved).length
  const avgRisk = atRisk.length > 0
    ? Math.round(atRisk.reduce((s, e) => s + e.risk_score, 0) / atRisk.length)
    : 0

  const summary: IntelligenceSummary = {
    period_from:        periodFrom,
    period_to:          periodTo,
    total_employees:    totalEmps ?? 0,
    at_risk_count:      atRisk.length,
    open_anomalies:     openTotal,
    resolved_anomalies: resolvedTotal,
    avg_risk_score:     avgRisk,
    computed_at:        now.toISOString(),
  }

  const result: IntelligenceResult = {
    summary,
    at_risk: atRisk,
    trends: {
      daily,
      anomaly_by_type:     byType,
      anomaly_by_severity: bySev,
    },
    patterns: {
      repeat_offenders: atRisk.slice(0, 10),
      top_anomaly_types: topTypes,
    },
  }

  // ── Persist snapshot ─────────────────────────────────────────────────────────
  const { error: snapshotErr } = await supabase
    .from('attendance_intelligence_snapshot')
    .upsert({
      tenant_id:   tenantId,
      computed_at: summary.computed_at,
      period_from: periodFrom,
      period_to:   periodTo,
      summary:     summary,
      at_risk:     atRisk,
      trends:      result.trends,
      patterns:    result.patterns,
    }, { onConflict: 'tenant_id' })
  // A failed persist must not be reported as a successful compute — the
  // caller (GET /attendance/intelligence) would otherwise believe this fresh
  // result is now durably cached when the next request will recompute from
  // whatever stale snapshot (or none) is actually on disk.
  if (snapshotErr) throw snapshotErr

  // ── Upsert per-employee risk flags ───────────────────────────────────────────
  for (const emp of atRisk) {
    for (const flagType of emp.flag_types) {
      const { error: flagErr } = await supabase
        .from('employee_risk_flags')
        .upsert({
          tenant_id:    tenantId,
          employee_id:  emp.employee_id,
          flag_type:    flagType,
          risk_score:   emp.risk_score,
          details:      { reasons: emp.reasons, anomaly_count: emp.anomaly_count },
          last_updated: summary.computed_at,
          dismissed:    false,
        }, { onConflict: 'tenant_id,employee_id,flag_type' })
      if (flagErr) logger.error({ err: flagErr }, '[intelligence] flag upsert error')
    }
  }

  return result
}
