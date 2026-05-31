/**
 * ExplainabilityService — shared AI explainability capability.
 *
 * Sprint 1: Foundation stub — returns structured placeholders.
 * Future sprint: Wire to LLM provider (Anthropic Claude, etc.).
 *
 * All modules that need AI explanations consume THIS shared service.
 * No duplicated prompts. No isolated AI logic.
 */

import type { ExplainabilityResult } from '../types/explainability.js'

export interface ExplainContext {
  event_type:  string
  entity_type: string
  entity_id:   string
  payload:     Record<string, unknown>
  rule_name?:  string
  severity?:   string
}

export class ExplainabilityService {
  /**
   * Generate an explanation for a governance event.
   *
   * Sprint 1: Returns a structured placeholder.
   * Future: Replace with real LLM call using context.
   */
  explain(context: ExplainContext): ExplainabilityResult {
    const factors: string[] = []
    if (context.rule_name) factors.push(`Rule triggered: ${context.rule_name}`)
    if (context.severity && context.severity !== 'info') factors.push(`Severity: ${context.severity}`)
    if (context.entity_type) factors.push(`Affected entity: ${context.entity_type} ${context.entity_id}`)

    return {
      summary:              `${context.event_type} — review recommended`,
      confidence_score:     null as unknown as undefined,
      contributing_factors: factors.length > 0 ? factors : undefined,
      recommended_actions:  ['Review the flagged record', 'Verify with HR admin'],
    }
  }

  /**
   * Generate an explanation for a compliance violation.
   * Sprint 2: Structured templates. Future: LLM-powered explanations.
   */
  explainComplianceViolation(params: {
    violation_type:    string
    entity_type:       string
    entity_id:         string
    value?:            number
    threshold?:        number
    severity:          string
    rule_name?:        string
    suggested_action?: string
  }): ExplainabilityResult {
    return {
      summary: `Compliance violation — ${params.violation_type} for ${params.entity_type} ${params.entity_id}`,
      confidence_score: 0.95,
      contributing_factors: [
        `Violation type: ${params.violation_type}`,
        ...(params.value !== undefined && params.threshold !== undefined
          ? [`Actual value: ${params.value} — Threshold: ${params.threshold}`]
          : []),
        `Severity: ${params.severity}`,
      ],
      recommended_actions: params.suggested_action
        ? [params.suggested_action, 'Review with HR admin before next payroll cycle']
        : ['Review the flagged record', 'Verify statutory compliance', 'Consult HR admin'],
    }
  }

  /**
   * Generate an explanation for a risk classification result.
   * Sprint 2: Structured templates. Future: LLM-powered explanations.
   */
  explainRiskClassification(params: {
    risk_type: string
    score:     number
    severity:  string
    factors:   string[]
  }): ExplainabilityResult {
    return {
      summary:              `Risk classification: ${params.risk_type} — score ${params.score}/100`,
      confidence_score:     0.8,
      contributing_factors: params.factors,
      recommended_actions:  params.score > 75
        ? ['Immediate review required — escalate to compliance team']
        : params.score > 50
        ? ['Schedule review within 7 days']
        : ['Continue monitoring'],
    }
  }

  /**
   * Generate an explanation for a governance drift signal.
   * Sprint 2: Structured templates. Future: LLM-powered explanations.
   */
  explainDriftSignal(params: {
    signal:      string
    module:      string
    description: string
    severity:    string
  }): ExplainabilityResult {
    return {
      summary:              `Governance drift detected in ${params.module}: ${params.description}`,
      confidence_score:     0.75,
      contributing_factors: [`Signal: ${params.signal}`, `Module: ${params.module}`],
      recommended_actions:  [
        'Audit recent activity in the affected module',
        'Review policy adherence',
      ],
    }
  }

  /**
   * Summarize a batch of related events into a human-readable description.
   * Sprint 1: Simple concatenation. Future: LLM summarization.
   */
  summarize(events: Array<{ event_type: string; timestamp: string }>): ExplainabilityResult {
    const types = [...new Set(events.map(e => e.event_type))]
    return {
      summary:              `${events.length} event(s) across ${types.length} type(s): ${types.join(', ')}`,
      contributing_factors: types,
    }
  }
}

/** Singleton — all modules share one instance */
export const explainabilityService = new ExplainabilityService()
