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
    // Per-type counts must scan every tracked entity for the tenant, not just
    // the global top-20 slice used for `top_risks` — filtering that slice
    // silently undercounts a type whose entities happen to rank outside the
    // top 20 overall (e.g. many at-risk employees but a few higher-scoring
    // branches).
    const counts = riskScoreService.countByType(orgId)
    return {
      employee_count:   counts.employee,
      branch_count:     counts.branch,
      payroll_count:    counts.payroll,
      attendance_count: counts.attendance,
      top_risks:        riskScoreService.getTopRisks(20, orgId),
    }
  }
}

/** Singleton risk aggregator. */
export const riskAggregator = new RiskAggregator()
