/**
 * HealthSignalService — enterprise-wide operational health scoring.
 * Aggregates signals from observability, risk, governance, and trust.
 * READ-ONLY computation — never mutates operational data.
 */
import type { DomainHealthSignal, HealthDomain } from '../types/operations-types.js'
import { riskScoreService }                      from '../../risk/scoring/risk-score.service.js'
import { observabilityIntelligenceService }      from '../../observability/intelligence/observability-intelligence.service.js'
import { explainabilityService }                 from '../../ai/services/explainability.service.js'

export class HealthSignalService {
  private readonly signals: Map<string, DomainHealthSignal> = new Map()

  /** Compute health for a specific domain based on available signals. */
  computeDomainHealth(domain: HealthDomain, orgId: string): DomainHealthSignal {
    const factors: string[] = []
    let score = 100

    // Pull from observability clusters for this org
    const clusters = observabilityIntelligenceService.getClusters(orgId)
    const domainClusters = clusters.filter(c => this.clusterBelongsToDomain(c.event_type, domain))

    for (const cluster of domainClusters) {
      if (cluster.severity === 'critical') { score -= 20; factors.push(`Critical events: ${cluster.event_type} (${cluster.count})`) }
      else if (cluster.severity === 'high') { score -= 10; factors.push(`High severity: ${cluster.event_type} (${cluster.count})`) }
      else if (cluster.severity === 'warning' && cluster.count > 10) { score -= 5; factors.push(`Elevated: ${cluster.event_type} (${cluster.count})`) }
    }

    // Pull risk scores for domain-relevant entity types
    const topRisks = riskScoreService.getTopRisks(20, orgId)
    const domainRisks = topRisks.filter(r => this.riskBelongsToDomain(r.type, domain))
    const criticalRisks = domainRisks.filter(r => r.severity === 'critical').length
    const highRisks     = domainRisks.filter(r => r.severity === 'high').length

    if (criticalRisks > 0) { score -= criticalRisks * 15; factors.push(`${criticalRisks} critical risk entities`) }
    if (highRisks > 0)     { score -= highRisks * 8;       factors.push(`${highRisks} high risk entities`) }

    score = Math.max(0, score)
    const severity: DomainHealthSignal['severity'] = score >= 75 ? 'healthy' : score >= 50 ? 'warning' : 'critical'

    const signal: DomainHealthSignal = {
      domain,
      score,
      severity,
      factors,
      computed_at: new Date().toISOString(),
      explainability: explainabilityService.explain({
        event_type:  `health.${domain}`,
        entity_type: 'org',
        entity_id:   orgId,
        payload:     { score, severity, factor_count: factors.length },
        severity:    severity === 'healthy' ? 'info' : severity === 'warning' ? 'warning' : 'critical',
      }),
    }

    this.signals.set(`${orgId}:${domain}`, signal)
    return signal
  }

  /** Get all domain health signals for an org. */
  getAllDomainHealth(orgId: string): DomainHealthSignal[] {
    const domains: HealthDomain[] = ['payroll', 'attendance', 'governance', 'trust', 'approvals', 'system']
    return domains.map(d => this.computeDomainHealth(d, orgId))
  }

  /** Cached signal lookup. */
  getCached(domain: HealthDomain, orgId: string): DomainHealthSignal | undefined {
    return this.signals.get(`${orgId}:${domain}`)
  }

  private clusterBelongsToDomain(eventType: string, domain: HealthDomain): boolean {
    const maps: Record<HealthDomain, string[]> = {
      payroll:     ['payroll.', 'compensation.'],
      attendance:  ['attendance.'],
      governance:  ['governance.', 'compliance.'],
      trust:       ['employee.trust.', 'duplicate.', 'verification.'],
      approvals:   ['leave.', 'regularisation.'],
      system:      ['incident.', 'regulatory.'],
    }
    return (maps[domain] ?? []).some(prefix => eventType.startsWith(prefix))
  }

  private riskBelongsToDomain(riskType: string, domain: HealthDomain): boolean {
    if (domain === 'payroll')    return riskType === 'payroll'
    if (domain === 'attendance') return riskType === 'attendance'
    if (domain === 'governance') return riskType === 'governance_drift'
    if (domain === 'trust')      return riskType === 'employee'
    return false
  }
}

export const healthSignalService = new HealthSignalService()
