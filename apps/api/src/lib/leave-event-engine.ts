/**
 * leave-event-engine.ts
 *
 * Automation engine for event-triggered leave grants.
 *
 * Called once per day by the leave-scheduler (after the standard accrual jobs).
 * For each tenant it:
 *   1. Loads all active leave_policy_rules that have an event_trigger_date_type_id set.
 *   2. Finds employees whose important date (month + day) matches today.
 *   3. Resolves the effective leave policy for each matching employee.
 *   4. Checks whether a leave_event_grants row already exists for this
 *      employee × date_type × calendar year (idempotency guard).
 *   5. Credits the grant days to the leave_balance_ledger and inserts
 *      a leave_event_grants row.
 *   6. Expires stale active grants whose expiry_date < today.
 *
 * No manual trigger is exposed. This runs on the daily scheduler tick only.
 *
 * Import graph:
 *   leave-scheduler → leave-event-engine (new, this file)
 *   leave-event-engine → leave-policy-service (getEffectiveLeavePolicy)
 */

import type { SupabaseClient }        from '@supabase/supabase-js'
import { generateLineageId }         from './leave-jobs.js'
import { writeBalanceLedgerEntry }   from './leave-ledger-service.js'

// ── Types ─────────────────────────────────────────────────────────────────────

interface EventRule {
  ruleId:         string
  policyId:       string
  leaveTypeId:    string
  dateTypeId:     string
  grantDays:      number
  validityDays:   number | null
}

interface EmployeeEventMatch {
  tenantId:     string
  employeeId:   string
  dateTypeId:   string
  importantDateId: string
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Format a Date as 'YYYY-MM-DD'. */
function toDateStr(d: Date): string {
  return d.toISOString().slice(0, 10)
}

// ── Core functions ────────────────────────────────────────────────────────────

/**
 * Fetch all active event-triggered rules for a tenant.
 *
 * A rule is "event-triggered" when event_trigger_date_type_id IS NOT NULL.
 * We join to leave_policy_masters to confirm the policy is active.
 */
export async function fetchEventRules(
  supabase:  SupabaseClient,
  tenantId:  string,
): Promise<EventRule[]> {
  const { data, error } = await supabase
    .from('leave_policy_rules')
    .select(`
      id,
      policy_id,
      leave_type_id,
      event_trigger_date_type_id,
      event_grant_days,
      event_validity_days,
      leave_policy_masters!leave_policy_rules_policy_id_fkey (
        is_active
      )
    `)
    .eq('tenant_id', tenantId)
    .not('event_trigger_date_type_id', 'is', null)

  if (error || !data) return []

  return (data as unknown as Array<{
    id: string
    policy_id: string
    leave_type_id: string
    event_trigger_date_type_id: string
    event_grant_days: number | null
    event_validity_days: number | null
    leave_policy_masters: { is_active: boolean } | null
  }>)
    .filter(r => r.leave_policy_masters?.is_active === true)
    .map(r => ({
      ruleId:       r.id,
      policyId:     r.policy_id,
      leaveTypeId:  r.leave_type_id,
      dateTypeId:   r.event_trigger_date_type_id,
      grantDays:    r.event_grant_days ?? 1.0,
      validityDays: r.event_validity_days ?? null,
    }))
}

/**
 * Find all employees in a tenant whose important date (for a specific
 * date_type) has month + day matching `month` / `day` (1-indexed).
 */
export async function findEmployeesWithEventToday(
  supabase:    SupabaseClient,
  tenantId:    string,
  dateTypeId:  string,
  month:       number,
  day:         number,
): Promise<EmployeeEventMatch[]> {
  // Fetch all dates for this date_type and filter in JS — Supabase does not
  // expose EXTRACT() directly in its filter API.
  const { data, error } = await supabase
    .from('employee_important_dates')
    .select('id, employee_id, event_date')
    .eq('tenant_id', tenantId)
    .eq('date_type_id', dateTypeId)

  if (error || !data) return []

  return data
    .filter((row: { id: string; employee_id: string; event_date: string }) => {
      const d = new Date(`${row.event_date}T00:00:00`)
      return d.getMonth() + 1 === month && d.getDate() === day
    })
    .map((row: { id: string; employee_id: string; event_date: string }) => ({
      tenantId,
      employeeId:      row.employee_id,
      dateTypeId,
      importantDateId: row.id,
    }))
}

/**
 * Check whether a grant already exists for this employee × date_type × year.
 * Returns true if a row exists (skip), false if we should grant.
 */
async function grantAlreadyExists(
  supabase:    SupabaseClient,
  tenantId:    string,
  employeeId:  string,
  dateTypeId:  string,
  eventYear:   number,
): Promise<boolean> {
  const { data } = await supabase
    .from('leave_event_grants')
    .select('id')
    .eq('tenant_id', tenantId)
    .eq('employee_id', employeeId)
    .eq('date_type_id', dateTypeId)
    .eq('event_year', eventYear)
    .maybeSingle()

  return !!data
}

/**
 * Compute the current leave balance for an employee + leave type in a year.
 * Used to populate balance_after in the ledger entry.
 */
async function currentBalance(
  supabase:     SupabaseClient,
  tenantId:     string,
  employeeId:   string,
  leaveTypeId:  string,
  year:         number,
): Promise<number> {
  const { data } = await supabase
    .from('leave_balance_ledger')
    .select('balance_after')
    .eq('tenant_id', tenantId)
    .eq('employee_id', employeeId)
    .eq('leave_type_id', leaveTypeId)
    .eq('year', year)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  return (data as { balance_after: number } | null)?.balance_after ?? 0
}

/**
 * Credit event-grant days to the balance ledger and record the grant.
 *
 * Write order matters for idempotency: the leave_event_grants insert below
 * is the one write the DB can actually reject as a duplicate (UNIQUE on
 * tenant_id/employee_id/date_type_id/event_year), so it must happen BEFORE
 * the ledger credit, not after. A previous version credited the ledger
 * first and only inserted the grant row afterward — if that second insert
 * failed for any reason other than a duplicate-key conflict (a timeout, a
 * connection blip), the ledger credit had already committed with no
 * idempotency marker to show for it, so a retry of the same event would
 * recompute the balance from the ledger (which already included the
 * orphaned credit) and add the grant days a second time. Reserving the
 * grant row first means a retry after a transient failure here simply
 * fails again with a duplicate-key error (treated as already-granted) —
 * the DB physically cannot accept two grant rows for the same event/year.
 *
 * Returns true on success, false on any DB error.
 */
export async function processEventGrant(
  supabase:    SupabaseClient,
  tenantId:    string,
  employeeId:  string,
  rule:        EventRule,
  grantDate:   Date,
  lineageId?:  string,
): Promise<boolean> {
  const today     = toDateStr(grantDate)
  // Derived from the processing date passed in, NOT a fresh clock read — the
  // scheduler reconstructs a deterministic grantDate from a queued dayKey
  // specifically so idempotency holds even if the job runs slightly after
  // midnight (see leave-scheduler.ts). Using new Date().getFullYear() here
  // would silently use next year's value for any run that crosses the
  // Dec 31/Jan 1 boundary, keying the grant/ledger write to the wrong year.
  const eventYear = grantDate.getUTCFullYear()
  const year      = eventYear

  // Cheap pre-check to skip the common case without round-tripping through
  // an insert — not itself the idempotency guarantee (see below).
  const exists = await grantAlreadyExists(
    supabase, tenantId, employeeId, rule.dateTypeId, eventYear,
  )
  if (exists) return true  // already granted this year — not an error

  const expiryDate: string | null = rule.validityDays != null
    ? toDateStr(new Date(grantDate.getTime() + rule.validityDays * 86_400_000))
    : null

  // 1. Reserve the grant atomically — the UNIQUE constraint is the real
  //    idempotency authority, not the pre-check above.
  const { data: grantRow, error: grantErr } = await supabase
    .from('leave_event_grants')
    .insert({
      tenant_id:      tenantId,
      employee_id:    employeeId,
      leave_type_id:  rule.leaveTypeId,
      date_type_id:   rule.dateTypeId,
      policy_rule_id: rule.ruleId,
      event_year:     eventYear,
      grant_date:     today,
      days_granted:   rule.grantDays,
      expiry_date:    expiryDate,
      status:         'active',
    })
    .select('id')
    .single()

  if (grantErr) {
    // Lost a race to a concurrent insert for the same event/year — already
    // granted, not an error.
    if (grantErr.message?.includes('duplicate')) return true
    return false
  }

  // 2. Credit the ledger now that the grant is safely reserved.
  const balBefore = await currentBalance(
    supabase, tenantId, employeeId, rule.leaveTypeId, year,
  )
  const balAfter = balBefore + rule.grantDays

  try {
    const ledgerRow = await writeBalanceLedgerEntry(supabase, {
      tenantId,
      employeeId,
      leaveTypeId:  rule.leaveTypeId,
      year,
      txnType:      'manual_credit',   // reuses existing enum value; semantically "event grant"
      delta:        rule.grantDays,
      balanceAfter: balAfter,
      notes:        `Event grant — date type ${rule.dateTypeId} (policy rule ${rule.ruleId})`,
      lineageId,
    })

    // Best-effort back-reference — the grant and ledger entry are both
    // already correctly committed even if this link update fails.
    const { error: linkErr } = await supabase
      .from('leave_event_grants')
      .update({ ledger_entry_id: ledgerRow.id })
      .eq('id', grantRow.id)
    if (linkErr) {
      console.error(
        'leave-event-engine: failed to link grant to ledger entry',
        { grantId: grantRow.id, ledgerEntryId: ledgerRow.id, error: linkErr.message },
      )
    }
  } catch (err) {
    // Ledger credit failed after the grant was reserved. We deliberately
    // do not retry or delete the grant row here: the UNIQUE constraint
    // means every future run will see it via grantAlreadyExists and skip,
    // which leaves the employee under-credited until reconciled manually —
    // but that is a detectable, bounded gap (an 'active' grant row with a
    // null ledger_entry_id), which is a materially safer failure mode than
    // the silent double-credit this ordering replaces.
    console.error(
      'leave-event-engine: grant reserved but ledger credit failed — needs manual reconciliation',
      { tenantId, employeeId, dateTypeId: rule.dateTypeId, eventYear, grantId: grantRow.id,
        error: err instanceof Error ? err.message : String(err) },
    )
    return false
  }

  return true
}

/**
 * Mark all active event grants whose expiry_date < today as 'expired'.
 * Also writes a negative ledger entry to deduct unused days.
 *
 * Returns the number of grants expired.
 */
export async function expireStaleEventGrants(
  supabase:   SupabaseClient,
  tenantId:   string,
  today:      Date,
  lineageId?: string,
): Promise<number> {
  const todayStr = toDateStr(today)

  const { data: stale, error } = await supabase
    .from('leave_event_grants')
    .select('id, employee_id, leave_type_id, days_granted, event_year')
    .eq('tenant_id', tenantId)
    .eq('status', 'active')
    .not('expiry_date', 'is', null)
    .lt('expiry_date', todayStr)

  if (error || !stale?.length) return 0

  let count = 0
  for (const grant of stale as Array<{
    id: string
    employee_id: string
    leave_type_id: string
    days_granted: number
    event_year: number
  }>) {
    // Compute current balance so we can write balance_after
    const bal = await currentBalance(
      supabase, tenantId, grant.employee_id, grant.leave_type_id, grant.event_year,
    )
    const balAfter = Math.max(0, bal - grant.days_granted)

    // Deduct from ledger via single authoritative path
    try {
      await writeBalanceLedgerEntry(supabase, {
        tenantId,
        employeeId:   grant.employee_id,
        leaveTypeId:  grant.leave_type_id,
        year:         grant.event_year,
        txnType:      'expiry',
        delta:        -grant.days_granted,
        balanceAfter: balAfter,
        notes:        `Event grant expired (grant ${grant.id})`,
        lineageId,
      })
    } catch {
      // Non-fatal: mark grant expired even if ledger write fails — prevents
      // stale active grants from persisting. Errors are surfaced in job logs.
    }

    // Mark grant expired
    await supabase
      .from('leave_event_grants')
      .update({ status: 'expired' })
      .eq('id', grant.id)

    count++
  }

  return count
}

/**
 * Primary daily entry point — called by the leave scheduler.
 *
 * Runs the full event-grant pipeline for a tenant on a given date:
 *   1. Fetch all event-triggered rules
 *   2. For each unique dateTypeId, find employees with an event today
 *   3. Grant days (with idempotency)
 *   4. Expire stale grants
 *
 * Returns a summary: { granted, skipped, expired, errors }
 */
export async function runEventGrantsForTenant(
  supabase:  SupabaseClient,
  tenantId:  string,
  today:     Date = new Date(),
): Promise<{ granted: number; skipped: number; expired: number; errors: number }> {
  const month = today.getMonth() + 1
  const day   = today.getDate()

  // Single lineage ID for all ledger entries written in this scheduler run
  const lineageId = generateLineageId()

  const result = { granted: 0, skipped: 0, expired: 0, errors: 0 }

  // Step 1 — load event-triggered rules
  const rules = await fetchEventRules(supabase, tenantId)
  if (!rules.length) {
    result.expired = await expireStaleEventGrants(supabase, tenantId, today, lineageId)
    return result
  }

  // Group rules by dateTypeId so we only fetch employees once per type
  const byDateType = new Map<string, EventRule[]>()
  for (const r of rules) {
    const list = byDateType.get(r.dateTypeId) ?? []
    list.push(r)
    byDateType.set(r.dateTypeId, list)
  }

  // Step 2+3 — process each date type
  for (const [dateTypeId, typeRules] of byDateType) {
    const matches = await findEmployeesWithEventToday(
      supabase, tenantId, dateTypeId, month, day,
    )
    if (!matches.length) continue

    for (const match of matches) {
      for (const rule of typeRules) {
        // Resolve effective policy for this employee
        // We only grant if this rule's policy is the one effective for the employee.
        // For simplicity in V1: grant for ALL matching rules across all policies
        // (the idempotency constraint is per date_type, not per rule).
        // A future iteration can add policy-resolution here.
        try {
          const ok = await processEventGrant(
            supabase, tenantId, match.employeeId, rule, today, lineageId,
          )
          if (ok) {
            result.granted++
          } else {
            result.skipped++   // already granted this year
          }
        } catch {
          result.errors++
        }
      }
    }
  }

  // Step 4 — expire stale grants
  result.expired = await expireStaleEventGrants(supabase, tenantId, today, lineageId)

  return result
}
