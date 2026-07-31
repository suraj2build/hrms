import type { SupabaseClient } from '@supabase/supabase-js'
import { panVerificationAdapter }            from '../../integrations/adapters/pan-verification.adapter.js'
import { bankVerificationAdapter }           from '../../integrations/adapters/bank-verification.adapter.js'
import { aadhaarVerificationAdapter }        from '../../integrations/adapters/aadhaar-verification.adapter.js'
import { verificationExplainabilityService } from '../explainability/verification-explainability.service.js'
import type { VerificationStatus }           from '../types/trust-types.js'
import type { IntegrationAdapterResult }     from '../../integrations/types/integration-types.js'
import type { PanVerificationData }          from '../../integrations/adapters/pan-verification.adapter.js'
import type { BankVerificationData }         from '../../integrations/adapters/bank-verification.adapter.js'
import type { AadhaarVerificationData }      from '../../integrations/adapters/aadhaar-verification.adapter.js'

export interface VerifyEmployeeParams {
  supabase:        SupabaseClient
  employee_id:     string
  tenant_id:       string
  pan?:            string
  account_number?: string
  ifsc_code?:      string
  aadhaar?:        string
  aadhaar_consent?: boolean
}

export class VerificationOrchestrator {
  /**
   * Run all applicable verifications. Fire-and-forget safe — swallows all errors.
   */
  async verify(params: VerifyEmployeeParams): Promise<void> {
    const jobs: Promise<void>[] = []
    if (params.pan) jobs.push(this.verifyPan(params))
    if (params.account_number && params.ifsc_code) jobs.push(this.verifyBank(params))
    // Aadhaar runs only with explicit consent (Aadhaar Act §8 / DPDP Act).
    if (params.aadhaar && params.aadhaar_consent) jobs.push(this.verifyAadhaar(params))
    await Promise.allSettled(jobs)
  }

  private adapterToVerificationStatus(
    adapterStatus: string, isPositive: boolean
  ): VerificationStatus {
    if (adapterStatus === 'active' && isPositive)  return 'verified'
    if (adapterStatus === 'active' && !isPositive) return 'failed'
    // 'not_configured' means no external provider ever ran — the adapter's
    // is_valid is a purely local format/checksum check (PAN regex, Aadhaar
    // Verhoeff checksum), not a real identity confirmation. Reporting
    // 'verified' here — as this used to do when isPositive was true — would
    // fabricate a completed identity check that never actually ran (see the
    // identical reasoning already applied to the bank penny-drop case in
    // verifyBank below). Always 'pending' — awaiting a real provider run.
    if (adapterStatus === 'not_configured')        return 'pending'
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

  /**
   * Retry-tracking fields for the upsert payload (PEND-29/76). Retry state
   * lives on this row (retry_count/degraded_reason) rather than a separate
   * in-process queue, so it survives restarts and stays correct across
   * replicas — verification-retry-scanner.ts reads it directly to decide
   * what's due for another attempt.
   */
  private async retryFields(
    supabase: SupabaseClient,
    employeeId: string,
    type: 'pan' | 'bank_account' | 'aadhaar',
    status: VerificationStatus,
    error: string | undefined,
  ): Promise<{ retry_count: number; degraded_reason: string | null }> {
    if (status !== 'degraded') return { retry_count: 0, degraded_reason: null }

    const { data } = await supabase
      .from('verification_records')
      .select('retry_count')
      .eq('employee_id', employeeId)
      .eq('verification_type', type)
      .maybeSingle()
    const priorCount = (data as { retry_count: number } | null)?.retry_count ?? 0

    return { retry_count: priorCount + 1, degraded_reason: error ?? 'provider unavailable' }
  }

  private async verifyPan(params: VerifyEmployeeParams): Promise<void> {
    try {
      const result: IntegrationAdapterResult<PanVerificationData> =
        await panVerificationAdapter.verify(params.pan!)

      const status      = this.adapterToVerificationStatus(result.status, result.data?.is_valid ?? false)
      const explanation = verificationExplainabilityService.pan(result)
      const retry       = await this.retryFields(params.supabase, params.employee_id, 'pan', status, result.error)

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
        ...retry,
      })
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

      let status        = this.adapterToVerificationStatus(result.status, result.data?.ifsc_valid ?? false)
      const explanation = verificationExplainabilityService.bank(result)

      // IFSC lookup succeeding only confirms the bank/branch exist — it says
      // nothing about whether the account belongs to this employee. Penny
      // drop (account-holder-name match) is the check that actually confirms
      // that, and bank-verification.adapter.ts's penny drop path is still a
      // stub that never resolves past 'pending'. Reporting 'verified' here
      // would fabricate a completed identity check that never ran.
      if (status === 'verified' && result.data?.penny_drop_status === 'pending') {
        status = 'pending'
      }

      const retry = await this.retryFields(params.supabase, params.employee_id, 'bank_account', status, result.error)

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
        ...retry,
      })
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err)
      console.warn('[VerificationOrchestrator] Bank verify error (silent):', msg)
    }
  }

  private async verifyAadhaar(params: VerifyEmployeeParams): Promise<void> {
    try {
      const result: IntegrationAdapterResult<AadhaarVerificationData> =
        await aadhaarVerificationAdapter.verify(params.aadhaar!)

      const status      = this.adapterToVerificationStatus(result.status, result.data?.is_valid ?? false)
      const explanation = verificationExplainabilityService.aadhaar(result, params.aadhaar_consent ?? false)
      // retry_count is still tracked for dashboard visibility, but the
      // scanner excludes 'aadhaar' from auto-retry — Aadhaar Act §8/DPDP Act
      // require fresh explicit consent per verification action, which an
      // unattended background job cannot provide. A degraded Aadhaar entry
      // stays visible as pending and is only cleared by a manual re-verify.
      const retry = await this.retryFields(params.supabase, params.employee_id, 'aadhaar', status, result.error)

      await this.upsert(params.supabase, {
        employee_id:        params.employee_id,
        tenant_id:          params.tenant_id,
        verification_type:  'aadhaar',
        status,
        provider:           result.provider,
        source:             result.source,
        score:              result.data?.is_valid ? 85 : 15,
        provider_reference: result.data?.provider_reference ?? null,
        explanation,
        last_error:         result.error ?? null,
        verified_at:        new Date().toISOString(),
        ...retry,
      })
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err)
      console.warn('[VerificationOrchestrator] Aadhaar verify error (silent):', msg)
    }
  }
}

export const verificationOrchestrator = new VerificationOrchestrator()
