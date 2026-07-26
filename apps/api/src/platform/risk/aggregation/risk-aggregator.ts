/**
 * RiskAggregator — provides org-level risk visibility by aggregating entity scores.
 *
 * Read-only view over the risk score service.
 * Sprint 2: Governance Intelligence Layer.
 */

import type { RiskScore } from '../scoring/risk-score.service.js'
import { riskScoreService } from '../scoring/risk-score.service.js'

export interface RiskSummary {
  employee_count:   number
  branch_count:     number
  payroll_count:    number
  attendance_count: number
  top_risks:        RiskScore[]
}

export class RiskAggregator {
  /** Summarize risk signals across all entity types for an org. */
  summarize(orgId: string): RiskSummary {
    const topRisks = riskScoreService.getTopRisks(20, orgId)
    return {
      employee_count:   topRisks.filter(r => r.type === 'employee').length,
      branch_count:     topRisks.filter(r => r.type === 'branch').length,
      payroll_count:    topRisks.filter(r => r.type === 'payroll').length,
      attendance_count: topRisks.filter(r => r.type === 'attendance').length,
      top_risks:        topRisks,
    }
  }
}

/** Singleton risk aggregator. */
export const riskAggregator = new RiskAggregator()
