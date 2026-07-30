/**
 * DuplicateDetectorService — detects suspicious workforce duplication.
 * Uses SHA-256 hashes — no raw PAN/account numbers stored.
 * PASSIVE ONLY — alerts only, never mutates records.
 */
import { createHash } from 'crypto'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { DuplicateDetectionResult, DuplicateType } from '../types/trust-types.js'
import { explainabilityService } from '../../ai/services/explainability.service.js'
import { fetchAllRows } from '../../../lib/supabase-paginate.js'

function hash(value: string): string {
  return createHash('sha256').update(value.trim().toLowerCase()).digest('hex')
}

export class DuplicateDetectorService {
  /**
   * Check if a PAN is used by multiple employees in the same tenant.
   * Returns detection result if duplicate found, null otherwise.
   */
  async detectDuplicatePan(supabase: SupabaseClient, params: {
    pan:         string
    employee_id: string
    tenant_id:   string
  }): Promise<DuplicateDetectionResult | null> {
    const { data, error } = await supabase
      .from('employee_bank_statutory')
      .select('employee_id, pan_number')
      .eq('tenant_id', params.tenant_id)
      .eq('pan_number', params.pan.toUpperCase().trim())
      .neq('employee_id', params.employee_id)

    // A query failure must not be indistinguishable from "no duplicate
    // found" — this is a passive fraud-detection signal, and silently
    // treating an error as "clean" inflates the trust score by omission.
    if (error) throw error
    if (!data || data.length === 0) return null

    return this.buildResult('pan', params.employee_id, 'employee', params.tenant_id,
      (data as any[]).map((r: any) => r.employee_id as string),
      hash(params.pan), 'high')
  }

  /**
   * Check if a bank account is shared across employees.
   */
  async detectDuplicateBank(supabase: SupabaseClient, params: {
    account_number: string
    employee_id:    string
    tenant_id:      string
  }): Promise<DuplicateDetectionResult | null> {
    // Match on normalized account number (remove spaces/dashes)
    const normalized = params.account_number.replace(/[\s\-]/g, '')
    // Account numbers are masked in the DB, so this can't be filtered
    // server-side — it must scan every other employee's row for this tenant
    // and match client-side. Paginated so a large tenant doesn't silently
    // miss duplicate-account matches past PostgREST's 1000-row cap.
    // A fetchAllRows() failure must propagate, not be treated as "no
    // duplicate found" — see detectDuplicatePan()'s comment above.
    const data = await fetchAllRows<any>((from, to) =>
      supabase
        .from('employee_bank_statutory')
        .select('employee_id, account_number')
        .eq('tenant_id', params.tenant_id)
        .neq('employee_id', params.employee_id)
        .range(from, to),
    )

    // Client-side normalize match (DB stores masked values)
    const matches = (data as any[]).filter(r =>
      r.account_number && r.account_number.replace(/[\s\-x]/gi, '').endsWith(
        normalized.slice(-4)
      )
    )

    if (matches.length === 0) return null

    return this.buildResult('bank_account', params.employee_id, 'employee', params.tenant_id,
      matches.map(r => r.employee_id as string),
      hash(normalized), 'high')
  }

  /**
   * Check if a phone number is shared across employees.
   */
  async detectDuplicatePhone(supabase: SupabaseClient, params: {
    phone:       string
    employee_id: string
    tenant_id:   string
  }): Promise<DuplicateDetectionResult | null> {
    const normalized = params.phone.replace(/[\s\-\+]/g, '')

    // Match on normalized phone number, not the raw stored value — the
    // same number can be entered as "+91 98765 43210" or "9876543210" and
    // both should be flagged. Also paginated (employees is a table known to
    // exceed 1,000 rows at enterprise scale), so a large tenant doesn't
    // silently miss duplicate-phone matches past PostgREST's 1000-row cap.
    // A fetchAllRows() failure must propagate, not be treated as "no
    // duplicate found" — see detectDuplicatePan()'s comment above.
    const data = await fetchAllRows<any>((from, to) =>
      supabase
        .from('employees')
        .select('id, phone')
        .eq('tenant_id', params.tenant_id)
        .neq('id', params.employee_id)
        .not('phone', 'is', null)
        .range(from, to),
    )

    const matches = (data as any[]).filter(r =>
      r.phone && r.phone.replace(/[\s\-\+]/g, '') === normalized
    )

    if (matches.length === 0) return null

    return this.buildResult('phone', params.employee_id, 'employee', params.tenant_id,
      matches.map(r => r.id as string),
      hash(normalized), 'warning')
  }

  private buildResult(
    type: DuplicateType,
    entityId: string,
    entityType: string,
    orgId: string,
    matchingIds: string[],
    valueHash: string,
    severity: 'warning' | 'high' | 'critical'
  ): DuplicateDetectionResult {
    return {
      duplicate_type:      type,
      entity_id:           entityId,
      entity_type:         entityType,
      tenant_id:              orgId,
      matching_entity_ids: matchingIds,
      value_hash:          valueHash,
      severity,
      detected_at:         new Date().toISOString(),
      explainability: explainabilityService.explain({
        event_type:  `duplicate.${type}`,
        entity_type: entityType,
        entity_id:   entityId,
        payload:     { duplicate_count: matchingIds.length, severity },
        severity,
      }),
    }
  }
}

export const duplicateDetectorService = new DuplicateDetectorService()
