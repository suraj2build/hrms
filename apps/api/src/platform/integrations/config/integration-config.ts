import type { IntegrationConfig, IntegrationProvider } from '../types/integration-types.js'

export function getIntegrationConfig(provider: IntegrationProvider): IntegrationConfig {
  const timeout_ms = 5000

  switch (provider) {
    case 'surepass_pan': {
      const api_key = process.env['SUREPASS_API_KEY']
      return {
        provider,
        enabled:  !!api_key,
        api_key,
        base_url: 'https://kyc-api.surepass.io/api/v1',
        timeout_ms,
      }
    }

    case 'razorpay_ifsc': {
      const disabled = process.env['RAZORPAY_IFSC_DISABLED'] === 'true'
      const base_url = process.env['RAZORPAY_IFSC_BASE_URL'] ?? 'https://ifsc.razorpay.com'
      return {
        provider,
        enabled: !disabled,
        base_url,
        timeout_ms,
      }
    }

    case 'tally_export': {
      const enabled = process.env['TALLY_EXPORT_ENABLED'] === 'true'
      return {
        provider,
        enabled,
        timeout_ms,
      }
    }

    case 'quickbooks_export': {
      // Pure local export — no external API needed; enabled unless explicitly disabled
      const disabled = process.env['QUICKBOOKS_EXPORT_DISABLED'] === 'true'
      return {
        provider,
        enabled: !disabled,
        timeout_ms,
      }
    }

    case 'regulatory_feed': {
      const base_url = process.env['REGULATORY_FEED_URL']
      return {
        provider,
        enabled:  !!base_url,
        base_url,
        timeout_ms,
      }
    }

    case 'decentro_pan': {
      const api_key   = process.env['DECENTRO_API_KEY']
      const client_id = process.env['DECENTRO_CLIENT_ID']
      return {
        provider, enabled: !!(api_key && client_id),
        api_key,
        base_url: process.env['DECENTRO_BASE_URL'] ?? 'https://in.decentro.tech',
        timeout_ms,
      }
    }

    case 'signzy_pan': {
      const api_key = process.env['SIGNZY_API_KEY']
      return {
        provider, enabled: !!api_key,
        api_key,
        base_url: process.env['SIGNZY_BASE_URL'] ?? 'https://api.signzy.tech',
        timeout_ms,
      }
    }

    case 'penny_drop': {
      const enabled  = process.env['PENNY_DROP_ENABLED'] === 'true'
      const api_key  = process.env['PENNY_DROP_API_KEY']
      return {
        provider, enabled: enabled && !!api_key,
        api_key,
        base_url: process.env['PENNY_DROP_BASE_URL'] ?? '',
        timeout_ms: 10_000,
      }
    }

    case 'aadhaar_okyc': {
      // Phase 2: a licensed AUA aggregator / Offline e-KYC provider. Disabled
      // until creds are supplied — Phase 1 runs purely on local validation.
      const api_key = process.env['AADHAAR_OKYC_API_KEY']
      return {
        provider, enabled: !!api_key,
        api_key,
        base_url: process.env['AADHAAR_OKYC_BASE_URL'] ?? '',
        timeout_ms,
      }
    }
  }
}

export function isIntegrationEnabled(provider: IntegrationProvider): boolean {
  const config = getIntegrationConfig(provider)
  return config.enabled
}
