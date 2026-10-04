/**
 * AttendanceStateService
 *
 * Tracks the lifecycle state of each employee × date's attendance data in
 * the `attendance_processing_states` table.
 *
 * The only wired-up entry point is `markDateRangeAsReplayPending()`, called
 * by `workforce-orchestrator.ts` before enqueuing an attendance rebuild.
 * Nothing else in the codebase reads or gates on this state machine —
 * earlier revisions of this file documented `payroll_locked`/`frozen` as
 * enforced preconditions on retroactive mutation, but no call site ever
 * checked them before writing. That claim has been removed; if that
 * enforcement is built later, reintroduce the read/check helpers
 * (`getAttendanceState`, `isMutableForRetroactive`, etc. — see git history)
 * alongside their real call sites rather than speculatively.
 *
 * VALID STATE TRANSITIONS:
 *   raw            → reconstructed | replay_pending
 *   reconstructed  → finalized | replay_pending
 *   finalized      → payroll_locked | replay_pending
 *   payroll_locked → frozen
 *   replay_pending → raw   (reset for full recompute)
 *   frozen         → (terminal — no further transitions)
 */

import type { SupabaseClient } from '@supabase/supabase-js'

// ── Types ──────────────────────────────────────────────────────────────────────

export type AttendanceProcessingState =
  | 'raw'
  | 'reconstructed'
  | 'finalized'
  | 'payroll_locked'
  | 'frozen'
  | 'replay_pending'

// State machine — maps each state to the states it can validly transition INTO
const VALID_TRANSITIONS: Record<AttendanceProcessingState, AttendanceProcessingState[]> = {
  raw:             ['reconstructed', 'replay_pending'],
  reconstructed:   ['finalized',     'replay_pending'],
  finalized:       ['payroll_locked', 'replay_pending'],
  payroll_locked:  ['frozen'],
  replay_pending:  ['raw'],     // reset to raw for recompute
  frozen:          [],          // terminal state
}

// ── Helpers ────────────────────────────────────────────────────────────────────

function buildDateRange(fromDate: string, toDate: string): string[] {
  const dates: string[] = []
  const cur  = new Date(`${fromDate}T00:00:00Z`)
  const end  = new Date(`${toDate}T00:00:00Z`)
  while (cur <= end) {
    dates.push(cur.toISOString().slice(0, 10))
    cur.setUTCDate(cur.getUTCDate() + 1)
  }
  return dates
}

/**
 * Get the processing state for one employee × date.
 * Returns 'raw' if no row exists (default — new dates start as raw).
 */
async function getAttendanceState(
  supabase:    SupabaseClient,
  tenantId:    string,
  employeeId:  string,
  workDate:    string,   // YYYY-MM-DD
): Promise<AttendanceProcessingState> {
  const { data, error } = await supabase
    .from('attendance_processing_states')
    .select('state')
    .eq('tenant_id',   tenantId)
    .eq('employee_id', employeeId)
    .eq('work_date',   workDate)
    .maybeSingle()
  // A query error must not be conflated with "no row" (→ 'raw') — a date
  // that's actually 'frozen'/'payroll_locked' (terminal, no transitions
  // allowed) would then pass VALID_TRANSITIONS checks as if it were a
  // brand-new date, bypassing the state machine's terminal-state guard.
  if (error) throw error

  return (data as { state: AttendanceProcessingState } | null)?.state ?? 'raw'
}

/**
 * Transition a single date's processing state.
 *
 * Validates the transition is legal per the state machine.
 * Creates the row if it doesn't exist (upsert semantics).
 *
 * Returns true on success, false if the transition is invalid or the date
 * is in 'frozen' state (permanent terminal state).
 */
async function transitionAttendanceState(
  supabase:       SupabaseClient,
  tenantId:       string,
  employeeId:     string,
  workDate:       string,
  newState:       AttendanceProcessingState,
  reason?:        string,
  lineageId?:     string,
): Promise<boolean> {
  const currentState = await getAttendanceState(supabase, tenantId, employeeId, workDate)

  // Check terminal state
  if (currentState === 'frozen') return false

  // Validate transition
  const allowed = VALID_TRANSITIONS[currentState]
  if (!allowed.includes(newState)) return false

  const now = new Date().toISOString()
  const payload = {
    tenant_id:                tenantId,
    employee_id:              employeeId,
    work_date:                workDate,
    state:                    newState,
    state_reason:             reason    ?? null,
    orchestrator_lineage_id:  lineageId ?? null,
    transitioned_at:          now,
    updated_at:               now,
  }

  // Fold the state we validated against into the UPDATE's own WHERE clause —
  // otherwise two concurrent transitions can each read the same starting
  // state and the second writer's blind upsert would silently overwrite
  // whatever the first writer committed (e.g. reverting a 'frozen' row back
  // to 'payroll_locked').
  const { data: updated, error: updateErr } = await supabase
    .from('attendance_processing_states')
    .update(payload)
    .eq('tenant_id',   tenantId)
    .eq('employee_id', employeeId)
    .eq('work_date',   workDate)
    .eq('state',       currentState)
    .select('id')
    .maybeSingle()
  if (updateErr) throw new Error(`transitionAttendanceState: update failed: ${updateErr.message}`)
  if (updated) return true

  // No existing row matched the guarded UPDATE. If currentState was the
  // implicit 'raw' default (no row yet), insert one — ignoreDuplicates
  // guards against a concurrent writer having inserted first, in which case
  // this correctly reports the race as lost rather than double-applying.
  if (currentState === 'raw') {
    const { data: inserted, error: insertErr } = await supabase
      // lint-tenant-ok: payload already carries tenant_id (built above as { tenant_id: tenantId, ... }) and onConflict is keyed on tenant_id — upsert is tenant-scoped even though the literal isn't inline in this query chain
      .from('attendance_processing_states')
      .upsert(payload, { onConflict: 'tenant_id,employee_id,work_date', ignoreDuplicates: true })
      .select('id')
    if (insertErr) throw new Error(`transitionAttendanceState: insert failed: ${insertErr.message}`)
    return !!inserted?.length
  }

  // A row existed but its state changed concurrently since our read above.
  return false
}

/**
 * Mark a date range as replay_pending.
 * Called by the orchestrator before enqueuing an attendance rebuild.
 *
 * Skips dates that are already 'frozen' (cannot be replayed).
 * Returns the number of dates successfully transitioned.
 */
export async function markDateRangeAsReplayPending(
  supabase:    SupabaseClient,
  tenantId:    string,
  employeeId:  string,
  fromDate:    string,
  toDate:      string,
  lineageId?:  string,
): Promise<number> {
  const dates = buildDateRange(fromDate, toDate)
  let transitioned = 0

  for (const date of dates) {
    const ok = await transitionAttendanceState(
      supabase, tenantId, employeeId, date,
      'replay_pending', 'Retroactive rebuild queued', lineageId,
    )
    if (ok) transitioned++
  }

  return transitioned
}
