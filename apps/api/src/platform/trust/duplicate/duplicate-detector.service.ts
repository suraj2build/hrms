/**
 * DuplicateDetectorService — detects suspicious workforce duplication.
 * Uses SHA-256 hashes — no raw PAN/account numbers stored.
 * PASSIVE ONLY — alerts only, never mutates records.
 */
import { createHash } from 'crypto'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { DuplicateDetectionResult, DuplicateType } from '../types/trust-types.js'
import { explainabilityService } from '../../ai/services/explainability.service.js'

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

    if (error || !data || data.length === 0) return null

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
    const { data, error } = await supabase
      .from('employee_bank_statutory')
      .select('employee_id, account_number')
      .eq('tenant_id', params.tenant_id)
      .neq('employee_id', params.employee_id)

    if (error || !data) return null

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
    const { data, error } = await supabase
      .from('employees')
      .select('id, phone')
      .eq('tenant_id', params.tenant_id)
      .neq('id', params.employee_id)
      .eq('phone', params.phone)

    if (error || !data || data.length === 0) return null

    return this.buildResult('phone', params.employee_id, 'employee', params.tenant_id,
      (data as any[]).map(r => r.id as string),
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
