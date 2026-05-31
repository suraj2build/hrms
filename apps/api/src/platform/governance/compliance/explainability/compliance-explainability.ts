/**
 * Compliance-specific explainability templates.
 *
 * Generates structured ExplainabilityResult objects for compliance violations
 * with entity context, threshold comparisons, and recommended actions.
 * Sprint 2: Governance Intelligence Layer.
 */

import type { ExplainabilityResult } from '../../../ai/types/explainability.js'

export interface ComplianceViolationParams {
  violation_type:    string
  entity_type:       string
  entity_id:         string
  value?:            number
  threshold?:        number
  severity:          string
  suggested_action?: string
}

/** Build an ExplainabilityResult for a compliance violation. */
export function explainComplianceViolation(
  params: ComplianceViolationParams,
): ExplainabilityResult {
  const parts = [`Violation: ${params.violation_type}`]
  if (params.value !== undefined && params.threshold !== undefined) {
    parts.push(`Actual: ${params.value} — Threshold: ${params.threshold}`)
  }
  return {
    summary:              parts.join(' | '),
    confidence_score:     0.95,
    contributing_factors: [
      `Entity: ${params.entity_type} ${params.entity_id}`,
      `Severity: ${params.severity}`,
    ],
    recommended_actions: params.suggested_action
      ? [params.suggested_action]
      : ['Review the flagged record with HR admin before next payroll cycle'],
  }
}
