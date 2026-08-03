/**
 * Shared helpers used by more than one payroll route-file (runs, slips,
 * snapshots, integrity, run-ledgers). Split out of the former monolithic
 * routes/payroll/index.ts so each domain's route file can import only what
 * it needs instead of duplicating these across files.
 */

export const monthRe = /^\d{4}-\d{2}$/

/**
 * checkFreezeGuard — shared helper for payroll write operations.
 *
 * Returns { frozen: true, reason } if the given month is currently frozen
 * (i.e. an unlifted freeze record exists in payroll_freeze_log).
 * Returns { frozen: false } when clear to proceed.
 * Returns { frozen: true, checkFailed: true, reason } when the freeze_log query
 * itself errored — fails CLOSED (ISSUE-147): freeze state could not be verified,
 * so treat the month as frozen rather than silently letting a payroll mutation
 * through on a transient DB error. Callers that use this guard in the OPPOSITE
 * direction (confirming a month IS frozen before an unfreeze/reopen action) must
 * check `checkFailed` explicitly — inheriting `frozen: true` there would flip
 * their `if (!frozen)` gate the wrong way and let the action through unverified.
 *
 * Call before any operation that creates or modifies payroll data for a month.
 */
export async function checkFreezeGuard(
  supabase: any,
  tenantId: string,
  month: string,
): Promise<{ frozen: boolean; reason?: string; checkFailed?: boolean }> {
  const { data, error } = await supabase
    .from('payroll_freeze_log')
    .select('frozen_by, reason')
    .eq('tenant_id', tenantId)
    .eq('freeze_month', month)
    .eq('action', 'freeze')
    .is('unfrozen_at', null)
    .order('frozen_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (error) {
    return {
      frozen:      true,
      checkFailed: true,
      reason:      `Unable to verify payroll freeze status for ${month} — treating as frozen for safety. Please retry; contact support if this persists.`,
    }
  }
  if (data) {
    return {
      frozen: true,
      reason: data.reason ?? `Payroll for ${month} is frozen and cannot be modified`,
    }
  }
  return { frozen: false }
}

/**
 * Append one forensic event to payroll_run_events.
 *
 * This is deliberately non-throwing — forensic logging must never block payroll.
 * Failures are logged to the Fastify logger at warn level.
 */
export async function logRunEvent(
  supabase: any,
  log:      { warn: (obj: unknown, msg: string) => void },
  event: {
    tenant_id:     string
    run_id:        string
    event_type:    string
    employee_id?:  string
    month?:        string
    payload?:      Record<string, unknown>
    error_details?: Record<string, unknown>
  },
): Promise<void> {
  const { error } = await supabase
    .from('payroll_run_events')
    .insert({
      tenant_id:    event.tenant_id,
      run_id:       event.run_id,
      event_type:   event.event_type,
      employee_id:  event.employee_id  ?? null,
      month:        event.month        ?? null,
      payload:      event.payload      ?? null,
      error_details: event.error_details ?? null,
    })

  if (error) {
    log.warn(
      { err: error, event_type: event.event_type, run_id: event.run_id },
      'payroll_run_events: insert failed — forensic event not persisted (payroll continues)',
    )
  }
}

/** Structured breakdown of all per-employee failures in a run — stored in payroll_runs.failure_summary */
export interface FailureSummaryGroup {
  failure_stage:   string
  reason:          string
  count:           number
  employee_codes:  string[]
}

export interface FailureSummary {
  total_failed:    number
  total_employees: number
  dominant_stage:  string
  dominant_reason: string
  groups:          FailureSummaryGroup[]
}
