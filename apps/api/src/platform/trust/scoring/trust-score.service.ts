/**
 * TrustScoreService — explainable workforce trust scoring.
 * Aggregates verification results, duplicate detections, and risk signals.
 * PASSIVE — assistive indicator only, never an operational blocker.
 */
import type { TrustScoreResult, TrustScoreType, VerificationResult, DuplicateDetectionResult } from '../types/trust-types.js'
import { explainabilityService } from '../../ai/services/explainability.service.js'

export class TrustScoreService {
  /**
   * Compute an employee trust score from verification and duplicate signals.
   * Score: 0–100 (higher = more trustworthy).
   */
  computeEmployeeTrustScore(params: {
    employee_id:  string
    org_id:       string
    verifications: VerificationResult[]
    duplicates:    DuplicateDetectionResult[]
    risk_flags?:   string[]
  }): TrustScoreResult {
    let score = 100
    const factors: string[] = []

    // Deductions for verification failures
    for (const v of params.verifications) {
      if (v.status === 'failed') {
        score -= 20
        factors.push(`${v.verification_type} verification failed: ${v.flags.join(', ')}`)
      } else if (v.status === 'inconclusive') {
        score -= 10
        factors.push(`${v.verification_type} verification inconclusive`)
      } else if (v.flags.length > 0) {
        score -= 5
        factors.push(`${v.verification_type} flags: ${v.flags.join(', ')}`)
      }
    }

    // Deductions for duplicate detections
    for (const d of params.duplicates) {
      const deduction = d.severity === 'critical' ? 35 : d.severity === 'high' ? 25 : 15
      score -= deduction
      factors.push(`Duplicate ${d.duplicate_type} across ${d.matching_entity_ids.length + 1} employees`)
    }

    // Deductions for external risk flags
    for (const flag of (params.risk_flags ?? [])) {
      score -= 10
      factors.push(`Risk flag: ${flag}`)
    }

    score = Math.max(0, score)
    const severity = score >= 80 ? 'low' : score >= 60 ? 'medium' : score >= 40 ? 'high' : 'critical'

    return {
      score_type:    'employee',
      entity_id:     params.employee_id,
      org_id:        params.org_id,
      score,
      severity,
      factors,
      computed_at:   new Date().toISOString(),
      explainability: explainabilityService.explain({
        event_type:  'trust.score.computed',
        entity_type: 'employee',
        entity_id:   params.employee_id,
        payload:     { score, severity, factor_count: factors.length },
        severity:    severity === 'low' ? 'info' : severity === 'medium' ? 'warning' : severity as any,
      }),
    }
  }

  /**
   * Compute onboarding trust score — used during employee onboarding.
   */
  computeOnboardingTrustScore(params: {
    employee_id:   string
    org_id:        string
    has_pan:       boolean
    has_bank:      boolean
    has_identity:  boolean
    pan_valid?:    boolean
    bank_valid?:   boolean
    duplicates:    DuplicateDetectionResult[]
  }): TrustScoreResult {
    let score = 100
    const factors: string[] = []

    if (!params.has_pan) { score -= 20; factors.push('PAN not provided') }
    else if (params.pan_valid === false) { score -= 15; factors.push('PAN validation failed') }

    if (!params.has_bank) { score -= 20; factors.push('Bank details not provided') }
    else if (params.bank_valid === false) { score -= 15; factors.push('Bank validation failed') }

    if (!params.has_identity) { score -= 10; factors.push('Identity documents not uploaded') }

    for (const d of params.duplicates) {
      const deduction = d.severity === 'high' ? 25 : 15
      score -= deduction
      factors.push(`Duplicate ${d.duplicate_type} detected`)
    }

    score = Math.max(0, score)
    const severity = score >= 80 ? 'low' : score >= 60 ? 'medium' : score >= 40 ? 'high' : 'critical'

    return {
      score_type: 'onboarding',
      entity_id:  params.employee_id,
      org_id:     params.org_id,
      score,
      severity,
      factors,
      computed_at: new Date().toISOString(),
    }
  }
}

export const trustScoreService = new TrustScoreService()
