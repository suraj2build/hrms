/**
 * FederationService — cross-module operational correlation.
 * Traces impact chains across modules (attendance → payroll → trust → compliance).
 * READ-ONLY. Provides dependency awareness and impact tracing.
 */
import type { SupabaseClient }         from '@supabase/supabase-js'
import type { ResolvedPlatformEvent }  from '../../events/types/platform-event.js'
import { observabilityIntelligenceService } from '../../observability/intelligence/observability-intelligence.service.js'

export interface FederationChain {
  root_entity_id:  string
  root_entity_type: string
  tenant_id:          string
  impact_modules:  string[]
  total_events:    number
  severity_peak:   string
  chain_events:    ResolvedPlatformEvent[]
  computed_at:     string
}

export interface ModuleDependency {
  from_module:     string
  to_module:       string
  dependency_type: 'triggers' | 'impacts' | 'correlates_with'
  strength:        number    // 0.0–1.0
  description:     string
}

// Static module dependency map (enterprise HRMS cross-module relationships)
const MODULE_DEPENDENCIES: ModuleDependency[] = [
  { from_module: 'attendance',   to_module: 'payroll',    dependency_type: 'impacts',         strength: 0.9,  description: 'Attendance data drives payroll calculation' },
  { from_module: 'attendance',   to_module: 'leave',      dependency_type: 'correlates_with', strength: 0.7,  description: 'Attendance corrections affect leave balances' },
  { from_module: 'payroll',      to_module: 'compliance', dependency_type: 'triggers',        strength: 0.8,  description: 'Payroll runs trigger statutory compliance checks' },
  { from_module: 'compensation', to_module: 'payroll',    dependency_type: 'impacts',         strength: 0.95, description: 'Compensation revisions directly affect payroll' },
  { from_module: 'compliance',   to_module: 'governance', dependency_type: 'triggers',        strength: 0.85, description: 'Compliance violations escalate to governance' },
  { from_module: 'trust',        to_module: 'compliance', dependency_type: 'correlates_with', strength: 0.6,  description: 'Trust deterioration correlates with compliance risk' },
  { from_module: 'leave',        to_module: 'attendance', dependency_type: 'impacts',         strength: 0.8,  description: 'Leave approvals affect attendance processing' },
  { from_module: 'governance',   to_module: 'operations', dependency_type: 'triggers',        strength: 0.7,  description: 'Governance alerts trigger operational reviews' },
]

export class FederationService {
  /** Get the module dependency map. */
  getModuleDependencies(): ModuleDependency[] {
    return MODULE_DEPENDENCIES
  }

  /** Get downstream dependencies for a given module. */
  getDownstreamModules(module: string): ModuleDependency[] {
    return MODULE_DEPENDENCIES.filter(d => d.from_module === module)
  }

  /** Get upstream dependencies for a given module. */
  getUpstreamModules(module: string): ModuleDependency[] {
    return MODULE_DEPENDENCIES.filter(d => d.to_module === module)
  }

  /**
   * Build a federation chain for an entity — traces cross-module event impact.
   * Uses observability cluster data. Never queries raw operational tables.
   */
  buildFederationChain(_supabase: SupabaseClient, entityId: string, entityType: string, orgId: string): FederationChain {
    const clusters = observabilityIntelligenceService.getClusters(orgId)
    const relevantClusters = clusters.filter(c => c.entity_ids.includes(entityId))
    const modules = [...new Set(relevantClusters.map(c => c.event_type.split('.')[0]))]
    const severityRank = { info: 0, warning: 1, high: 2, critical: 3 } as const
    const severityPeak = relevantClusters.reduce((worst, c) => {
      return (severityRank[c.severity as keyof typeof severityRank] ?? 0) > (severityRank[worst as keyof typeof severityRank] ?? 0) ? c.severity : worst
    }, 'info' as string)

    return {
      root_entity_id:   entityId,
      root_entity_type: entityType,
      tenant_id:           orgId,
      impact_modules:   modules,
      total_events:     relevantClusters.reduce((s, c) => s + c.count, 0),
      severity_peak:    severityPeak,
      chain_events:     [],   // populated by EventStreamService in routes
      computed_at:      new Date().toISOString(),
    }
  }
}

export const federationService = new FederationService()
