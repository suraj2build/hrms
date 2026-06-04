/**
 * comp-off-service.ts
 *
 * Single source of truth for generating compensatory-off requests from
 * worked-on-weekly-off / worked-on-holiday attendance. Used by:
 *   - the attendance recompute pipeline (recomputeRange) → AUTOMATIC generation
 *     whenever a worked-off/holiday day is (re)computed
 *   - POST /attendance/comp-off/generate → manual/bulk generation
 *
 * Generation is idempotent: rows conflict on (tenant_id, employee_id, worked_date)
 * and duplicates are ignored, so it is safe to call on every recompute. Each
 * request is created as `pending` — the existing HR approval step (which credits
 * the leave ledger) is unchanged. No direct payroll/net-pay effect.
 */

import type { SupabaseClient } from '@supabase/supabase-js'

export interface CompOffCandidate {
  employee_id:          string
  date:                 string
  worked_on_weekly_off?: boolean | null
  worked_on_holiday?:    boolean | null
  /** Days to credit (0.5 for a half-day worked on off/holiday). Defaults to 1.0. */
  days_to_credit?:      number
}

export interface CompOffGenerationResult {
  created: number
  skipped: number
}

/**
 * Create pending comp_off_requests for the qualifying candidates.
 * Non-qualifying rows (neither worked_on_* flag) are ignored.
 */
export async function generateCompOffRequests(
  supabase:   SupabaseClient,
  tenantId:   string,
  candidates: CompOffCandidate[],
  createdBy:  string | null,
  leaveTypeId?: string | null,
): Promise<CompOffGenerationResult> {
  const qualifying = candidates.filter(c => c.worked_on_weekly_off || c.worked_on_holiday)
  if (qualifying.length === 0) return { created: 0, skipped: 0 }

  const rows = qualifying.map(c => ({
    tenant_id:      tenantId,
    employee_id:    c.employee_id,
    worked_date:    c.date,
    worked_reason:  c.worked_on_holiday ? 'holiday' : 'weekly_off',
    leave_type_id:  leaveTypeId ?? null,
    days_to_credit: c.days_to_credit ?? 1.0,
    status:         'pending',
    created_by:     createdBy,
  }))

  const { data: inserted, error } = await supabase
    .from('comp_off_requests')
    .upsert(rows, { onConflict: 'tenant_id,employee_id,worked_date', ignoreDuplicates: true })
    .select('id')

  if (error) throw new Error(`comp_off generation failed: ${error.message}`)

  const created = (inserted as Array<{ id: string }> | null)?.length ?? 0
  return { created, skipped: rows.length - created }
}
