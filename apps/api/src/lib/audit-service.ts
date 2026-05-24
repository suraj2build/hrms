/**
 * Audit Service — thin wrapper around the existing `audit_logs` table
 * (created in migration 006_audit_logs.sql).
 *
 * Usage:
 *
 *   import { logAction } from '../../lib/audit-service.js'
 *
 *   await logAction(fastify.supabase, {
 *     tenantId:    req.tenantId,
 *     tableName:   'employee_leave_balance',
 *     recordId:    employeeId,          // closest meaningful UUID
 *     action:      'UPDATE',
 *     performedBy: req.userId,
 *     newData:     { balance, year, leave_type_id },
 *   })
 *
 * Errors are intentionally swallowed — the primary operation must already
 * have succeeded before logAction is called.  If the insert fails it logs a
 * warning but never throws.
 */
import type { SupabaseClient } from '@supabase/supabase-js'

type AuditAction = 'INSERT' | 'UPDATE' | 'DELETE'

export interface LogActionOpts {
  tenantId:    string
  tableName:   string
  recordId:    string                      // closest meaningful UUID for the affected record
  action:      AuditAction
  performedBy?: string | null             // userId (profiles.id); null for system actions
  oldData?:    Record<string, unknown> | null
  newData?:    Record<string, unknown> | null
}

/**
 * Write a single audit row.  Non-fatal — errors are swallowed after logging.
 */
export async function logAction(
  supabase: SupabaseClient,
  opts:     LogActionOpts,
): Promise<void> {
  const { tenantId, tableName, recordId, action, performedBy, oldData, newData } = opts

  const { error } = await supabase.from('audit_logs').insert({
    tenant_id:    tenantId,
    table_name:   tableName,
    record_id:    recordId,
    action,
    performed_by: performedBy ?? null,
    old_data:     oldData     ?? null,
    new_data:     newData     ?? null,
  })

  if (error) {
    // Non-fatal — log but do not propagate
    console.warn('[audit-service] Failed to write audit log:', {
      error: error.message,
      tableName,
      recordId,
      action,
    })
  }
}

/**
 * Log a bulk operation that affects many records in one shot.
 * Uses a synthetic UUID derived from tenantId + scope as the record_id
 * (since there is no single row to reference).
 *
 * The `newData` should describe the operation at a high level
 * (e.g. employee_ids count, date range, shift_id).
 */
export async function logBulkAction(
  supabase: SupabaseClient,
  opts: {
    tenantId:    string
    tableName:   string
    action:      AuditAction
    performedBy?: string | null
    summary:     Record<string, unknown>   // high-level description of what changed
  },
): Promise<void> {
  // Use a deterministic-ish record_id by inserting and letting Supabase generate one,
  // but we pass a fixed sentinel UUID since record_id is NOT NULL.
  // Convention: '00000000-0000-0000-0000-000000000000' signals a bulk/batch row.
  const BULK_SENTINEL = '00000000-0000-0000-0000-000000000000'

  const { error } = await supabase.from('audit_logs').insert({
    tenant_id:    opts.tenantId,
    table_name:   opts.tableName,
    record_id:    BULK_SENTINEL,
    action:       opts.action,
    performed_by: opts.performedBy ?? null,
    old_data:     null,
    new_data:     opts.summary,
  })

  if (error) {
    console.warn('[audit-service] Failed to write bulk audit log:', {
      error:     error.message,
      tableName: opts.tableName,
      action:    opts.action,
    })
  }
}
