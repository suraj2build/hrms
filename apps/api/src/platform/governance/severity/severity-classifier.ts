/**
 * SeverityClassifier — maps event patterns to severity levels.
 *
 * Used by governance listeners to enrich events with risk context.
 */

import type { EventSeverity }         from '../../events/types/platform-event.js'
import type { ResolvedPlatformEvent } from '../../events/types/platform-event.js'
import { EventType }                  from '../../events/constants/event-types.js'

/** Baseline severity by event type */
const BASELINE_SEVERITY: Partial<Record<string, EventSeverity>> = {
  [EventType.COMPLIANCE_FAILED]:          'high',
  [EventType.INCIDENT_CREATED]:           'high',
  [EventType.INCIDENT_ESCALATED]:         'critical',
  [EventType.GOVERNANCE_ALERT_RAISED]:    'high',
  [EventType.EMPLOYEE_SEPARATED]:         'warning',
  [EventType.ATTENDANCE_LOCKED]:          'warning',
  [EventType.COMPENSATION_REVISION_APPROVED]: 'warning',
}

export class SeverityClassifier {
  /**
   * Classify the severity of an event.
   * Returns the event's own severity if set, otherwise derives from baseline map.
   */
  classify(event: ResolvedPlatformEvent): EventSeverity {
    if (event.severity && event.severity !== 'info') return event.severity
    return BASELINE_SEVERITY[event.event_type] ?? 'info'
  }

  /**
   * Determine if an event warrants escalation based on severity.
   */
  requiresEscalation(severity: EventSeverity): boolean {
    return severity === 'critical' || severity === 'high'
  }
}

export const severityClassifier = new SeverityClassifier()
