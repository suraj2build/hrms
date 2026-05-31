import type { IntegrationAdapterResult } from '../../integrations/types/integration-types.js'
import type { PanVerificationData }       from '../../integrations/adapters/pan-verification.adapter.js'
import type { BankVerificationData }      from '../../integrations/adapters/bank-verification.adapter.js'
import type { VerificationStatus }        from '../types/trust-types.js'

function cap(s: string): string { return s.charAt(0).toUpperCase() + s.slice(1) }

export class VerificationExplainabilityService {
  pan(result: IntegrationAdapterResult<PanVerificationData>): string {
    if (result.status === 'active' && result.data?.is_valid) {
      const parts = ['PAN verified successfully.']
      if (result.data.name_match_confidence) parts.push(`Name confidence: ${cap(result.data.name_match_confidence)}.`)
      if (result.data.dob_match_confidence === 'high') parts.push('Date of birth confirmed.')
      return parts.join(' ')
    }
    if (result.status === 'error' || result.status === 'degraded') {
      return 'PAN verification degraded due to provider issue. Operations may continue. Retry scheduled automatically.'
    }
    if (result.status === 'not_configured') {
      return result.data?.is_valid
        ? 'PAN format verified. External verification not configured — configure SUREPASS_API_KEY to enable.'
        : 'PAN format is invalid. Please correct the PAN number.'
    }
    return 'PAN verification returned inconclusive result. Manual review recommended.'
  }

  bank(result: IntegrationAdapterResult<BankVerificationData>): string {
    if (!result.data?.ifsc_valid) {
      if (result.status === 'error' || result.status === 'degraded') {
        return 'Bank verification degraded due to provider issue. Operations may continue.'
      }
      return 'IFSC code is invalid or not found. Please verify the bank details.'
    }
    const parts: string[] = ['Bank details verified.']
    if (result.data.bank_name) parts.push(`Bank: ${result.data.bank_name}.`)
    if (result.data.penny_drop_status === 'success') parts.push('Account holder confirmed via penny drop.')
    if (result.data.penny_drop_status === 'not_attempted') parts.push('Account ownership verification not enabled.')
    if (result.data.penny_drop_status === 'pending') parts.push('Penny drop verification in progress.')
    return parts.join(' ')
  }

  stateNarrative(status: VerificationStatus): string {
    const map: Record<VerificationStatus, string> = {
      verified:      'Verification complete.',
      partial_match: 'Partially verified. Some fields require confirmation.',
      needs_review:  'Flagged for manual review.',
      failed:        'Verification failed. Please update the details.',
      pending:       'Verification in progress.',
      skipped:       'No data available to verify.',
      inconclusive:  'Result inconclusive. Manual review recommended.',
      degraded:      'Provider unavailable. Verification will retry automatically.',
      expired:       'Verification has expired. Re-verification recommended.',
    }
    return map[status] ?? 'Verification status unknown.'
  }
}

export const verificationExplainabilityService = new VerificationExplainabilityService()
