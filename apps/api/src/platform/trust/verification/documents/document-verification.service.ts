/**
 * Document Verification Service — Sprint 3.
 * Validates document completeness, expiry, and field consistency.
 * PASSIVE ONLY.
 */
import type { VerificationResult } from '../../types/trust-types.js'
import { explainabilityService } from '../../../ai/services/explainability.service.js'

export interface DocumentRecord {
  id:            string
  identity_type: string   // 'passport' | 'driving_license' | 'voter_id' | etc.
  identity_number: string
  expiry_date?:  string   // ISO date
  storage_path?: string
}

export class DocumentVerificationService {
  verify(params: {
    document:    DocumentRecord
    employee_id: string
    tenant_id:      string
    as_of?:      string   // ISO date for expiry check
  }): VerificationResult {
    const flags: string[] = []
    const today = params.as_of ?? new Date().toISOString().split('T')[0]

    if (!params.document.storage_path) flags.push('missing_scan')
    if (!params.document.identity_number) flags.push('missing_number')

    if (params.document.expiry_date && params.document.expiry_date < today) {
      flags.push('document_expired')
    } else if (params.document.expiry_date) {
      // Warn if expiring within 90 days
      const expiryMs = new Date(params.document.expiry_date).getTime()
      const todayMs  = new Date(today).getTime()
      const days     = (expiryMs - todayMs) / 86_400_000
      if (days < 90) flags.push('expiry_approaching')
    }

    const score = flags.length === 0 ? 90 : flags.includes('document_expired') ? 10 : 60

    return {
      verification_type: 'document',
      status:            flags.includes('document_expired') ? 'failed'
                       : flags.length > 0 ? 'inconclusive'
                       : 'verified',
      entity_id:         params.employee_id,
      entity_type:       'employee',
      tenant_id:            params.tenant_id,
      verified_at:       new Date().toISOString(),
      score,
      flags,
      explainability: explainabilityService.explain({
        event_type:  'document.verification',
        entity_type: 'employee',
        entity_id:   params.employee_id,
        payload:     { doc_type: params.document.identity_type, flags },
        severity:    flags.includes('document_expired') ? 'high' : flags.length > 0 ? 'warning' : 'info',
      }),
    }
  }
}

export const documentVerificationService = new DocumentVerificationService()
