/**
 * RiskClassifier — classifies platform events into typed risk signals.
 *
 * Passive only — classifies and scores, never mutates operational data.
 * Sprint 2: Governance Intelligence Layer.
 */

import type { ResolvedPlatformEvent } from '../../events/types/platform-event.js'
import type { EventSeverity }         from '../../events/types/platform-event.js'
import type { ExplainabilityResult }  from '../../ai/types/explainability.js'
import { explainabilityService }      from '../../ai/services/explainability.service.js'

export type RiskType =
  | 'attendance_excessive_edits'
  | 'attendance_proxy_behavior'
  | 'attendance_suspicious_timing'
  | 'payroll_abnormal_spike'
  | 'payroll_excessive_overrides'
  | 'payroll_repeated_recalculations'
  | 'approval_abnormal_frequency'
  | 'approval_same_user_override'
  | 'approval_escalation_bypass'
  | 'security_risky_session'
  | 'security_unusual_admin_activity'
  | 'security_failed_authorization'

export interface RiskClassification {
  risk_type:         RiskType
  score:             number          // 0–100
  severity:          EventSeverity
  factors:           string[]
  entity_id:         string
  entity_type:       string
  org_id:            string
  classified_at:     string
  signal_confidence: number          // 0.0–1.0: 1.0 = fully deterministic, 0.5 = inferred
  explainability?:   ExplainabilityResult
}

export class RiskClassifier {
  /**
   * Attempt to classify a platform event into a risk signal.
   * Returns null if no risk pattern matches.
   */
  classify(event: ResolvedPlatformEvent): RiskClassification | null {
    const payload = event.payload

    // Payroll spike risk
    if (event.event_type === 'compensation.revision.approved') {
      const deltaPct = (payload?.delta_pct as number) ?? 0
      if (deltaPct > 30) {
        const score    = Math.min(100, deltaPct * 2)
        const severity: EventSeverity = deltaPct > 60 ? 'critical' : deltaPct > 40 ? 'high' : 'warning'
        return this.build(
          'payroll_abnormal_spike', score, severity,
          [`Compensation delta: ${deltaPct.toFixed(1)}%`],
          event,
        )
      }
    }

    // Attendance edit risk
    if (event.event_type === 'attendance.logged' && payload?.correction === true) {
      return this.build(
        'attendance_excessive_edits', 40, 'warning',
        ['Attendance correction detected'],
        event,
      )
    }

    // Approval bypass risk
    if (event.event_type === 'leave.approved' && payload?.self_approved === true) {
      return this.build(
        'approval_same_user_override', 75, 'high',
        ['Self-approved leave detected'],
        event,
      )
    }

    return null
  }

  private build(
    risk_type: RiskType,
    score:     number,
    severity:  EventSeverity,
    factors:   string[],
    event:     ResolvedPlatformEvent,
  ): RiskClassification {
    return {
      risk_type,
      score,
      severity,
      factors,
      entity_id:         event.entity_id,
      entity_type:       event.entity_type,
      org_id:            event.org_id,
      classified_at:     new Date().toISOString(),
      signal_confidence: 1.0,
      explainability: explainabilityService.explain({
        event_type:  event.event_type,
        entity_type: event.entity_type,
        entity_id:   event.entity_id,
        payload:     event.payload,
        rule_name:   risk_type,
        severity,
      }),
    }
  }
}

/** Singleton risk classifier. */
export const riskClassifier = new RiskClassifier()
