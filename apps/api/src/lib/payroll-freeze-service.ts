/**
 * PayrollFreezeService
 *
 * Governance freeze boundaries for payroll periods.
 *
 * WHAT IT DOES:
 *   Manages the `payroll_period_states` table, which provides an orchestration-
 *   level freeze layer ON TOP of the existing `payroll_runs` status machine.
 *
 *   Every period starts as 'open' (implicit — no row needed). As payroll
 *   progresses, explicit rows are created with stricter states:
 *
 *   open               → retroactive rebuilds are fully allowed
 *   payroll_processing → rebuild is queued but execution is deferred
 *   payroll_locked     → retroactive changes require an adjustment workflow
 *   payroll_archived   → audit-only; no mutations permitted
 *
 * WHAT IT DOES NOT DO (scope guard):
 *   - Does NOT recalculate payroll.
 *   - Does NOT modify payroll_runs rows.
 *   - Does NOT block approval workflows.
 *   - Does NOT change existing payroll outputs.
 *   This service only enforces orchestration boundaries.
 *
 * USAGE BY THE ORCHESTRATOR:
 *   Before enqueuing a retroactive rebuild, call checkFreezeConstraint().
 *   The result tells the orchestrator whether to proceed, queue-and-defer, or block.
 */

import type { SupabaseClient } from '@supabase/supabase-js'

// ── Types ──────────────────────────────────────────────────────────────────────

export type PayrollGovernanceState =
  | 'open'
  | 'payroll_processing'
  | 'payroll_locked'
  | 'payroll_archived'

export interface PayrollPeriodStateRow {
  id:                string
  tenant_id:         string
  period_month:      string   // 'YYYY-MM'
  payroll_run_id:    string | null
  governance_state:  PayrollGovernanceState
  locked_at:         string | null
  locked_by:         string | null
  archived_at:       string | null
  notes:             string | null
  created_at:        string
  updated_at:        string
}

export interface PeriodFreezeInfo {
  period_month:     string
  governance_state: PayrollGovernanceState
}

/**
 * Result of checking the freeze constraint for a rebuild date range.
 *
 *   allowed                 — at least one period is open; rebuild can proceed
 *   queuedOnly              — some periods are PAYROLL_PROCESSING; defer execution
 *   requiresAdjustmentWorkflow — some periods are PAYROLL_LOCKED
 *   auditOnly               — some periods are PAYROLL_ARCHIVED; rebuild blocked
 *   blockedPeriods          — the specific locked/archived periods
 *   checkFailed             — the underlying query errored; state could not be
 *                             verified (see checkFreezeConstraint below)
 */
export interface FreezeConstraintResult {
  allowed:                     boolean
  queuedOnly:                  boolean
  requiresAdjustmentWorkflow:  boolean
  auditOnly:                   boolean
  blockedPeriods:              PeriodFreezeInfo[]
  checkFailed?:                boolean
}

// ── Helpers ────────────────────────────────────────────────────────────────────

/** Convert a date string (YYYY-MM-DD) to a period month string ('YYYY-MM'). */
function dateToPeriodMonth(date: string): string {
  return date.slice(0, 7)   // 'YYYY-MM-DD' → 'YYYY-MM'
}

/**
 * Enumerate all 'YYYY-MM' period months between two dates (inclusive).
 * Handles multi-month rebuild ranges.
 */
function enumeratePeriods(fromDate: string, toDate: string): string[] {
  const periods: string[] = []
  const from = new Date(`${fromDate.slice(0, 7)}-01`)
  const to   = new Date(`${toDate.slice(0, 7)}-01`)
  const cur  = new Date(from)
  while (cur <= to) {
    periods.push(cur.toISOString().slice(0, 7))
    cur.setMonth(cur.getMonth() + 1)
  }
  return periods
}

// ── Core service functions ─────────────────────────────────────────────────────

/**
 * Get the governance state for a specific period (tenant + 'YYYY-MM').
 * Returns 'open' if no row exists (default — all periods start as open).
 */
export async function getPayrollPeriodState(
  supabase:     SupabaseClient,
  tenantId:     string,
  periodMonth:  string,   // 'YYYY-MM'
): Promise<PayrollGovernanceState> {
  const { data, error } = await supabase
    .from('payroll_period_states')
    .select('governance_state')
    .eq('tenant_id',    tenantId)
    .eq('period_month', periodMonth)
    .maybeSingle()

  // A query error must not read the same as "no row" (→ 'open') — that would
  // let isRetroactiveAllowed() fail open on a transient DB error against a
  // period that may actually be locked/archived (same class as ISSUE-147's
  // checkFreezeGuard / checkFreezeConstraint's fail-closed handling above).
  if (error) throw new Error(`Failed to read payroll period state for ${periodMonth}: ${error.message}`)

  return (data as { governance_state: PayrollGovernanceState } | null)?.governance_state ?? 'open'
}

/**
 * Retrieve the full payroll_period_states row for a period.
 * Returns null if no row exists (period is implicitly 'open').
 */
export async function getPayrollPeriodStateRow(
  supabase:     SupabaseClient,
  tenantId:     string,
  periodMonth:  string,
): Promise<PayrollPeriodStateRow | null> {
  const { data, error } = await supabase
    .from('payroll_period_states')
    .select('*')
    .eq('tenant_id',    tenantId)
    .eq('period_month', periodMonth)
    .maybeSingle()

  if (error) throw new Error(`Failed to read payroll period state row for ${periodMonth}: ${error.message}`)

  return data ? (data as unknown as PayrollPeriodStateRow) : null
}

/**
 * Get or create a payroll_period_states row.
 * Idempotent — returns the existing row if already created.
 */
export async function getOrCreatePayrollPeriod(
  supabase:     SupabaseClient,
  tenantId:     string,
  periodMonth:  string,
  payrollRunId?: string,
): Promise<PayrollPeriodStateRow> {
  const existing = await getPayrollPeriodStateRow(supabase, tenantId, periodMonth)
  if (existing) return existing

  const { data, error } = await supabase
    .from('payroll_period_states')
    .insert({
      tenant_id:        tenantId,
      period_month:     periodMonth,
      payroll_run_id:   payrollRunId ?? null,
      governance_state: 'open',
    })
    .select('*')
    .single()

  if (error || !data) {
    // Handle race — another request may have inserted first
    if (error?.code === '23505') {
      const row = await getPayrollPeriodStateRow(supabase, tenantId, periodMonth)
      if (row) return row
    }
    throw new Error(`Failed to create payroll period state for ${periodMonth}: ${error?.message}`)
  }

  return data as unknown as PayrollPeriodStateRow
}

/**
 * Transition a payroll period to a new governance state.
 *
 * Valid transitions:
 *   open → payroll_processing → payroll_locked → payroll_archived
 *
 * Attempts to regress the state (e.g. locked → open) are rejected by returning
 * false. The orchestrator must not attempt to revert freeze states.
 *
 * Returns true on success, false if the transition was invalid OR if the
 * governance_state changed concurrently between the read and the write
 * (the update's WHERE clause is scoped to the state just read, so a
 * concurrent transition wins the race cleanly instead of being overwritten).
 */
export async function transitionPayrollPeriod(
  supabase:     SupabaseClient,
  tenantId:     string,
  periodMonth:  string,
  newState:     PayrollGovernanceState,
  lockedBy?:    string,
  notes?:       string,
): Promise<boolean> {
  const stateOrder: Record<PayrollGovernanceState, number> = {
    'open':               0,
    'payroll_processing': 1,
    'payroll_locked':     2,
    'payroll_archived':   3,
  }

  const row = await getOrCreatePayrollPeriod(supabase, tenantId, periodMonth)
  const currentOrder = stateOrder[row.governance_state]
  const targetOrder  = stateOrder[newState]

  if (targetOrder <= currentOrder) {
    // Regression or no-op — reject silently
    return false
  }

  const updates: Record<string, unknown> = {
    governance_state: newState,
    updated_at:       new Date().toISOString(),
    notes:            notes ?? null,
  }

  if (newState === 'payroll_locked' || newState === 'payroll_processing') {
    updates.locked_at = new Date().toISOString()
    updates.locked_by = lockedBy ?? null
  }

  if (newState === 'payroll_archived') {
    updates.archived_at = new Date().toISOString()
  }

  // Fold the state we validated against into the UPDATE's own WHERE clause —
  // otherwise two concurrent transitions can each read the same starting
  // state, both pass the regression check above, and the second writer's
  // last-write-wins update could silently regress the governance state
  // (e.g. an automatic archive racing an admin lock).
  const { data: updated, error } = await supabase
    .from('payroll_period_states')
    .update(updates)
    .eq('tenant_id',        tenantId)
    .eq('period_month',     periodMonth)
    .eq('governance_state', row.governance_state)
    .select('id')
    .maybeSingle()

  if (error) throw new Error(`Failed to transition payroll period ${periodMonth} to ${newState}: ${error.message}`)

  // No row matched → governance_state changed concurrently since the read
  // above; the transition lost the race and must not be reported as applied.
  return !!updated
}

/**
 * Check whether retroactive rebuilds are allowed for a date range.
 *
 * Queries payroll_period_states for all months in [fromDate, toDate].
 * Periods with no row are implicitly 'open'.
 *
 * The most restrictive state across all affected periods determines the result:
 *   All open              → { allowed: true, queuedOnly: false, ... }
 *   Any payroll_processing → { allowed: true, queuedOnly: true, ... }
 *   Any payroll_locked     → { allowed: false, requiresAdjustmentWorkflow: true }
 *   Any payroll_archived   → { allowed: false, auditOnly: true }
 */
export async function checkFreezeConstraint(
  supabase:   SupabaseClient,
  tenantId:   string,
  fromDate:   string,
  toDate?:    string | null,
): Promise<FreezeConstraintResult> {
  const effectiveTo = toDate ?? new Date().toISOString().slice(0, 10)
  const periods     = enumeratePeriods(fromDate, effectiveTo)

  if (periods.length === 0) {
    return { allowed: true, queuedOnly: false, requiresAdjustmentWorkflow: false, auditOnly: false, blockedPeriods: [] }
  }

  // Fetch all rows for the affected periods in one query
  const { data: rows, error } = await supabase
    .from('payroll_period_states')
    .select('period_month, governance_state')
    .eq('tenant_id', tenantId)
    .in('period_month', periods)

  if (error) {
    // Fail CLOSED: freeze state could not be verified, so treat as blocked
    // rather than silently letting a retroactive rebuild through against a
    // period that may actually be locked/archived (same class of bug as
    // ISSUE-147's checkFreezeGuard — a transient DB error must never read
    // as "no periods are frozen").
    console.error(
      'payroll-freeze-service: checkFreezeConstraint query failed — failing closed',
      { tenantId, fromDate, toDate: effectiveTo, error: error.message },
    )
    return {
      allowed: false, queuedOnly: false, requiresAdjustmentWorkflow: false,
      auditOnly: false, blockedPeriods: [], checkFailed: true,
    }
  }

  // Build a map — periods not in the response are 'open'
  const stateMap = new Map<string, PayrollGovernanceState>(
    (rows ?? []).map((r: any) => [r.period_month, r.governance_state as PayrollGovernanceState]),
  )

  const blockedPeriods: PeriodFreezeInfo[] = []
  let hasProcessing  = false
  let hasLocked      = false
  let hasArchived    = false

  for (const period of periods) {
    const state = stateMap.get(period) ?? 'open'
    if (state === 'payroll_processing') {
      hasProcessing = true
      blockedPeriods.push({ period_month: period, governance_state: state })
    } else if (state === 'payroll_locked') {
      hasLocked = true
      blockedPeriods.push({ period_month: period, governance_state: state })
    } else if (state === 'payroll_archived') {
      hasArchived = true
      blockedPeriods.push({ period_month: period, governance_state: state })
    }
  }

  // Most restrictive constraint wins
  if (hasArchived) {
    return {
      allowed: false,
      queuedOnly: false,
      requiresAdjustmentWorkflow: false,
      auditOnly: true,
      blockedPeriods,
    }
  }

  if (hasLocked) {
    return {
      allowed: false,
      queuedOnly: false,
      requiresAdjustmentWorkflow: true,
      auditOnly: false,
      blockedPeriods,
    }
  }

  if (hasProcessing) {
    return {
      allowed: true,
      queuedOnly: true,
      requiresAdjustmentWorkflow: false,
      auditOnly: false,
      blockedPeriods,
    }
  }

  // All periods open
  return {
    allowed: true,
    queuedOnly: false,
    requiresAdjustmentWorkflow: false,
    auditOnly: false,
    blockedPeriods: [],
  }
}

/**
 * Convenience: check whether a single period allows retroactive mutations.
 * Returns detailed object indicating what is and isn't allowed.
 */
export async function isRetroactiveAllowed(
  supabase:     SupabaseClient,
  tenantId:     string,
  periodMonth:  string,
): Promise<{ allowed: boolean; requiresAdjustmentWorkflow: boolean; auditOnly: boolean }> {
  let state: PayrollGovernanceState
  try {
    state = await getPayrollPeriodState(supabase, tenantId, periodMonth)
  } catch {
    // Fail CLOSED — see checkFreezeConstraint's fail-closed handling above.
    return { allowed: false, requiresAdjustmentWorkflow: false, auditOnly: false }
  }
  return {
    allowed:                    state === 'open' || state === 'payroll_processing',
    requiresAdjustmentWorkflow: state === 'payroll_locked',
    auditOnly:                  state === 'payroll_archived',
  }
}

/**
 * List all periods for a tenant that are in a non-open state.
 * Useful for displaying freeze status in the HR admin UI.
 */
export async function listFrozenPeriods(
  supabase:  SupabaseClient,
  tenantId:  string,
  limit      = 24,
): Promise<PayrollPeriodStateRow[]> {
  const { data } = await supabase
    .from('payroll_period_states')
    .select('*')
    .eq('tenant_id', tenantId)
    .neq('governance_state', 'open')
    .order('period_month', { ascending: false })
    .limit(limit)

  return (data ?? []) as unknown as PayrollPeriodStateRow[]
}
