/**
 * AttendanceStateService
 *
 * Authoritative attendance processing lifecycle state layer.
 *
 * WHAT IT DOES:
 *   Manages the `attendance_processing_states` table, which tracks the
 *   lifecycle state of each employee × date's attendance data. This state
 *   determines what retroactive operations are permissible:
 *
 *   raw            — unprocessed; full mutation allowed
 *   reconstructed  — computed/corrected; mutation requires re-computation
 *   finalized      — attendance confirmed for the period; requires unlock
 *   payroll_locked — the containing payroll period is locked
 *   frozen         — immutable; no mutations permitted
 *   replay_pending — a rebuild is in-flight; data is temporarily unstable
 *
 * WHAT IT DOES NOT DO (scope guard):
 *   - Does NOT recalculate attendance.
 *   - Does NOT modify attendance_daily rows.
 *   - Does NOT change shift/roster/punch logic.
 *   - ONLY manages the state machine that governs mutation permissions.
 *
 * VALID STATE TRANSITIONS:
 *   raw            → reconstructed | replay_pending
 *   reconstructed  → finalized | replay_pending
 *   finalized      → payroll_locked | replay_pending
 *   payroll_locked → frozen
 *   replay_pending → raw   (reset for full recompute)
 *   frozen         → (terminal — no further transitions)
 */

import type { SupabaseClient }        from '@supabase/supabase-js'
import type { PayrollPeriodStateRow }  from './payroll-freeze-service.js'

// ── Types ──────────────────────────────────────────────────────────────────────

export type AttendanceProcessingState =
  | 'raw'
  | 'reconstructed'
  | 'finalized'
  | 'payroll_locked'
  | 'frozen'
  | 'replay_pending'

export interface AttendanceProcessingStateRow {
  id:                       string
  tenant_id:                string
  employee_id:              string
  work_date:                string   // YYYY-MM-DD
  state:                    AttendanceProcessingState
  state_reason:             string | null
  payroll_period_state_id:  string | null
  orchestrator_lineage_id:  string | null
  transitioned_at:          string
  created_at:               string
  updated_at:               string
}

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

// ── Core service functions ─────────────────────────────────────────────────────

/**
 * Get the processing state for one employee × date.
 * Returns 'raw' if no row exists (default — new dates start as raw).
 */
export async function getAttendanceState(
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
 * Get processing states for an employee across a date range.
 * Returns a Map<date, state> — dates not in the map are implicitly 'raw'.
 */
export async function getAttendanceStateBulk(
  supabase:    SupabaseClient,
  tenantId:    string,
  employeeId:  string,
  fromDate:    string,
  toDate:      string,
): Promise<Map<string, AttendanceProcessingState>> {
  const { data } = await supabase
    .from('attendance_processing_states')
    .select('work_date, state')
    .eq('tenant_id',   tenantId)
    .eq('employee_id', employeeId)
    .gte('work_date',  fromDate)
    .lte('work_date',  toDate)

  const result = new Map<string, AttendanceProcessingState>()
  for (const row of (data ?? []) as { work_date: string; state: AttendanceProcessingState }[]) {
    result.set(row.work_date, row.state)
  }
  return result
}

/**
 * Get the full state row for one employee × date.
 * Returns null if no row exists (date is implicitly 'raw').
 */
export async function getAttendanceStateRow(
  supabase:    SupabaseClient,
  tenantId:    string,
  employeeId:  string,
  workDate:    string,
): Promise<AttendanceProcessingStateRow | null> {
  const { data } = await supabase
    .from('attendance_processing_states')
    .select('*')
    .eq('tenant_id',   tenantId)
    .eq('employee_id', employeeId)
    .eq('work_date',   workDate)
    .maybeSingle()

  return data ? (data as unknown as AttendanceProcessingStateRow) : null
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
export async function transitionAttendanceState(
  supabase:       SupabaseClient,
  tenantId:       string,
  employeeId:     string,
  workDate:       string,
  newState:       AttendanceProcessingState,
  reason?:        string,
  lineageId?:     string,
  payrollPeriodStateId?: string,
): Promise<boolean> {
  const currentState = await getAttendanceState(supabase, tenantId, employeeId, workDate)

  // Check terminal state
  if (currentState === 'frozen') return false

  // Validate transition
  const allowed = VALID_TRANSITIONS[currentState]
  if (!allowed.includes(newState)) return false

  const now = new Date().toISOString()

  await supabase
    .from('attendance_processing_states')
    .upsert({
      tenant_id:                tenantId,
      employee_id:              employeeId,
      work_date:                workDate,
      state:                    newState,
      state_reason:             reason                ?? null,
      orchestrator_lineage_id:  lineageId             ?? null,
      payroll_period_state_id:  payrollPeriodStateId  ?? null,
      transitioned_at:          now,
      updated_at:               now,
    }, {
      onConflict: 'tenant_id,employee_id,work_date',
    })

  return true
}

/**
 * Check whether a date is eligible for replay (retroactive reconstruction).
 * Dates in 'frozen' or 'payroll_locked' state are NOT eligible.
 */
export async function isReplayEligible(
  supabase:    SupabaseClient,
  tenantId:    string,
  employeeId:  string,
  workDate:    string,
): Promise<boolean> {
  const state = await getAttendanceState(supabase, tenantId, employeeId, workDate)
  return state !== 'frozen' && state !== 'payroll_locked'
}

/**
 * Check whether retroactive mutation is allowed on a date.
 * Only 'raw' and 'reconstructed' states permit free mutations.
 * 'finalized' requires unlock, 'payroll_locked' requires adjustment workflow.
 */
export async function isMutableForRetroactive(
  supabase:    SupabaseClient,
  tenantId:    string,
  employeeId:  string,
  workDate:    string,
): Promise<{ mutable: boolean; state: AttendanceProcessingState; requiresUnlock: boolean }> {
  const state = await getAttendanceState(supabase, tenantId, employeeId, workDate)
  return {
    mutable:        state === 'raw' || state === 'reconstructed' || state === 'replay_pending',
    state,
    requiresUnlock: state === 'finalized' || state === 'payroll_locked',
  }
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

/**
 * Lock a date range for payroll (transition to payroll_locked).
 * Called when a payroll period is locked.
 *
 * Only 'finalized' dates can be locked — others are skipped (must be finalized first).
 * Returns the number of dates successfully locked.
 */
export async function lockDateRangeForPayroll(
  supabase:              SupabaseClient,
  tenantId:              string,
  employeeId:            string,
  fromDate:              string,
  toDate:                string,
  payrollPeriodStateId?: string,
  lineageId?:            string,
): Promise<number> {
  const dates = buildDateRange(fromDate, toDate)
  let locked = 0

  for (const date of dates) {
    const ok = await transitionAttendanceState(
      supabase, tenantId, employeeId, date,
      'payroll_locked', 'Payroll period locked', lineageId, payrollPeriodStateId,
    )
    if (ok) locked++
  }

  return locked
}

/**
 * Get the count of dates in each state for an employee in a date range.
 * Useful for the orchestrator to understand rebuild scope.
 */
export async function getStateSummary(
  supabase:    SupabaseClient,
  tenantId:    string,
  employeeId:  string,
  fromDate:    string,
  toDate:      string,
): Promise<Record<AttendanceProcessingState, number>> {
  const stateMap = await getAttendanceStateBulk(supabase, tenantId, employeeId, fromDate, toDate)
  const dates    = buildDateRange(fromDate, toDate)

  const counts: Record<string, number> = {
    raw: 0, reconstructed: 0, finalized: 0,
    payroll_locked: 0, frozen: 0, replay_pending: 0,
  }

  for (const date of dates) {
    const state = stateMap.get(date) ?? 'raw'
    counts[state] = (counts[state] ?? 0) + 1
  }

  return counts as Record<AttendanceProcessingState, number>
}

/**
 * Find all dates in a range that are in a specific state.
 * Useful for the orchestrator to identify which dates need rebuilding.
 */
export async function getDatesInState(
  supabase:    SupabaseClient,
  tenantId:    string,
  employeeId:  string,
  fromDate:    string,
  toDate:      string,
  targetState: AttendanceProcessingState,
): Promise<string[]> {
  const { data } = await supabase
    .from('attendance_processing_states')
    .select('work_date')
    .eq('tenant_id',   tenantId)
    .eq('employee_id', employeeId)
    .eq('state',       targetState)
    .gte('work_date',  fromDate)
    .lte('work_date',  toDate)
    .order('work_date', { ascending: true })

  return ((data ?? []) as { work_date: string }[]).map(r => r.work_date)
}
