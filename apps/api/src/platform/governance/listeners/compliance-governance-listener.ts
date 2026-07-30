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

  // supabase is not injected in listeners by default — set at startup from
  // apps/api/src/index.ts, same pattern as OperationalIntelligenceListener /
  // FabricOrchestrationListener. Without it, violations/drift are still
  // detected and logged but not persisted (best-effort — never blocks or
  // throws on registration).
  private supabase: import('@supabase/supabase-js').SupabaseClient | null = null

  setSupabase(supabase: import('@supabase/supabase-js').SupabaseClient): void {
    this.supabase = supabase
  }

  async evaluate(event: ResolvedPlatformEvent): Promise<void> {
    // 1. Record in observability intelligence (never throws)
    try {
      observabilityIntelligenceService.recordEvent(event)
    } catch { /* non-fatal */ }

    // 2. Compliance evaluation — passive alerts only
    try {
      const complianceResult = await complianceEvaluator.evaluate(event, this.supabase ?? undefined)
      if (!complianceResult.compliant) {
        console.info('[ComplianceGovernanceListener] compliance violation', {
          event_type: event.event_type,
          violations: complianceResult.violations,
          severity:   complianceResult.severity,
        })
        if (this.supabase) {
          const { error } = await this.supabase.from('compliance_evaluations').insert({
            tenant_id:   event.tenant_id,
            event_id:    event.event_id,
            entity_type: event.entity_type,
            entity_id:   event.entity_id,
            compliant:   false,
            severity:    complianceResult.severity,
            violations:  complianceResult.violations,
            explainability: complianceResult.explainability ?? null,
          })
          if (error) console.warn('[ComplianceGovernanceListener] compliance_evaluations insert failed', error.message)
        }
      }
    } catch (err) {
      console.warn('[ComplianceGovernanceListener] compliance evaluation step failed', err)
    }

    // 3. Drift detection
    try {
      const drift = driftDetectionService.analyse(event)
      if (drift) {
        console.info('[ComplianceGovernanceListener] drift detected', {
          signal: drift.signal,
          module: drift.affected_module,
        })
        if (this.supabase) {
          const { error } = await this.supabase.from('governance_drift_events').insert({
            tenant_id:       event.tenant_id,
            signal:          drift.signal,
            severity:        drift.severity,
            affected_module: drift.affected_module,
            description:     drift.description,
            entity_id:       drift.entity_id ?? null,
            entity_type:     drift.entity_id ? event.entity_type : null,
            explainability:  drift.explainability ?? null,
            source_event_id: event.event_id,
          })
          if (error) console.warn('[ComplianceGovernanceListener] governance_drift_events insert failed', error.message)
        }
      }
    } catch (err) {
      console.warn('[ComplianceGovernanceListener] drift detection step failed', err)
    }

    // 4. Risk classification
    try {
      const risk = riskClassifier.classify(event)
      if (risk) {
        riskScoreService.upsertFromClassification(risk)
      }
    } catch (err) {
      console.warn('[ComplianceGovernanceListener] risk classification step failed', err)
    }
  }
}

/** Singleton compliance governance listener. */
export const complianceGovernanceListener = new ComplianceGovernanceListener()
