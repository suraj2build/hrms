/**
 * LeaveReplayEngine — Read-only Historical Reconstruction
 *
 * Reconstructs leave balance state deterministically from stored ledger events.
 *
 * IMMUTABILITY GUARANTEE:
 *   This engine performs NO writes. It reads existing ledger entries, accrual
 *   records, and policy snapshots and reconstructs what the balance was (or would
 *   be) at any point in time.
 *
 * PRIMARY USE CASES:
 *   1. Payroll dispute: "What was this employee's EL balance on 2025-03-15?"
 *   2. Retroactive correction validation: "After approving this past leave,
 *      what does the reconstructed balance become?"
 *   3. Reconciliation: "Does the stored balance match the replay-reconstructed
 *      balance?" (Drift = inconsistency requiring correction)
 *   4. Audit export: complete event trace for an employee
 *   5. Scheduler recovery: was this accrual cycle already written?
 *
 * ARCHITECTURE:
 *   The engine reads both ledger tables (leave_accrual_ledger + leave_balance_ledger)
 *   and produces a unified event timeline from which it computes running balances.
 *   It does NOT use the stored employee_leave_balance table — that table is the
 *   denormalized projection that this engine validates.
 */

import type { SupabaseClient }     from '@supabase/supabase-js'
import { getSnapshot, findLatestSnapshotAsOf } from './leave-policy-snapshot-service.js'

// ── Types ──────────────────────────────────────────────────────────────────────

export interface ReplayEvent {
  id:              string
  source:          'accrual_ledger' | 'balance_ledger'
  event_date:      string     // YYYY-MM-DD — when this event took effect
  event_type:      string     // accrual_type or transaction_type
  delta:           number     // positive = credit, negative = debit
  running_balance: number     // accumulated balance at this point in the timeline
  cycle_key:       string | null
  lineage_id:      string | null
  snapshot_id:     string | null
  is_expired:      boolean
  notes:           string | null
  created_at:      string
}

export interface ReplayResult {
  employee_id:            string
  leave_type_id:          string
  as_of:                  string
  reconstructed_balance:  number   // net consumable balance at asOf
  total_credited:         number
  total_debited:          number
  held_credits:           number   // credits not yet consumable
  lapsed_credits:         number   // credits that expired
  event_count:            number
  events:                 ReplayEvent[]
  cycle_keys_seen:        string[] // for scheduler deduplication checks
  warnings:               string[]
}

export interface ReplayDriftResult {
  employee_id:            string
  leave_type_id:          string
  year:                   number
  as_of:                  string
  reconstructed_balance:  number
  stored_balance:         number
  drift:                  number   // reconstructed - stored; 0 = consistent
  drift_pct:              number   // |drift| / stored * 100 (for relative magnitude)
  drift_tolerance:        number   // within tolerance = not an error
  is_drifted:             boolean
  drift_detail:           string
}

export interface CycleOwnershipResult {
  cycle_key:    string
  exists:       boolean
  entry_id:     string | null
  lineage_id:   string | null
  written_at:   string | null
  days:         number
}

// ── Helpers ────────────────────────────────────────────────────────────────────

const DRIFT_TOLERANCE = 0.05   // ±0.05 days is floating-point rounding noise

function toDateOnly(s: string): string {
  return s.slice(0, 10)
}

// ── Core reconstruction ────────────────────────────────────────────────────────

/**
 * Reconstruct the leave balance for an employee + leave type as of `asOf`.
 *
 * Reads ALL ledger events (both tables) up to and including `asOf`, sorts them
 * into a unified timeline, and computes a running balance.
 *
 * @param supabase     — Supabase client (read-only operations only)
 * @param tenantId     — tenant scope
 * @param employeeId   — employee to replay for
 * @param leaveTypeId  — leave type to replay
 * @param asOf         — YYYY-MM-DD; events after this date are excluded
 * @param includeEvents — whether to include the full event list in result (expensive for large spans)
 */
export async function replayBalanceAsOf(
  supabase:       SupabaseClient,
  tenantId:       string,
  employeeId:     string,
  leaveTypeId:    string,
  asOf:           string,
  includeEvents   = false,
): Promise<ReplayResult> {
  const warnings: string[] = []

  // ── Read both ledger tables concurrently ──────────────────────────────────
  const [accrualRes, balanceRes] = await Promise.all([
    supabase
      .from('leave_accrual_ledger')
      .select('id, days, accrual_type, accrued_on, is_expired, consumption_eligible_from, cycle_key, lineage_id, snapshot_id, notes, created_at')
      .eq('tenant_id',     tenantId)
      .eq('employee_id',   employeeId)
      .eq('leave_type_id', leaveTypeId)
      .lte('accrued_on',   asOf)
      .order('accrued_on', { ascending: true })
      .order('created_at', { ascending: true }),

    supabase
      .from('leave_balance_ledger')
      .select('id, delta, txn_type, entry_type:txn_type, transaction_type:txn_type, days:delta, effective_date:created_at, created_at, lineage_id, snapshot_id, notes')
      .eq('tenant_id',     tenantId)
      .eq('employee_id',   employeeId)
      .eq('leave_type_id', leaveTypeId)
      .order('created_at', { ascending: true }),
  ])

  const accrualRows  = (accrualRes.data  ?? []) as Record<string, unknown>[]
  const balanceRows  = (balanceRes.data  ?? []) as Record<string, unknown>[]

  // ── Normalise into unified event list ────────────────────────────────────
  const events: ReplayEvent[] = []

  for (const row of accrualRows) {
    const days      = Number(row.days ?? 0)
    const eventDate = (row.accrued_on as string) ?? toDateOnly(row.created_at as string)
    events.push({
      id:              row.id as string,
      source:          'accrual_ledger',
      event_date:      eventDate,
      event_type:      row.accrual_type as string,
      delta:           days,
      running_balance: 0,  // filled in below
      cycle_key:       (row.cycle_key   as string | null) ?? null,
      lineage_id:      (row.lineage_id  as string | null) ?? null,
      snapshot_id:     (row.snapshot_id as string | null) ?? null,
      is_expired:      Boolean(row.is_expired),
      notes:           (row.notes as string | null) ?? null,
      created_at:      row.created_at as string,
    })
  }

  for (const row of balanceRows) {
    // balance_ledger may use delta, days, or days_delta depending on version
    const days      = Number((row.delta ?? row.days ?? row.days_delta) ?? 0)
    const eventType = ((row.txn_type ?? row.entry_type ?? row.transaction_type) as string) ?? 'unknown'
    const eventDate = (row.effective_date as string) ?? toDateOnly(row.created_at as string)

    // Only include events on or before asOf
    if (eventDate > asOf) continue

    events.push({
      id:              row.id as string,
      source:          'balance_ledger',
      event_date:      eventDate,
      event_type:      eventType,
      delta:           days,
      running_balance: 0,
      cycle_key:       null,
      lineage_id:      (row.lineage_id  as string | null) ?? null,
      snapshot_id:     (row.snapshot_id as string | null) ?? null,
      is_expired:      false,
      notes:           (row.notes as string | null) ?? null,
      created_at:      row.created_at as string,
    })
  }

  // Sort by event_date, then created_at (deterministic ordering)
  events.sort((a, b) => {
    const dateComp = a.event_date.localeCompare(b.event_date)
    if (dateComp !== 0) return dateComp
    return a.created_at.localeCompare(b.created_at)
  })

  // ── Compute running balance and aggregate stats ───────────────────────────
  let running       = 0
  let totalCredited = 0
  let totalDebited  = 0
  let heldCredits   = 0
  let lapsedCredits = 0
  const cycleKeysSeen: string[] = []

  for (const ev of events) {
    // Expired credits: count separately, exclude from running balance
    if (ev.is_expired && ev.delta > 0) {
      lapsedCredits += ev.delta
      ev.running_balance = running  // expired — no change to running
      continue
    }

    // Held credits (consumable in the future — as of asOf, not yet available)
    // From accrual_ledger: check consumption_eligible_from
    const row = accrualRows.find(r => r.id === ev.id)
    const eligibleFrom = row ? (row.consumption_eligible_from as string | null) : null
    if (eligibleFrom && eligibleFrom > asOf && ev.delta > 0) {
      heldCredits += ev.delta
      ev.running_balance = running  // held — not yet consumable
      continue
    }

    running += ev.delta

    if (ev.delta > 0) totalCredited += ev.delta
    else              totalDebited  += Math.abs(ev.delta)

    ev.running_balance = running

    if (ev.cycle_key) cycleKeysSeen.push(ev.cycle_key)
  }

  if (running < 0) {
    warnings.push(`Reconstructed balance is negative (${running.toFixed(2)} days) — may indicate unapproved deductions or policy errors.`)
  }

  if (accrualRows.length === 0 && balanceRows.length === 0) {
    warnings.push('No ledger entries found for this employee + leave type. Balance reconstructed as 0.')
  }

  return {
    employee_id:           employeeId,
    leave_type_id:         leaveTypeId,
    as_of:                 asOf,
    reconstructed_balance: Math.max(0, running),  // floor at 0 for consumable balance
    total_credited:        totalCredited,
    total_debited:         totalDebited,
    held_credits:          heldCredits,
    lapsed_credits:        lapsedCredits,
    event_count:           events.length,
    events:                includeEvents ? events : [],
    cycle_keys_seen:       [...new Set(cycleKeysSeen)],
    warnings,
  }
}

/**
 * Validate whether the replay-reconstructed balance matches the stored balance.
 *
 * A drift > DRIFT_TOLERANCE indicates an inconsistency that requires investigation
 * (missed write, partial rollback, manual DB edit, or unprocessed deduction).
 */
export async function validateReconstructedVsStored(
  supabase:     SupabaseClient,
  tenantId:     string,
  employeeId:   string,
  leaveTypeId:  string,
  year:         number,
  asOf:         string = new Date().toISOString().slice(0, 10),
): Promise<ReplayDriftResult> {
  // Reconstruct from ledger
  const replay = await replayBalanceAsOf(supabase, tenantId, employeeId, leaveTypeId, asOf)

  // Fetch stored balance
  const { data: balRow } = await supabase
    .from('employee_leave_balance')
    .select('balance')
    .eq('tenant_id',     tenantId)
    .eq('employee_id',   employeeId)
    .eq('leave_type_id', leaveTypeId)
    .eq('year',          year)
    .maybeSingle()

  const storedBalance = (balRow as { balance: number } | null)?.balance ?? 0
  const drift         = parseFloat((replay.reconstructed_balance - storedBalance).toFixed(4))
  const isDrifted     = Math.abs(drift) > DRIFT_TOLERANCE

  return {
    employee_id:           employeeId,
    leave_type_id:         leaveTypeId,
    year,
    as_of:                 asOf,
    reconstructed_balance: replay.reconstructed_balance,
    stored_balance:        storedBalance,
    drift,
    drift_pct:             storedBalance > 0 ? Math.abs(drift / storedBalance) * 100 : 0,
    drift_tolerance:       DRIFT_TOLERANCE,
    is_drifted:            isDrifted,
    drift_detail:          isDrifted
      ? `Stored=${storedBalance}, Reconstructed=${replay.reconstructed_balance}, Δ=${drift}`
      : 'No drift detected',
  }
}

/**
 * Check whether a specific accrual cycle has already been written for an employee.
 *
 * Used by the scheduler for deterministic cycle ownership verification:
 * "Before running the May 2026 accrual for employee X, verify it hasn't been run."
 *
 * @param cycleKey — the deterministic key for this cycle (matches leave_accrual_ledger.cycle_key)
 */
export async function checkCycleOwnership(
  supabase:    SupabaseClient,
  tenantId:    string,
  employeeId:  string,
  leaveTypeId: string,
  cycleKey:    string,
): Promise<CycleOwnershipResult> {
  const { data, error } = await supabase
    .from('leave_accrual_ledger')
    .select('id, lineage_id, created_at, days')
    .eq('tenant_id',     tenantId)
    .eq('employee_id',   employeeId)
    .eq('leave_type_id', leaveTypeId)
    .eq('cycle_key',     cycleKey)
    .maybeSingle()

  if (error) {
    return { cycle_key: cycleKey, exists: false, entry_id: null, lineage_id: null, written_at: null, days: 0 }
  }

  if (!data) {
    return { cycle_key: cycleKey, exists: false, entry_id: null, lineage_id: null, written_at: null, days: 0 }
  }

  const row = data as any
  return {
    cycle_key:   cycleKey,
    exists:      true,
    entry_id:    row.id,
    lineage_id:  row.lineage_id ?? null,
    written_at:  row.created_at,
    days:        Number(row.days ?? 0),
  }
}

/**
 * Reconstruct the full entitlement event timeline for an employee + leave type
 * within a date range. Returns events sorted chronologically with running balances.
 *
 * Useful for audit exports and dispute resolution.
 */
export async function reconstructEntitlementHistory(
  supabase:     SupabaseClient,
  tenantId:     string,
  employeeId:   string,
  leaveTypeId:  string,
  fromDate:     string,  // YYYY-MM-DD
  toDate:       string,  // YYYY-MM-DD
): Promise<ReplayEvent[]> {
  // Replay as of toDate with full events included
  const result = await replayBalanceAsOf(
    supabase, tenantId, employeeId, leaveTypeId, toDate, true,
  )

  // Filter to the requested range
  return result.events.filter(ev => ev.event_date >= fromDate && ev.event_date <= toDate)
}

/**
 * Batch drift validation across all leave types for an employee.
 * Returns only drifted types (those with |drift| > DRIFT_TOLERANCE).
 */
export async function detectBalanceDrift(
  supabase:    SupabaseClient,
  tenantId:    string,
  employeeId:  string,
  year:        number,
  asOf:        string = new Date().toISOString().slice(0, 10),
): Promise<ReplayDriftResult[]> {
  // Find all leave types with ledger entries for this employee
  const [accrualRes, balanceRes] = await Promise.all([
    supabase
      .from('leave_accrual_ledger')
      .select('leave_type_id')
      .eq('tenant_id',   tenantId)
      .eq('employee_id', employeeId)
      .eq('year',        year),
    supabase
      .from('leave_balance_ledger')
      .select('leave_type_id')
      .eq('tenant_id',   tenantId)
      .eq('employee_id', employeeId),
  ])

  const leaveTypeIds = [
    ...new Set([
      ...((accrualRes.data ?? []) as Array<{ leave_type_id: string }>).map(r => r.leave_type_id),
      ...((balanceRes.data ?? []) as Array<{ leave_type_id: string }>).map(r => r.leave_type_id),
    ]),
  ]

  const driftResults = await Promise.all(
    leaveTypeIds.map(ltId =>
      validateReconstructedVsStored(supabase, tenantId, employeeId, ltId, year, asOf),
    ),
  )

  return driftResults.filter(r => r.is_drifted)
}

/**
 * Verify that re-running a scheduler cycle (replay) would NOT produce duplicate
 * ledger entries. Returns a list of cycle keys that already exist.
 *
 * Call this BEFORE any replay write to enforce idempotency at the orchestration
 * level (in addition to the DB-level unique index).
 */
export async function checkReplaySafety(
  supabase:     SupabaseClient,
  tenantId:     string,
  employeeId:   string,
  leaveTypeId:  string,
  cycleKeys:    string[],
): Promise<{ safe: boolean; alreadyWritten: string[]; missing: string[] }> {
  if (cycleKeys.length === 0) return { safe: true, alreadyWritten: [], missing: [] }

  const { data } = await supabase
    .from('leave_accrual_ledger')
    .select('cycle_key')
    .eq('tenant_id',     tenantId)
    .eq('employee_id',   employeeId)
    .eq('leave_type_id', leaveTypeId)
    .in('cycle_key',     cycleKeys)

  const written    = ((data ?? []) as Array<{ cycle_key: string }>).map(r => r.cycle_key)
  const writtenSet = new Set(written)
  const missing    = cycleKeys.filter(k => !writtenSet.has(k))

  return {
    safe:          written.length === 0,
    alreadyWritten: written,
    missing,
  }
}

/**
 * Retrieve the policy snapshot that governed a specific ledger entry.
 * Returns null if the entry predates snapshot infrastructure or has no snapshot.
 */
export async function getSnapshotForLedgerEntry(
  supabase:     SupabaseClient,
  tenantId:     string,
  ledgerEntryId: string,
  source:       'accrual_ledger' | 'balance_ledger',
): Promise<Record<string, unknown> | null> {
  const table = source === 'accrual_ledger' ? 'leave_accrual_ledger' : 'leave_balance_ledger'

  const { data: entry } = await supabase
    .from(table)
    .select('snapshot_id')
    .eq('id', ledgerEntryId)
    .maybeSingle()

  const snapshotId = (entry as { snapshot_id: string | null } | null)?.snapshot_id
  if (!snapshotId) return null

  const snapshot = await getSnapshot(supabase, tenantId, snapshotId)
  return snapshot?.policy_snapshot ?? null
}
