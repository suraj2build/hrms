/**
 * RuleEngine — passive rule matching for governance evaluation.
 *
 * Rules define WHEN to trigger governance actions (classify, alert, score).
 * Rules NEVER mutate operational data.
 */

import type { ResolvedPlatformEvent } from '../../events/types/platform-event.js'
import type { EventSeverity }         from '../../events/types/platform-event.js'

export interface GovernanceRule {
  id:          string
  name:        string
  description: string
  event_types: string[]   // EventType values this rule applies to
  /** Returns true when the rule should trigger */
  matches: (event: ResolvedPlatformEvent) => boolean
  /** Severity to assign if rule matches */
  severity: EventSeverity
  /** Human-readable reason for the match */
  reason: (event: ResolvedPlatformEvent) => string
}

export interface RuleMatch {
  rule:     GovernanceRule
  severity: EventSeverity
  reason:   string
}

export class RuleEngine {
  private readonly rules: GovernanceRule[] = []

  register(rule: GovernanceRule): this {
    this.rules.push(rule)
    return this
  }

  /**
   * Evaluate all rules against an event.
   * Returns all matching rules — caller decides what to do with them.
   */
  evaluate(event: ResolvedPlatformEvent): RuleMatch[] {
    const matches: RuleMatch[] = []

    for (const rule of this.rules) {
      // Skip rules not applicable to this event type
      if (!rule.event_types.includes('*') && !rule.event_types.includes(event.event_type)) continue

      try {
        if (rule.matches(event)) {
          matches.push({
            rule,
            severity: rule.severity,
            reason:   rule.reason(event),
          })
        }
      } catch (err) {
        console.warn('[RuleEngine] rule evaluation error', { rule: rule.id, error: err })
      }
    }

    return matches
  }
}

/** Singleton rule engine */
export const ruleEngine = new RuleEngine()
