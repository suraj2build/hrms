/**
 * Trust-specific explainability helpers.
 * All trust intelligence must produce explainable output.
 */
import type { ExplainabilityResult } from '../../ai/types/explainability.js'
import type { TrustScoreResult, DuplicateDetectionResult } from '../types/trust-types.js'

export function explainTrustScore(score: TrustScoreResult): ExplainabilityResult {
  return {
    summary: `Trust score ${score.score}/100 (${score.severity} risk) for ${score.score_type} ${score.entity_id}`,
    confidence_score: 0.9,
    contributing_factors: score.factors,
    recommended_actions: score.severity === 'critical'
      ? ['Immediate HR review required', 'Do not process payroll until resolved']
      : score.severity === 'high'
      ? ['Schedule verification review within 48 hours']
      : score.severity === 'medium'
      ? ['Flag for next HR audit cycle']
      : ['No immediate action required — continue monitoring'],
  }
}

export function explainDuplicate(dup: DuplicateDetectionResult): ExplainabilityResult {
  return {
    summary: `Duplicate ${dup.duplicate_type} detected across ${dup.matching_entity_ids.length + 1} employees`,
    confidence_score: 0.95,
    contributing_factors: [
      `Duplicate type: ${dup.duplicate_type}`,
      `Affected employee count: ${dup.matching_entity_ids.length + 1}`,
      `Severity: ${dup.severity}`,
    ],
    recommended_actions: [
      'Verify all affected employees with HR admin',
      'Check for data entry errors before escalating',
      'If fraud suspected, escalate to compliance team',
    ],
  }
}
