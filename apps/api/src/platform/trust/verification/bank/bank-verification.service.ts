/**
 * Bank Verification Service — Sprint 3.
 * IFSC validation, account number structure checks, duplicate detection.
 * PASSIVE ONLY.
 */
import { createHash } from 'crypto'
import type { VerificationResult } from '../../types/trust-types.js'
import { explainabilityService } from '../../../ai/services/explainability.service.js'

// IFSC format: 4 letters + 0 + 6 alphanumeric
const IFSC_REGEX = /^[A-Z]{4}0[A-Z0-9]{6}$/

export class BankVerificationService {
  validateIfsc(ifsc: string): boolean {
    return IFSC_REGEX.test(ifsc.toUpperCase().trim())
  }

  hashAccountNumber(accountNumber: string): string {
    // Normalize: strip spaces/dashes
    const normalized = accountNumber.replace(/[\s\-]/g, '')
    return createHash('sha256').update(normalized).digest('hex')
  }

  verify(params: {
    account_number: string
    ifsc_code:      string
    bank_name?:     string
    employee_id:    string
    org_id:         string
  }): VerificationResult {
    const flags: string[] = []

    const validIfsc = this.validateIfsc(params.ifsc_code)
    if (!validIfsc) flags.push('invalid_ifsc_format')

    const acctLen = params.account_number.replace(/[\s\-]/g, '').length
    if (acctLen < 9 || acctLen > 18) flags.push('suspicious_account_length')

    const score = validIfsc ? (flags.length === 0 ? 85 : 55) : 20

    return {
      verification_type: 'bank_account',
      status:            flags.length === 0 ? 'verified' : 'failed',
      entity_id:         params.employee_id,
      entity_type:       'employee',
      org_id:            params.org_id,
      verified_at:       new Date().toISOString(),
      score,
      flags,
      explainability: explainabilityService.explain({
        event_type:  'bank.verification',
        entity_type: 'employee',
        entity_id:   params.employee_id,
        payload:     { valid_ifsc: validIfsc, flags },
        severity:    flags.length > 0 ? 'warning' : 'info',
      }),
    }
  }
}

export const bankVerificationService = new BankVerificationService()
