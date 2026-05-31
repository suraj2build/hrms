/**
 * ObservabilityIntelligenceService — READ-ONLY enrichment over event clusters.
 *
 * Tracks event frequency clusters and operational health signals.
 * Never mutates operational data. Updated by the governance pipeline.
 * Sprint 2: Governance Intelligence Layer.
 */

import type { ResolvedPlatformEvent } from '../../events/types/platform-event.js'
import type { EventSeverity }         from '../../events/types/platform-event.js'

export interface GovernanceEventCluster {
  event_type:  string
  count:       number
  severity:    EventSeverity
  latest_at:   string
  entity_ids:  string[]
}

export interface OperationalHealthSignal {
  module:       string
  health_score: number                              // 0–100
  signal:       'healthy' | 'degraded' | 'critical'
  event_counts: Record<string, number>
  risk_summary: { high_risk: number; medium_risk: number; low_risk: number }
  computed_at:  string
}

export class ObservabilityIntelligenceService {
  /** Event clusters keyed by `org_id:event_type`. */
  private clusters: Map<string, GovernanceEventCluster> = new Map()
  private healthSignals: Map<string, OperationalHealthSignal> = new Map()

  /** Record an incoming platform event into the cluster index. */
  recordEvent(event: ResolvedPlatformEvent): void {
    const key      = `${event.org_id}:${event.event_type}`
    const existing = this.clusters.get(key)
    if (existing) {
      existing.count++
      existing.latest_at = event.timestamp
      if (!existing.entity_ids.includes(event.entity_id)) {
        existing.entity_ids = [...existing.entity_ids.slice(-99), event.entity_id]
      }
    } else {
      this.clusters.set(key, {
        event_type:  event.event_type,
        count:       1,
        severity:    event.severity ?? 'info',
        latest_at:   event.timestamp,
        entity_ids:  [event.entity_id],
      })
    }
  }

  /** Get all clusters for a specific org, sorted by frequency descending. */
  getClusters(orgId: string): GovernanceEventCluster[] {
    return [...this.clusters.entries()]
      .filter(([key]) => key.startsWith(`${orgId}:`))
      .map(([, v]) => v)
      .sort((a, b) => b.count - a.count)
  }

  /** Update or replace a module's health signal. */
  updateHealthSignal(module: string, signal: OperationalHealthSignal): void {
    this.healthSignals.set(module, signal)
  }

  /** Get all health signals. */
  getHealthSignals(): OperationalHealthSignal[] {
    return [...this.healthSignals.values()]
  }
}

/** Singleton observability intelligence service. */
export const observabilityIntelligenceService = new ObservabilityIntelligenceService()
