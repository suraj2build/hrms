/**
 * ComplianceGovernanceListener — passive compliance + risk observer.
 *
 * Handles all platform events. Runs compliance evaluation, drift detection,
 * and risk classification in the background. Never blocks operational flow.
 * Sprint 2: Governance Intelligence Layer.
 */

import { GovernanceListener }                    from './governance-listener.js'
import type { ResolvedPlatformEvent }            from '../../events/types/platform-event.js'
import { complianceEvaluator }                   from '../compliance/evaluators/compliance-evaluator.js'
import { driftDetectionService }                 from '../compliance/drift/drift-detection.service.js'
import { riskClassifier }                        from '../../risk/classifiers/risk-classifier.js'
import { riskScoreService }                      from '../../risk/scoring/risk-score.service.js'
import { observabilityIntelligenceService }      from '../../observability/intelligence/observability-intelligence.service.js'

export class ComplianceGovernanceListener extends GovernanceListener {
  readonly name    = 'ComplianceGovernanceListener'
  readonly handles = ['*']   // handles all events

  async evaluate(event: ResolvedPlatformEvent): Promise<void> {
    // 1. Record in observability intelligence (never throws)
    try {
      observabilityIntelligenceService.recordEvent(event)
    } catch { /* non-fatal */ }

    // 2. Compliance evaluation — passive alerts only
    try {
      const complianceResult = await complianceEvaluator.evaluate(event)
      if (!complianceResult.compliant) {
        console.info('[ComplianceGovernanceListener] compliance violation', {
          event_type: event.event_type,
          violations: complianceResult.violations,
          severity:   complianceResult.severity,
        })
        // Future sprint: persist to compliance_evaluations table
      }
    } catch { /* non-fatal */ }

    // 3. Drift detection
    try {
      const drift = driftDetectionService.analyse(event)
      if (drift) {
        console.info('[ComplianceGovernanceListener] drift detected', {
          signal: drift.signal,
          module: drift.affected_module,
        })
        // Future sprint: persist to governance_drift_events table
      }
    } catch { /* non-fatal */ }

    // 4. Risk classification
    try {
      const risk = riskClassifier.classify(event)
      if (risk) {
        riskScoreService.upsertFromClassification(risk)
      }
    } catch { /* non-fatal */ }
  }
}

/** Singleton compliance governance listener. */
export const complianceGovernanceListener = new ComplianceGovernanceListener()
