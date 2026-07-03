/**
 * FabricControlPlaneService — unified orchestration visibility layer.
 * Aggregates fabric health, active orchestrations, recent decisions, replay sessions.
 * READ-ONLY observability facade.
 */
import type { SupabaseClient }           from '@supabase/supabase-js'
import type { FabricHealthSnapshot }     from '../types/fabric-types.js'
import { healthSignalService }           from '../../operations/health/health-signal.service.js'
import { slaService }                    from '../../operations/sla/sla.service.js'
import { explainabilityService }         from '../../ai/services/explainability.service.js'

export class FabricControlPlaneService {
  /**
   * Compute an enterprise fabric health snapshot.
   */
  async computeFabricHealth(supabase: SupabaseClient, orgId: string): Promise<FabricHealthSnapshot> {
    const domains = healthSignalService.getAllDomainHealth(orgId)
    const byDomain = Object.fromEntries(domains.map(d => [d.domain, d.score]))

    const govHealth   = byDomain['governance']   ?? 80
    const trustHealth = byDomain['trust']        ?? 80
    const opHealth    = byDomain['attendance']   ?? 80   // operational proxy
    const secHealth   = byDomain['system']       ?? 80

    const overall = Math.round((govHealth + trustHealth + opHealth + secHealth) / 4)

    // SLA pending count
    const pendingSlas = slaService.getTracked(orgId).filter(s => !s.breached).length

    // Open incidents
    const { count: openIncidents } = await supabase
      .from('operational_incidents')
      .select('id', { count: 'exact', head: true })
      .eq('tenant_id', orgId)
      .eq('status', 'open')

    // Active orchestrations
    const { count: activeOrchestrations } = await supabase
      .from('orchestration_activity_logs')
      .select('activity_id', { count: 'exact', head: true })
      .eq('tenant_id', orgId)
      .eq('status', 'active')

    return {
      tenant_id:                orgId,
      overall_score:         overall,
      governance_health:     govHealth,
      trust_health:          trustHealth,
      operational_health:    opHealth,
      security_health:       secHealth,
      active_orchestrations: activeOrchestrations ?? 0,
      pending_slas:          pendingSlas,
      open_incidents:        openIncidents ?? 0,
      computed_at:           new Date().toISOString(),
      explainability:        explainabilityService.explain({
        event_type:  'fabric.health',
        entity_type: 'org',
        entity_id:   orgId,
        payload:     { overall, governance: govHealth, trust: trustHealth, ops: opHealth, security: secHealth },
        severity:    overall >= 75 ? 'info' : overall >= 50 ? 'warning' : 'critical',
      }),
    }
  }
}

export const fabricControlPlaneService = new FabricControlPlaneService()
