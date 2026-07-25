/**
 * LeaveLedgerService
 *
 * Single authoritative read/write surface for all leave balance operations.
 *
 * BACKGROUND — why two ledger tables exist:
 *   leave_accrual_ledger   — Engine 3 (leave-jobs.ts) and Engine 2 credits.
 *                            Supports held-credits, expiry, release triggers.
 *   leave_balance_ledger   — Engine 1 (accrual-engine.ts) event-sourced grants,
 *                            manual adjustments, encashment, opening balances.
 *
 * Callers should use this service instead of querying either table directly.
 * This isolates the dual-ledger complexity and provides a unified balance view.
 *
 * Exported surface:
 *   LedgerEntry        — canonical read shape (normalised across both tables)
 *   getBalanceSummary  — net consumable balance for one employee+leave_type
 *   getLedgerHistory   — full audit trail (both tables, merged and sorted)
 *   creditAccrualLedger — write to leave_accrual_ledger (Engine 3 path)
 *   creditBalanceLedger — write to leave_balance_ledger (Engine 1 / event path)
 *   debitLeaveRequest  — record a leave debit against the appropriate ledger
 */

import type { SupabaseClient } from '@supabase/supabase-js'

// ── Canonical read shape ───────────────────────────────────────────────────────

export type LedgerSource = 'accrual_ledger' | 'balance_ledger'

export type LedgerEntryType =
  | 'accrual'
  | 'opening_balance'
  | 'manual_grant'
  | 'debit'
  | 'encashment'
  | 'lapse'
  | 'carry_forward'
  | 'correction'
  | 'release'

export interface LedgerEntry {
  id:                       string
  source:                   LedgerSource
  entry_type:               LedgerEntryType
  employee_id:              string
  leave_type_id:            string
  days:                     number
  /** Positive = credit; negative = debit */
  net_days:                 number
  effective_date:           string     // YYYY-MM-DD — when this entry takes effect
  reference_id:             string | null   // leave_request_id, revision_id, etc.
  reference_type:           string | null   // 'leave_request' | 'revision' | 'manual' | etc.
  notes:                    string | null
  /** Null or future date = not yet consumable (held credit) */
  consumption_eligible_from: string | null
  /** Whether this credit has lapsed / been marked expired */
  is_expired:               boolean
  created_at:               string
}

/** Aggregated balance for a single employee + leave type */
export interface BalanceSummary {
  employee_id:           string
  leave_type_id:         string
  total_accrued:         number   // sum of all credit entries (both ledgers)
  total_debited:         number   // sum of all debit entries
  held_credits:          number   // credits not yet consumable (future eligible_from)
  lapsed_credits:        number   // expired entries
  net_consumable:        number   // total_accrued - total_debited - held_credits - lapsed_credits
  ledger_sources_used:   LedgerSource[]
}

// ── Internal helpers ───────────────────────────────────────────────────────────

/**
 * Normalise a leave_accrual_ledger row to LedgerEntry shape.
 */
function normaliseAccrualRow(row: Record<string, unknown>): LedgerEntry {
  const days = Number(row.days ?? 0)
  // The accrual ledger only has credit rows; debits are separate rows with negative days
  const isDebit = days < 0
  return {
    id:                       row.id as string,
    source:                   'accrual_ledger',
    entry_type:               isDebit ? 'debit' : (row.release_trigger === 'opening' ? 'opening_balance' : 'accrual'),
    employee_id:              row.employee_id as string,
    leave_type_id:            row.leave_type_id as string,
    days:                     Math.abs(days),
    net_days:                 days,
    effective_date:           (row.effective_date ?? row.created_at) as string,
    reference_id:             (row.leave_request_id ?? row.revision_id ?? null) as string | null,
    reference_type:           row.leave_request_id ? 'leave_request'
                              : row.revision_id    ? 'revision'
                              : null,
    notes:                    (row.notes ?? null) as string | null,
    consumption_eligible_from: (row.consumption_eligible_from ?? null) as string | null,
    is_expired:               Boolean(row.is_expired),
    created_at:               row.created_at as string,
  }
}

/**
 * Normalise a leave_balance_ledger row to LedgerEntry shape.
 */
function normaliseBalanceRow(row: Record<string, unknown>): LedgerEntry {
  const type     = (row.entry_type ?? row.transaction_type ?? 'accrual') as string
  const days     = Number(row.days ?? row.days_delta ?? 0)
  const isDebit  = days < 0 || type === 'debit' || type === 'leave_taken' || type === 'encashment'
  return {
    id:                       row.id as string,
    source:                   'balance_ledger',
    entry_type:               (type as LedgerEntryType) ?? (isDebit ? 'debit' : 'accrual'),
    employee_id:              row.employee_id as string,
    leave_type_id:            row.leave_type_id as string,
    days:                     Math.abs(days),
    net_days:                 isDebit ? -Math.abs(days) : Math.abs(days),
    effective_date:           (row.effective_date ?? row.created_at) as string,
    reference_id:             (row.leave_request_id ?? row.reference_id ?? null) as string | null,
    reference_type:           row.leave_request_id ? 'leave_request' : (row.reference_type ?? null) as string | null,
    notes:                    (row.notes ?? row.reason ?? null) as string | null,
    consumption_eligible_from: null,
    is_expired:               false,
    created_at:               row.created_at as string,
  }
}

// ── Exported read functions ────────────────────────────────────────────────────

/**
 * Get aggregated balance summary for an employee + leave type.
 *
 * Reads both ledger tables and combines them into a single coherent view.
 * `asOf` is today by default — held credits beyond this date are excluded
 * from net_consumable.
 */
export async function getBalanceSummary(
  supabase:      SupabaseClient,
  tenantId:      string,
  employeeId:    string,
  leaveTypeId:   string,
  asOf:          string = new Date().toISOString().slice(0, 10),
): Promise<BalanceSummary> {
  // Query both ledgers in parallel
  const [accrualRes, balanceRes] = await Promise.all([
    supabase
      .from('leave_accrual_ledger')
      .select('id, days, is_expired, consumption_eligible_from, created_at')
      .eq('tenant_id',     tenantId)
      .eq('employee_id',   employeeId)
      .eq('leave_type_id', leaveTypeId),

    supabase
      .from('leave_balance_ledger')
      .select('id, days:delta, entry_type:txn_type, transaction_type:txn_type, days_delta:delta, created_at')
      .eq('tenant_id',     tenantId)
      .eq('employee_id',   employeeId)
      .eq('leave_type_id', leaveTypeId),
  ])

  const accrualRows  = (accrualRes.data  ?? []) as Record<string, unknown>[]
  const balanceRows  = (balanceRes.data  ?? []) as Record<string, unknown>[]

  const sourcesUsed: LedgerSource[] = []
  if (accrualRows.length  > 0) sourcesUsed.push('accrual_ledger')
  if (balanceRows.length  > 0) sourcesUsed.push('balance_ledger')

  let totalAccrued   = 0
  let totalDebited   = 0
  let heldCredits    = 0
  let lapsedCredits  = 0

  for (const row of accrualRows) {
    const days = Number(row.days ?? 0)
    if (row.is_expired) { lapsedCredits += Math.abs(days); continue }
    const eligibleFrom = row.consumption_eligible_from as string | null
    if (eligibleFrom && eligibleFrom > asOf) {
      heldCredits += days
    } else if (days >= 0) {
      totalAccrued += days
    } else {
      totalDebited += Math.abs(days)
    }
  }

  for (const row of balanceRows) {
    const days = Number((row.days ?? row.days_delta) ?? 0)
    const type = ((row.entry_type ?? row.transaction_type) as string) ?? ''
    const isDebit = days < 0 || type === 'debit' || type === 'leave_taken' || type === 'encashment'
    if (isDebit) {
      totalDebited += Math.abs(days)
    } else {
      totalAccrued += Math.abs(days)
    }
  }

  const netConsumable = Math.max(0, totalAccrued - totalDebited - heldCredits)

  return {
    employee_id:         employeeId,
    leave_type_id:       leaveTypeId,
    total_accrued:       totalAccrued,
    total_debited:       totalDebited,
    held_credits:        heldCredits,
    lapsed_credits:      lapsedCredits,
    net_consumable:      netConsumable,
    ledger_sources_used: sourcesUsed,
  }
}

/**
 * Get the full ledger history (audit trail) for an employee + leave type.
 *
 * Reads both ledger tables, normalises rows to LedgerEntry, merges, and
 * returns sorted descending by effective_date (newest first).
 */
export async function getLedgerHistory(
  supabase:    SupabaseClient,
  tenantId:    string,
  employeeId:  string,
  leaveTypeId: string,
  limit        = 100,
  offset       = 0,
): Promise<LedgerEntry[]> {
  const [accrualRes, balanceRes] = await Promise.all([
    supabase
      .from('leave_accrual_ledger')
      .select('*')
      .eq('tenant_id',     tenantId)
      .eq('employee_id',   employeeId)
      .eq('leave_type_id', leaveTypeId),

    supabase
      .from('leave_balance_ledger')
      .select('*')
      .eq('tenant_id',     tenantId)
      .eq('employee_id',   employeeId)
      .eq('leave_type_id', leaveTypeId),
  ])

  const accrualEntries = ((accrualRes.data ?? []) as Record<string, unknown>[]).map(normaliseAccrualRow)
  const balanceEntries = ((balanceRes.data ?? []) as Record<string, unknown>[]).map(normaliseBalanceRow)

  const merged = [...accrualEntries, ...balanceEntries]
  merged.sort((a, b) => b.effective_date.localeCompare(a.effective_date) || b.created_at.localeCompare(a.created_at))

  return merged.slice(offset, offset + limit)
}

/**
 * Get balance summaries for all leave types for one employee.
 * Returns a Map keyed by leave_type_id.
 */
export async function getAllBalancesForEmployee(
  supabase:    SupabaseClient,
  tenantId:    string,
  employeeId:  string,
  asOf:        string = new Date().toISOString().slice(0, 10),
): Promise<Map<string, BalanceSummary>> {
  // Fetch distinct leave_type_ids across both ledgers
  const [accrualRes, balanceRes] = await Promise.all([
    supabase
      .from('leave_accrual_ledger')
      .select('leave_type_id, days, is_expired, consumption_eligible_from')
      .eq('tenant_id',   tenantId)
      .eq('employee_id', employeeId),

    supabase
      .from('leave_balance_ledger')
      .select('leave_type_id, days:delta, entry_type:txn_type, transaction_type:txn_type, days_delta:delta')
      .eq('tenant_id',   tenantId)
      .eq('employee_id', employeeId),
  ])

  const allRows = [
    ...((accrualRes.data ?? []) as Array<{ leave_type_id: string }>),
    ...((balanceRes.data ?? []) as Array<{ leave_type_id: string }>),
  ]
  const leaveTypeIds = [...new Set(allRows.map(r => r.leave_type_id))]

  const summaries = new Map<string, BalanceSummary>()

  // Build summaries concurrently
  await Promise.all(
    leaveTypeIds.map(async ltId => {
      const summary = await getBalanceSummary(supabase, tenantId, employeeId, ltId, asOf)
      summaries.set(ltId, summary)
    }),
  )

  return summaries
}

// ── Exported write functions ───────────────────────────────────────────────────

export interface AccrualCreditOpts {
  tenantId:                 string
  employeeId:               string
  leaveTypeId:              string
  days:                     number
  effectiveDate:            string   // YYYY-MM-DD
  cycleKey:                 string   // deduplication key (e.g. '2026-05')
  policyRuleId:             string
  notes?:                   string
  consumptionEligibleFrom?: string   // if null, immediately consumable
  releaseTrigger?:          string
  createdBy?:               string
}

/**
 * Write a credit to leave_accrual_ledger (Engine 3 / named policy path).
 * Idempotent: if a row with the same (employee_id, leave_type_id, cycle_key)
 * already exists, it is returned without inserting a duplicate.
 */
export async function creditAccrualLedger(
  supabase: SupabaseClient,
  opts:     AccrualCreditOpts,
): Promise<{ id: string; inserted: boolean }> {
  // Check for existing entry with this cycle key (idempotency guard)
  const { data: existing } = await supabase
    .from('leave_accrual_ledger')
    .select('id')
    .eq('tenant_id',     opts.tenantId)
    .eq('employee_id',   opts.employeeId)
    .eq('leave_type_id', opts.leaveTypeId)
    .eq('cycle_key',     opts.cycleKey)
    .maybeSingle()

  if (existing) return { id: (existing as any).id, inserted: false }

  const { data, error } = await supabase
    .from('leave_accrual_ledger')
    .insert({
      tenant_id:                 opts.tenantId,
      employee_id:               opts.employeeId,
      leave_type_id:             opts.leaveTypeId,
      days:                      opts.days,
      accrued_on:                opts.effectiveDate,
      cycle_key:                 opts.cycleKey,
      notes:                     opts.notes ?? null,
      consumption_eligible_from: opts.consumptionEligibleFrom ?? null,
      // 'auto' is not a valid leave_accrual_ledger.release_trigger value (CHECK
      // constraint, migration 159: immediate/cycle_completion/payroll_lock/
      // attendance_confirmation/manual_release) — every insert without an
      // explicit releaseTrigger would fail. 'immediate' matches the documented
      // default meaning of consumptionEligibleFrom being unset.
      release_trigger:           opts.releaseTrigger ?? 'immediate',
      is_expired:                false,
    })
    .select('id')
    .single()

  if (error) {
    throw new Error(`creditAccrualLedger failed for employee ${opts.employeeId}: ${error.message}`)
  }

  return { id: (data as any).id, inserted: true }
}

export interface BalanceCreditOpts {
  tenantId:      string
  employeeId:    string
  leaveTypeId:   string
  days:          number
  entryType:     LedgerEntryType
  effectiveDate: string
  referenceId?:  string
  referenceType?: string
  notes?:        string
  createdBy?:    string
}

/**
 * Write a credit or debit to leave_balance_ledger (Engine 1 / event path).
 * Use for manual grants, opening balances, carry-forwards, and encashment.
 */
export async function creditBalanceLedger(
  supabase: SupabaseClient,
  opts:     BalanceCreditOpts,
): Promise<{ id: string }> {
  const { data, error } = await supabase
    .from('leave_balance_ledger')
    .insert({
      tenant_id:      opts.tenantId,
      employee_id:    opts.employeeId,
      leave_type_id:     opts.leaveTypeId,
      delta:             opts.days,
      txn_type:          opts.entryType,
      leave_request_ref: opts.referenceId ?? null,
      notes:             opts.notes       ?? null,
      created_by:        opts.createdBy   ?? null,
    })
    .select('id')
    .single()

  if (error) {
    throw new Error(`creditBalanceLedger failed for employee ${opts.employeeId}: ${error.message}`)
  }

  return { id: (data as any).id }
}

// ── Hardened write authority (Final Stabilization Pass) ────────────────────────
//
// These three functions are the SOLE authoritative write paths for ledger mutations.
// All scheduler jobs, event engines, replay flows, and reconciliation repairs
// MUST route through these functions — no direct table inserts are permitted elsewhere.

export interface WriteAccrualEntryOpts {
  tenantId:        string
  employeeId:      string
  leaveTypeId:     string
  year:            number
  accrualType:     string
  days:            number
  accruedOn:       string   // YYYY-MM-DD
  expiresOn?:      string | null
  notes?:          string
  /** Deterministic idempotency key. When provided, uses cycle_key upsert path. */
  cycleKey?:       string
  /** UUID shared across all entries in the same job run (audit lineage). */
  lineageId?:      string
  /** Original lineageId when this entry is part of a replay. */
  parentReplayId?: string
  /** Policy snapshot that governed this accrual. */
  snapshotId?:     string
  /** Policy rule ID (required for named-policy path; optional for expiry/adjustment). */
  policyRuleId?:   string
}

/**
 * Single authoritative write to leave_accrual_ledger.
 *
 * Implements the two-path idempotency strategy:
 *   - cycle_key path (preferred): upsert on cycle_key unique index — safe for replay
 *   - legacy path (fallback): upsert on 6-column conflict key — for entries without cycle_key
 *
 * Returns `{ skipped: true }` when a duplicate is safely ignored.
 * Never throws on idempotent duplicate — only throws on unexpected DB errors.
 */
export async function writeAccrualEntry(
  supabase: SupabaseClient,
  opts:     WriteAccrualEntryOpts,
): Promise<{ skipped: boolean }> {
  const hasCycleKey = !!opts.cycleKey

  const payload: Record<string, unknown> = {
    tenant_id:        opts.tenantId,
    employee_id:      opts.employeeId,
    leave_type_id:    opts.leaveTypeId,
    year:             opts.year,
    accrual_type:     opts.accrualType,
    days:             opts.days,
    accrued_on:       opts.accruedOn,
    expires_on:       opts.expiresOn        ?? null,
    notes:            opts.notes            ?? null,
    lineage_id:       opts.lineageId        ?? null,
    parent_replay_id: opts.parentReplayId   ?? null,
    snapshot_id:      opts.snapshotId       ?? null,
    policy_rule_id:   opts.policyRuleId     ?? null,
  }

  if (hasCycleKey) {
    // Pre-check: if a row with this cycle_key already exists, report skipped.
    // This avoids the ambiguity of ignoreDuplicates upsert return counts.
    const { data: existing } = await supabase
      .from('leave_accrual_ledger')
      .select('id')
      .eq('tenant_id',  opts.tenantId)
      .eq('cycle_key',  opts.cycleKey!)
      .maybeSingle()

    if (existing) return { skipped: true }

    payload.cycle_key = opts.cycleKey
    const { error } = await supabase
      .from('leave_accrual_ledger')
      .upsert(payload, { onConflict: 'cycle_key', ignoreDuplicates: true })

    if (error) {
      throw new Error(
        `writeAccrualEntry (cycle_key) failed for employee ${opts.employeeId}: ${error.message}`,
      )
    }

    return { skipped: false }
  } else {
    // Pre-check the composite idempotency key so the caller can tell whether the
    // row already existed — an ignoreDuplicates upsert can't report that, and the
    // accrual jobs rely on it to keep the (non-idempotent) balance cache in step.
    const { data: existing } = await supabase
      .from('leave_accrual_ledger')
      .select('id')
      .eq('tenant_id',     opts.tenantId)
      .eq('employee_id',   opts.employeeId)
      .eq('leave_type_id', opts.leaveTypeId)
      .eq('year',          opts.year)
      .eq('accrual_type',  opts.accrualType)
      .eq('accrued_on',    opts.accruedOn)
      .maybeSingle()

    if (existing) return { skipped: true }

    const { error } = await supabase
      .from('leave_accrual_ledger')
      .upsert(payload, {
        onConflict:       'tenant_id,employee_id,leave_type_id,year,accrual_type,accrued_on',
        ignoreDuplicates: true,
      })

    if (error) {
      throw new Error(
        `writeAccrualEntry (legacy) failed for employee ${opts.employeeId}: ${error.message}`,
      )
    }

    return { skipped: false }
  }
}

export interface WriteBalanceLedgerEntryOpts {
  tenantId:     string
  employeeId:   string
  leaveTypeId:  string
  year:         number
  /** Transaction type (e.g. 'manual_credit', 'expiry', 'carry_forward', etc.) */
  txnType:      string
  /** Signed delta: positive = credit, negative = debit */
  delta:        number
  /** Running balance after this entry */
  balanceAfter: number
  notes?:       string
  lineageId?:   string
  snapshotId?:  string
}

/**
 * Single authoritative write to leave_balance_ledger (event-grant / Engine 1 path).
 *
 * Uses the txn_type/delta/balance_after column pattern (event-sourced ledger).
 * Non-idempotent by design — callers must perform their own idempotency guard
 * (e.g. checking leave_event_grants for existence before calling).
 *
 * Returns the id of the inserted row.
 */
export async function writeBalanceLedgerEntry(
  supabase: SupabaseClient,
  opts:     WriteBalanceLedgerEntryOpts,
): Promise<{ id: string }> {
  const { data, error } = await supabase
    .from('leave_balance_ledger')
    .insert({
      tenant_id:    opts.tenantId,
      employee_id:  opts.employeeId,
      leave_type_id: opts.leaveTypeId,
      year:         opts.year,
      txn_type:     opts.txnType,
      delta:        opts.delta,
      balance_after: opts.balanceAfter,
      notes:        opts.notes      ?? null,
      lineage_id:   opts.lineageId  ?? null,
      snapshot_id:  opts.snapshotId ?? null,
    })
    .select('id')
    .single()

  if (error) {
    throw new Error(
      `writeBalanceLedgerEntry failed for employee ${opts.employeeId}: ${error.message}`,
    )
  }

  return { id: (data as any).id }
}

/**
 * Write a negative adjustment entry to leave_accrual_ledger for expired credits.
 *
 * This is the authoritative path for CO expiry deductions. It does NOT use
 * cycle_key (expiry entries are uniquely identified by accruedOn date + type).
 *
 * The caller is responsible for:
 *   - Updating employee_leave_balance (deducting the days)
 *   - Marking the source ledger rows as is_expired = true
 */
export async function expireAccrualEntry(
  supabase:     SupabaseClient,
  tenantId:     string,
  employeeId:   string,
  leaveTypeId:  string,
  year:         number,
  days:         number,   // positive; stored as negative in ledger
  accruedOn:    string,   // YYYY-MM-DD — the expiry date
  notes?:       string,
  lineageId?:   string,
): Promise<void> {
  await writeAccrualEntry(supabase, {
    tenantId,
    employeeId,
    leaveTypeId,
    year,
    accrualType:  'adjustment',
    days:         -Math.abs(days),   // always stored as negative
    accruedOn,
    notes:        notes ?? `Expiry deduction: ${days} day(s) on ${accruedOn}`,
    lineageId,
  })
}
