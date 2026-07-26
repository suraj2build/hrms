/**
 * RegulatoryIngestionService — ingests statutory compliance revision events.
 * Sprint 3: Manual ingestion only (no automatic external feed).
 * IMPORTANT: All revisions start in 'pending_review' status.
 * Human review required before activation.
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import type { ComplianceRevisionEvent } from '../../trust/types/trust-types.js'
import { explainabilityService } from '../../ai/services/explainability.service.js'

export class RegulatoryIngestionService {
  /**
   * Ingest a new compliance revision event.
   * Always starts as 'pending_review' — never auto-activates.
   */
  async ingest(supabase: SupabaseClient, input: Omit<ComplianceRevisionEvent, 'id' | 'ingested_at' | 'status'>): Promise<string | null> {
    const explainability = explainabilityService.explain({
      event_type:  `regulatory.${input.revision_type}.revision`,
      entity_type: 'compliance_rule',
      entity_id:   input.jurisdiction,
      payload:     { old_value: input.old_value, new_value: input.new_value, unit: input.unit },
      severity:    'warning',
      rule_name:   input.title,
    })

    const { data, error } = await supabase
      .from('compliance_revision_events')
      .insert({
        tenant_id:            input.tenant_id ?? null,
        revision_type:     input.revision_type,
        jurisdiction:      input.jurisdiction,
        title:             input.title,
        description:       input.description,
        old_value:         input.old_value ?? null,
        new_value:         input.new_value ?? null,
        unit:              input.unit ?? null,
        effective_from:    input.effective_from,
        source_reference:  input.source_reference ?? null,
        status:            'pending_review',   // ALWAYS starts pending
        ingested_at:       new Date().toISOString(),
        explainability:    explainability,
      })
      .select('id')
      .single()

    if (error) {
      console.warn('[RegulatoryIngestionService] failed to ingest revision', error.message)
      return null
    }
    return (data as any)?.id ?? null
  }

  /**
   * Approve a revision after human review — marks as approved only.
   * Does NOT automatically change benchmarks. Benchmark update is a separate manual step.
   * tenantId scopes the update to revisions visible to the caller's tenant
   * (own tenant_id or platform-wide/null), matching listPending()'s read
   * scope — previously missing entirely, letting any tenant's admin
   * approve/reject another tenant's compliance revision.
   */
  async approve(supabase: SupabaseClient, revisionId: string, reviewedBy: string, tenantId: string): Promise<void> {
    try {
      await supabase
        .from('compliance_revision_events')
        .update({ status: 'approved', reviewed_at: new Date().toISOString(), reviewed_by: reviewedBy })
        .eq('id', revisionId)
        .or(`tenant_id.eq.${tenantId},tenant_id.is.null`)
    } catch {
      // Non-fatal
    }
  }

  /**
   * Reject a revision.
   */
  async reject(supabase: SupabaseClient, revisionId: string, reviewedBy: string, tenantId: string): Promise<void> {
    try {
      await supabase
        .from('compliance_revision_events')
        .update({ status: 'rejected', reviewed_at: new Date().toISOString(), reviewed_by: reviewedBy })
        .eq('id', revisionId)
        .or(`tenant_id.eq.${tenantId},tenant_id.is.null`)
    } catch {
      // Non-fatal
    }
  }

  /**
   * List pending revisions.
   */
  async listPending(supabase: SupabaseClient, tenantId?: string): Promise<ComplianceRevisionEvent[]> {
    let q = supabase
      .from('compliance_revision_events')
      .select('*')
      .eq('status', 'pending_review')
      .order('ingested_at', { ascending: false })

    if (tenantId) {
      q = q.or(`tenant_id.eq.${tenantId},tenant_id.is.null`)
    }

    const { data } = await q
    return (data ?? []) as ComplianceRevisionEvent[]
  }
}

export const regulatoryIngestionService = new RegulatoryIngestionService()
