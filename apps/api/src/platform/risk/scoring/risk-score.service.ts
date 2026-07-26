/**
 * RiskScoreService — maintains in-memory risk scores per entity using EMA.
 *
 * Scores update via exponential moving average on new classifications.
 * Sprint 2: Governance Intelligence Layer.
 */

import type { EventSeverity }       from '../../events/types/platform-event.js'
import type { RiskClassification }  from '../classifiers/risk-classifier.js'

export type RiskScoreType = 'employee' | 'branch' | 'payroll' | 'attendance' | 'governance_drift'

export interface RiskScore {
  type:          RiskScoreType
  entity_id:     string
  tenant_id:     string
  score:         number                            // 0–100, higher = riskier
  severity:      EventSeverity
  contributing_classifications: RiskClassification[]
  computed_at:   string
}

export class RiskScoreService {
  // Keyed by tenant_id:entity_type:entity_id (fresh audit finding — this was
  // previously keyed by entity_type:entity_id only, with getTopRisks()
  // returning entries across every tenant with no filter, exposing raw
  // entity UUIDs and risk severity for other tenants via the ops heatmap).
  private readonly scores: Map<string, RiskScore> = new Map()

  /**
   * Upsert risk score for an entity using exponential moving average.
   * New score = existing * 0.7 + new_classification * 0.3
   */
  upsertFromClassification(classification: RiskClassification): void {
    const key      = `${classification.tenant_id}:${classification.entity_type}:${classification.entity_id}`
    const existing = this.scores.get(key)
    const newScore = existing
      ? Math.min(100, (existing.score * 0.7) + (classification.score * 0.3))
      : classification.score

    this.scores.set(key, {
      type:          this.mapEntityTypeToScoreType(classification.entity_type),
      entity_id:     classification.entity_id,
      tenant_id:     classification.tenant_id,
      score:         newScore,
      severity:      this.scoreToSeverity(newScore),
      contributing_classifications: [
        ...(existing?.contributing_classifications ?? []).slice(-4),
        classification,
      ],
      computed_at: new Date().toISOString(),
    })
  }

  /** Get the current risk score for an entity within a tenant. */
  getScore(entityId: string, entityType: string, tenantId: string): RiskScore | undefined {
    return this.scores.get(`${tenantId}:${entityType}:${entityId}`)
  }

  /** Get the top N riskiest entities for a tenant (sorted by score descending). */
  getTopRisks(limit = 10, tenantId?: string): RiskScore[] {
    const all = tenantId
      ? [...this.scores.values()].filter(s => s.tenant_id === tenantId)
      : [...this.scores.values()]
    return all
      .sort((a, b) => b.score - a.score)
      .slice(0, limit)
  }

  private mapEntityTypeToScoreType(entityType: string): RiskScoreType {
    if (entityType === 'employee')    return 'employee'
    if (entityType === 'branch')      return 'branch'
    if (entityType === 'payroll_run') return 'payroll'
    return 'governance_drift'
  }

  private scoreToSeverity(score: number): EventSeverity {
    if (score >= 75) return 'critical'
    if (score >= 50) return 'high'
    if (score >= 25) return 'warning'
    return 'info'
  }
}

/** Singleton risk score service. */
export const riskScoreService = new RiskScoreService()
