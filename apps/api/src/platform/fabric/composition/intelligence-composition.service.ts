/**
 * IntelligenceCompositionService — composes outputs from all platform intelligence
 * layers into a unified per-entity risk picture.
 * READ-ONLY. Never mutates operational data.
 */
import type { IntelligenceComposition }   from '../types/fabric-types.js'
import type { EventSeverity }             from '../../events/types/platform-event.js'
import { riskScoreService }               from '../../risk/scoring/risk-score.service.js'
import { healthSignalService }            from '../../operations/health/health-signal.service.js'
import { explainabilityService }          from '../../ai/services/explainability.service.js'

export class IntelligenceCompositionService {
  /**
   * Compose a unified intelligence picture for an entity.
   * Weights: governance 25%, trust 25%, operational 30%, security 20%.
   */
  compose(params: {
    entity_id:         string
    entity_type:       string
    tenant_id:            string
    governance_score?: number   // 0–100 (pass 100 if no violations)
    trust_score?:      number   // 0–100 from TrustScoreService
    // operational health derived from HealthSignalService
    // security risk derived from RiskScoreService + SecurityIntelligenceService
  }): IntelligenceComposition {
    const { entity_id, entity_type, tenant_id } = params

    // Governance score (passed in or default 80 = no violations observed)
    const govScore   = params.governance_score ?? 80

    // Trust score (passed in or default 100 = not evaluated)
    const trustScore = params.trust_score ?? 100

    // Operational health — average across domains for this org
    const healthSignals = healthSignalService.getAllDomainHealth(tenant_id)
    const opHealth = healthSignals.length > 0
      ? healthSignals.reduce((s, h) => s + h.score, 0) / healthSignals.length
      : 80

    // Security risk — from risk score service (inverted: risk → health)
    const riskScore  = riskScoreService.getScore(entity_id, entity_type, tenant_id)
    const secRisk    = riskScore ? riskScore.score : 0    // 0–100, higher = riskier

    // Composite risk: invert health scores to risk
    const govRisk    = 100 - govScore
    const trustRisk  = 100 - trustScore
    const opRisk     = 100 - opHealth

    const compositeRisk = Math.round(
      govRisk * 0.25 + trustRisk * 0.25 + opRisk * 0.30 + secRisk * 0.20
    )

    const factors: string[] = []
    if (govRisk > 30)    factors.push(`Governance risk: ${govRisk.toFixed(0)}/100`)
    if (trustRisk > 30)  factors.push(`Trust risk: ${trustRisk.toFixed(0)}/100`)
    if (opRisk > 30)     factors.push(`Operational risk: ${opRisk.toFixed(0)}/100`)
    if (secRisk > 30)    factors.push(`Security risk: ${secRisk.toFixed(0)}/100`)

    const severity: EventSeverity = compositeRisk >= 75 ? 'critical'
                                  : compositeRisk >= 50 ? 'high'
                                  : compositeRisk >= 25 ? 'warning'
                                  : 'info'

    return {
      entity_id,
      entity_type,
      tenant_id,
      governance_score:   govScore,
      trust_score:        trustScore,
      operational_health: opHealth,
      security_risk:      secRisk,
      composite_risk:     compositeRisk,
      severity,
      factors,
      computed_at:        new Date().toISOString(),
      explainability:     explainabilityService.explain({
        event_type:  'fabric.composition',
        entity_type,
        entity_id,
        payload:     { composite_risk: compositeRisk, factors },
        severity,
      }),
    }
  }

  /** Compose summaries for a batch of entity IDs. */
  composeBatch(orgId: string, entities: Array<{ entity_id: string; entity_type: string; governance_score?: number; trust_score?: number }>): IntelligenceComposition[] {
    return entities.map(e => this.compose({ ...e, tenant_id: orgId }))
  }
}

export const intelligenceCompositionService = new IntelligenceCompositionService()
