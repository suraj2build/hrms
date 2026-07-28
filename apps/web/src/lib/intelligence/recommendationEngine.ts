/**
 * recommendationEngine.ts — Pure Decision Insight Generator (Phase UX-5)
 *
 * Deterministic, side-effect-free. Takes the unified activity stream and
 * returns a prioritised list of actionable DecisionInsights. No API calls,
 * no React, fully memoizable.
 */

import type { OperationalActivityEvent } from '@/lib/activity/types'
import type {
  DecisionInsight,
  AffectedEntity,
  ConfidenceFactor,
  ExplainabilityTrace,
  ImpactEstimate,
  InsightSeverity,
} from './types'
import { toConfidenceLevel } from './types'

// ── Shared helpers ────────────────────────────────────────────────────────────

function uniqueEntities(events: OperationalActivityEvent[]): AffectedEntity[] {
  const map = new Map<string, AffectedEntity>()
  for (const e of events) {
    if (e.employeeId && !map.has(e.employeeId)) {
      map.set(e.employeeId, { id: e.employeeId, name: e.employeeName ?? 'Unknown', type: 'employee' })
    }
  }
  return [...map.values()]
}

const SEVERITY_ORDER: Record<InsightSeverity, number> = {
  critical: 0,
  high:     1,
  medium:   2,
  low:      3,
}

// Deterministic — derived from the type + the exact set of source event IDs
// that triggered this insight, NOT Date.now()/Math.random(). The activity
// stream polls every 30s and regenerates insights from the same underlying
// events between user actions; a random ID here would mint a new identity
// for the same logical condition on every poll, silently un-dismissing (or
// un-actioning) an insight the user just cleared moments earlier.
function makeId(type: string, eventIds: string[]): string {
  return `insight_${type}_${[...eventIds].sort().join('_')}`
}

// ── Rule 1 — regularise_punches ───────────────────────────────────────────────

function ruleRegularisePunches(events: OperationalActivityEvent[]): DecisionInsight | null {
  const filtered = events.filter(e => e.type === 'missing_punch' && e.status === 'open')
  const count = filtered.length
  if (count === 0) return null

  const severity: InsightSeverity = count > 10 ? 'critical' : count > 5 ? 'high' : 'medium'
  const confidence = Math.min(95, 65 + count * 3)
  const entities = uniqueEntities(filtered)
  const uniqueEmployeeCount = entities.length
  const eventIds = filtered.map(e => e.id)

  const factors: ConfidenceFactor[] = [
    { label: 'Missing punch count', contribution: 60, description: `${count} open missing punch records` },
    { label: 'Status open',         contribution: 40, description: 'All records unresolved' },
  ]

  const impactEstimate: ImpactEstimate = {
    affectedCount:      uniqueEmployeeCount,
    complianceRisk:     'medium',
    rollbackPossible:   true,
    rollbackWindowHours: 24,
  }

  const explainability: ExplainabilityTrace = {
    triggeringEventIds: eventIds,
    appliedRules:       ['missing_punch_threshold_rule'],
    confidenceLogic:    'Base confidence 65%, +3% per event up to 95%',
    impactCalculation:  `Affects ${uniqueEmployeeCount} employees with unresolved missing punches`,
  }

  return {
    id:                makeId('regularise_punches', eventIds),
    type:              'regularise_punches',
    category:          'attendance',
    severity,
    confidence,
    confidenceLevel:   toConfidenceLevel(confidence),
    title:             `${count} Missing Punch${count > 1 ? 'es' : ''} Require Regularisation`,
    explanation:       `${count} open missing punch records affect ${uniqueEmployeeCount} employee${uniqueEmployeeCount > 1 ? 's' : ''} and remain unresolved.`,
    recommendedAction: 'Bulk-regularise all open missing punch records to restore accurate attendance data.',
    affectedEntities:  entities,
    impactEstimate,
    sourceEventIds:    eventIds,
    createdAt:         new Date().toISOString(),
    factors,
    explainability,
    status:            'pending',
    actionLabel:       'Regularise Now',
    actionType:        'bulk_regularise_punches',
    actionEndpoint:    '/attendance/regularisation/bulk-approve',
    actionBody:        { ids: eventIds },
  }
}

// ── Rule 2 — approve_sessions ─────────────────────────────────────────────────

function ruleApproveSessions(events: OperationalActivityEvent[]): DecisionInsight | null {
  const pending = events.filter(
    e => e.type === 'approval_pending' && e.workspace === 'attendance' && e.status === 'pending',
  )
  const lowRisk = pending.filter(
    e => !(e.description?.toLowerCase().includes('suspicious') || e.description?.toLowerCase().includes('mismatch')),
  )
  const count = lowRisk.length
  if (count === 0) return null

  const confidence = 72
  const entities = uniqueEntities(lowRisk)
  const eventIds = lowRisk.map(e => e.id)

  const factors: ConfidenceFactor[] = [
    { label: 'Low-risk approvals', contribution: 70, description: `${count} pending sessions with no suspicious flags` },
    { label: 'No anomaly markers', contribution: 30, description: 'No "suspicious" or "mismatch" in descriptions' },
  ]

  const impactEstimate: ImpactEstimate = {
    affectedCount:      entities.length,
    complianceRisk:     'low',
    rollbackPossible:   true,
    rollbackWindowHours: 24,
  }

  const explainability: ExplainabilityTrace = {
    triggeringEventIds: eventIds,
    appliedRules:       ['low_risk_approval_rule'],
    confidenceLogic:    'Fixed 72% — sessions with no suspicious or mismatch markers are safe to auto-approve',
    impactCalculation:  `Approves ${count} low-risk attendance sessions for ${entities.length} employee${entities.length > 1 ? 's' : ''}`,
  }

  return {
    id:                makeId('approve_sessions', eventIds),
    type:              'approve_sessions',
    category:          'attendance',
    severity:          'low',
    confidence,
    confidenceLevel:   toConfidenceLevel(confidence),
    title:             `${count} Attendance Session${count > 1 ? 's' : ''} Safe to Auto-Approve`,
    explanation:       `${count} pending attendance correction${count > 1 ? 's' : ''} show no suspicious or mismatched indicators.`,
    recommendedAction: 'Bulk-approve all low-risk pending attendance sessions to clear the approval queue.',
    affectedEntities:  entities,
    impactEstimate,
    sourceEventIds:    eventIds,
    createdAt:         new Date().toISOString(),
    factors,
    explainability,
    status:            'pending',
    actionLabel:       'Auto-approve Safe',
    actionType:        'bulk_approve_attendance',
    actionEndpoint:    '/attendance/corrections/bulk-approve',
    actionBody:        { ids: eventIds },
  }
}

// ── Rule 3 — investigate_timing ───────────────────────────────────────────────

function ruleInvestigateTiming(events: OperationalActivityEvent[]): DecisionInsight | null {
  const filtered = events.filter(
    e => e.type === 'attendance_anomaly' && (e.severity === 'high' || e.severity === 'critical'),
  )
  const count = filtered.length
  if (count === 0) return null

  const confidence = 78
  const entities = uniqueEntities(filtered)
  const eventIds = filtered.map(e => e.id)

  const factors: ConfidenceFactor[] = [
    { label: 'High-severity anomalies', contribution: 75, description: `${count} attendance anomalies rated high or critical` },
    { label: 'Severity signal',         contribution: 25, description: 'Elevated severity indicates non-trivial timing deviations' },
  ]

  const impactEstimate: ImpactEstimate = {
    affectedCount:    entities.length,
    complianceRisk:   'medium',
    rollbackPossible: false,
  }

  const explainability: ExplainabilityTrace = {
    triggeringEventIds: eventIds,
    appliedRules:       ['high_severity_anomaly_rule'],
    confidenceLogic:    'Fixed 78% — high/critical attendance anomalies warrant manual review',
    impactCalculation:  `${count} anomalies across ${entities.length} employee${entities.length > 1 ? 's' : ''} flagged for investigation`,
  }

  return {
    id:                makeId('investigate_timing', eventIds),
    type:              'investigate_timing',
    category:          'attendance',
    severity:          'high',
    confidence,
    confidenceLevel:   toConfidenceLevel(confidence),
    title:             `${count} High-Severity Attendance Anomal${count > 1 ? 'ies' : 'y'} Detected`,
    explanation:       `${count} attendance anomal${count > 1 ? 'ies' : 'y'} with high or critical severity require investigation.`,
    recommendedAction: 'Flag all high-severity anomalies for supervisor review before payroll lock.',
    affectedEntities:  entities,
    impactEstimate,
    sourceEventIds:    eventIds,
    createdAt:         new Date().toISOString(),
    factors,
    explainability,
    status:            'pending',
    actionLabel:       'Flag for Review',
    actionType:        'bulk_resolve_anomalies',
    actionEndpoint:    '/attendance/anomalies/bulk-resolve',
    actionBody:        { ids: eventIds, resolution: 'flagged_for_review' },
  }
}

// ── Rule 4 — rebalance_shifts ─────────────────────────────────────────────────

function ruleRebalanceShifts(events: OperationalActivityEvent[]): DecisionInsight | null {
  const filtered = events.filter(e => e.type === 'shift_unassigned')
  const count = filtered.length
  if (count === 0) return null

  const severity: InsightSeverity = count > 5 ? 'high' : 'medium'
  const confidence = 80
  const entities = uniqueEntities(filtered)
  const eventIds = filtered.map(e => e.id)

  const factors: ConfidenceFactor[] = [
    { label: 'Unassigned shifts',  contribution: 80, description: `${count} shift${count > 1 ? 's' : ''} without an assigned employee` },
    { label: 'Coverage impact',    contribution: 20, description: 'Unassigned shifts directly impact operational coverage' },
  ]

  const impactEstimate: ImpactEstimate = {
    affectedCount:    count,
    fatigueImpact:    count > 5 ? 'high' : 'medium',
    rollbackPossible: true,
    rollbackWindowHours: 48,
  }

  const explainability: ExplainabilityTrace = {
    triggeringEventIds: eventIds,
    appliedRules:       ['unassigned_shift_rule'],
    confidenceLogic:    'Fixed 80% — unassigned shifts are a clear coverage gap',
    impactCalculation:  `${count} shift${count > 1 ? 's' : ''} unassigned, creating coverage gaps`,
  }

  return {
    id:                makeId('rebalance_shifts', eventIds),
    type:              'rebalance_shifts',
    category:          'roster',
    severity,
    confidence,
    confidenceLevel:   toConfidenceLevel(confidence),
    title:             `${count} Shift${count > 1 ? 's' : ''} Unassigned — Coverage Gap`,
    explanation:       `${count} roster shift${count > 1 ? 's' : ''} currently have no assigned employee, creating coverage gaps.`,
    recommendedAction: 'Assign available employees to the unassigned shifts to restore full coverage.',
    affectedEntities:  entities,
    impactEstimate,
    sourceEventIds:    eventIds,
    createdAt:         new Date().toISOString(),
    factors,
    explainability,
    status:            'pending',
    actionLabel:       'Assign Shifts',
    actionType:        'bulk_assign_shifts',
    actionEndpoint:    '/roster/assignments/bulk-assign',
    actionBody:        { shiftEventIds: eventIds },
  }
}

// ── Rule 5 — reduce_fatigue ───────────────────────────────────────────────────

function ruleReduceFatigue(events: OperationalActivityEvent[]): DecisionInsight | null {
  const filtered = events.filter(e => e.type === 'fatigue_risk' && e.status === 'open')
  const count = filtered.length
  if (count === 0) return null

  const severity: InsightSeverity = count > 3 ? 'high' : 'medium'
  const confidence = Math.min(90, 70 + count * 4)
  const entities = uniqueEntities(filtered)
  const eventIds = filtered.map(e => e.id)

  const factors: ConfidenceFactor[] = [
    { label: 'Open fatigue risk events', contribution: 65, description: `${count} unresolved fatigue risk flag${count > 1 ? 's' : ''}` },
    { label: 'Employee wellbeing signal', contribution: 35, description: 'Fatigue accumulation increases error and safety risk' },
  ]

  const impactEstimate: ImpactEstimate = {
    affectedCount:    entities.length,
    fatigueImpact:    count > 3 ? 'high' : 'medium',
    complianceRisk:   'medium',
    rollbackPossible: true,
    rollbackWindowHours: 72,
  }

  const explainability: ExplainabilityTrace = {
    triggeringEventIds: eventIds,
    appliedRules:       ['fatigue_risk_threshold_rule'],
    confidenceLogic:    'Base confidence 70%, +4% per event up to 90%',
    impactCalculation:  `${entities.length} employee${entities.length > 1 ? 's' : ''} showing active fatigue risk signals`,
  }

  return {
    id:                makeId('reduce_fatigue', eventIds),
    type:              'reduce_fatigue',
    category:          'roster',
    severity,
    confidence,
    confidenceLevel:   toConfidenceLevel(confidence),
    title:             `${count} Fatigue Risk${count > 1 ? 's' : ''} Open — Schedule Review Needed`,
    explanation:       `${count} employee${count > 1 ? 's are' : ' is'} flagged with active fatigue risk that remains unresolved.`,
    recommendedAction: 'Review and adjust schedules for employees with active fatigue risk flags.',
    affectedEntities:  entities,
    impactEstimate,
    sourceEventIds:    eventIds,
    createdAt:         new Date().toISOString(),
    factors,
    explainability,
    status:            'pending',
    actionLabel:       'Review Schedules',
    actionType:        'bulk_resolve_anomalies',
    actionEndpoint:    '/roster/fatigue/bulk-resolve',
    actionBody:        { ids: eventIds },
  }
}

// ── Rule 6 — resolve_payroll_blockers ─────────────────────────────────────────

function ruleResolvePayrollBlockers(events: OperationalActivityEvent[]): DecisionInsight | null {
  const filtered = events.filter(e => e.type === 'payroll_blocker' && e.status === 'open')
  const count = filtered.length
  if (count === 0) return null

  const severity: InsightSeverity = count > 3 ? 'critical' : 'high'
  const confidence = 88
  const entities = uniqueEntities(filtered)
  const eventIds = filtered.map(e => e.id)

  const factors: ConfidenceFactor[] = [
    { label: 'Open payroll blockers', contribution: 70, description: `${count} unresolved payroll blocker${count > 1 ? 's' : ''}` },
    { label: 'Payroll lock dependency', contribution: 30, description: 'All blockers must be cleared before payroll can be locked' },
  ]

  const impactEstimate: ImpactEstimate = {
    affectedCount:    entities.length,
    payrollImpact:    0,
    complianceRisk:   'high',
    rollbackPossible: false,
  }

  const explainability: ExplainabilityTrace = {
    triggeringEventIds: eventIds,
    appliedRules:       ['payroll_blocker_threshold_rule'],
    confidenceLogic:    'Fixed 88% — payroll blockers are explicit system-flagged items requiring action',
    impactCalculation:  `${count} blocker${count > 1 ? 's' : ''} preventing payroll lock for ${entities.length} employee${entities.length > 1 ? 's' : ''}`,
  }

  return {
    id:                makeId('resolve_payroll_blockers', eventIds),
    type:              'resolve_payroll_blockers',
    category:          'payroll',
    severity,
    confidence,
    confidenceLevel:   toConfidenceLevel(confidence),
    title:             `${count} Payroll Blocker${count > 1 ? 's' : ''} Preventing Lock`,
    explanation:       `${count} open payroll blocker${count > 1 ? 's' : ''} must be resolved before payroll can be locked and processed.`,
    recommendedAction: 'Resolve all open payroll blockers to unblock the payroll lock process.',
    affectedEntities:  entities,
    impactEstimate,
    sourceEventIds:    eventIds,
    createdAt:         new Date().toISOString(),
    factors,
    explainability,
    status:            'pending',
    actionLabel:       'Resolve Blockers',
    actionType:        'bulk_lock_payroll',
    actionEndpoint:    '/payroll/blockers/bulk-resolve',
    actionBody:        { ids: eventIds },
  }
}

// ── Rule 7 — detect_payroll_variance ─────────────────────────────────────────

function ruleDetectPayrollVariance(events: OperationalActivityEvent[]): DecisionInsight | null {
  const filtered = events.filter(
    e => e.type === 'approval_approved' && e.workspace === 'payroll',
  )
  const count = filtered.length
  if (count === 0) return null

  const confidence = 65
  const entities = uniqueEntities(filtered)
  const eventIds = filtered.map(e => e.id)

  const factors: ConfidenceFactor[] = [
    { label: 'Approved payroll revisions', contribution: 60, description: `${count} compensation revision${count > 1 ? 's' : ''} recently approved` },
    { label: 'Variance detection',          contribution: 40, description: 'Recent approvals may introduce payroll variance' },
  ]

  const impactEstimate: ImpactEstimate = {
    affectedCount:    entities.length,
    complianceRisk:   'low',
    rollbackPossible: true,
    rollbackWindowHours: 48,
  }

  const explainability: ExplainabilityTrace = {
    triggeringEventIds: eventIds,
    appliedRules:       ['payroll_revision_variance_rule'],
    confidenceLogic:    'Fixed 65% — approved payroll revisions should be reviewed for cumulative variance',
    impactCalculation:  `${count} revision${count > 1 ? 's' : ''} across ${entities.length} employee${entities.length > 1 ? 's' : ''} may affect payroll totals`,
  }

  return {
    id:                makeId('detect_payroll_variance', eventIds),
    type:              'detect_payroll_variance',
    category:          'payroll',
    severity:          'medium',
    confidence,
    confidenceLevel:   toConfidenceLevel(confidence),
    title:             `${count} Payroll Revision${count > 1 ? 's' : ''} May Cause Variance`,
    explanation:       `${count} recently approved payroll revision${count > 1 ? 's' : ''} may introduce unexpected variance in the current payroll cycle.`,
    recommendedAction: 'Review all recent payroll revisions to identify and validate any unexpected variance.',
    affectedEntities:  entities,
    impactEstimate,
    sourceEventIds:    eventIds,
    createdAt:         new Date().toISOString(),
    factors,
    explainability,
    status:            'pending',
    actionLabel:       'Review Changes',
    actionType:        'bulk_lock_payroll',
    actionEndpoint:    '/payroll/revisions/review',
    actionBody:        { ids: eventIds },
  }
}

// ── Rule 8 — ot_threshold_warning ─────────────────────────────────────────────

function ruleOtThresholdWarning(events: OperationalActivityEvent[]): DecisionInsight | null {
  const filtered = events.filter(e => e.type === 'ot_spike' && e.status === 'open')
  const count = filtered.length
  if (count === 0) return null

  const severity: InsightSeverity = count > 5 ? 'high' : 'medium'
  const confidence = 75
  const entities = uniqueEntities(filtered)
  const eventIds = filtered.map(e => e.id)

  const factors: ConfidenceFactor[] = [
    { label: 'OT spike events', contribution: 65, description: `${count} open overtime spike flag${count > 1 ? 's' : ''}` },
    { label: 'Threshold breach', contribution: 35, description: 'OT spikes may breach statutory or policy limits' },
  ]

  const impactEstimate: ImpactEstimate = {
    affectedCount:    entities.length,
    complianceRisk:   count > 5 ? 'high' : 'medium',
    fatigueImpact:    count > 5 ? 'high' : 'medium',
    rollbackPossible: false,
  }

  const explainability: ExplainabilityTrace = {
    triggeringEventIds: eventIds,
    appliedRules:       ['ot_spike_threshold_rule'],
    confidenceLogic:    'Fixed 75% — OT spikes are direct signals of threshold proximity',
    impactCalculation:  `${count} OT spike${count > 1 ? 's' : ''} detected across ${entities.length} employee${entities.length > 1 ? 's' : ''}`,
  }

  return {
    id:                makeId('ot_threshold_warning', eventIds),
    type:              'ot_threshold_warning',
    category:          'compliance',
    severity,
    confidence,
    confidenceLevel:   toConfidenceLevel(confidence),
    title:             `${count} Overtime Spike${count > 1 ? 's' : ''} Exceed Threshold`,
    explanation:       `${count} employee${count > 1 ? 's have' : ' has'} open overtime spike flags that may breach statutory or policy OT limits.`,
    recommendedAction: 'Review all flagged OT spikes and adjust schedules or approvals to stay within permitted limits.',
    affectedEntities:  entities,
    impactEstimate,
    sourceEventIds:    eventIds,
    createdAt:         new Date().toISOString(),
    factors,
    explainability,
    status:            'pending',
    actionLabel:       'Review OT',
    actionType:        'bulk_resolve_anomalies',
    actionEndpoint:    '/attendance/anomalies/bulk-resolve',
    actionBody:        { ids: eventIds, resolution: 'ot_review' },
  }
}

// ── Rule 9 — compliance_warning ───────────────────────────────────────────────

function ruleComplianceWarning(events: OperationalActivityEvent[]): DecisionInsight | null {
  const filtered = events.filter(e => e.type === 'compliance_alert' && e.status === 'open')
  const count = filtered.length
  if (count === 0) return null

  const severity: InsightSeverity = count > 2 ? 'critical' : 'high'
  const confidence = 85
  const entities = uniqueEntities(filtered)
  const eventIds = filtered.map(e => e.id)

  const factors: ConfidenceFactor[] = [
    { label: 'Open compliance alerts', contribution: 75, description: `${count} unresolved compliance alert${count > 1 ? 's' : ''}` },
    { label: 'Regulatory exposure',    contribution: 25, description: 'Unresolved compliance issues increase regulatory risk' },
  ]

  const impactEstimate: ImpactEstimate = {
    affectedCount:    entities.length,
    complianceRisk:   'high',
    rollbackPossible: false,
  }

  const explainability: ExplainabilityTrace = {
    triggeringEventIds: eventIds,
    appliedRules:       ['compliance_alert_threshold_rule'],
    confidenceLogic:    'Fixed 85% — compliance alerts are high-signal items requiring immediate attention',
    impactCalculation:  `${count} compliance alert${count > 1 ? 's' : ''} affecting ${entities.length} employee${entities.length > 1 ? 's' : ''}`,
  }

  return {
    id:                makeId('compliance_warning', eventIds),
    type:              'compliance_warning',
    category:          'compliance',
    severity,
    confidence,
    confidenceLevel:   toConfidenceLevel(confidence),
    title:             `${count} Open Compliance Alert${count > 1 ? 's' : ''} Require Immediate Action`,
    explanation:       `${count} compliance alert${count > 1 ? 's' : ''} remain unresolved, increasing regulatory exposure.`,
    recommendedAction: 'Address all open compliance alerts before the end of the current period.',
    affectedEntities:  entities,
    impactEstimate,
    sourceEventIds:    eventIds,
    createdAt:         new Date().toISOString(),
    factors,
    explainability,
    status:            'pending',
    actionLabel:       'Address Now',
    actionType:        'bulk_resolve_anomalies',
    actionEndpoint:    '/compliance/alerts/bulk-resolve',
    actionBody:        { ids: eventIds },
  }
}

// ── Main export ───────────────────────────────────────────────────────────────

/** Generate decision insights from the unified activity stream */
export function generateInsights(events: OperationalActivityEvent[]): DecisionInsight[] {
  const results = [
    ruleRegularisePunches(events),
    ruleApproveSessions(events),
    ruleInvestigateTiming(events),
    ruleRebalanceShifts(events),
    ruleReduceFatigue(events),
    ruleResolvePayrollBlockers(events),
    ruleDetectPayrollVariance(events),
    ruleOtThresholdWarning(events),
    ruleComplianceWarning(events),
  ].filter((insight): insight is DecisionInsight => insight !== null)

  return results.sort((a, b) => {
    const severityDiff = SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity]
    if (severityDiff !== 0) return severityDiff
    return b.confidence - a.confidence
  })
}
