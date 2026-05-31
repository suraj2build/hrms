import { ifscVerificationAdapter } from './ifsc-verification.adapter.js'
import { getIntegrationConfig }    from '../config/integration-config.js'
import type { IntegrationAdapterResult } from '../types/integration-types.js'

export interface BankVerificationData {
  ifsc_valid:              boolean
  bank_name?:              string
  branch?:                 string
  city?:                   string
  penny_drop_status:       'not_attempted' | 'success' | 'failed' | 'pending'
  account_holder_name?:    string
  name_match_confidence?:  'high' | 'medium' | 'low'
  provider_reference?:     string
}

export class BankVerificationAdapter {
  async verify(params: {
    account_number: string
    ifsc_code:      string
    name_from_db?:  string
  }): Promise<IntegrationAdapterResult<BankVerificationData>> {
    const ifscResult = await ifscVerificationAdapter.lookup(params.ifsc_code)
    const ifscValid  = ifscResult.status === 'active' && !!ifscResult.data

    // If IFSC lookup failed, return degraded result
    if (!ifscValid) {
      return {
        provider:   'razorpay_ifsc',
        status:     ifscResult.status === 'error' ? 'degraded' : ifscResult.status,
        source:     ifscResult.source,
        error:      ifscResult.error,
        data: {
          ifsc_valid:        false,
          penny_drop_status: 'not_attempted',
        },
        latency_ms: ifscResult.latency_ms,
      }
    }

    const pennyConfig = getIntegrationConfig('penny_drop')
    let pennyStatus: BankVerificationData['penny_drop_status'] = 'not_attempted'

    if (pennyConfig.enabled) {
      // Penny drop is optional — stub: mark as pending (real impl needs contract with provider)
      pennyStatus = 'pending'
    }

    return {
      provider:   'razorpay_ifsc',
      status:     'active',
      source:     'external',
      latency_ms: ifscResult.latency_ms,
      data: {
        ifsc_valid:        true,
        bank_name:         ifscResult.data!.bank,
        branch:            ifscResult.data!.branch,
        city:              ifscResult.data!.city,
        penny_drop_status: pennyStatus,
      },
    }
  }
}

export const bankVerificationAdapter = new BankVerificationAdapter()
