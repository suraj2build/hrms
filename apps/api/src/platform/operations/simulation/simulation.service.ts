/**
 * SimulationService — analytical impact simulation.
 * All simulations are read-only analytical projections.
 * NEVER applies changes to operational data.
 */
import type { SimulationRun, SimulationResultSummary } from '../types/operations-types.js'
import { explainabilityService }                        from '../../ai/services/explainability.service.js'

export class SimulationService {
  /**
   * Simulate the payroll impact of a compensation change.
   * Returns estimated total impact in INR.
   * ANALYTICAL ONLY — does not touch payroll_runs or compensation tables.
   */
  simulatePayrollImpact(params: {
    tenant_id:             string
    affected_count:     number
    avg_ctc_increase:   number    // INR per employee per month
    months_in_period:   number
    created_by?:        string
  }): SimulationRun {
    const totalImpact = params.affected_count * params.avg_ctc_increase * params.months_in_period
    const riskLevel = totalImpact > 10_000_000 ? 'critical' as const
                    : totalImpact > 1_000_000  ? 'high' as const
                    : totalImpact > 100_000    ? 'warning' as const
                    : 'info' as const

    const result: SimulationResultSummary = {
      affected_count:   params.affected_count,
      estimated_impact: totalImpact,
      impact_unit:      'INR',
      risk_level:       riskLevel,
      key_findings: [
        `${params.affected_count} employees affected`,
        `Estimated additional payroll cost: ₹${(totalImpact / 100).toFixed(0)} per month`,
        `Annual payroll impact: ₹${(totalImpact * 12 / 100).toFixed(0)}`,
      ],
      explainability: explainabilityService.explain({
        event_type:  'simulation.payroll_impact',
        entity_type: 'org',
        entity_id:   params.tenant_id,
        payload:     { total_impact: totalImpact, affected_count: params.affected_count },
        severity:    riskLevel,
      }),
    }

    return {
      tenant_id:           params.tenant_id,
      simulation_type:  'payroll_impact',
      label:            `Payroll impact: ${params.affected_count} employees, ₹${params.avg_ctc_increase}/month avg`,
      input_params:     params as unknown as Record<string, unknown>,
      result_summary:   result,
      created_at:       new Date().toISOString(),
      created_by:       params.created_by,
    }
  }

  /**
   * Simulate compliance threshold change impact.
   */
  simulateComplianceThreshold(params: {
    tenant_id:           string
    threshold_type:   string    // 'pf_ceiling' | 'esi_ceiling' | etc.
    old_threshold:    number
    new_threshold:    number
    affected_count:   number
    created_by?:      string
  }): SimulationRun {
    const changePct = ((params.new_threshold - params.old_threshold) / params.old_threshold) * 100
    const riskLevel = Math.abs(changePct) > 20 ? 'high' as const : Math.abs(changePct) > 10 ? 'warning' as const : 'info' as const

    const result: SimulationResultSummary = {
      affected_count:   params.affected_count,
      estimated_impact: Math.abs(changePct),
      impact_unit:      '%',
      risk_level:       riskLevel,
      key_findings: [
        `Threshold change: ${params.old_threshold} → ${params.new_threshold} (${changePct > 0 ? '+' : ''}${changePct.toFixed(1)}%)`,
        `${params.affected_count} employees affected`,
        `Statutory compliance impact: ${riskLevel}`,
      ],
      explainability: explainabilityService.explain({
        event_type:  'simulation.compliance_threshold',
        entity_type: 'org',
        entity_id:   params.tenant_id,
        payload:     { change_pct: changePct, affected_count: params.affected_count },
        severity:    riskLevel,
      }),
    }

    return {
      tenant_id:          params.tenant_id,
      simulation_type: 'compliance_threshold',
      label:           `${params.threshold_type} threshold change: ${params.old_threshold} → ${params.new_threshold}`,
      input_params:    params as unknown as Record<string, unknown>,
      result_summary:  result,
      created_at:      new Date().toISOString(),
      created_by:      params.created_by,
    }
  }

  /**
   * Simulate workforce overtime growth impact.
   */
  simulateOvertimeGrowth(params: {
    tenant_id:               string
    affected_count:       number
    avg_ot_hours_per_week: number
    ot_rate_per_hour:     number
    weeks:                number
    created_by?:          string
  }): SimulationRun {
    const totalCost = params.affected_count * params.avg_ot_hours_per_week * params.ot_rate_per_hour * params.weeks
    const riskLevel = params.avg_ot_hours_per_week > 20 ? 'critical' as const
                    : params.avg_ot_hours_per_week > 10 ? 'high' as const
                    : 'warning' as const

    const result: SimulationResultSummary = {
      affected_count:   params.affected_count,
      estimated_impact: totalCost,
      impact_unit:      'INR',
      risk_level:       riskLevel,
      key_findings: [
        `${params.affected_count} employees averaging ${params.avg_ot_hours_per_week}h OT/week`,
        `Estimated OT cost over ${params.weeks} weeks: ₹${totalCost.toLocaleString('en-IN')}`,
        `Risk: ${riskLevel} — ${params.avg_ot_hours_per_week > 20 ? 'exceeds statutory OT limits' : 'within monitoring range'}`,
      ],
      explainability: explainabilityService.explain({
        event_type:  'simulation.workforce_overtime',
        entity_type: 'org',
        entity_id:   params.tenant_id,
        payload:     { avg_ot_hours: params.avg_ot_hours_per_week, total_cost: totalCost },
        severity:    riskLevel,
      }),
    }

    return {
      tenant_id:          params.tenant_id,
      simulation_type: 'workforce_overtime',
      label:           `Overtime simulation: ${params.affected_count} employees, ${params.avg_ot_hours_per_week}h/week`,
      input_params:    params as unknown as Record<string, unknown>,
      result_summary:  result,
      created_at:      new Date().toISOString(),
      created_by:      params.created_by,
    }
  }
}

export const simulationService = new SimulationService()
