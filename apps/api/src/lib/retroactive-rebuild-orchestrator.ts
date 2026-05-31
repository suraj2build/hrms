/**
 * RetroactiveRebuildOrchestrator
 *
 * Orchestration contracts for retroactive module rebuilds.
 *
 * WHAT IT DOES:
 *   When a governance event occurs that affects historical data (retroactive leave
 *   approval, attendance correction, policy back-dated change), this orchestrator:
 *
 *   1. Determines which modules are affected and in what order they must be rebuilt.
 *   2. Creates an entry in retroactive_rebuild_queue with idempotency guarantees.
 *   3. Provides lifecycle management (start, complete, fail, cancel).
 *   4. Does NOT execute the rebuild — that is delegated to each module's own engine.
 *
 * WHAT IT DOES NOT DO (scope guard):
 *   - Does NOT execute attendance recalculation (that's the attendance engine).
 *   - Does NOT execute payroll recalculation (that's the payroll engine).
 *   - Does NOT directly modify balances (that's the ledger service).
 *   - Does NOT re-run accrual jobs (that's the scheduler).
 *
 * REBUILD MODULE ORDER (must be respected):
 *   1. attendance    — attendance_daily records for affected date range
 *   2. leave_balance — leave accrual / deduction replay
 *   3. payroll       — payroll slip recalculation for affected period
 *
 *   This order is enforced because: attendance affects leave balance (LOP),
 *   and leave balance affects payroll (paid vs unpaid days).
 */

import type { SupabaseClient } from '@supabase/supabase-js'

// ── Types ──────────────────────────────────────────────────────────────────────

export type RebuildSourceEventType =
  | 'leave_approved'
  | 'leave_cancelled'
  | 'leave_rejected'
  | 'attendance_correction'
  | 'payroll_adjustment'
  | 'policy_change'
  | 'balance_correction'
  | 'scheduler_recovery'
  | 'replay_requested'
  | 'manual_trigger'

export type RebuildModule = 'attendance' | 'leave_balance' | 'payroll'

export type RebuildStatus =
  | 'pending'
  | 'in_progress'
  | 'completed'
  | 'failed'
  | 'cancelled'
  | 'skipped'

export type RebuildStage = 'attendance' | 'leave_balance' | 'payroll' | 'entitlement' | 'reconciliation'
export type RebuildScope = 'single_day' | 'date_range' | 'full_year' | 'open_ended'

export interface RebuildQueueRow {
  id:                       string
  tenant_id:                string
  source_event_type:        RebuildSourceEventType
  source_event_id:          string
  employee_id:              string | null
  leave_type_id:            string | null
  rebuild_from_date:        string
  rebuild_to_date:          string | null
  affected_modules:         RebuildModule[]
  priority:                 number
  status:                   RebuildStatus
  replay_lineage_id:        string | null
  retry_count:              number
  max_retries:              number
  last_error:               string | null
  idempotency_key:          string | null
  scheduled_at:             string
  started_at:               string | null
  completed_at:             string | null
  created_by:               string | null
  created_at:               string
  updated_at:               string
  // ── Phase 3 orchestration columns (migration 164) ─────────────────────────
  dependency_order:         number
  orchestrator_lineage_id:  string | null
  blocked_by_rebuild_id:    string | null
  rebuild_stage:            RebuildStage | null
  rebuild_scope:            RebuildScope | null
}

export interface EnqueueRebuildOpts {
  tenantId:                   string
  sourceEventType:            RebuildSourceEventType
  sourceEventId:              string
  employeeId?:                string
  leaveTypeId?:               string
  rebuildFromDate:            string         // YYYY-MM-DD — earliest affected date
  rebuildToDate?:             string         // YYYY-MM-DD — latest affected date (null = open)
  /** Override default module list (default: all three, in order) */
  affectedModules?:           RebuildModule[]
  /** 1 = critical, 5 = normal, 10 = background (default: 5) */
  priority?:                  number
  /** Custom idempotency key (default: '{sourceEventType}|{sourceEventId}') */
  idempotencyKey?:            string
  createdBy?:                 string
  // ── Phase 3 orchestration opts (migration 164) ───────────────────────────
  /** Execution order within the chain (1 = first; higher numbers run after) */
  dependencyOrder?:           number
  /** Shared UUID across all rebuilds in one orchestrated chain */
  orchestratorLineageId?:     string
  /** ID of the predecessor rebuild that must complete first */
  blockedByRebuildId?:        string
  /** Which pipeline stage this entry covers */
  rebuildStage?:              RebuildStage
  /** Date span scope classification */
  rebuildScope?:              RebuildScope
}

// ── Module dependency map ──────────────────────────────────────────────────────

/**
 * For each source event type, return the ordered list of modules that MUST
 * be rebuilt and in what order.
 *
 * Order semantics:
 *   attendance before leave_balance — LOP requires attendance data
 *   leave_balance before payroll    — payroll reads balance for LOP calculation
 */
export function getAffectedModulesForEvent(eventType: RebuildSourceEventType): RebuildModule[] {
  switch (eventType) {
    case 'leave_approved':
    case 'leave_cancelled':
    case 'leave_rejected':
      // Leave status change → balance changes → payroll may change (LOP)
      return ['leave_balance', 'payroll']

    case 'attendance_correction':
      // Attendance changes → may affect leave (regularisation) → affects payroll
      return ['attendance', 'leave_balance', 'payroll']

    case 'payroll_adjustment':
      // Direct payroll fix — no upstream deps
      return ['payroll']

    case 'policy_change':
      // Policy change → all downstream entitlements may change
      return ['leave_balance', 'payroll']

    case 'balance_correction':
      // Balance corrected directly → payroll may change
      return ['leave_balance', 'payroll']

    case 'scheduler_recovery':
      // Scheduler missed a cycle → replay accrual → check payroll
      return ['leave_balance', 'payroll']

    case 'replay_requested':
    case 'manual_trigger':
      // Full rebuild
      return ['attendance', 'leave_balance', 'payroll']
  }
}

// ── Scope classification helper ────────────────────────────────────────────────

/**
 * Derive a RebuildScope descriptor from a date range.
 *
 * single_day  — fromDate === toDate
 * open_ended  — toDate is null (rebuild extends to today)
 * full_year   — the range spans ≥ 365 days
 * date_range  — everything else
 */
export function classifyRebuildScope(fromDate: string, toDate?: string | null): RebuildScope {
  if (!toDate) return 'open_ended'
  if (fromDate === toDate) return 'single_day'
  const msPerDay  = 86_400_000
  const spanDays  = (new Date(toDate).getTime() - new Date(fromDate).getTime()) / msPerDay
  if (spanDays >= 365) return 'full_year'
  return 'date_range'
}

// ── Core orchestration functions ───────────────────────────────────────────────

/**
 * Enqueue a rebuild request.
 *
 * Idempotent: if an entry with the same idempotency_key already exists (regardless
 * of status), the existing entry is returned without creating a duplicate.
 *
 * Returns { queued: true, row } on new entry, { queued: false, row } when
 * deduplicated (entry already existed).
 */
export async function enqueueRebuild(
  supabase: SupabaseClient,
  opts:     EnqueueRebuildOpts,
): Promise<{ queued: boolean; row: RebuildQueueRow }> {
  const idempotencyKey = opts.idempotencyKey
    ?? `${opts.sourceEventType}|${opts.sourceEventId}`

  const affectedModules = opts.affectedModules
    ?? getAffectedModulesForEvent(opts.sourceEventType)

  // Check for existing entry (idempotency)
  const { data: existing } = await supabase
    .from('retroactive_rebuild_queue')
    .select('*')
    .eq('tenant_id',       opts.tenantId)
    .eq('idempotency_key', idempotencyKey)
    .maybeSingle()

  if (existing) {
    return { queued: false, row: existing as unknown as RebuildQueueRow }
  }

  const { data, error } = await supabase
    .from('retroactive_rebuild_queue')
    .insert({
      tenant_id:                opts.tenantId,
      source_event_type:        opts.sourceEventType,
      source_event_id:          opts.sourceEventId,
      employee_id:              opts.employeeId               ?? null,
      leave_type_id:            opts.leaveTypeId              ?? null,
      rebuild_from_date:        opts.rebuildFromDate,
      rebuild_to_date:          opts.rebuildToDate            ?? null,
      affected_modules:         affectedModules,
      priority:                 opts.priority                 ?? 5,
      status:                   'pending',
      idempotency_key:          idempotencyKey,
      created_by:               opts.createdBy                ?? null,
      // Phase 3 orchestration fields
      dependency_order:         opts.dependencyOrder          ?? 0,
      orchestrator_lineage_id:  opts.orchestratorLineageId   ?? null,
      blocked_by_rebuild_id:    opts.blockedByRebuildId       ?? null,
      rebuild_stage:            opts.rebuildStage             ?? null,
      rebuild_scope:            opts.rebuildScope             ?? null,
    })
    .select('*')
    .single()

  if (error || !data) {
    // If insert failed due to a race on idempotency_key, fetch the existing row
    if (error?.code === '23505') {
      const { data: raceRow } = await supabase
        .from('retroactive_rebuild_queue')
        .select('*')
        .eq('tenant_id',       opts.tenantId)
        .eq('idempotency_key', idempotencyKey)
        .maybeSingle()
      if (raceRow) return { queued: false, row: raceRow as unknown as RebuildQueueRow }
    }
    throw new Error(`Failed to enqueue rebuild: ${error?.message ?? 'unknown error'}`)
  }

  return { queued: true, row: data as unknown as RebuildQueueRow }
}

/**
 * Mark a rebuild entry as in_progress.
 * Returns false if the entry is not in 'pending' status (prevents double-processing).
 */
export async function markRebuildStarted(
  supabase:         SupabaseClient,
  tenantId:         string,
  queueId:          string,
  replayLineageId?: string,
): Promise<boolean> {
  const { data, error } = await supabase
    .from('retroactive_rebuild_queue')
    .update({
      status:             'in_progress',
      started_at:         new Date().toISOString(),
      replay_lineage_id:  replayLineageId ?? null,
      updated_at:         new Date().toISOString(),
    })
    .eq('id',         queueId)
    .eq('tenant_id',  tenantId)
    .eq('status',     'pending')      // only advance from pending
    .select('id')
    .maybeSingle()

  return !error && !!data
}

/**
 * Mark a rebuild entry as completed.
 */
export async function markRebuildCompleted(
  supabase:  SupabaseClient,
  tenantId:  string,
  queueId:   string,
): Promise<void> {
  await supabase
    .from('retroactive_rebuild_queue')
    .update({
      status:       'completed',
      completed_at: new Date().toISOString(),
      updated_at:   new Date().toISOString(),
    })
    .eq('id',        queueId)
    .eq('tenant_id', tenantId)
}

/**
 * Mark a rebuild entry as failed (with optional error message).
 * Increments retry_count; if max_retries exceeded, status stays 'failed'.
 */
export async function markRebuildFailed(
  supabase:  SupabaseClient,
  tenantId:  string,
  queueId:   string,
  errorMsg:  string,
): Promise<{ willRetry: boolean }> {
  // Fetch current retry state
  const { data: current } = await supabase
    .from('retroactive_rebuild_queue')
    .select('retry_count, max_retries')
    .eq('id',        queueId)
    .eq('tenant_id', tenantId)
    .maybeSingle()

  const retryCount = ((current as any)?.retry_count ?? 0) + 1
  const maxRetries = (current as any)?.max_retries ?? 3
  const willRetry  = retryCount < maxRetries

  await supabase
    .from('retroactive_rebuild_queue')
    .update({
      status:      willRetry ? 'pending' : 'failed',
      retry_count: retryCount,
      last_error:  errorMsg,
      started_at:  null,           // reset so it can be picked up again
      updated_at:  new Date().toISOString(),
    })
    .eq('id',        queueId)
    .eq('tenant_id', tenantId)

  return { willRetry }
}

/**
 * Cancel a pending rebuild entry.
 */
export async function cancelRebuild(
  supabase:  SupabaseClient,
  tenantId:  string,
  queueId:   string,
  reason?:   string,
): Promise<void> {
  await supabase
    .from('retroactive_rebuild_queue')
    .update({
      status:     'cancelled',
      last_error: reason ?? null,
      updated_at: new Date().toISOString(),
    })
    .eq('id',        queueId)
    .eq('tenant_id', tenantId)
    .in('status',    ['pending', 'failed'])  // only cancel non-terminal states
}

/**
 * Get the rebuild status for a source event.
 * Returns null if no rebuild was queued for this event.
 */
export async function getRebuildStatus(
  supabase:       SupabaseClient,
  tenantId:       string,
  sourceEventId:  string,
): Promise<RebuildQueueRow | null> {
  const { data } = await supabase
    .from('retroactive_rebuild_queue')
    .select('*')
    .eq('tenant_id',      tenantId)
    .eq('source_event_id', sourceEventId)
    .order('created_at',  { ascending: false })
    .limit(1)
    .maybeSingle()

  return data ? (data as unknown as RebuildQueueRow) : null
}

/**
 * List all pending rebuild entries for a tenant, ordered by priority then scheduled_at.
 * Used by the background processor to find work to do.
 */
export async function getPendingRebuildQueue(
  supabase:  SupabaseClient,
  tenantId:  string,
  limit      = 50,
): Promise<RebuildQueueRow[]> {
  const { data } = await supabase
    .from('retroactive_rebuild_queue')
    .select('*')
    .eq('tenant_id', tenantId)
    .eq('status',    'pending')
    .order('priority',     { ascending: true })
    .order('scheduled_at', { ascending: true })
    .limit(limit)

  return (data ?? []) as unknown as RebuildQueueRow[]
}

/**
 * Get all rebuild entries for a specific employee (status history).
 * Useful for the admin view to show "what historical corrections were applied".
 */
export async function getEmployeeRebuildHistory(
  supabase:    SupabaseClient,
  tenantId:    string,
  employeeId:  string,
  limit        = 20,
): Promise<RebuildQueueRow[]> {
  const { data } = await supabase
    .from('retroactive_rebuild_queue')
    .select('*')
    .eq('tenant_id',   tenantId)
    .eq('employee_id', employeeId)
    .order('created_at', { ascending: false })
    .limit(limit)

  return (data ?? []) as unknown as RebuildQueueRow[]
}

/**
 * Determine the earliest date that needs rebuilding across all pending entries
 * for an employee. Used by the payroll engine to know "how far back do we need
 * to look when re-running payroll for this employee?"
 */
export async function getEarliestPendingRebuildDate(
  supabase:    SupabaseClient,
  tenantId:    string,
  employeeId:  string,
): Promise<string | null> {
  const { data } = await supabase
    .from('retroactive_rebuild_queue')
    .select('rebuild_from_date')
    .eq('tenant_id',   tenantId)
    .eq('employee_id', employeeId)
    .in('status',      ['pending', 'in_progress'])
    .order('rebuild_from_date', { ascending: true })
    .limit(1)
    .maybeSingle()

  return (data as { rebuild_from_date: string } | null)?.rebuild_from_date ?? null
}
