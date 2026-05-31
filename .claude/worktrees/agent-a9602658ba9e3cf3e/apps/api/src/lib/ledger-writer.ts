/**
 * Ledger Writer — Phase 3 Payroll Traceability
 *
 * Utility to write entries into payroll_explainability_ledger.
 * Called from leave approval, correction approval, payroll computation,
 * and any other handler that impacts payroll for an employee.
 *
 * Non-fatal: failures are swallowed (logged) so the primary operation
 * always succeeds even if ledger writing fails.
 */

import type { SupabaseClient } from '@supabase/supabase-js'

export type LedgerEventType =
  | 'attendance_recomputed'
  | 'correction_approved'
  | 'leave_deducted'
  | 'ot_added'
  | 'policy_changed'
  | 'retro_adjustment'
  | 'payable_days_changed'
  | 'lop_applied'
  | 'payroll_computed'
  | 'payroll_finalized'
  | 'anomaly_resolved'
  | 'manual_note'

export interface LedgerEntry {
  tenant_id:          string
  employee_id:        string
  month:              string               // YYYY-MM
  event_type:         LedgerEventType
  event_description:  string
  impact_type?:       string               // 'lop' | 'deduction' | 'gross_change' | 'ot' | 'net_change'
  impact_amount?:     number
  before_value?:      string
  after_value?:       string
  source_entity_type?: string
  source_entity_id?:  string
  created_by?:        string
}

/**
 * Write a single ledger entry.  Non-fatal — catches and logs all errors.
 */
export async function writeLedgerEntry(
  supabase:  SupabaseClient,
  entry:     LedgerEntry,
  log?:      { warn: (obj: unknown, msg: string) => void },
): Promise<void> {
  try {
    const { error } = await supabase
      .from('payroll_explainability_ledger')
      .insert(entry)
    if (error) {
      log?.warn({ err: error, event_type: entry.event_type }, 'ledger write failed (non-fatal)')
    }
  } catch (err: unknown) {
    log?.warn({ err, event_type: entry.event_type }, 'ledger write exception (non-fatal)')
  }
}

/**
 * Write multiple ledger entries in one insert.  Non-fatal.
 */
export async function writeLedgerEntries(
  supabase:  SupabaseClient,
  entries:   LedgerEntry[],
  log?:      { warn: (obj: unknown, msg: string) => void },
): Promise<void> {
  if (!entries.length) return
  try {
    const { error } = await supabase
      .from('payroll_explainability_ledger')
      .insert(entries)
    if (error) {
      log?.warn({ err: error, count: entries.length }, 'ledger bulk write failed (non-fatal)')
    }
  } catch (err: unknown) {
    log?.warn({ err, count: entries.length }, 'ledger bulk write exception (non-fatal)')
  }
}

// ── Month helpers ─────────────────────────────────────────────────────────────

/** Derive YYYY-MM from a YYYY-MM-DD date string. */
export function dateToMonth(dateStr: string): string {
  return dateStr.slice(0, 7)
}
