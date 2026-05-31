/**
 * Risk-specific explainability templates.
 *
 * Generates structured ExplainabilityResult objects for risk scores.
 * Sprint 2: Governance Intelligence Layer.
 */

import type { ExplainabilityResult } from '../../ai/types/explainability.js'
import type { RiskScore }            from '../scoring/risk-score.service.js'

/** Build an ExplainabilityResult for a risk score. */
export function explainRiskScore(score: RiskScore): ExplainabilityResult {
  return {
    summary:          `Risk score ${score.score.toFixed(0)}/100 for ${score.type} ${score.entity_id}`,
    confidence_score: 0.8,
    contributing_factors: score.contributing_classifications.map(
      c => `${c.risk_type}: ${c.score.toFixed(0)}`,
    ),
    recommended_actions: score.score > 75
      ? ['Immediate review required', 'Escalate to HR compliance team']
      : score.score > 50
      ? ['Schedule review within 7 days', 'Check recent activity logs']
      : ['Monitor — no immediate action required'],
  }
}
