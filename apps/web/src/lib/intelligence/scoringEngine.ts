/**
 * scoringEngine.ts — Operational Score Calculator (Phase UX-5)
 *
 * Pure function. Deterministic, side-effect-free. Computes an OperationalScore
 * from the unified activity stream. No API calls, no React.
 */

import type { OperationalActivityEvent } from '@/lib/activity/types'
import type { OperationalScore } from './types'
import { scoreToGrade } from './types'

// ── Helper ────────────────────────────────────────────────────────────────────

function clamp(v: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, v))
}

// ── Export ────────────────────────────────────────────────────────────────────

export function computeScore(events: OperationalActivityEvent[]): OperationalScore {
  const now = Date.now()

  // ── Attendance health ────────────────────────────────────────────────────────
  const missingPunchOpen = events.filter(e => e.type === 'missing_punch' && e.status === 'open').length
  const lateArrivalOpen  = events.filter(e => e.type === 'late_arrival'  && e.status === 'open').length
  const anomalyHigh      = events.filter(e => e.type === 'attendance_anomaly' && (e.severity === 'high' || e.severity === 'critical')).length

  const attendanceHealth = 100 - clamp(missingPunchOpen * 8 + lateArrivalOpen * 3 + anomalyHigh * 5, 0, 100)

  // ── Payroll readiness ────────────────────────────────────────────────────────
  const payrollBlockers = events.filter(e => e.type === 'payroll_blocker' && e.status === 'open').length
  const payrollLocks    = events.filter(e => e.type === 'payroll_lock'    && e.status === 'open').length

  const payrollReadiness = 100 - clamp(payrollBlockers * 20 + payrollLocks * 5, 0, 100)

  // ── Compliance score ─────────────────────────────────────────────────────────
  const complianceAlertOpen = events.filter(e => e.type === 'compliance_alert' && e.status === 'open').length
  const otSpikeOpen         = events.filter(e => e.type === 'ot_spike'         && e.status === 'open').length

  const complianceScore = 100 - clamp(complianceAlertOpen * 25 + otSpikeOpen * 10, 0, 100)

  // ── Fatigue risk ─────────────────────────────────────────────────────────────
  const fatigueEvents  = events.filter(e => e.type === 'fatigue_risk' && e.status === 'open').length
  const otSpikeEvents  = events.filter(e => e.type === 'ot_spike'     && e.status === 'open').length

  const fatigueRisk = clamp(fatigueEvents * 15 + otSpikeEvents * 8, 0, 100)

  // ── Operational efficiency ───────────────────────────────────────────────────
  const operationalEfficiency = (attendanceHealth + payrollReadiness + complianceScore + (100 - fatigueRisk)) / 4

  // ── Overall score ────────────────────────────────────────────────────────────
  const overallScore = Math.round(
    attendanceHealth   * 0.30 +
    payrollReadiness   * 0.25 +
    complianceScore    * 0.25 +
    (100 - fatigueRisk) * 0.20,
  )

  // ── Trend: compare open events in last 24h vs 24-48h ago ────────────────────
  const openEvents24h = events.filter(e => {
    const ms = now - new Date(e.timestamp).getTime()
    return ms >= 0 && ms < 24 * 3_600_000 && e.status === 'open'
  }).length

  const openEvents48h = events.filter(e => {
    const ms = now - new Date(e.timestamp).getTime()
    return ms >= 24 * 3_600_000 && ms < 48 * 3_600_000 && e.status === 'open'
  }).length

  const trend: 'up' | 'down' | 'stable' =
    openEvents24h < openEvents48h ? 'up'   :
    openEvents24h > openEvents48h ? 'down' :
    'stable'

  return {
    attendanceHealth:      Math.round(attendanceHealth),
    payrollReadiness:      Math.round(payrollReadiness),
    complianceScore:       Math.round(complianceScore),
    fatigueRisk:           Math.round(fatigueRisk),
    operationalEfficiency: Math.round(operationalEfficiency),
    overallScore,
    grade:                 scoreToGrade(overallScore),
    updatedAt:             new Date().toISOString(),
    trend,
  }
}
