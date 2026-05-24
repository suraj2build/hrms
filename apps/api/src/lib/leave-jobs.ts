/**
 * Leave Job Handlers
 *
 * Four scheduled jobs for the leave entitlement lifecycle:
 *
 *   1. monthlyAccrualJob      — credit 1/12th of annual entitlement on the 1st of each month
 *   2. coExpiryJob            — zero out comp-off grants whose expires_on has passed
 *   3. carryForwardJob        — move eligible year-end balance to the next year
 *   4. policyRecalculateJob   — reconcile YTD accruals after a policy parameter changes
 *
 * Each job:
 *   • Writes a leave_job_log row at start  (status = 'running')
 *   • Iterates all active employees for the tenant
 *   • Writes entries to leave_accrual_ledger for full audit trail
 *   • Updates employee_leave_balance
 *   • Closes leave_job_log row at end      (status = 'completed' | 'failed')
 *   • Returns a typed JobResult — no throws escape the function boundary
 *
 * The service-role Supabase client is used so RLS does not interfere
 * with cross-employee writes inside the same batch.
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import {
  type LeavePolicy,
  checkEligibility,
  computeEntitlement,
  computeMonthlyAccrualAmount,
  creditEmployeeDays,
  runEngineMonthlyAccrual,
  runEngineYearlyCredit,
} from './leave-entitlement-service.js'

// ── Types ──────────────────────────────────────────────────────────────────────

export interface JobResult {
  job_id:              string
  job_type:            string
  status:              'completed' | 'failed'
  employees_processed: number
  /** For expiry jobs this is negative (days removed). */
  total_days_credited: number
  skipped:             number
  errors:              string[]
  duration_ms:         number
}

type JobType = 'monthly_accrual' | 'yearly_accrual' | 'co_expiry' | 'carry_forward' | 'policy_recalculate'

// ── Internal helpers ───────────────────────────────────────────────────────────

/** Shift a YYYY-MM-DD string by N days (UTC noon, avoids DST). */
function shiftDay(dateStr: string, days: number): string {
  const d = new Date(`${dateStr}T12:00:00.000Z`)
  d.setUTCDate(d.getUTCDate() + days)
  return d.toISOString().slice(0, 10)
}

async function startJobLog(
  supabase:    SupabaseClient,
  tenantId:    string,
  jobType:     JobType,
  params:      Record<string, unknown>,
  triggeredBy: string | null,
): Promise<string> {
  const { data } = await supabase
    .from('leave_job_log')
    .insert({
      tenant_id:    tenantId,
      job_type:     jobType,
      status:       'running',
      params,
      triggered_by: triggeredBy,
    })
    .select('id')
    .single()
  return data?.id ?? 'unknown'
}

async function completeJobLog(
  supabase:  SupabaseClient,
  jobId:     string,
  status:    'completed' | 'failed',
  result:    Record<string, unknown>,
  startedAt: number,
  errorMsg?: string,
): Promise<void> {
  await supabase
    .from('leave_job_log')
    .update({
      status,
      completed_at: new Date().toISOString(),
      duration_ms:  Date.now() - startedAt,
      result,
      error_msg:    errorMsg ?? null,
    })
    .eq('id', jobId)
}

async function writeLedgerEntry(
  supabase:     SupabaseClient,
  tenantId:     string,
  employeeId:   string,
  leaveTypeId:  string,
  year:         number,
  accrualType:  string,
  days:         number,
  accruedOn:    string,
  expiresOn:    string | null,
  notes?:       string,
): Promise<void> {
  // upsert with ignoreDuplicates ensures re-running the same job period never
  // double-writes (pairs with uidx_accrual_ledger_idempotency partial index).
  // For adjustment / co_grant types the unique index is partial and does NOT
  // cover them, so ON CONFLICT will simply not match — functionally equivalent
  // to a plain insert for those types.
  await supabase.from('leave_accrual_ledger').upsert(
    {
      tenant_id:     tenantId,
      employee_id:   employeeId,
      leave_type_id: leaveTypeId,
      year,
      accrual_type:  accrualType,
      days,
      accrued_on:    accruedOn,
      expires_on:    expiresOn,
      notes:         notes ?? null,
    },
    {
      onConflict:       'tenant_id,employee_id,leave_type_id,year,accrual_type,accrued_on',
      ignoreDuplicates: true,
    },
  )
}

async function fetchPolicies(
  supabase: SupabaseClient,
  tenantId: string,
): Promise<LeavePolicy[]> {
  const { data } = await supabase
    .from('leave_policies')
    .select('*')
    .eq('tenant_id', tenantId)
  return (data ?? []) as LeavePolicy[]
}

async function fetchActiveEmployees(
  supabase: SupabaseClient,
  tenantId: string,
): Promise<Array<{ id: string; joining_date: string }>> {
  const { data } = await supabase
    .from('employees')
    .select('id, joining_date')
    .eq('tenant_id', tenantId)
    .eq('status', 'active')
  return data ?? []
}

function emptyResult(jobId: string, jobType: string, startedAt: number): JobResult {
  return {
    job_id: jobId, job_type: jobType, status: 'completed',
    employees_processed: 0, total_days_credited: 0, skipped: 0, errors: [],
    duration_ms: Date.now() - startedAt,
  }
}

// ── Job 1: Monthly Accrual ─────────────────────────────────────────────────────
//
// Credits 1/12th of the annual entitlement (rounded to 1 dp) to every active
// employee whose policy is `accrual_type = 'monthly'` and who has passed the
// eligibility waiting period.
//
// If the policy has `expiry_days` set, each monthly grant is written to the
// ledger with an `expires_on` date so the coExpiryJob can reclaim it later.

export async function monthlyAccrualJob(
  supabase:    SupabaseClient,
  tenantId:    string,
  year:        number,
  month:       number,   // 1-indexed (1 = Jan)
  triggeredBy: string | null = null,
): Promise<JobResult> {
  const startedAt = Date.now()
  const jobId = await startJobLog(
    supabase, tenantId, 'monthly_accrual', { year, month }, triggeredBy,
  )

  let employees_processed = 0
  let total_days_credited  = 0
  let skipped              = 0
  const errors: string[]   = []

  try {
    // ── Phase 1: Engine-aware accrual (named policy assignments) ─────────────
    // Processes employees who have a direct employee-scoped policy assignment
    // (leave_policy_assignments with scope_type='employee').  Supports monthly
    // and quarterly accrual types, and writes ledger entries.
    const engineResult = await runEngineMonthlyAccrual(supabase, tenantId, year, month)
    employees_processed += engineResult.employees_processed
    total_days_credited  = parseFloat((total_days_credited + engineResult.total_days_credited).toFixed(2))
    skipped             += engineResult.skipped
    errors.push(...engineResult.errors)

    // Step 1: build an exclusion set from Phase 1 so Phase 2 never double-credits
    const engineProcessed = new Set(engineResult.processed_employee_ids)

    // ── Phase 2: Legacy accrual (leave_policies table) ────────────────────────
    // Processes all active employees against legacy leave_policies rows.
    // In a fully-migrated tenant this will be empty; in a hybrid tenant it
    // covers employees without a named policy assignment.
    const [policies, employees] = await Promise.all([
      fetchPolicies(supabase, tenantId),
      fetchActiveEmployees(supabase, tenantId),
    ])

    const monthlyPolicies = policies.filter(p => p.accrual_type === 'monthly')

    if (monthlyPolicies.length && employees.length) {
      // YYYY-MM-01 — the date label used for the ledger entry
      const accrualDate = `${year}-${String(month).padStart(2, '0')}-01`

      for (const policy of monthlyPolicies) {
        const monthlyDays = computeMonthlyAccrualAmount(policy)
        if (monthlyDays <= 0) {
          skipped += employees.length
          continue
        }

        // Compute expiry date for this grant (null if policy has no expiry)
        const expiresOn = policy.expiry_days
          ? shiftDay(accrualDate, policy.expiry_days)
          : null

        for (const emp of employees) {
          // Step 1: skip employees already credited by Phase 1 (engine)
          if (engineProcessed.has(emp.id)) { skipped++; continue }

          try {
            const asOfDate = new Date(`${accrualDate}T12:00:00.000Z`)
            const elig = checkEligibility(emp.joining_date, policy, asOfDate)
            if (!elig.eligible) { skipped++; continue }

            // Credit balance (respects max_accrual_balance cap)
            await creditEmployeeDays(
              supabase, tenantId, emp.id, policy.leave_type_id,
              monthlyDays, year, policy.max_accrual_balance ?? undefined,
            )

            // Write ledger entry — accrual_type 'monthly'; include expiry if applicable
            await writeLedgerEntry(
              supabase, tenantId, emp.id, policy.leave_type_id, year,
              'monthly', monthlyDays, accrualDate, expiresOn,
              `Monthly accrual ${year}-${String(month).padStart(2, '0')}`,
            )

            employees_processed++
            total_days_credited = parseFloat((total_days_credited + monthlyDays).toFixed(2))
          } catch (e: unknown) {
            errors.push(`Emp ${emp.id} policy ${policy.id}: ${(e as Error).message}`)
          }
        }
      }
    }

    const result = { employees_processed, total_days_credited, skipped, errors }
    await completeJobLog(supabase, jobId, 'completed', result, startedAt)
    return { job_id: jobId, job_type: 'monthly_accrual', status: 'completed', ...result, duration_ms: Date.now() - startedAt }

  } catch (e: unknown) {
    const msg = (e as Error).message
    await completeJobLog(supabase, jobId, 'failed', {}, startedAt, msg)
    return {
      job_id: jobId, job_type: 'monthly_accrual', status: 'failed',
      employees_processed, total_days_credited, skipped,
      errors: [...errors, msg], duration_ms: Date.now() - startedAt,
    }
  }
}

// ── Job 1b: Yearly Accrual ─────────────────────────────────────────────────────
//
// Credits the full (optionally prorated) annual entitlement to every active
// employee whose policy is `accrual_type = 'yearly' | 'upfront'`.
//
// Runs in two phases:
//   Phase 1: Engine-aware credit via leave_policy_rules (named assignments)
//   Phase 2: Legacy credit via leave_policies table
//
// Both phases are idempotent — employees already credited for the year are skipped.

export async function yearlyAccrualJob(
  supabase:    SupabaseClient,
  tenantId:    string,
  leaveYear:   number,
  triggeredBy: string | null = null,
  asOf?:       string,
): Promise<JobResult> {
  const startedAt = Date.now()
  const jobId = await startJobLog(
    supabase, tenantId, 'yearly_accrual',
    { leave_year: leaveYear, as_of: asOf ?? null },
    triggeredBy,
  )

  let employees_processed = 0
  let total_days_credited  = 0
  let skipped              = 0
  const errors: string[]   = []

  try {
    // ── Phase 1: Engine-aware yearly/upfront credit ───────────────────────
    const engineResult = await runEngineYearlyCredit(supabase, tenantId, leaveYear, asOf)
    employees_processed += engineResult.employees_processed
    total_days_credited  = parseFloat((total_days_credited + engineResult.total_days_credited).toFixed(2))
    skipped             += engineResult.skipped
    errors.push(...engineResult.errors)

    // Step 1: exclusion set — employees already credited by Phase 1 are skipped below
    const engineProcessed = new Set(engineResult.processed_employee_ids)

    // ── Phase 2: Legacy yearly credit ────────────────────────────────────
    const { data: policies } = await supabase
      .from('leave_policies')
      .select('*')
      .eq('tenant_id', tenantId)
      .in('accrual_type', ['yearly', 'upfront'])

    const yearlyPolicies = (policies ?? []) as LeavePolicy[]

    if (yearlyPolicies.length) {
      const employees = await fetchActiveEmployees(supabase, tenantId)

      for (const policy of yearlyPolicies) {
        for (const emp of employees) {
          // Step 1: skip employees already handled by the engine in Phase 1
          if (engineProcessed.has(emp.id)) { skipped++; continue }

          if (!emp.joining_date) { skipped++; continue }

          const days = computeEntitlement(emp.joining_date, policy, leaveYear)
          if (days <= 0) { skipped++; continue }

          try {
            // Idempotency: skip if already credited this year
            const { data: existing } = await supabase
              .from('employee_leave_balance')
              .select('id')
              .eq('tenant_id',     tenantId)
              .eq('employee_id',   emp.id)
              .eq('leave_type_id', policy.leave_type_id)
              .eq('year',          leaveYear)
              .maybeSingle()

            if (existing) { skipped++; continue }

            await supabase.from('employee_leave_balance').insert({
              tenant_id:     tenantId,
              employee_id:   emp.id,
              leave_type_id: policy.leave_type_id,
              year:          leaveYear,
              balance:       days,
              updated_at:    new Date().toISOString(),
            })

            const yearStartStr = asOf ?? `${leaveYear}-01-01`
            await writeLedgerEntry(
              supabase, tenantId, emp.id, policy.leave_type_id, leaveYear,
              policy.accrual_type, days, yearStartStr,
              policy.expiry_days ? shiftDay(yearStartStr, policy.expiry_days) : null,
              `Yearly accrual ${leaveYear}`,
            )

            employees_processed++
            total_days_credited = parseFloat((total_days_credited + days).toFixed(2))
          } catch (e: unknown) {
            errors.push(`Emp ${emp.id} policy ${policy.id}: ${(e as Error).message}`)
          }
        }
      }
    }

    const result = { employees_processed, total_days_credited, skipped, errors }
    await completeJobLog(supabase, jobId, 'completed', result, startedAt)
    return { job_id: jobId, job_type: 'yearly_accrual', status: 'completed', ...result, duration_ms: Date.now() - startedAt }

  } catch (e: unknown) {
    const msg = (e as Error).message
    await completeJobLog(supabase, jobId, 'failed', {}, startedAt, msg)
    return {
      job_id: jobId, job_type: 'yearly_accrual', status: 'failed',
      employees_processed, total_days_credited, skipped,
      errors: [...errors, msg], duration_ms: Date.now() - startedAt,
    }
  }
}

// ── Job 2: CO Expiry ───────────────────────────────────────────────────────────
//
// Finds all leave_accrual_ledger rows where:
//   expires_on <= asOf   AND   is_expired = false   AND   days > 0
//
// For each affected employee+leave_type+year group:
//   • Sums expired days
//   • Deducts from employee_leave_balance (floor at 0)
//   • Writes a negative 'adjustment' ledger entry documenting the deduction
//   • Marks the original ledger rows as expired
//
// Designed to be run daily — safe to re-run (already-expired rows are skipped).

export async function coExpiryJob(
  supabase:    SupabaseClient,
  tenantId:    string,
  asOf:        Date = new Date(),
  triggeredBy: string | null = null,
): Promise<JobResult> {
  const startedAt = Date.now()
  const asOfStr   = asOf.toISOString().slice(0, 10)
  const jobId     = await startJobLog(
    supabase, tenantId, 'co_expiry', { as_of: asOfStr }, triggeredBy,
  )

  let employees_processed = 0
  let total_days_expired   = 0
  let skipped              = 0
  const errors: string[]   = []

  try {
    // Fetch all ledger entries due for expiry today
    const { data: expiredRows, error: fetchErr } = await supabase
      .from('leave_accrual_ledger')
      .select('id, employee_id, leave_type_id, year, days')
      .eq('tenant_id', tenantId)
      .eq('is_expired', false)
      .lte('expires_on', asOfStr)
      .gt('days', 0)   // only positive credit grants can expire

    if (fetchErr) throw new Error(fetchErr.message)

    if (!expiredRows?.length) {
      await completeJobLog(supabase, jobId, 'completed', { employees_processed: 0, total_days_credited: 0, skipped: 0 }, startedAt)
      return emptyResult(jobId, 'co_expiry', startedAt)
    }

    // Group by employee + leave_type + year so we do one balance update each
    type GroupKey = string
    const grouped = new Map<GroupKey, {
      employeeId:  string
      leaveTypeId: string
      year:        number
      totalDays:   number
      ids:         string[]
    }>()

    for (const row of expiredRows) {
      const key: GroupKey = `${row.employee_id}:${row.leave_type_id}:${row.year}`
      const g = grouped.get(key)
      if (g) {
        g.totalDays += Number(row.days)
        g.ids.push(row.id)
      } else {
        grouped.set(key, {
          employeeId:  row.employee_id,
          leaveTypeId: row.leave_type_id,
          year:        Number(row.year),
          totalDays:   Number(row.days),
          ids:         [row.id],
        })
      }
    }

    const expiredAt = new Date().toISOString()

    for (const group of grouped.values()) {
      try {
        // Current balance
        const { data: balRow } = await supabase
          .from('employee_leave_balance')
          .select('balance')
          .eq('tenant_id', tenantId)
          .eq('employee_id', group.employeeId)
          .eq('leave_type_id', group.leaveTypeId)
          .eq('year', group.year)
          .maybeSingle()

        const current    = Number(balRow?.balance ?? 0)
        const deductDays = Math.min(group.totalDays, current)  // floor at 0

        if (deductDays > 0) {
          // Deduct from balance
          await supabase
            .from('employee_leave_balance')
            .update({
              balance:    Math.max(0, parseFloat((current - deductDays).toFixed(2))),
              updated_at: new Date().toISOString(),
            })
            .eq('tenant_id', tenantId)
            .eq('employee_id', group.employeeId)
            .eq('leave_type_id', group.leaveTypeId)
            .eq('year', group.year)

          // Write negative adjustment ledger entry (audit trail of the deduction)
          await writeLedgerEntry(
            supabase, tenantId, group.employeeId, group.leaveTypeId, group.year,
            'adjustment', -deductDays, asOfStr, null,
            `CO expiry: ${deductDays} day(s) removed on ${asOfStr}`,
          )
        }

        // Mark source rows as expired
        await supabase
          .from('leave_accrual_ledger')
          .update({ is_expired: true, expired_on: expiredAt })
          .in('id', group.ids)

        employees_processed++
        total_days_expired = parseFloat((total_days_expired + deductDays).toFixed(2))
      } catch (e: unknown) {
        errors.push(`Emp ${group.employeeId} LT ${group.leaveTypeId}: ${(e as Error).message}`)
      }
    }

    // total_days_credited is negative for expiry (days removed)
    const result = {
      employees_processed,
      total_days_credited: -total_days_expired,
      skipped,
      errors,
    }
    await completeJobLog(supabase, jobId, 'completed', result, startedAt)
    return { job_id: jobId, job_type: 'co_expiry', status: 'completed', ...result, duration_ms: Date.now() - startedAt }

  } catch (e: unknown) {
    const msg = (e as Error).message
    await completeJobLog(supabase, jobId, 'failed', {}, startedAt, msg)
    return {
      job_id: jobId, job_type: 'co_expiry', status: 'failed',
      employees_processed, total_days_credited: -total_days_expired, skipped,
      errors: [...errors, msg], duration_ms: Date.now() - startedAt,
    }
  }
}

// ── Job 3: Carry Forward ───────────────────────────────────────────────────────
//
// For each policy that has carry_forward_enabled = true:
//   • Reads the employee's fromYear balance
//   • Applies the carry_forward_max_days cap
//   • Credits the carry amount to the toYear balance
//   • Writes a 'carry_forward' ledger entry in toYear
//
// Idempotent: if a carry_forward ledger entry already exists for toYear,
// the employee is skipped (prevents double-carry on re-runs).

export async function carryForwardJob(
  supabase:    SupabaseClient,
  tenantId:    string,
  fromYear:    number,
  toYear:      number,
  triggeredBy: string | null = null,
): Promise<JobResult> {
  const startedAt = Date.now()
  const jobId     = await startJobLog(
    supabase, tenantId, 'carry_forward', { from_year: fromYear, to_year: toYear }, triggeredBy,
  )

  let employees_processed = 0
  let total_days_credited  = 0
  let skipped              = 0
  const errors: string[]   = []

  try {
    const [policies, employees] = await Promise.all([
      fetchPolicies(supabase, tenantId),
      fetchActiveEmployees(supabase, tenantId),
    ])

    const cfPolicies = policies.filter(p => p.carry_forward_enabled)

    if (!cfPolicies.length || !employees.length) {
      await completeJobLog(supabase, jobId, 'completed', { employees_processed: 0, total_days_credited: 0, skipped: 0 }, startedAt)
      return emptyResult(jobId, 'carry_forward', startedAt)
    }

    // Date label for ledger entry — Jan 1 of new year
    const cfDate = `${toYear}-01-01`

    for (const policy of cfPolicies) {
      for (const emp of employees) {
        try {
          // Idempotency: skip if a carry_forward ledger entry already exists for toYear
          const { count: existingCF } = await supabase
            .from('leave_accrual_ledger')
            .select('id', { count: 'exact', head: true })
            .eq('tenant_id', tenantId)
            .eq('employee_id', emp.id)
            .eq('leave_type_id', policy.leave_type_id)
            .eq('year', toYear)
            .eq('accrual_type', 'carry_forward')

          if ((existingCF ?? 0) > 0) { skipped++; continue }

          // fromYear balance
          const { data: fromBal } = await supabase
            .from('employee_leave_balance')
            .select('balance')
            .eq('tenant_id', tenantId)
            .eq('employee_id', emp.id)
            .eq('leave_type_id', policy.leave_type_id)
            .eq('year', fromYear)
            .maybeSingle()

          const fromBalance = Number(fromBal?.balance ?? 0)
          if (fromBalance <= 0) { skipped++; continue }

          // Apply carry-forward cap
          const carryDays = policy.carry_forward_max_days != null
            ? Math.min(fromBalance, policy.carry_forward_max_days)
            : fromBalance

          if (carryDays <= 0) { skipped++; continue }

          // Credit toYear balance
          await creditEmployeeDays(
            supabase, tenantId, emp.id, policy.leave_type_id,
            carryDays, toYear, policy.max_accrual_balance ?? undefined,
          )

          // Ledger entry for the carry-forward
          await writeLedgerEntry(
            supabase, tenantId, emp.id, policy.leave_type_id, toYear,
            'carry_forward', carryDays, cfDate, null,
            `Carry-forward from ${fromYear}: ${carryDays} day(s)`,
          )

          employees_processed++
          total_days_credited = parseFloat((total_days_credited + carryDays).toFixed(2))
        } catch (e: unknown) {
          errors.push(`Emp ${emp.id} policy ${policy.id}: ${(e as Error).message}`)
        }
      }
    }

    const result = { employees_processed, total_days_credited, skipped, errors }
    await completeJobLog(supabase, jobId, 'completed', result, startedAt)
    return { job_id: jobId, job_type: 'carry_forward', status: 'completed', ...result, duration_ms: Date.now() - startedAt }

  } catch (e: unknown) {
    const msg = (e as Error).message
    await completeJobLog(supabase, jobId, 'failed', {}, startedAt, msg)
    return {
      job_id: jobId, job_type: 'carry_forward', status: 'failed',
      employees_processed, total_days_credited, skipped,
      errors: [...errors, msg], duration_ms: Date.now() - startedAt,
    }
  }
}

// ── Job 4: Policy Recalculate ──────────────────────────────────────────────────
//
// Called after an HR admin changes a leave policy's accrual rate or rules.
// Reconciles each employee's YTD accrual:
//
//   expectedYTD = what they should have received based on the NEW policy
//   actualYTD   = sum of monthly/yearly ledger entries for this year
//   adjustment  = expectedYTD - actualYTD
//
// If adjustment != 0: update balance + write an 'adjustment' ledger entry.
// If adjustment ≈ 0: skip (no change needed).
//
// Monthly policies: re-accumulates per-month (respects joining eligibility).
// Yearly / upfront policies: uses computeEntitlement (prorated from joining date).

export async function policyRecalculateJob(
  supabase:    SupabaseClient,
  tenantId:    string,
  leaveTypeId: string,
  year:        number,
  triggeredBy: string | null = null,
): Promise<JobResult> {
  const startedAt = Date.now()
  const jobId     = await startJobLog(
    supabase, tenantId, 'policy_recalculate', { leave_type_id: leaveTypeId, year }, triggeredBy,
  )

  let employees_processed = 0
  let total_days_credited  = 0  // net: positive = more credited, negative = reduced
  let skipped              = 0
  const errors: string[]   = []

  try {
    // Load the policy
    const { data: policyRow } = await supabase
      .from('leave_policies')
      .select('*')
      .eq('tenant_id', tenantId)
      .eq('leave_type_id', leaveTypeId)
      .maybeSingle()

    if (!policyRow) throw new Error('No policy found for leave type in this tenant')

    const policy   = policyRow as LeavePolicy
    const employees = await fetchActiveEmployees(supabase, tenantId)
    const today    = new Date()
    // Current month (1-indexed) for monthly policy accumulation
    const currentMonth = today.getUTCMonth() + 1

    for (const emp of employees) {
      try {
        // ── Compute expected YTD based on NEW policy ───────────────────────
        let expectedYTD = 0

        if (policy.accrual_type === 'monthly') {
          // Sum eligible months from Jan (or joining month) to current month
          const monthlyRate = computeMonthlyAccrualAmount(policy)
          for (let m = 1; m <= currentMonth; m++) {
            const monthStart = new Date(year, m - 1, 1)
            const elig = checkEligibility(emp.joining_date, policy, monthStart)
            if (elig.eligible) expectedYTD += monthlyRate
          }
          expectedYTD = parseFloat(expectedYTD.toFixed(2))
        } else {
          // yearly / upfront: prorated or full-year credit
          expectedYTD = computeEntitlement(emp.joining_date, policy, year)
        }

        // ── Fetch actual YTD from ledger (only base accrual entries) ───────
        const { data: ledgerRows } = await supabase
          .from('leave_accrual_ledger')
          .select('days')
          .eq('tenant_id', tenantId)
          .eq('employee_id', emp.id)
          .eq('leave_type_id', leaveTypeId)
          .eq('year', year)
          .in('accrual_type', ['monthly', 'yearly', 'upfront'])

        const actualYTD   = (ledgerRows ?? []).reduce((s, r) => s + Number(r.days), 0)
        const adjustment  = parseFloat((expectedYTD - actualYTD).toFixed(2))

        if (Math.abs(adjustment) < 0.01) { skipped++; continue }

        // ── Apply adjustment to balance ────────────────────────────────────
        const { data: balRow } = await supabase
          .from('employee_leave_balance')
          .select('balance')
          .eq('tenant_id', tenantId)
          .eq('employee_id', emp.id)
          .eq('leave_type_id', leaveTypeId)
          .eq('year', year)
          .maybeSingle()

        const currentBalance = Number(balRow?.balance ?? 0)
        const newBalance     = parseFloat(Math.max(0, currentBalance + adjustment).toFixed(2))

        if (balRow) {
          await supabase
            .from('employee_leave_balance')
            .update({ balance: newBalance, updated_at: new Date().toISOString() })
            .eq('tenant_id', tenantId)
            .eq('employee_id', emp.id)
            .eq('leave_type_id', leaveTypeId)
            .eq('year', year)
        } else if (newBalance > 0) {
          await supabase.from('employee_leave_balance').insert({
            tenant_id:     tenantId,
            employee_id:   emp.id,
            leave_type_id: leaveTypeId,
            year,
            balance:       newBalance,
          })
        }

        // ── Write adjustment ledger entry ─────────────────────────────────
        const todayStr = today.toISOString().slice(0, 10)
        await writeLedgerEntry(
          supabase, tenantId, emp.id, leaveTypeId, year,
          'adjustment', adjustment, todayStr, null,
          `Policy recalculate: expected=${expectedYTD} actual=${actualYTD} adj=${adjustment > 0 ? '+' : ''}${adjustment}`,
        )

        employees_processed++
        total_days_credited = parseFloat((total_days_credited + adjustment).toFixed(2))
      } catch (e: unknown) {
        errors.push(`Emp ${emp.id}: ${(e as Error).message}`)
      }
    }

    const result = { employees_processed, total_days_credited, skipped, errors }
    await completeJobLog(supabase, jobId, 'completed', result, startedAt)
    return { job_id: jobId, job_type: 'policy_recalculate', status: 'completed', ...result, duration_ms: Date.now() - startedAt }

  } catch (e: unknown) {
    const msg = (e as Error).message
    await completeJobLog(supabase, jobId, 'failed', {}, startedAt, msg)
    return {
      job_id: jobId, job_type: 'policy_recalculate', status: 'failed',
      employees_processed, total_days_credited, skipped,
      errors: [...errors, msg], duration_ms: Date.now() - startedAt,
    }
  }
}
