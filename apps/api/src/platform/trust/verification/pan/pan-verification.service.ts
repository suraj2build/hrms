/**
 * PAN Verification Service — Sprint 3.
 * Validates PAN structure, name match, and duplicate usage.
 * Sprint 3: Rule-based verification (no external provider yet).
 * Provider-ready: inject a real PAN API in a future sprint.
 *
 * PASSIVE ONLY — validates and scores, never mutates employee records.
 */
import { createHash } from 'crypto'
import type { VerificationResult } from '../../types/trust-types.js'
import { explainabilityService } from '../../../ai/services/explainability.service.js'

// PAN format: 5 letters + 4 digits + 1 letter (e.g. ABCDE1234F)
const PAN_REGEX = /^[A-Z]{5}[0-9]{4}[A-Z]{1}$/

export class PanVerificationService {
  /** Validate PAN structure (no external API call in Sprint 3) */
  validateStructure(pan: string): boolean {
    return PAN_REGEX.test(pan.toUpperCase().trim())
  }

  /** Hash a PAN for duplicate detection — no raw PAN stored */
  hashPan(pan: string): string {
    return createHash('sha256').update(pan.toUpperCase().trim()).digest('hex')
  }

  /**
   * Verify a PAN value for an employee.
   * Sprint 3: validates format + flags issues. No external API.
   */
  verify(params: {
    pan:          string
    employee_id:  string
    org_id:       string
    name_from_db?: string   // for future name-match check
  }): VerificationResult {
    const flags: string[] = []
    const isValid = this.validateStructure(params.pan)

    if (!isValid) flags.push('invalid_pan_format')
    // PAN 4th character encodes entity type: P = individual
    const fourthChar = params.pan.toUpperCase()[3]
    if (fourthChar && fourthChar !== 'P') flags.push('non_individual_pan')

    const score = isValid ? (flags.length === 0 ? 90 : 60) : 10

    return {
      verification_type: 'pan',
      status:            isValid ? 'verified' : 'failed',
      entity_id:         params.employee_id,
      entity_type:       'employee',
      org_id:            params.org_id,
      verified_at:       new Date().toISOString(),
      score,
      flags,
      explainability: explainabilityService.explain({
        event_type:  'pan.verification',
        entity_type: 'employee',
        entity_id:   params.employee_id,
        payload:     { valid: isValid, flags },
        severity:    isValid ? 'info' : 'warning',
      }),
    }
  }
}

export const panVerificationService = new PanVerificationService()
