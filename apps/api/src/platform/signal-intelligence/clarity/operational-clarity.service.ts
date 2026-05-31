/**
 * OperationalClarityService — converts raw signals into human-readable operational narratives.
 *
 * Answers the 5 enterprise questions for every signal:
 *   What happened? / Why? / How severe? / What is affected? / What next?
 *
 * Pure computation — no DB access.
 */

import type { PlatformSignal } from '../types/signal-types.js'

export interface OperationalNarrative {
  what:             string   // Short factual statement: what happened
  why:              string   // Root cause or triggering condition
  severity_context: string   // What this severity level means operationally
  affected:         string   // Entity/module description
  next_action:      string   // Recommended user action
}

function severityContext(severity: PlatformSignal['severity']): string {
  switch (severity) {
    case 'critical': return 'Requires immediate attention — this issue may impact payroll or compliance'
    case 'high':     return 'Should be resolved within 24 hours to avoid escalation'
    case 'warning':  return 'Monitor closely — may escalate if unaddressed'
    case 'info':     return 'Informational — no immediate action required'
    default:         return 'Informational — no immediate action required'
  }
}

class OperationalClarityService {
  buildNarrative(signal: PlatformSignal): OperationalNarrative {
    const sevCtx = severityContext(signal.severity)

    switch (signal.source) {
      case 'governance': {
        if (signal.event_type.includes('drift')) {
          return {
            what:             'Policy drift detected',
            why:              'Unusual change pattern exceeds configured threshold',
            severity_context: sevCtx,
            affected:         `Governance module for entity ${signal.entity_id}`,
            next_action:      'Review recent policy changes and verify compliance',
          }
        }
        if (signal.event_type.includes('compliance')) {
          return {
            what:             'Compliance rule triggered',
            why:              'A statutory or policy rule condition was met',
            severity_context: sevCtx,
            affected:         `Governance module for entity ${signal.entity_id}`,
            next_action:      'Review compliance report and confirm rule applicability',
          }
        }
        return {
          what:             'Governance event recorded',
          why:              'An administrative change triggered a governance rule',
          severity_context: sevCtx,
          affected:         `Governance module for entity ${signal.entity_id}`,
          next_action:      'Review governance activity log and confirm intent',
        }
      }

      case 'trust': {
        if (signal.event_type.includes('duplicate')) {
          return {
            what:             'Potential duplicate record detected',
            why:              'Same PAN/bank/phone fingerprint found on multiple records',
            severity_context: sevCtx,
            affected:         `Employee identity data for ${signal.entity_id}`,
            next_action:      'Verify employee records and merge or flag duplicates',
          }
        }
        if (signal.event_type.includes('verification') && signal.severity === 'critical') {
          return {
            what:             'Identity verification failed',
            why:              'PAN or bank account verification could not be completed',
            severity_context: sevCtx,
            affected:         `Employee identity data for ${signal.entity_id}`,
            next_action:      'Contact employee to re-submit valid documents',
          }
        }
        return {
          what:             'Trust signal recorded',
          why:              'A workforce trust evaluation was triggered',
          severity_context: sevCtx,
          affected:         `Employee trust profile for ${signal.entity_id}`,
          next_action:      'Review trust score and verify underlying data',
        }
      }

      case 'security': {
        if (signal.event_type.includes('approval_velocity')) {
          return {
            what:             'Unusual approval velocity detected',
            why:              'Admin approved an abnormally high number of requests in a short window',
            severity_context: 'This pattern may indicate automation abuse or compromised credentials',
            affected:         `Admin actor ${signal.entity_id}`,
            next_action:      'Audit the approval session and verify each action was intentional',
          }
        }
        if (signal.event_type.includes('override')) {
          return {
            what:             'Excessive data override activity',
            why:              'Multiple compensation or record overrides occurred in a short window',
            severity_context: sevCtx,
            affected:         `System records modified by ${signal.entity_id}`,
            next_action:      'Review override audit trail and confirm authorisation',
          }
        }
        return {
          what:             'Security signal detected',
          why:              'Anomalous system activity pattern was observed',
          severity_context: sevCtx,
          affected:         `Security context for ${signal.entity_type} ${signal.entity_id}`,
          next_action:      'Review security audit log and verify actor session',
        }
      }

      case 'sla': {
        return {
          what:             'SLA breach detected',
          why:              `${signal.entity_type} action has exceeded the allowed resolution window`,
          severity_context: sevCtx,
          affected:         `${signal.entity_type} ${signal.entity_id}`,
          next_action:      'Escalate to responsible team and update timeline',
        }
      }

      case 'operations': {
        return {
          what:             'Operational health signal',
          why:              'Module health score fell below acceptable threshold',
          severity_context: sevCtx,
          affected:         `${signal.entity_type} ${signal.entity_id}`,
          next_action:      'Review module activity and address flagged items',
        }
      }

      default: {
        return {
          what:             signal.title,
          why:              signal.description,
          severity_context: `${signal.severity} severity signal`,
          affected:         `${signal.entity_type} ${signal.entity_id}`,
          next_action:      'Review signal details and take appropriate action',
        }
      }
    }
  }

  enrichSignal(signal: PlatformSignal): PlatformSignal & { narrative: OperationalNarrative } {
    return {
      ...signal,
      narrative: this.buildNarrative(signal),
    }
  }
}

export const operationalClarityService = new OperationalClarityService()
