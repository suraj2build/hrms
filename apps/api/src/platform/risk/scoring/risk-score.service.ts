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
  score:         number                            // 0–100, higher = riskier
  severity:      EventSeverity
  contributing_classifications: RiskClassification[]
  computed_at:   string
}

export class RiskScoreService {
  private readonly scores: Map<string, RiskScore> = new Map()

  /**
   * Upsert risk score for an entity using exponential moving average.
   * New score = existing * 0.7 + new_classification * 0.3
   */
  upsertFromClassification(classification: RiskClassification): void {
    const key      = `${classification.entity_type}:${classification.entity_id}`
    const existing = this.scores.get(key)
    const newScore = existing
      ? Math.min(100, (existing.score * 0.7) + (classification.score * 0.3))
      : classification.score

    this.scores.set(key, {
      type:          this.mapEntityTypeToScoreType(classification.entity_type),
      entity_id:     classification.entity_id,
      score:         newScore,
      severity:      this.scoreToSeverity(newScore),
      contributing_classifications: [
        ...(existing?.contributing_classifications ?? []).slice(-4),
        classification,
      ],
      computed_at: new Date().toISOString(),
    })
  }

  /** Get the current risk score for an entity. */
  getScore(entityId: string, entityType: string): RiskScore | undefined {
    return this.scores.get(`${entityType}:${entityId}`)
  }

  /** Get the top N riskiest entities (sorted by score descending). */
  getTopRisks(limit = 10): RiskScore[] {
    return [...this.scores.values()]
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
