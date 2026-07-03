/**
 * TrustIntelligenceService — orchestrates verification, duplicate detection,
 * graph edge building, and trust scoring for an employee onboarding event.
 *
 * Called by TrustGovernanceListener after EMPLOYEE_CREATED events.
 * PASSIVE ONLY — generates scores and alerts, never mutates employee records.
 *
 * O5.4: Document extraction signals from onboarding_documents are now fetched
 * and folded into the trust score as VerificationResult entries.
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import { panVerificationService }      from '../verification/pan/pan-verification.service.js'
import { bankVerificationService }     from '../verification/bank/bank-verification.service.js'
import { duplicateDetectorService }    from '../duplicate/duplicate-detector.service.js'
import { workforceGraphService }       from '../graph/workforce-graph.service.js'
import { trustScoreService }           from '../scoring/trust-score.service.js'
import type { TrustScoreResult, VerificationResult } from '../types/trust-types.js'
import {
  emitTrustScoreComputed,
  emitTrustVerificationCompleted,
  emitTrustVerificationFailed,
  emitTrustDuplicateDetected,
  dispatchTrustLifecycleEvent,
} from '../../../lib/trust-events.js'

export interface TrustIntelligenceInput {
  employee_id: string
  tenant_id:   string
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
    const verifications: VerificationResult[] = []
    const duplicates    = []
    const allFlags: string[] = []

    // 1. PAN verification + graph edge
    if (input.pan) {
      const panResult = panVerificationService.verify({
        pan:         input.pan,
        employee_id: input.employee_id,
        tenant_id:      input.tenant_id,
      })
      verifications.push(panResult)
      allFlags.push(...panResult.flags)

      // Graph edge
      await workforceGraphService.addPanEdge(supabase, input.employee_id, input.pan, input.tenant_id)

      // Duplicate detection
      const dupPan = await duplicateDetectorService.detectDuplicatePan(supabase, {
        pan:         input.pan,
        employee_id: input.employee_id,
        tenant_id:   input.tenant_id,
      })
      if (dupPan) duplicates.push(dupPan)
    }

    // 2. Bank verification + graph edge
    if (input.account_number && input.ifsc_code) {
      const bankResult = bankVerificationService.verify({
        account_number: input.account_number,
        ifsc_code:      input.ifsc_code,
        employee_id:    input.employee_id,
        tenant_id:         input.tenant_id,
      })
      verifications.push(bankResult)
      allFlags.push(...bankResult.flags)

      await workforceGraphService.addBankEdge(supabase, input.employee_id, input.account_number, input.tenant_id)

      const dupBank = await duplicateDetectorService.detectDuplicateBank(supabase, {
        account_number: input.account_number,
        employee_id:    input.employee_id,
        tenant_id:      input.tenant_id,
      })
      if (dupBank) duplicates.push(dupBank)
    }

    // 3. Phone duplicate
    if (input.phone) {
      await workforceGraphService.addPhoneEdge(supabase, input.employee_id, input.phone, input.tenant_id)
      const dupPhone = await duplicateDetectorService.detectDuplicatePhone(supabase, {
        phone:       input.phone,
        employee_id: input.employee_id,
        tenant_id:   input.tenant_id,
      })
      if (dupPhone) duplicates.push(dupPhone)
    }

    // 4. Document extraction signals (O5.4)
    //    Fetch from onboarding_documents where the employee's draft profile is linked.
    //    Map extraction_status → VerificationResult so the scoring explainability
    //    layer can surface document-level strengths and risks.
    const docVerifications = await this.fetchDocumentVerifications(supabase, input)
    verifications.push(...docVerifications)

    // 5. Compute trust score
    const trustScore = trustScoreService.computeEmployeeTrustScore({
      employee_id:   input.employee_id,
      tenant_id:        input.tenant_id,
      verifications,
      duplicates,
    })

    // 6. Emit trust events (O5.2 / O5.5) — non-blocking, best-effort
    this.emitTrustEvents(supabase, input, verifications, duplicates, trustScore)

    return {
      employee_id:        input.employee_id,
      trust_score:        trustScore,
      duplicate_count:    duplicates.length,
      verification_flags: allFlags,
    }
  }

  private emitTrustEvents(
    supabase:      SupabaseClient,
    input:         TrustIntelligenceInput,
    verifications: VerificationResult[],
    duplicates:    any[],
    score:         TrustScoreResult,
  ): void {
    // Score computed event
    emitTrustScoreComputed({
      tenantId:    input.tenant_id,
      entityId:    input.employee_id,
      entityType:  'employee',
      score:       score.score,
      severity:    score.severity,
      factorCount: score.factors.length,
    })

    // Per-verification events
    for (const v of verifications) {
      if (v.status === 'verified' || v.status === 'partial_match') {
        emitTrustVerificationCompleted({
          tenantId:         input.tenant_id,
          entityId:         input.employee_id,
          entityType:       'employee',
          verificationType: v.verification_type,
          score:            v.score,
          flags:            v.flags,
        })
      } else if (v.status === 'failed' || v.status === 'inconclusive') {
        emitTrustVerificationFailed({
          tenantId:         input.tenant_id,
          entityId:         input.employee_id,
          entityType:       'employee',
          verificationType: v.verification_type,
          status:           v.status,
          flags:            v.flags,
        })
      }
    }

    // Per-duplicate events
    for (const d of duplicates) {
      emitTrustDuplicateDetected({
        tenantId:          input.tenant_id,
        entityId:          input.employee_id,
        duplicateType:     d.duplicate_type,
        matchingEntityIds: d.matching_entity_ids,
        severity:          d.severity,
        valueHash:         d.value_hash,
      })
    }

    // Timeline entry for material trust signals (O5.5)
    const hasFailure  = verifications.some(v => v.status === 'failed' || v.status === 'inconclusive')
    const hasDuplicate = duplicates.length > 0

    // Only write to the timeline when there is something meaningful to report.
    // Clean evaluations (score ≥ 80, no failures) are silent — "Trust Score Computed"
    // repeated on every run is noise, not signal.
    if (hasDuplicate) {
      dispatchTrustLifecycleEvent({
        supabase,
        tenantId:    input.tenant_id,
        employeeId:  input.employee_id,
        eventType:   'trust.duplicate.detected',
        title:       'Duplicate identity signal detected',
        description: `${duplicates.length} duplicate record(s) flagged during trust evaluation`,
        severity:    'critical',
        payload:     { duplicate_count: duplicates.length },
      }).catch(() => { /* best-effort */ })
    } else if (hasFailure) {
      dispatchTrustLifecycleEvent({
        supabase,
        tenantId:    input.tenant_id,
        employeeId:  input.employee_id,
        eventType:   'trust.verification.failed',
        title:       'Verification issue found',
        description: 'One or more identity verifications could not be confirmed',
        severity:    'warning',
        payload:     { score: score.score },
      }).catch(() => { /* best-effort */ })
    }
    // No timeline entry for clean evaluations — silence is the signal.
  }

  private async fetchDocumentVerifications(
    supabase: SupabaseClient,
    input:    TrustIntelligenceInput,
  ): Promise<VerificationResult[]> {
    // Resolve the session via the draft profile linked to this employee
    const { data: draft } = await supabase
      .from('draft_employee_profiles')
      .select('session_id')
      .eq('linked_employee_id', input.employee_id)
      .eq('tenant_id', input.tenant_id)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle()

    if (!draft?.session_id) return []

    const { data: docs } = await supabase
      .from('onboarding_documents')
      .select('id, document_type, extraction_status, created_at:uploaded_at')
      .eq('session_id', draft.session_id)
      .eq('tenant_id', input.tenant_id)

    if (!docs || docs.length === 0) return []

    const now = new Date().toISOString()

    return (docs as any[]).map(doc => {
      const status = extractionStatusToVerification(doc.extraction_status)
      const flags  = status === 'failed' ? ['extraction_failed'] : []
      return {
        verification_type: 'document',
        status,
        entity_id:         input.employee_id,
        entity_type:       'employee',
        tenant_id:            input.tenant_id,
        verified_at:       doc.created_at ?? now,
        score:             status === 'verified' ? 85 : status === 'partial_match' ? 50 : 0,
        flags,
      } satisfies VerificationResult
    })
  }
}

function extractionStatusToVerification(
  extractionStatus: string | null | undefined,
): VerificationResult['status'] {
  switch (extractionStatus) {
    case 'completed': return 'verified'
    case 'partial':   return 'partial_match'
    case 'failed':    return 'failed'
    case 'pending':
    case 'processing': return 'pending'
    default:           return 'skipped'
  }
}

export const trustIntelligenceService = new TrustIntelligenceService()
