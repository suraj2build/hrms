/**
 * Trust-specific explainability helpers.
 * All trust intelligence must produce explainable output.
 */
import type { ExplainabilityResult } from '../../ai/types/explainability.js'
import type { TrustScoreResult, DuplicateDetectionResult } from '../types/trust-types.js'

export function explainTrustScore(score: TrustScoreResult): ExplainabilityResult {
  return {
    summary: `Trust score ${score.score}/100 (${score.severity} risk) for ${score.score_type} ${score.entity_id}`,
    // No LLM wired up yet — a hardcoded literal here would present as a real
    // AI confidence estimate on the Trust dashboard when it's actually a
    // fixed constant (SYSCERT_AUDIT_2026-08-02.md High #13).
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
    // See explainTrustScore's note above.
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
