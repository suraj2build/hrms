/**
 * GovernanceRuleRegistry — manages effective-dated, jurisdiction-aware V2 governance rules.
 *
 * Supports registration, filtering by date/jurisdiction/category, and evaluation.
 * Sprint 2: Governance Intelligence Layer.
 */

import type { SupabaseClient }        from '@supabase/supabase-js'
import type { ResolvedPlatformEvent } from '../../../events/types/platform-event.js'
import type { EventSeverity }         from '../../../events/types/platform-event.js'
import type {
  GovernanceRuleV2,
  RuleCategory,
}                                     from '../types/governance-rule-v2.js'
import { fetchTenantTz } from '../../../../lib/attendance-engine.js'
import { getLocalDate }  from '../../../../lib/org-context.js'

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
   * Defaults to today. When `supabase` + `tenantId` are supplied and `asOf`
   * is not, "today" resolves to the tenant's local calendar date (PEND-31/74)
   * instead of the bare server-UTC date — consistent with every other
   * effective-dated check in this codebase (fetchTenantTz + getLocalDate).
   * Falls back to UTC if the tenant-tz lookup fails — this must never throw.
   */
  async getActiveRules(asOf?: string, supabase?: SupabaseClient, tenantId?: string): Promise<GovernanceRuleV2[]> {
    let date = asOf
    if (!date) {
      if (supabase && tenantId) {
        try {
          date = getLocalDate(new Date().toISOString(), await fetchTenantTz(supabase, tenantId))
        } catch {
          date = new Date().toISOString().slice(0, 10)
        }
      } else {
        date = new Date().toISOString().slice(0, 10)
      }
    }
    return this.rules.filter(r => {
      if (!r.enabled) return false
      if (r.effective_from > date!) return false
      if (r.effective_to && r.effective_to < date!) return false
      return true
    })
  }

  /** Get active rules that match a specific event type. */
  async getRulesForEvent(eventType: string, asOf?: string, supabase?: SupabaseClient, tenantId?: string): Promise<GovernanceRuleV2[]> {
    const active = await this.getActiveRules(asOf, supabase, tenantId)
    return active.filter(r =>
      r.event_types.includes('*') || r.event_types.includes(eventType),
    )
  }

  /** Get all rules (active or not) by category. */
  getRulesByCategory(category: RuleCategory): GovernanceRuleV2[] {
    return this.rules.filter(r => r.category === category)
  }

  /**
   * Evaluate a platform event against all currently-active rules.
   * Returns matches — caller decides what to do with them. Pass `supabase`
   * to resolve the effective-date check against the event's tenant's local
   * date rather than server UTC (see getActiveRules).
   */
  async evaluate(event: ResolvedPlatformEvent, supabase?: SupabaseClient): Promise<GovernanceRuleMatch[]> {
    const matches: GovernanceRuleMatch[] = []
    const candidates = await this.getRulesForEvent(event.event_type, undefined, supabase, event.tenant_id)

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
