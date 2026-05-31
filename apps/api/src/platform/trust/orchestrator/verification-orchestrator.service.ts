import type { SupabaseClient } from '@supabase/supabase-js'
import { panVerificationAdapter }            from '../../integrations/adapters/pan-verification.adapter.js'
import { bankVerificationAdapter }           from '../../integrations/adapters/bank-verification.adapter.js'
import { verificationRetryService }          from '../../integrations/retry/verification-retry.service.js'
import { verificationExplainabilityService } from '../explainability/verification-explainability.service.js'
import type { VerificationStatus }           from '../types/trust-types.js'
import type { IntegrationAdapterResult }     from '../../integrations/types/integration-types.js'
import type { PanVerificationData }          from '../../integrations/adapters/pan-verification.adapter.js'
import type { BankVerificationData }         from '../../integrations/adapters/bank-verification.adapter.js'

export interface VerifyEmployeeParams {
  supabase:        SupabaseClient
  employee_id:     string
  tenant_id:       string
  pan?:            string
  account_number?: string
  ifsc_code?:      string
}

export class VerificationOrchestrator {
  /**
   * Run all applicable verifications. Fire-and-forget safe — swallows all errors.
   */
  async verify(params: VerifyEmployeeParams): Promise<void> {
    const jobs: Promise<void>[] = []
    if (params.pan) jobs.push(this.verifyPan(params))
    if (params.account_number && params.ifsc_code) jobs.push(this.verifyBank(params))
    await Promise.allSettled(jobs)
  }

  private adapterToVerificationStatus(
    adapterStatus: string, isPositive: boolean
  ): VerificationStatus {
    if (adapterStatus === 'active' && isPositive)  return 'verified'
    if (adapterStatus === 'active' && !isPositive) return 'failed'
    if (adapterStatus === 'not_configured')        return isPositive ? 'verified' : 'pending'
    return 'degraded'
  }

  private async upsert(
    supabase: SupabaseClient,
    record: Record<string, unknown>,
  ): Promise<void> {
    const { error } = await supabase
      .from('verification_records')
      .upsert(
        { ...record, updated_at: new Date().toISOString() },
        { onConflict: 'employee_id,verification_type' },
      )
    if (error) {
      console.warn('[VerificationOrchestrator] persist failed:', error.message)
    }
  }

  private async verifyPan(params: VerifyEmployeeParams): Promise<void> {
    try {
      const result: IntegrationAdapterResult<PanVerificationData> =
        await panVerificationAdapter.verify(params.pan!)

      const status      = this.adapterToVerificationStatus(result.status, result.data?.is_valid ?? false)
      const explanation = verificationExplainabilityService.pan(result)

      await this.upsert(params.supabase, {
        employee_id:           params.employee_id,
        tenant_id:             params.tenant_id,
        verification_type:     'pan',
        status,
        provider:              result.provider,
        source:                result.source,
        score:                 result.data?.is_valid ? 90 : 30,
        name_match_confidence: result.data?.name_match_confidence ?? null,
        provider_reference:    result.data?.provider_reference ?? null,
        explanation,
        last_error:            result.error ?? null,
        verified_at:           new Date().toISOString(),
      })

      if (status === 'degraded') {
        verificationRetryService.enqueue(params.employee_id, 'pan', result.error ?? 'provider unavailable')
      } else {
        verificationRetryService.dequeue(params.employee_id, 'pan')
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err)
      console.warn('[VerificationOrchestrator] PAN verify error (silent):', msg)
    }
  }

  private async verifyBank(params: VerifyEmployeeParams): Promise<void> {
    try {
      const result: IntegrationAdapterResult<BankVerificationData> =
        await bankVerificationAdapter.verify({
          account_number: params.account_number!,
          ifsc_code:      params.ifsc_code!,
        })

      const status      = this.adapterToVerificationStatus(result.status, result.data?.ifsc_valid ?? false)
      const explanation = verificationExplainabilityService.bank(result)

      await this.upsert(params.supabase, {
        employee_id:        params.employee_id,
        tenant_id:          params.tenant_id,
        verification_type:  'bank_account',
        status,
        provider:           result.provider,
        source:             result.source,
        score:              result.data?.ifsc_valid ? 80 : 20,
        provider_reference: result.data?.provider_reference ?? null,
        explanation,
        last_error:         result.error ?? null,
        verified_at:        new Date().toISOString(),
      })

      if (status === 'degraded') {
        verificationRetryService.enqueue(params.employee_id, 'bank_account', result.error ?? 'provider unavailable')
      } else {
        verificationRetryService.dequeue(params.employee_id, 'bank_account')
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err)
      console.warn('[VerificationOrchestrator] Bank verify error (silent):', msg)
    }
  }
}

export const verificationOrchestrator = new VerificationOrchestrator()
