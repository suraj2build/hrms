/**
 * ComplianceEvaluator — evaluates platform events against registered governance rules.
 *
 * PASSIVE ONLY — may alert/score/incident but NEVER mutates operational data.
 * Sprint 2: Governance Intelligence Layer.
 */

import type { SupabaseClient }         from '@supabase/supabase-js'
import type { ResolvedPlatformEvent }  from '../../../events/types/platform-event.js'
import type { EventSeverity }          from '../../../events/types/platform-event.js'
import type { ExplainabilityResult }   from '../../../ai/types/explainability.js'
import { governanceRuleRegistry }      from '../../rules/registry/governance-rule-registry.js'
import { explainabilityService }       from '../../../ai/services/explainability.service.js'
// Side-effect import — registers all 4 statutory compliance rules
// (attendance/compensation/leave/payroll) onto governanceRuleRegistry.
// This is the actual runtime-reachable registration point: nothing in the
// import chain from apps/api/src/index.ts (which imports this evaluator
// via compliance-governance-listener.ts) previously imported
// rules/compliance/index.ts, so the registry was permanently empty and
// evaluate() always returned { compliant: true, violations: [] }.
import '../../rules/compliance/index.js'

export interface ComplianceValidationResult {
  compliant:           boolean
  severity:            EventSeverity
  violations:          string[]
  affected_entities?:  string[]
  explainability?:     ExplainabilityResult
}

/** Severity ordering for computing max severity. */
const SEVERITY_ORDER: Record<EventSeverity, number> = {
  info: 0, warning: 1, high: 2, critical: 3,
}

export class ComplianceEvaluator {
  /**
   * Evaluate a platform event against all active compliance rules.
   * Returns a ComplianceValidationResult — never throws.
   */
  async evaluate(event: ResolvedPlatformEvent, supabase?: SupabaseClient): Promise<ComplianceValidationResult> {
    const matches = await governanceRuleRegistry.evaluate(event, supabase)
    const violations = matches.map(m => m.reason)

    // Compute highest severity across all matches, and track which match
    // is actually responsible for it — explainability must cite that rule,
    // not just whichever rule happened to be registered first.
    let maxSeverity: EventSeverity = 'info'
    let maxSeverityMatch: typeof matches[number] | undefined
    for (const m of matches) {
      if (!maxSeverityMatch || SEVERITY_ORDER[m.severity] > SEVERITY_ORDER[maxSeverity]) {
        maxSeverity = m.severity
        maxSeverityMatch = m
      }
    }

    const explainability = matches.length > 0
      ? explainabilityService.explain({
          event_type:  event.event_type,
          entity_type: event.entity_type,
          entity_id:   event.entity_id,
          payload:     event.payload,
          rule_name:   maxSeverityMatch?.rule.name,
          severity:    maxSeverity,
        })
      : undefined

    return {
      compliant:         matches.length === 0,
      severity:          maxSeverity,
      violations,
      affected_entities: [event.entity_id],
      explainability,
    }
  }
}

/** Singleton compliance evaluator. */
export const complianceEvaluator = new ComplianceEvaluator()
