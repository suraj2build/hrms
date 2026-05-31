/**
 * GovernanceRuleRegistry — manages effective-dated, jurisdiction-aware V2 governance rules.
 *
 * Supports registration, filtering by date/jurisdiction/category, and evaluation.
 * Sprint 2: Governance Intelligence Layer.
 */

import type { ResolvedPlatformEvent } from '../../../events/types/platform-event.js'
import type { EventSeverity }         from '../../../events/types/platform-event.js'
import type {
  GovernanceRuleV2,
  RuleCategory,
}                                     from '../types/governance-rule-v2.js'

export interface GovernanceRuleMatch {
  rule:     GovernanceRuleV2
  severity: EventSeverity
  reason:   string
}

export class GovernanceRuleRegistry {
  private rules: GovernanceRuleV2[] = []

  /** Register a V2 governance rule. Returns this for chaining. */
  register(rule: GovernanceRuleV2): this {
    this.rules.push(rule)
    return this
  }

  /**
   * Get all active rules as of a given ISO date.
   * Defaults to today.
   */
  getActiveRules(asOf?: string): GovernanceRuleV2[] {
    const date = asOf ?? new Date().toISOString().slice(0, 10)
    return this.rules.filter(r => {
      if (!r.enabled) return false
      if (r.effective_from > date) return false
      if (r.effective_to && r.effective_to < date) return false
      return true
    })
  }

  /** Get active rules that match a specific event type. */
  getRulesForEvent(eventType: string, asOf?: string): GovernanceRuleV2[] {
    return this.getActiveRules(asOf).filter(r =>
      r.event_types.includes('*') || r.event_types.includes(eventType),
    )
  }

  /** Get all rules (active or not) by category. */
  getRulesByCategory(category: RuleCategory): GovernanceRuleV2[] {
    return this.rules.filter(r => r.category === category)
  }

  /**
   * Evaluate a platform event against all currently-active rules.
   * Returns matches — caller decides what to do with them.
   */
  evaluate(event: ResolvedPlatformEvent): GovernanceRuleMatch[] {
    const matches: GovernanceRuleMatch[] = []
    const candidates = this.getRulesForEvent(event.event_type)

    for (const rule of candidates) {
      try {
        if (rule.matches(event)) {
          matches.push({
            rule,
            severity: rule.severity,
            reason:   rule.reason(event),
          })
        }
      } catch (err) {
        console.warn('[GovernanceRuleRegistry] rule evaluation error', {
          rule_id: rule.rule_id,
          error:   err,
        })
      }
    }

    return matches
  }

  /** List all registered rules (active and inactive). */
  listAll(): GovernanceRuleV2[] {
    return [...this.rules]
  }
}

/** Singleton registry — rules are registered at module load time via side-effects. */
export const governanceRuleRegistry = new GovernanceRuleRegistry()
