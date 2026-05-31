/**
 * ComplianceEvaluator — evaluates platform events against registered governance rules.
 *
 * PASSIVE ONLY — may alert/score/incident but NEVER mutates operational data.
 * Sprint 2: Governance Intelligence Layer.
 */

import type { ResolvedPlatformEvent }  from '../../../events/types/platform-event.js'
import type { EventSeverity }          from '../../../events/types/platform-event.js'
import type { ComplianceValidationResult } from '../benchmarks/compliance-benchmark.service.js'
import { governanceRuleRegistry }      from '../../rules/registry/governance-rule-registry.js'
import { explainabilityService }       from '../../../ai/services/explainability.service.js'

/** Severity ordering for computing max severity. */
const SEVERITY_ORDER: Record<EventSeverity, number> = {
  info: 0, warning: 1, high: 2, critical: 3,
}

export class ComplianceEvaluator {
  /**
   * Evaluate a platform event against all active compliance rules.
   * Returns a ComplianceValidationResult — never throws.
   */
  async evaluate(event: ResolvedPlatformEvent): Promise<ComplianceValidationResult> {
    const matches = governanceRuleRegistry.evaluate(event)
    const violations = matches.map(m => m.reason)

    // Compute highest severity across all matches
    let maxSeverity: EventSeverity = 'info'
    for (const m of matches) {
      if (SEVERITY_ORDER[m.severity] > SEVERITY_ORDER[maxSeverity]) {
        maxSeverity = m.severity
      }
    }

    const explainability = matches.length > 0
      ? explainabilityService.explain({
          event_type:  event.event_type,
          entity_type: event.entity_type,
          entity_id:   event.entity_id,
          payload:     event.payload,
          rule_name:   matches[0]?.rule.name,
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
