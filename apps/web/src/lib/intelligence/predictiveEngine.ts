/**
 * predictiveEngine.ts — Predictive Warning Generator (Phase UX-5)
 *
 * Pure function. Deterministic, side-effect-free. Analyses the activity stream
 * for leading indicators and returns up to 5 PredictiveWarnings sorted by
 * severity then probability descending. No API calls, no React.
 */

import type { OperationalActivityEvent } from '@/lib/activity/types'
import type { PredictiveWarning, PredictiveWarningType } from './types'

// ── Helper ────────────────────────────────────────────────────────────────────

/**
 * Returns events whose timestamp falls in the window
 * [now - hoursAgo, now - hoursAgoEnd).
 *
 * @param hoursAgo     - older boundary (e.g. 24 means "events older than 24h end here")
 * @param hoursAgoEnd  - newer boundary (e.g. 0 means "up to now")
 */
function eventsInWindow(
  events: OperationalActivityEvent[],
  hoursAgo: number,
  hoursAgoEnd: number,
): OperationalActivityEvent[] {
  const now = Date.now()
  return events.filter(e => {
    const ms = now - new Date(e.timestamp).getTime()
    return ms >= hoursAgoEnd * 3_600_000 && ms < hoursAgo * 3_600_000
  })
}

const SEVERITY_ORDER: Record<'critical' | 'high' | 'medium', number> = {
  critical: 0,
  high:     1,
  medium:   2,
}

function makeWarningId(type: PredictiveWarningType): string {
  return `warning_${type}_${Date.now().toString(36)}`
}

// ── Rule 1 — payroll_delay ────────────────────────────────────────────────────

function warnPayrollDelay(events: OperationalActivityEvent[]): PredictiveWarning | null {
  const count = events.filter(e => e.type === 'payroll_blocker' && e.status === 'open').length
  if (count <= 2) return null

  const severity = count > 5 ? 'critical' : 'high'
  const probability = count > 5 ? Math.min(95, 50 + count * 8) : 60

  return {
    id:          makeWarningId('payroll_delay'),
    type:        'payroll_delay',
    severity,
    title:       'Payroll Processing Delay Risk',
    description: `${count} unresolved payroll blocker${count > 1 ? 's' : ''} may prevent the next payroll run from completing on time.`,
    probability,
    timeHorizon: 'next payroll run',
    basis:       [
      `${count} unresolved payroll blockers`,
      'Blockers must be cleared before payroll can process',
    ],
  }
}

// ── Rule 2 — anomaly_surge ────────────────────────────────────────────────────

function warnAnomalySurge(events: OperationalActivityEvent[]): PredictiveWarning | null {
  const anomalyTypes: ReadonlyArray<string> = [
    'attendance_anomaly', 'missing_punch', 'late_arrival', 'early_departure',
  ]

  const last24h = eventsInWindow(events, 24, 0).filter(e =>
    anomalyTypes.includes(e.type),
  ).length

  const last48h = eventsInWindow(events, 48, 24).filter(e =>
    anomalyTypes.includes(e.type),
  ).length

  if (!(last24h > last48h * 1.5 && last24h >= 3)) return null

  const ratio = last24h / Math.max(last48h, 1)
  const probability = Math.min(90, Math.round((ratio - 1) * 60))
  const severity = last24h > last48h * 2 ? 'high' : 'medium'

  return {
    id:          makeWarningId('anomaly_surge'),
    type:        'anomaly_surge',
    severity,
    title:       'Attendance Anomaly Surge Detected',
    description: `Anomaly volume has increased ${Math.round((ratio - 1) * 100)}% in the last 24 hours compared to the prior period.`,
    probability,
    timeHorizon: 'next 24 hours',
    basis:       [
      `${last24h} anomalies in last 24h vs ${last48h} in prior 24h`,
      'Upward trend detected',
    ],
  }
}

// ── Rule 3 — coverage_risk ────────────────────────────────────────────────────

function warnCoverageRisk(events: OperationalActivityEvent[]): PredictiveWarning | null {
  const count = events.filter(e => e.type === 'shift_unassigned').length
  if (count === 0) return null

  const probability = Math.min(85, 40 + count * 10)
  const severity = count > 5 ? 'high' : 'medium'

  return {
    id:          makeWarningId('coverage_risk'),
    type:        'coverage_risk',
    severity,
    title:       'Operational Coverage Gap Risk',
    description: `${count} unassigned shift${count > 1 ? 's' : ''} may leave coverage gaps in tomorrow's roster.`,
    probability,
    timeHorizon: 'tomorrow',
    basis:       [
      `${count} shifts unassigned`,
      'Coverage gap increases operational risk',
    ],
  }
}

// ── Rule 4 — fatigue_increasing ───────────────────────────────────────────────

function warnFatigueIncreasing(events: OperationalActivityEvent[]): PredictiveWarning | null {
  const fatigueAndOt = (e: OperationalActivityEvent) =>
    e.type === 'fatigue_risk' || e.type === 'ot_spike'

  const recent = eventsInWindow(events, 24, 0).filter(fatigueAndOt).length
  const prior  = eventsInWindow(events, 48, 24).filter(fatigueAndOt).length

  if (!(recent > prior && recent >= 2)) return null

  const probability = Math.min(80, 45 + recent * 8)

  return {
    id:          makeWarningId('fatigue_increasing'),
    type:        'fatigue_increasing',
    severity:    'medium',
    title:       'Fatigue Risk Trending Upward',
    description: `Fatigue and OT indicators have increased to ${recent} in the last 24 hours, up from ${prior} in the prior period.`,
    probability,
    timeHorizon: 'next 3 days',
    basis:       [
      `${recent} fatigue indicators in last 24h`,
      'OT accumulation increasing',
    ],
  }
}

// ── Rule 5 — compliance_breach_risk ──────────────────────────────────────────

function warnComplianceBreachRisk(events: OperationalActivityEvent[]): PredictiveWarning | null {
  const count = events.filter(e => e.type === 'compliance_alert' && e.status === 'open').length
  if (count <= 1) return null

  const probability = Math.min(88, 55 + count * 10)
  const severity = count > 3 ? 'critical' : 'high'

  return {
    id:          makeWarningId('compliance_breach_risk'),
    type:        'compliance_breach_risk',
    severity,
    title:       'Compliance Breach Risk This Week',
    description: `${count} open compliance alert${count > 1 ? 's' : ''} remain unresolved and may trigger a regulatory violation if not addressed.`,
    probability,
    timeHorizon: 'this week',
    basis:       [
      `${count} open compliance alerts`,
      'Unresolved alerts may trigger violations',
    ],
  }
}

// ── Main export ───────────────────────────────────────────────────────────────

export function generatePredictiveWarnings(events: OperationalActivityEvent[]): PredictiveWarning[] {
  const warnings = [
    warnPayrollDelay(events),
    warnAnomalySurge(events),
    warnCoverageRisk(events),
    warnFatigueIncreasing(events),
    warnComplianceBreachRisk(events),
  ].filter((w): w is PredictiveWarning => w !== null)

  return warnings
    .sort((a, b) => {
      const sevDiff = SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity]
      if (sevDiff !== 0) return sevDiff
      return b.probability - a.probability
    })
    .slice(0, 5)
}
