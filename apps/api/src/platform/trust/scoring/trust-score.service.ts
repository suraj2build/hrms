/**
 * TrustScoreService — explainable workforce trust scoring.
 * Aggregates verification results, duplicate detections, and risk signals.
 * PASSIVE — assistive indicator only, never an operational blocker.
 *
 * O5.1: Extended with strengths[], risks[], recommendations[], audit_signals[].
 * The scoring algorithm is UNCHANGED — no score inflation, no new weights.
 */
import type {
  TrustScoreResult, TrustScoreType, TrustAuditSignal,
  VerificationResult, VerificationType, DuplicateDetectionResult,
} from '../types/trust-types.js'
import { explainabilityService } from '../../ai/services/explainability.service.js'

const TYPE_LABEL: Record<VerificationType, string> = {
  pan:          'PAN',
  aadhaar:      'Aadhaar',
  bank_account: 'Bank account',
  ifsc:         'IFSC',
  document:     'Document',
  phone:        'Mobile',
  email:        'Email',
}

function label(t: VerificationType): string {
  return TYPE_LABEL[t] ?? t
}

export class TrustScoreService {
  // ── O5.1 Explainability builders ──────────────────────────────────────────

  private buildStrengths(
    verifications: VerificationResult[],
    duplicates:    DuplicateDetectionResult[],
  ): string[] {
    const s: string[] = []
    for (const v of verifications) {
      if (v.status === 'verified')       s.push(`${label(v.verification_type)} verified`)
      else if (v.status === 'partial_match') s.push(`${label(v.verification_type)} partially matched`)
    }
    if (duplicates.length === 0 && verifications.length > 0) {
      s.push('No duplicate identity detected')
    }
    return s
  }

  private buildRisks(
    verifications: VerificationResult[],
    duplicates:    DuplicateDetectionResult[],
    riskFlags:     string[],
  ): string[] {
    const r: string[] = []
    for (const v of verifications) {
      if (v.status === 'failed')              r.push(`${label(v.verification_type)} verification failed`)
      else if (v.status === 'inconclusive')   r.push(`${label(v.verification_type)} verification inconclusive`)
      if (v.flags.includes('name_mismatch'))  r.push(`Name mismatch on ${label(v.verification_type)}`)
      if (v.flags.includes('non_individual_pan')) r.push('PAN is not registered to an individual')
    }
    for (const d of duplicates) {
      r.push(`Duplicate ${d.duplicate_type} detected (${d.matching_entity_ids.length + 1} employees share this value)`)
    }
    for (const f of riskFlags) r.push(`Risk flag: ${f}`)
    return r
  }

  private buildRecommendations(
    score:         number,
    verifications: VerificationResult[],
    duplicates:    DuplicateDetectionResult[],
  ): string[] {
    const rec: string[] = []
    const failed = new Set(verifications.filter(v => v.status === 'failed').map(v => v.verification_type))
    if (failed.has('pan'))          rec.push('Request a valid PAN card from the employee')
    if (failed.has('bank_account')) rec.push('Verify bank account details with the employee')
    if (failed.has('aadhaar'))      rec.push('Complete Aadhaar verification with employee consent')
    if (duplicates.length > 0)      rec.push('Investigate duplicate identity — cross-check with existing employee records')
    if (score < 60)                 rec.push('HR review recommended before finalising onboarding')
    if (score < 40)                 rec.push('Escalate to compliance team for identity verification')
    return rec
  }

  private buildAuditSignals(
    verifications: VerificationResult[],
    duplicates:    DuplicateDetectionResult[],
  ): TrustAuditSignal[] {
    const signals: TrustAuditSignal[] = []
    for (const v of verifications) {
      signals.push({
        signal:      `${v.verification_type.toUpperCase()}_${v.status.toUpperCase()}`,
        source:      'verification_events',
        occurred_at: v.verified_at,
        detail:      v.flags.length > 0 ? v.flags.join(', ') : undefined,
      })
    }
    for (const d of duplicates) {
      signals.push({
        signal:      `DUPLICATE_${d.duplicate_type.toUpperCase()}_DETECTED`,
        source:      'duplicate_detection_events',
        occurred_at: d.detected_at,
        detail:      `Matches ${d.matching_entity_ids.length} other employee record(s)`,
      })
    }
    return signals
  }

  // ── Public scoring methods ────────────────────────────────────────────────

  computeEmployeeTrustScore(params: {
    employee_id:  string
    tenant_id:       string
    verifications: VerificationResult[]
    duplicates:    DuplicateDetectionResult[]
    risk_flags?:   string[]
  }): TrustScoreResult {
    let score = 100
    const factors: string[] = []

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

    for (const d of params.duplicates) {
      const deduction = d.severity === 'critical' ? 35 : d.severity === 'high' ? 25 : 15
      score -= deduction
      factors.push(`Duplicate ${d.duplicate_type} across ${d.matching_entity_ids.length + 1} employees`)
    }

    for (const flag of (params.risk_flags ?? [])) {
      score -= 10
      factors.push(`Risk flag: ${flag}`)
    }

    score = Math.max(0, score)
    const severity = score >= 80 ? 'low' : score >= 60 ? 'medium' : score >= 40 ? 'high' : 'critical'
    const riskFlags = params.risk_flags ?? []

    return {
      score_type:      'employee',
      entity_id:       params.employee_id,
      tenant_id:          params.tenant_id,
      score,
      severity,
      factors,
      strengths:       this.buildStrengths(params.verifications, params.duplicates),
      risks:           this.buildRisks(params.verifications, params.duplicates, riskFlags),
      recommendations: this.buildRecommendations(score, params.verifications, params.duplicates),
      audit_signals:   this.buildAuditSignals(params.verifications, params.duplicates),
      computed_at:     new Date().toISOString(),
      explainability:  explainabilityService.explain({
        event_type:  'trust.score.computed',
        entity_type: 'employee',
        entity_id:   params.employee_id,
        payload:     { score, severity, factor_count: factors.length },
        severity:    severity === 'low' ? 'info' : severity === 'medium' ? 'warning' : severity as any,
      }),
    }
  }

  computeOnboardingTrustScore(params: {
    employee_id:  string
    tenant_id:       string
    has_pan:      boolean
    has_bank:     boolean
    has_identity: boolean
    pan_valid?:   boolean
    bank_valid?:  boolean
    duplicates:   DuplicateDetectionResult[]
  }): TrustScoreResult {
    let score = 100
    const factors: string[] = []
    const mockVerifications: VerificationResult[] = []

    if (!params.has_pan) {
      score -= 20; factors.push('PAN not provided')
    } else if (params.pan_valid === false) {
      score -= 15; factors.push('PAN validation failed')
    } else {
      mockVerifications.push({ verification_type: 'pan', status: 'verified', entity_id: params.employee_id, entity_type: 'employee', tenant_id: params.tenant_id, verified_at: new Date().toISOString(), score: 90, flags: [] })
    }

    if (!params.has_bank) {
      score -= 20; factors.push('Bank details not provided')
    } else if (params.bank_valid === false) {
      score -= 15; factors.push('Bank validation failed')
    } else {
      mockVerifications.push({ verification_type: 'bank_account', status: 'verified', entity_id: params.employee_id, entity_type: 'employee', tenant_id: params.tenant_id, verified_at: new Date().toISOString(), score: 90, flags: [] })
    }

    if (!params.has_identity) {
      score -= 10; factors.push('Identity documents not uploaded')
    } else {
      mockVerifications.push({ verification_type: 'document', status: 'verified', entity_id: params.employee_id, entity_type: 'employee', tenant_id: params.tenant_id, verified_at: new Date().toISOString(), score: 85, flags: [] })
    }

    for (const d of params.duplicates) {
      const deduction = d.severity === 'high' ? 25 : 15
      score -= deduction
      factors.push(`Duplicate ${d.duplicate_type} detected`)
    }

    score = Math.max(0, score)
    const severity = score >= 80 ? 'low' : score >= 60 ? 'medium' : score >= 40 ? 'high' : 'critical'

    return {
      score_type:      'onboarding',
      entity_id:       params.employee_id,
      tenant_id:          params.tenant_id,
      score,
      severity,
      factors,
      strengths:       this.buildStrengths(mockVerifications, params.duplicates),
      risks:           this.buildRisks(mockVerifications, params.duplicates, []),
      recommendations: this.buildRecommendations(score, mockVerifications, params.duplicates),
      audit_signals:   this.buildAuditSignals(mockVerifications, params.duplicates),
      computed_at:     new Date().toISOString(),
    }
  }
}

export const trustScoreService = new TrustScoreService()
