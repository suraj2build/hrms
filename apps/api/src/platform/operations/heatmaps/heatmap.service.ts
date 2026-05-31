/**
 * HeatmapService — aggregate operational visibility heatmaps.
 * Builds heatmap snapshots from observability clusters + risk scores.
 * READ-ONLY — visualization intelligence only, never mutates data.
 */
import type { HeatmapSnapshot, HeatmapCell, HealthDomain } from '../types/operations-types.js'
import { observabilityIntelligenceService }                 from '../../observability/intelligence/observability-intelligence.service.js'
import { riskScoreService }                                 from '../../risk/scoring/risk-score.service.js'
import type { EventSeverity }                               from '../../events/types/platform-event.js'

export class HeatmapService {
  private readonly snapshots: Map<string, HeatmapSnapshot> = new Map()

  /**
   * Build a risk heatmap for a domain by aggregating risk scores.
   * Groups by entity_id with their risk scores.
   */
  buildDomainHeatmap(domain: HealthDomain, orgId: string): HeatmapSnapshot {
    const period = new Date().toISOString().slice(0, 7)  // YYYY-MM
    const topRisks = riskScoreService.getTopRisks(50)
    const clusters = observabilityIntelligenceService.getClusters(orgId)

    const cells: HeatmapCell[] = topRisks
      .filter(r => {
        if (domain === 'payroll')    return r.type === 'payroll'
        if (domain === 'attendance') return r.type === 'attendance'
        if (domain === 'trust')      return r.type === 'employee'
        if (domain === 'governance') return r.type === 'governance_drift'
        return true
      })
      .map(r => ({
        dimension_id:    r.entity_id,
        dimension_label: `${r.type}:${r.entity_id.slice(0, 8)}`,
        value:           r.score,
        severity:        r.severity as EventSeverity,
        event_count:     r.contributing_classifications.length,
        period,
      }))

    // Fill in from observability clusters if no risk scores
    if (cells.length === 0) {
      const domainPrefix = domain === 'payroll' ? 'payroll.' : domain === 'attendance' ? 'attendance.' : domain + '.'
      const domainClusters = clusters.filter(c => c.event_type.startsWith(domainPrefix))
      for (const cluster of domainClusters.slice(0, 20)) {
        cells.push({
          dimension_id:    cluster.event_type,
          dimension_label: cluster.event_type.replace(/\./g, ' › '),
          value:           Math.min(100, cluster.count * 5),
          severity:        cluster.severity,
          event_count:     cluster.count,
          period,
        })
      }
    }

    const snapshot: HeatmapSnapshot = { domain, period, cells, computed_at: new Date().toISOString() }
    this.snapshots.set(`${orgId}:${domain}`, snapshot)
    return snapshot
  }

  getSnapshot(domain: HealthDomain, orgId: string): HeatmapSnapshot | undefined {
    return this.snapshots.get(`${orgId}:${domain}`)
  }

  getAllSnapshots(orgId: string): HeatmapSnapshot[] {
    const domains: HealthDomain[] = ['payroll', 'attendance', 'governance', 'trust', 'approvals']
    return domains.map(d => this.buildDomainHeatmap(d, orgId))
  }
}

export const heatmapService = new HeatmapService()
