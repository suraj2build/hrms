/**
 * AnomalyService — shared AI anomaly classification capability.
 *
 * Sprint 1: Rule-based classification (no ML).
 * Future sprint: Wire to anomaly detection model.
 *
 * Passive only — never mutates operational data.
 */

import type { ExplainabilityResult } from '../types/explainability.js'
import type { ResolvedPlatformEvent } from '../../events/types/platform-event.js'

export interface AnomalyClassification {
  is_anomaly:       boolean
  anomaly_type?:    string
  risk_score:       number  // 0–100
  explainability:   ExplainabilityResult
}

export class AnomalyService {
  /**
   * Classify whether a platform event represents an anomaly.
   * Sprint 1: Returns low-risk baseline. Future: ML scoring.
   */
  classify(event: ResolvedPlatformEvent): AnomalyClassification {
    const severity = event.severity ?? 'info'
    const riskScore =
      severity === 'critical' ? 90 :
      severity === 'high'     ? 70 :
      severity === 'warning'  ? 40 : 10

    return {
      is_anomaly:    riskScore >= 70,
      anomaly_type:  riskScore >= 70 ? event.event_type : undefined,
      risk_score:    riskScore,
      explainability: {
        summary:              `Event ${event.event_type} classified with risk score ${riskScore}`,
        confidence_score:     0.5,
        contributing_factors: [`severity=${severity}`],
      },
    }
  }
}

export const anomalyService = new AnomalyService()
