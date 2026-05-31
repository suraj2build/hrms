/**
 * PanVerificationAdapter — wraps external PAN verification with graceful degradation.
 *
 * Provider chain: Surepass → Decentro → Signzy (stub) → local regex.
 * Returns first successful 'active' result, or degraded local result if all fail.
 * NEVER blocks if external call fails — catches all errors and returns degraded result.
 */

import type { IntegrationAdapterResult } from '../types/integration-types.js'
import { getIntegrationConfig } from '../config/integration-config.js'

// PAN format: 5 letters + 4 digits + 1 letter (e.g. ABCDE1234F)
const PAN_REGEX = /^[A-Z]{5}[0-9]{4}[A-Z]{1}$/

export interface PanVerificationData {
  name?:                   string
  pan_type?:               string
  is_valid:                boolean
  name_match_confidence?:  'high' | 'medium' | 'low' | null
  dob_match_confidence?:   'high' | 'medium' | 'low' | null
  provider_reference?:     string
  verified_at?:            string
}

export class PanVerificationAdapter {
  async verify(pan: string, _name_from_db?: string): Promise<IntegrationAdapterResult<PanVerificationData>> {
    const normalised = pan.toUpperCase().trim()
    const localValid = PAN_REGEX.test(normalised)

    // Try Surepass first
    const surepassResult = await this.verifyViaSurepass(normalised, localValid)
    if (surepassResult.status === 'active' && surepassResult.data?.is_valid) {
      return surepassResult
    }

    // Try Decentro as fallback
    const decentroResult = await this.verifyViaDecentro(normalised, localValid)
    if (decentroResult.status === 'active' && decentroResult.data?.is_valid) {
      return decentroResult
    }

    // Try Signzy (stub) as final fallback
    const signzyResult = await this.verifyViaSignzy(localValid)
    if (signzyResult.status === 'active' && signzyResult.data?.is_valid) {
      return signzyResult
    }

    // All providers failed or not configured — return degraded if at least one was tried
    const anyProviderTried =
      surepassResult.status !== 'not_configured' ||
      decentroResult.status !== 'not_configured' ||
      signzyResult.status   !== 'not_configured'

    if (anyProviderTried) {
      // Pick the last non-not_configured result's error
      const lastErr =
        (decentroResult.status !== 'not_configured' ? decentroResult.error : undefined) ??
        (surepassResult.status  !== 'not_configured' ? surepassResult.error : undefined)

      return {
        provider:   'surepass_pan',
        status:     'degraded',
        source:     'local',
        error:      lastErr,
        data:       { is_valid: localValid },
      }
    }

    // Nothing configured — return not_configured with local result
    return {
      provider: 'surepass_pan',
      status:   'not_configured',
      source:   'local',
      data:     { is_valid: localValid },
    }
  }

  private async verifyViaSurepass(
    normalised: string,
    localValid: boolean,
  ): Promise<IntegrationAdapterResult<PanVerificationData>> {
    const config = getIntegrationConfig('surepass_pan')

    if (!config.enabled || !config.api_key) {
      return {
        provider: 'surepass_pan',
        status:   'not_configured',
        source:   'local',
        data:     { is_valid: localValid },
      }
    }

    const start = Date.now()
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), config.timeout_ms)

    try {
      const response = await fetch(
        `${config.base_url}/pan-comprehensive/pan`,
        {
          method:  'POST',
          headers: {
            'Content-Type':  'application/json',
            'Authorization': `Bearer ${config.api_key}`,
          },
          body:   JSON.stringify({ id_number: normalised }),
          signal: controller.signal,
        },
      )

      clearTimeout(timer)
      const latency_ms = Date.now() - start

      if (!response.ok) {
        return {
          provider:   'surepass_pan',
          status:     'error',
          source:     'local',
          error:      `Surepass returned HTTP ${response.status}`,
          data:       { is_valid: localValid },
          latency_ms,
        }
      }

      const json = await response.json() as {
        data?: {
          pan_number?:  string
          first_name?:  string
          last_name?:   string
          middle_name?: string
          pan_type?:    string
        }
      }

      const d = json.data ?? {}
      const fullName = [d.first_name, d.middle_name, d.last_name]
        .filter(Boolean)
        .join(' ')
        .trim() || undefined

      return {
        provider:   'surepass_pan',
        status:     'active',
        source:     'external',
        latency_ms,
        data: {
          is_valid:   true,
          name:       fullName,
          pan_type:   d.pan_type,
          verified_at: new Date().toISOString(),
        },
      }
    } catch (err: unknown) {
      clearTimeout(timer)
      const latency_ms = Date.now() - start
      const message = err instanceof Error ? err.message : String(err)
      return {
        provider:   'surepass_pan',
        status:     'error',
        source:     'local',
        error:      message,
        data:       { is_valid: localValid },
        latency_ms,
      }
    }
  }

  private async verifyViaDecentro(
    normalised: string,
    localValid: boolean,
  ): Promise<IntegrationAdapterResult<PanVerificationData>> {
    const config = getIntegrationConfig('decentro_pan')

    if (!config.enabled || !config.api_key) {
      return {
        provider: 'decentro_pan',
        status:   'not_configured',
        source:   'local',
        data:     { is_valid: localValid },
      }
    }

    // api_key is "client_id:client_secret"
    const [client_id, client_secret] = (config.api_key ?? '').split(':')

    const start = Date.now()
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), config.timeout_ms)

    try {
      const reference_id = Math.random().toString(36).slice(2)
      const response = await fetch(
        `${config.base_url}/v2/kyc/pan/verify`,
        {
          method:  'POST',
          headers: {
            'Content-Type': 'application/json',
            'client_id':     client_id ?? '',
            'client_secret': client_secret ?? '',
          },
          body: JSON.stringify({
            reference_id,
            consent:         'Y',
            consent_purpose: 'For KYC verification',
            pan:             normalised,
          }),
          signal: controller.signal,
        },
      )

      clearTimeout(timer)
      const latency_ms = Date.now() - start

      if (!response.ok) {
        return {
          provider:   'decentro_pan',
          status:     'error',
          source:     'local',
          error:      `Decentro returned HTTP ${response.status}`,
          data:       { is_valid: localValid },
          latency_ms,
        }
      }

      const json = await response.json() as {
        decentroTxnId?: string
        status?:        string
        data?: {
          pan_holder_name?: string
          pan_type?:        string
        }
      }

      const d = json.data ?? {}
      const isActive = json.status === 'SUCCESS'

      return {
        provider:   'decentro_pan',
        status:     isActive ? 'active' : 'error',
        source:     'external',
        latency_ms,
        data: {
          is_valid:              isActive,
          name:                  d.pan_holder_name,
          pan_type:              d.pan_type,
          name_match_confidence: 'medium',
          provider_reference:    json.decentroTxnId,
          verified_at:           new Date().toISOString(),
        },
      }
    } catch (err: unknown) {
      clearTimeout(timer)
      const latency_ms = Date.now() - start
      const message = err instanceof Error ? err.message : String(err)
      return {
        provider:   'decentro_pan',
        status:     'error',
        source:     'local',
        error:      message,
        data:       { is_valid: localValid },
        latency_ms,
      }
    }
  }

  private async verifyViaSignzy(
    localValid: boolean,
  ): Promise<IntegrationAdapterResult<PanVerificationData>> {
    // Signzy requires contract setup — stub only
    return {
      provider: 'signzy_pan',
      status:   'not_configured',
      source:   'local',
      data:     { is_valid: localValid },
    }
  }
}

export const panVerificationAdapter = new PanVerificationAdapter()
