/**
 * AadhaarVerificationAdapter — wraps Aadhaar verification with graceful degradation.
 *
 * Phase 1: no external provider is wired, so this returns a 'not_configured'
 * result carrying the LOCAL validation outcome (format + Verhoeff checksum).
 * Phase 2: plug a licensed AUA aggregator / Offline e-KYC provider into
 * verifyViaProvider() — the orchestrator and callers stay unchanged.
 *
 * NEVER blocks if an external call fails — all errors are caught and degraded.
 * PII-safe: only a last-4 mask + boolean outcomes are ever returned.
 */

import type { IntegrationAdapterResult } from '../types/integration-types.js'
import { getIntegrationConfig } from '../config/integration-config.js'
import { aadhaarVerificationService } from '../../trust/verification/aadhaar/aadhaar-verification.service.js'

export interface AadhaarVerificationData {
  is_valid:            boolean
  format_ok:           boolean
  checksum_ok:         boolean
  masked:              string            // "XXXX-XXXX-1234"
  name_match_confidence?: 'high' | 'medium' | 'low' | null
  provider_reference?: string            // provider txn / UID token (Phase 2)
  verified_at?:        string
}

export class AadhaarVerificationAdapter {
  async verify(aadhaar: string, _name_from_db?: string): Promise<IntegrationAdapterResult<AadhaarVerificationData>> {
    const v = aadhaarVerificationService.validateStructure(aadhaar)
    const local: AadhaarVerificationData = {
      is_valid:    v.isValid,
      format_ok:   v.formatOk,
      checksum_ok: v.checksumOk,
      masked:      v.masked,
    }

    // Phase 2 hook — a real provider would be tried here first.
    const provided = await this.verifyViaProvider(aadhaar, local)
    if (provided.status === 'active' && provided.data?.is_valid) return provided

    if (provided.status !== 'not_configured') {
      // Provider was tried but failed → degrade to local result.
      return { provider: 'aadhaar_okyc', status: 'degraded', source: 'local', error: provided.error, data: local }
    }

    // No provider configured → local-only result (Phase 1 default).
    return { provider: 'aadhaar_okyc', status: 'not_configured', source: 'local', data: local }
  }

  /**
   * Phase 2 integration point. Returns 'not_configured' until a licensed
   * Aadhaar aggregator / Offline e-KYC provider is wired and credentialed.
   */
  private async verifyViaProvider(
    _aadhaar: string,
    local: AadhaarVerificationData,
  ): Promise<IntegrationAdapterResult<AadhaarVerificationData>> {
    const config = getIntegrationConfig('aadhaar_okyc')
    if (!config.enabled || !config.api_key) {
      return { provider: 'aadhaar_okyc', status: 'not_configured', source: 'local', data: local }
    }
    // TODO(Phase 2): call config.base_url with consent + OTP/offline-XML flow,
    // map the provider response into AadhaarVerificationData, return status 'active'.
    return { provider: 'aadhaar_okyc', status: 'not_configured', source: 'local', data: local }
  }
}

export const aadhaarVerificationAdapter = new AadhaarVerificationAdapter()
