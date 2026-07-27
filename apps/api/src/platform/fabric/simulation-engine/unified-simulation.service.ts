/**
 * UnifiedSimulationEngine — cross-module simulation orchestration.
 * Composes Sprint 4 SimulationService with additional policy/governance types.
 * ANALYTICAL ONLY — never mutates production data.
 */
import type { SimulationRun }       from '../../operations/types/operations-types.js'
import { simulationService }        from '../../operations/simulation/simulation.service.js'
import { explainabilityService }    from '../../ai/services/explainability.service.js'

export type UnifiedSimulationType =
  | 'payroll_impact'
  | 'compliance_threshold'
  | 'workforce_overtime'
  | 'policy_change'
  | 'leave_policy_revision'
  | 'governance_drift_projection'
  | 'trust_degradation_projection'

export interface PolicyChangeSimulationParams {
  tenant_id:           string
  policy_name:      string
  change_type:      'stricter' | 'relaxed' | 'new'
  affected_modules: string[]
  affected_count:   number
  estimated_admin_hours: number
  created_by?:      string
}

export interface GovernanceDriftProjectionParams {
  tenant_id:             string
  current_drift_rate: number    // 0–100 current drift score
  trend_direction:    'improving' | 'stable' | 'deteriorating'
  weeks_ahead:        number
  created_by?:        string
}

export class UnifiedSimulationService {
  /** Delegate payroll simulation to existing SimulationService */
  simulatePayroll = simulationService.simulatePayrollImpact.bind(simulationService)
  simulateCompliance = simulationService.simulateComplianceThreshold.bind(simulationService)
  simulateOvertime = simulationService.simulateOvertimeGrowth.bind(simulationService)

  /** Policy change simulation */
  simulatePolicyChange(params: PolicyChangeSimulationParams): SimulationRun {
    const adminImpact = params.affected_count * params.estimated_admin_hours
    const risk = adminImpact > 1000 ? 'high' as const : adminImpact > 200 ? 'warning' as const : 'info' as const

    return {
      tenant_id:          params.tenant_id,
      simulation_type: 'policy_change',
      label:           `Policy change: ${params.policy_name} (${params.change_type})`,
      input_params:    params as unknown as Record<string, unknown>,
      result_summary: {
        affected_count:   params.affected_count,
        estimated_impact: adminImpact,
        impact_unit:      'admin_hours',
        risk_level:       risk,
        key_findings: [
          `Policy: ${params.policy_name} — ${params.change_type}`,
          `${params.affected_count} employees impacted`,
          `Affected modules: ${params.affected_modules.join(', ')}`,
          `Estimated admin overhead: ${adminImpact.toFixed(0)} hours`,
        ],
        explainability: explainabilityService.explain({
          event_type:  'simulation.policy_change',
          entity_type: 'org',
          entity_id:   params.tenant_id,
          payload:     { policy: params.policy_name, change_type: params.change_type },
          severity:    risk,
        }),
      },
      created_at:  new Date().toISOString(),
      created_by:  params.created_by,
    }
  }

  /** Governance drift projection simulation */
  simulateGovernanceDrift(params: GovernanceDriftProjectionParams): SimulationRun {
    const trendFactor = params.trend_direction === 'deteriorating' ? 1.15 : params.trend_direction === 'stable' ? 1.0 : 0.9
    const projectedDrift = Math.min(100, params.current_drift_rate * Math.pow(trendFactor, params.weeks_ahead / 4))
    const risk = projectedDrift > 70 ? 'critical' as const : projectedDrift > 50 ? 'high' as const : projectedDrift > 30 ? 'warning' as const : 'info' as const

    return {
      tenant_id:          params.tenant_id,
      simulation_type: 'governance_drift_projection',
      label:           `Governance drift projection: ${params.weeks_ahead} weeks (${params.trend_direction})`,
      input_params:    params as unknown as Record<string, unknown>,
      result_summary: {
        affected_count:   1,
        estimated_impact: projectedDrift,
        impact_unit:      'drift_score',
        risk_level:       risk,
        key_findings: [
          `Current drift score: ${params.current_drift_rate.toFixed(1)}/100`,
          `Trend: ${params.trend_direction}`,
          `Projected drift in ${params.weeks_ahead} weeks: ${projectedDrift.toFixed(1)}/100`,
          `Risk level: ${risk}`,
        ],
        explainability: explainabilityService.explain({
          event_type:  'simulation.governance_drift',
          entity_type: 'org',
          entity_id:   params.tenant_id,
          payload:     { current: params.current_drift_rate, projected: projectedDrift, weeks: params.weeks_ahead },
          severity:    risk,
        }),
      },
      created_at: new Date().toISOString(),
      created_by: params.created_by,
    }
  }
}

export const unifiedSimulationService = new UnifiedSimulationService()
