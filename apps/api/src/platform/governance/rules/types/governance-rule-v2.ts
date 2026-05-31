/**
 * GovernanceRuleV2 — extended governance rule type with jurisdiction,
 * effective-dating, category, and action metadata.
 *
 * Does NOT replace GovernanceRule — extends it with richer metadata.
 * Sprint 2: Governance Intelligence Layer.
 */

import type { EventSeverity }          from '../../../events/types/platform-event.js'
import type { ResolvedPlatformEvent }  from '../../../events/types/platform-event.js'

export type RuleCategory =
  | 'compliance'
  | 'risk'
  | 'trust'
  | 'attendance'
  | 'payroll'
  | 'security'
  | 'escalation'
  | 'leave'

export interface GovernanceAction {
  type:                  'alert' | 'incident' | 'score' | 'classify' | 'notify'
  severity?:             EventSeverity
  incident_type?:        string
  notification_channel?: string
  metadata?:             Record<string, unknown>
}

export interface GovernanceRuleV2 {
  rule_id:          string
  name:             string
  description:      string
  category:         RuleCategory
  /** e.g. 'IN', 'IN-MH', 'IN-KA' — undefined = all jurisdictions */
  jurisdiction?:    string
  state?:           string
  severity:         EventSeverity
  /** ISO date — rule becomes active on this date */
  effective_from:   string
  /** ISO date — undefined means no expiry */
  effective_to?:    string
  enabled:          boolean
  event_types:      string[]
  conditions:       Record<string, unknown>
  actions:          GovernanceAction[]
  /** true = safe to re-evaluate during event replay */
  replay_safe:      boolean
  /** Optional template string for human-readable explanations */
  explainability_template?: string
  /** Predicate — returns true when the rule should fire */
  matches: (event: ResolvedPlatformEvent) => boolean
  /** Human-readable reason for the match */
  reason:  (event: ResolvedPlatformEvent) => string
}
