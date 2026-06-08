/**
 * Aadhaar Verification Service — Phase 1 (rule-based, provider-ready).
 *
 * Validates an Aadhaar number's structure and Verhoeff checksum WITHOUT calling
 * UIDAI. A real provider (Offline e-KYC / licensed AUA aggregator) is injected
 * later via aadhaar-verification.adapter.ts — exactly the PAN pattern.
 *
 * COMPLIANCE — this service NEVER:
 *   • stores or logs the raw 12-digit Aadhaar number,
 *   • returns the full number in any result or explanation,
 *   • runs without an explicit, recorded consent flag.
 * Only a last-4 mask and a SHA-256 hash (for duplicate detection) leave here.
 *
 * PASSIVE ONLY — validates and scores, never mutates employee records.
 */
import { createHash } from 'crypto'
import type { VerificationResult } from '../../types/trust-types.js'
import { explainabilityService } from '../../../ai/services/explainability.service.js'

// ── Verhoeff checksum (the algorithm UIDAI uses for the Aadhaar check digit) ────

const D = [
  [0, 1, 2, 3, 4, 5, 6, 7, 8, 9],
  [1, 2, 3, 4, 0, 6, 7, 8, 9, 5],
  [2, 3, 4, 0, 1, 7, 8, 9, 5, 6],
  [3, 4, 0, 1, 2, 8, 9, 5, 6, 7],
  [4, 0, 1, 2, 3, 9, 5, 6, 7, 8],
  [5, 9, 8, 7, 6, 0, 4, 3, 2, 1],
  [6, 5, 9, 8, 7, 1, 0, 4, 3, 2],
  [7, 6, 5, 9, 8, 2, 1, 0, 4, 3],
  [8, 7, 6, 5, 9, 3, 2, 1, 0, 4],
  [9, 8, 7, 6, 5, 4, 3, 2, 1, 0],
]
const P = [
  [0, 1, 2, 3, 4, 5, 6, 7, 8, 9],
  [1, 5, 7, 6, 2, 8, 3, 0, 9, 4],
  [5, 8, 0, 3, 7, 9, 6, 1, 4, 2],
  [8, 9, 1, 6, 0, 4, 3, 5, 2, 7],
  [9, 4, 5, 3, 1, 2, 6, 8, 7, 0],
  [4, 2, 8, 6, 5, 7, 3, 9, 0, 1],
  [2, 7, 9, 3, 8, 0, 6, 4, 1, 5],
  [7, 0, 4, 6, 9, 1, 3, 2, 5, 8],
]

function verhoeffValid(digits: string): boolean {
  let c = 0
  const reversed = digits.split('').reverse()
  for (let i = 0; i < reversed.length; i++) {
    const d = Number(reversed[i])
    if (Number.isNaN(d)) return false
    c = D[c][P[i % 8][d]]
  }
  return c === 0
}

// Aadhaar: 12 digits, first digit 2–9 (0/1 are reserved), valid Verhoeff check digit.
const AADHAAR_REGEX = /^[2-9][0-9]{11}$/

export interface AadhaarValidation {
  isValid:        boolean
  formatOk:       boolean
  checksumOk:     boolean
  masked:         string   // e.g. "XXXX-XXXX-1234"
}

export class AadhaarVerificationService {
  /** Normalise: strip spaces / hyphens. */
  normalise(aadhaar: string): string {
    return (aadhaar ?? '').replace(/[\s-]/g, '').trim()
  }

  /** Structural + Verhoeff checksum validation (no external call). */
  validateStructure(aadhaar: string): AadhaarValidation {
    const n = this.normalise(aadhaar)
    const formatOk   = AADHAAR_REGEX.test(n)
    const checksumOk = formatOk && verhoeffValid(n)
    return {
      isValid:    formatOk && checksumOk,
      formatOk,
      checksumOk,
      masked:     this.mask(n),
    }
  }

  /** Last-4 mask — the only form of the number allowed to leave this layer. */
  mask(aadhaar: string): string {
    const n = this.normalise(aadhaar)
    if (n.length !== 12) return 'XXXX-XXXX-XXXX'
    return `XXXX-XXXX-${n.slice(-4)}`
  }

  /** SHA-256 hash for duplicate detection — never store the raw number. */
  hashAadhaar(aadhaar: string): string {
    return createHash('sha256').update(this.normalise(aadhaar)).digest('hex')
  }

  /**
   * Verify an Aadhaar value for an employee (Phase 1: format + checksum only).
   * Consent MUST be captured by the caller before invoking this.
   */
  verify(params: {
    aadhaar:      string
    employee_id:  string
    org_id:       string
    consent:      boolean
  }): VerificationResult {
    const flags: string[] = []
    const v = this.validateStructure(params.aadhaar)

    if (!params.consent)  flags.push('consent_missing')
    if (!v.formatOk)      flags.push('invalid_aadhaar_format')
    else if (!v.checksumOk) flags.push('invalid_aadhaar_checksum')

    // No consent → never a pass, regardless of format.
    const status: VerificationResult['status'] =
      !params.consent ? 'needs_review' : v.isValid ? 'verified' : 'failed'

    const score = !params.consent ? 0 : v.isValid ? 85 : 10

    return {
      verification_type: 'aadhaar',
      status,
      entity_id:         params.employee_id,
      entity_type:       'employee',
      org_id:            params.org_id,
      verified_at:       new Date().toISOString(),
      score,
      flags,
      // PII-safe: only the mask + boolean outcomes, never the raw number.
      raw_response: { masked: v.masked, format_ok: v.formatOk, checksum_ok: v.checksumOk, consent: params.consent },
      explainability: explainabilityService.explain({
        event_type:  'aadhaar.verification',
        entity_type: 'employee',
        entity_id:   params.employee_id,
        payload:     { valid: v.isValid, flags, masked: v.masked },
        severity:    v.isValid && params.consent ? 'info' : 'warning',
      }),
    }
  }
}

export const aadhaarVerificationService = new AadhaarVerificationService()
