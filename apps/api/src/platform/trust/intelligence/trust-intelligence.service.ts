/**
 * TrustIntelligenceService — orchestrates verification, duplicate detection,
 * graph edge building, and trust scoring for an employee onboarding event.
 *
 * Called by TrustGovernanceListener after EMPLOYEE_CREATED events.
 * PASSIVE ONLY — generates scores and alerts, never mutates employee records.
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import { panVerificationService }      from '../verification/pan/pan-verification.service.js'
import { bankVerificationService }     from '../verification/bank/bank-verification.service.js'
import { duplicateDetectorService }    from '../duplicate/duplicate-detector.service.js'
import { workforceGraphService }       from '../graph/workforce-graph.service.js'
import { trustScoreService }           from '../scoring/trust-score.service.js'
import type { TrustScoreResult }       from '../types/trust-types.js'

export interface TrustIntelligenceInput {
  employee_id: string
  tenant_id:   string
  org_id:      string
  pan?:        string
  account_number?: string
  ifsc_code?:  string
  phone?:      string
}

export interface TrustIntelligenceOutput {
  employee_id:    string
  trust_score:    TrustScoreResult
  duplicate_count: number
  verification_flags: string[]
}

export class TrustIntelligenceService {
  async evaluateEmployee(supabase: SupabaseClient, input: TrustIntelligenceInput): Promise<TrustIntelligenceOutput> {
    const verifications = []
    const duplicates    = []
    const allFlags: string[] = []

    // 1. PAN verification + graph edge
    if (input.pan) {
      const panResult = panVerificationService.verify({
        pan:         input.pan,
        employee_id: input.employee_id,
        org_id:      input.org_id,
      })
      verifications.push(panResult)
      allFlags.push(...panResult.flags)

      // Graph edge
      await workforceGraphService.addPanEdge(supabase, input.employee_id, input.pan, input.org_id)

      // Duplicate detection
      const dupPan = await duplicateDetectorService.detectDuplicatePan(supabase, {
        pan:         input.pan,
        employee_id: input.employee_id,
        tenant_id:   input.tenant_id,
        org_id:      input.org_id,
      })
      if (dupPan) duplicates.push(dupPan)
    }

    // 2. Bank verification + graph edge
    if (input.account_number && input.ifsc_code) {
      const bankResult = bankVerificationService.verify({
        account_number: input.account_number,
        ifsc_code:      input.ifsc_code,
        employee_id:    input.employee_id,
        org_id:         input.org_id,
      })
      verifications.push(bankResult)
      allFlags.push(...bankResult.flags)

      await workforceGraphService.addBankEdge(supabase, input.employee_id, input.account_number, input.org_id)

      const dupBank = await duplicateDetectorService.detectDuplicateBank(supabase, {
        account_number: input.account_number,
        employee_id:    input.employee_id,
        tenant_id:      input.tenant_id,
        org_id:         input.org_id,
      })
      if (dupBank) duplicates.push(dupBank)
    }

    // 3. Phone duplicate
    if (input.phone) {
      await workforceGraphService.addPhoneEdge(supabase, input.employee_id, input.phone, input.org_id)
      const dupPhone = await duplicateDetectorService.detectDuplicatePhone(supabase, {
        phone:       input.phone,
        employee_id: input.employee_id,
        tenant_id:   input.tenant_id,
        org_id:      input.org_id,
      })
      if (dupPhone) duplicates.push(dupPhone)
    }

    // 4. Compute trust score
    const trustScore = trustScoreService.computeEmployeeTrustScore({
      employee_id:   input.employee_id,
      org_id:        input.org_id,
      verifications,
      duplicates,
    })

    return {
      employee_id:        input.employee_id,
      trust_score:        trustScore,
      duplicate_count:    duplicates.length,
      verification_flags: allFlags,
    }
  }
}

export const trustIntelligenceService = new TrustIntelligenceService()
