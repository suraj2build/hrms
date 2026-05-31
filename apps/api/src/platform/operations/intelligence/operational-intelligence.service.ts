/**
 * OperationalIntelligenceService — top-level operations intelligence aggregator.
 * Combines health signals, heatmaps, SLA status, and security events.
 * READ-ONLY facade over all Sprint 4 operations services.
 */
import { healthSignalService }          from '../health/health-signal.service.js'
import { heatmapService }               from '../heatmaps/heatmap.service.js'
import { slaService }                   from '../sla/sla.service.js'
import { securityIntelligenceService }  from '../security-intelligence/security-intelligence.service.js'
import type { HealthDomain }            from '../types/operations-types.js'

export class OperationalIntelligenceService {
  getOperationalSummary(orgId: string) {
    const healthSignals = healthSignalService.getAllDomainHealth(orgId)
    const slaBreaches   = slaService.getBreaches(orgId)
    const secEvents     = securityIntelligenceService.getEvents(orgId, 20)
    const overallScore  = healthSignals.reduce((s, h) => s + h.score, 0) / Math.max(healthSignals.length, 1)

    return {
      overall_health:   Math.round(overallScore),
      domains:          healthSignals,
      sla_breaches:     slaBreaches.length,
      security_signals: secEvents.length,
      computed_at:      new Date().toISOString(),
    }
  }

  getDomainHeatmap(domain: HealthDomain, orgId: string) {
    return heatmapService.buildDomainHeatmap(domain, orgId)
  }

  getAllHeatmaps(orgId: string) {
    return heatmapService.getAllSnapshots(orgId)
  }
}

export const operationalIntelligenceService = new OperationalIntelligenceService()
