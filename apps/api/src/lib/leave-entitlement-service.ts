/**
 * LeaveEntitlementService
 *
 * Implements the full leave entitlement lifecycle:
 *
 *   1. Accrual   — monthly (1/12 per month) or yearly/upfront (full credit at year start)
 *   2. Eligibility — joining date + configurable wait period before first credit / usage
 *   3. Carry-forward — year-end, optional cap on days carried to next year
 *   4. Year boundary — calendar (Jan–Dec) or financial (Apr–Mar, Indian FY)
 *
 * Design principles:
 *   • Pure functions for all date / computation logic (easy to unit-test)
 *   • All DB mutations use upserts — batch operations are safe to re-run
 *   • yearly/upfront credit is idempotent: row is only inserted once per year
 *   • No throws — batch functions return a BatchResult with errors[]
 *
 * Exported surface:
 *   getLeaveYear           helper: which leave year does a date fall in?
 *   yearStart / yearEnd    boundary Date objects for a given leave year
 *   checkEligibility       can an employee use / accrue this leave today?
 *   computeEntitlement     prorated days for yearly/upfront policies
 *   computeMonthlyAccrualAmount  1/12th rounded to 1 dp
 *   fetchPolicy            load a single LeavePolicy row
 *   creditEmployeeDays     low-level: add N days to one employee's balance
 *   runMonthlyAccrual      batch: credit all eligible employees for one month
 *   runYearlyCredit        batch: credit all eligible employees at year start
 *   runCarryForward        batch: carry unused balance to the next year
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import { fetchAllRows } from './supabase-paginate.js'

// ── Types ──────────────────────────────────────────────────────────────────────

export interface LeavePolicy {
  id:                     string
  tenant_id:              string
  leave_type_id:          string
  /** 'monthly' | 'quarterly' | 'yearly' | 'upfront' */
  accrual_type:           'monthly' | 'quarterly' | 'yearly' | 'upfront'
  /** Total days per year the policy awards */
  accrual_days_per_year:  number
  /** Maximum balance that can accumulate — null = unlimited */
  max_accrual_balance:    number | null
  /** Days from joining before employee is eligible */
  eligibility_days:       number
  /** For yearly accrual: prorate for mid-year joiners */
  prorate_on_joining:     boolean
  carry_forward_enabled:  boolean
  /** Max days to carry to next year — null = unlimited */
  carry_forward_max_days: number | null
  /** 'calendar' (Jan–Dec) or 'financial' (Apr–Mar) */
  year_type:              'calendar' | 'financial'
  /** Days after grant date when the leave expires — null = never expires (CO use-case) */
  expiry_days:            number | null
}

export interface EligibilityResult {
  eligible:       boolean
  /** Human-readable reason when eligible = false */
  reason?:        string
  /** YYYY-MM-DD when the employee will become eligible */
  eligible_from?: string
}

export interface BatchResult {
  employees_processed:  number
  total_days_credited:  number
  skipped:              number
  errors:               string[]
  /** Employee UUIDs that were credited in this batch run (used to avoid double-accrual in Phase 2). */
  processed_employee_ids: string[]
  /**
   * Count of employee+leave-type combinations for which crediting was
   * BLOCKED this run because both leave_accrual_rules (System A) and
   * leave_policy_rules (System B, this function) have an active applicable
   * rule — recorded in leave_accrual_conflicts rather than credited by
   * either system (SYSTEM_AUDIT_2026-10-14 checkpoint 14). Only populated
   * by runEngineMonthlyAccrual/runEngineYearlyCredit; absent (undefined)
   * from callers that predate this field, which is why it is optional
   * rather than defaulted to 0 everywhere.
   */
  conflicted?: number
}

// ── Year boundary helpers ──────────────────────────────────────────────────────

/**
 * Returns the "leave year" integer for a given Date.
 *
 * Calendar year: 2025-07-01 → 2025
 * Financial year (Indian FY starts Apr 1):
 *   2025-07-01 → 2025  (FY 2025 = Apr 2025 – Mar 2026)
 *   2026-02-15 → 2025  (still within FY 2025)
 *   2026-04-01 → 2026  (FY 2026 starts)
 */
export function getLeaveYear(date: Date, yearType: 'calendar' | 'financial'): number {
  if (yearType === 'calendar') return date.getUTCFullYear()
  // Financial: months 0–2 (Jan–Mar) belong to the PREVIOUS FY
  const m = date.getUTCMonth() // 0-indexed
  return m >= 3 ? date.getUTCFullYear() : date.getUTCFullYear() - 1
}

/**
 * First day of the leave year at UTC noon.
 *   Calendar 2025 → 2025-01-01
 *   Financial 2025 → 2025-04-01
 */
export function yearStart(leaveYear: number, yearType: 'calendar' | 'financial'): Date {
  if (yearType === 'calendar') {
    return new Date(`${leaveYear}-01-01T12:00:00.000Z`)
  }
  return new Date(`${leaveYear}-04-01T12:00:00.000Z`)
}

/**
 * Last day of the leave year at UTC noon.
 *   Calendar 2025 → 2025-12-31
 *   Financial 2025 → 2026-03-31
 */
export function yearEnd(leaveYear: number, yearType: 'calendar' | 'financial'): Date {
  if (yearType === 'calendar') {
    return new Date(`${leaveYear}-12-31T12:00:00.000Z`)
  }
  return new Date(`${leaveYear + 1}-03-31T12:00:00.000Z`)
}

// ── Eligibility ────────────────────────────────────────────────────────────────

/**
 * Check whether an employee is eligible to accrue or use a leave type.
 *
 * An employee becomes eligible `policy.eligibility_days` days after their
 * joining date.  If eligibility_days = 0, they are immediately eligible.
 *
 * @param joiningDateStr  YYYY-MM-DD joining date
 * @param policy          loaded LeavePolicy
 * @param asOf            evaluate eligibility as of this date (default: now UTC)
 */
export function checkEligibility(
  joiningDateStr: string,
  policy:         LeavePolicy,
  asOf?:          Date,
): EligibilityResult {
  const now     = asOf ?? new Date()
  const joining = new Date(`${joiningDateStr}T12:00:00.000Z`)

  const eligible_from = new Date(
    joining.getTime() + policy.eligibility_days * 86_400_000,
  )

  if (now < eligible_from) {
    return {
      eligible:       false,
      reason:
        `Minimum service period of ${policy.eligibility_days} day(s) not yet completed.` +
        ` Eligible from ${eligible_from.toISOString().slice(0, 10)}.`,
      eligible_from:  eligible_from.toISOString().slice(0, 10),
    }
  }

  return { eligible: true }
}

// ── Entitlement computation ────────────────────────────────────────────────────

/**
 * Compute how many leave days an employee earns in a given leave year.
 *
 * Logic per accrual_type:
 *   upfront : always full `accrual_days_per_year` (no proration)
 *   yearly  : if prorate_on_joining=true and employee joined mid-year,
 *             prorate based on eligible months remaining in the year
 *   monthly : NOT computed here — runMonthlyAccrual credits month-by-month
 *
 * Returns 0 when the employee hasn't joined yet or is not eligible this year.
 *
 * @param joiningDateStr  YYYY-MM-DD
 * @param policy          loaded LeavePolicy
 * @param leaveYear       leave year integer (calendar year or FY start year)
 */
export function computeEntitlement(
  joiningDateStr: string,
  policy:         LeavePolicy,
  leaveYear:      number,
): number {
  const joining = new Date(`${joiningDateStr}T12:00:00.000Z`)
  const start   = yearStart(leaveYear, policy.year_type)
  const end     = yearEnd(leaveYear, policy.year_type)

  // Employee hasn't joined yet this year
  if (joining > end) return 0

  // upfront — always full credit regardless of joining date
  if (policy.accrual_type === 'upfront') {
    return round1(policy.accrual_days_per_year)
  }

  // No proration configured → always full credit
  if (!policy.prorate_on_joining) {
    return round1(policy.accrual_days_per_year)
  }

  // Proration: find when the employee becomes eligible
  const eligible_from = new Date(
    joining.getTime() + policy.eligibility_days * 86_400_000,
  )

  // Effective credit start = later of (year start, eligibility date)
  const effective_start = eligible_from > start ? eligible_from : start

  // Eligibility begins after the year ends — no entitlement
  if (effective_start > end) return 0

  // Count whole months from effective_start through the end of the year
  const months   = monthsBetween(effective_start, end)
  const prorated = (policy.accrual_days_per_year / 12) * months

  return round1(Math.min(prorated, policy.accrual_days_per_year))
}

/**
 * Monthly accrual amount = annual / 12, rounded to 1 decimal place.
 */
export function computeMonthlyAccrualAmount(policy: LeavePolicy): number {
  return round1(policy.accrual_days_per_year / 12)
}

/**
 * Quarterly accrual amount = annual / 4, rounded to 1 decimal place.
 * Only runs in quarter-start months: Jan (1), Apr (4), Jul (7), Oct (10).
 */
export function computeQuarterlyAccrualAmount(policy: LeavePolicy): number {
  return round1(policy.accrual_days_per_year / 4)
}

// ── Policy fetch ───────────────────────────────────────────────────────────────

/**
 * Fetch the leave policy for a specific leave type.
 * Returns null if no policy has been configured.
 */
export async function fetchPolicy(
  supabase:    SupabaseClient,
  tenantId:    string,
  leaveTypeId: string,
): Promise<LeavePolicy | null> {
  const { data } = await supabase
    .from('leave_policies')
    .select('*')
    .eq('tenant_id',     tenantId)
    .eq('leave_type_id', leaveTypeId)
    .maybeSingle()

  return (data as LeavePolicy | null)
}

// ── Low-level balance mutation ─────────────────────────────────────────────────

/**
 * Add `days` to an employee's leave balance for a given year.
 *
 * Respects `max_accrual_balance` if provided — balance will never exceed the cap.
 * Uses upsert so it is safe to call multiple times.
 *
 * @param days       number of days to add (must be > 0)
 * @param maxBalance optional cap to apply after addition
 */
export async function creditEmployeeDays(
  supabase:    SupabaseClient,
  tenantId:    string,
  employeeId:  string,
  leaveTypeId: string,
  days:        number,
  year:        number,
  maxBalance?: number | null,
): Promise<void> {
  if (days <= 0) return

  // Fetch current balance to compute the new value
  const { data: current } = await supabase
    .from('employee_leave_balance')
    .select('balance')
    .eq('tenant_id',     tenantId)
    .eq('employee_id',   employeeId)
    .eq('leave_type_id', leaveTypeId)
    .eq('year',          year)
    .maybeSingle()

  const prev     = current ? Number(current.balance) : 0
  let   newBal   = prev + days

  if (maxBalance != null && newBal > maxBalance) {
    newBal = maxBalance
  }

  await supabase
    .from('employee_leave_balance')
    .upsert(
      {
        tenant_id:     tenantId,
        employee_id:   employeeId,
        leave_type_id: leaveTypeId,
        year,
        balance:       round1(newBal),
        updated_at:    new Date().toISOString(),
      },
      { onConflict: 'tenant_id,employee_id,leave_type_id,year' },
    )
}

// ── Batch-fetch helper ──────────────────────────────────────────────────────────
//
// SYSCERT_AUDIT_2026-08-02.md High #9: runMonthlyAccrual / runYearlyCredit /
// runCarryForward used to issue a SELECT + upsert PER (employee, policy) pair,
// fully sequential, inside the admin-triggered HTTP request. At enterprise
// scale (thousands of employees × several policies) this is tens of thousands
// of round trips synchronously in-request. Batch-fetch the whole policy's
// balances in ONE query so the per-employee work becomes in-memory
// computation — mirrors the C8 fix already applied to leave-jobs.ts.

/** employee_id → current balance for (leaveType, year), for in-memory balance math. */
async function fetchBalanceMap(
  supabase:    SupabaseClient,
  tenantId:    string,
  leaveTypeId: string,
  year:        number,
): Promise<Map<string, number>> {
  const rows = await fetchAllRows<{ employee_id: string; balance: number }>((from, to) =>
    supabase
      .from('employee_leave_balance')
      .select('employee_id, balance')
      .eq('tenant_id', tenantId)
      .eq('leave_type_id', leaveTypeId)
      .eq('year', year)
      .range(from, to),
  )
  return new Map(rows.map(r => [r.employee_id, Number(r.balance)]))
}

// ── Batch: Monthly accrual ─────────────────────────────────────────────────────

/**
 * runMonthlyAccrual — credit 1/12th of the annual entitlement to every
 * eligible active employee, for all leave types that use monthly accrual.
 *
 * Designed to be called on the 1st of each month (cron / scheduled job).
 * Safe to re-run: creditEmployeeDays respects the max_accrual_balance cap
 * and adds idempotently on top of existing balance.
 *
 * @param year   calendar year (or FY start year) to credit
 * @param month  1-indexed month (1 = January)
 */
export async function runMonthlyAccrual(
  supabase:  SupabaseClient,
  tenantId:  string,
  year:      number,
  month:     number,
): Promise<BatchResult> {
  const result: BatchResult = {
    employees_processed:   0,
    total_days_credited:   0,
    skipped:               0,
    errors:                [],
    processed_employee_ids: [],
  }

  // All active leave types with a monthly accrual policy
  const { data: policies, error: pErr } = await supabase
    .from('leave_policies')
    .select('*, leave_types!inner(id, name, is_active)')
    .eq('tenant_id',   tenantId)
    .eq('accrual_type', 'monthly')
    .eq('leave_types.is_active', true)

  if (pErr) {
    result.errors.push(`Failed to fetch policies: ${pErr.message}`)
    return result
  }
  if (!policies?.length) return result

  // All active employees
  let employees: Array<{ id: string; joining_date: string | null }>
  let eErr: unknown = null
  try {
    employees = await fetchAllRows((from, to) =>
      supabase
        .from('employees')
        .select('id, joining_date')
        .eq('tenant_id', tenantId)
        .eq('status', 'active')
        .order('id')
        .range(from, to),
    )
  } catch (err) {
    employees = []
    eErr = err
  }

  if (eErr) {
    result.errors.push(`Failed to fetch employees: ${(eErr as Error).message}`)
    return result
  }
  if (!employees?.length) return result

  // Evaluate eligibility as of the 1st of the given month
  const asOf = new Date(
    `${year}-${String(month).padStart(2, '0')}-01T12:00:00.000Z`,
  )

  for (const policy of policies as any[]) {
    const p             = policy as LeavePolicy
    const leaveTypeId   = p.leave_type_id
    const accrualAmount = computeMonthlyAccrualAmount(p)
    if (accrualAmount <= 0) continue

    const eligible = employees.filter(emp => {
      if (!emp.joining_date) { result.skipped++; return false }
      const elig = checkEligibility(emp.joining_date, p, asOf)
      if (!elig.eligible) { result.skipped++; return false }
      return true
    })
    if (!eligible.length) continue

    let balanceMap: Map<string, number>
    try {
      balanceMap = await fetchBalanceMap(supabase, tenantId, leaveTypeId, year)
    } catch (err: any) {
      result.errors.push(`Policy ${p.id}: balance pre-fetch failed — ${err?.message ?? 'unknown error'}`)
      continue
    }

    const balUpserts = eligible.map(emp => {
      const current = balanceMap.get(emp.id) ?? 0
      let   newBal  = current + accrualAmount
      if (p.max_accrual_balance != null && newBal > p.max_accrual_balance) {
        newBal = p.max_accrual_balance
      }
      return {
        tenant_id:     tenantId,
        employee_id:   emp.id,
        leave_type_id: leaveTypeId,
        year,
        balance:       round1(newBal),
        updated_at:    new Date().toISOString(),
      }
    })

    // Counts are only credited AFTER the batch write is confirmed — a failed
    // batch must not report these employees as processed (no fabricated
    // success; the original per-employee call never checked its own upsert's
    // error at all, which this fixes as part of the batching rewrite).
    const { error: balErr } = await supabase
      // lint-tenant-ok: balUpserts rows already carry tenant_id (built with tenant_id: tenantId above) — upsert payload is tenant-scoped even though the literal isn't inline in this query chain
      .from('employee_leave_balance')
      .upsert(balUpserts, { onConflict: 'tenant_id,employee_id,leave_type_id,year' })
    if (balErr) {
      console.warn(
        `[leave-entitlement-service] monthly accrual employee_leave_balance batch upsert failed policy=${p.id} year=${year} month=${month}:`,
        balErr.message,
      )
      result.errors.push(`Policy ${p.id}: balance batch write failed — ${balErr.message}`)
      continue
    }

    result.employees_processed += balUpserts.length
    result.total_days_credited  = round1(result.total_days_credited + accrualAmount * balUpserts.length)
  }

  return result
}

// ── Batch: Yearly credit ───────────────────────────────────────────────────────

/**
 * runYearlyCredit — credit the full (optionally prorated) annual entitlement
 * to all eligible active employees at the start of a leave year.
 *
 * Covers leave types with accrual_type = 'yearly' or 'upfront'.
 *
 * Idempotent: an employee's row is only INSERTED once per year.
 * Re-running will NOT double-credit employees already credited — they are
 * counted as `skipped`.
 *
 * @param leaveYear  leave year integer (FY start year for financial)
 */
export async function runYearlyCredit(
  supabase:  SupabaseClient,
  tenantId:  string,
  leaveYear: number,
): Promise<BatchResult> {
  const result: BatchResult = {
    employees_processed:   0,
    total_days_credited:   0,
    skipped:               0,
    errors:                [],
    processed_employee_ids: [],
  }

  const { data: policies, error: pErr } = await supabase
    .from('leave_policies')
    .select('*, leave_types!inner(id, name, is_active)')
    .eq('tenant_id', tenantId)
    .in('accrual_type', ['yearly', 'upfront'])
    .eq('leave_types.is_active', true)

  if (pErr) {
    result.errors.push(`Failed to fetch policies: ${pErr.message}`)
    return result
  }
  if (!policies?.length) return result

  let employees: Array<{ id: string; joining_date: string | null }>
  let eErr: unknown = null
  try {
    employees = await fetchAllRows((from, to) =>
      supabase
        .from('employees')
        .select('id, joining_date')
        .eq('tenant_id', tenantId)
        .eq('status', 'active')
        .order('id')
        .range(from, to),
    )
  } catch (err) {
    employees = []
    eErr = err
  }

  if (eErr) {
    result.errors.push(`Failed to fetch employees: ${(eErr as Error).message}`)
    return result
  }
  if (!employees?.length) return result

  for (const policy of policies as any[]) {
    const p           = policy as LeavePolicy
    const leaveTypeId = p.leave_type_id

    let balanceMap: Map<string, number>
    try {
      balanceMap = await fetchBalanceMap(supabase, tenantId, leaveTypeId, leaveYear)
    } catch (err: any) {
      result.errors.push(`Policy ${p.id}: balance pre-fetch failed — ${err?.message ?? 'unknown error'}`)
      continue
    }

    const daysByEmp: Map<string, number> = new Map()
    const toInsert: Record<string, unknown>[] = []

    for (const emp of employees) {
      if (!emp.joining_date) { result.skipped++; continue }

      const days = computeEntitlement(emp.joining_date, p, leaveYear)
      if (days <= 0) { result.skipped++; continue }

      // Prevents double-crediting on re-run — idempotent per year.
      if (balanceMap.has(emp.id)) { result.skipped++; continue }

      daysByEmp.set(emp.id, days)
      toInsert.push({
        tenant_id:     tenantId,
        employee_id:   emp.id,
        leave_type_id: leaveTypeId,
        year:          leaveYear,
        balance:       days,
        updated_at:    new Date().toISOString(),
      })
    }

    if (!toInsert.length) continue

    // ignoreDuplicates covers the race window between the balance pre-fetch
    // above and this write (e.g. a concurrent duplicate run) — the unique
    // constraint on (tenant_id,employee_id,leave_type_id,year) means a
    // conflicting row is silently skipped rather than erroring, and .select()
    // returns only the rows that were actually inserted so counts stay
    // accurate.
    const { data: inserted, error: balInsErr } = await supabase
      .from('employee_leave_balance')
      .upsert(toInsert, { onConflict: 'tenant_id,employee_id,leave_type_id,year', ignoreDuplicates: true })
      .select('employee_id')

    if (balInsErr) {
      // A missing initial balance row silently manifests to the employee
      // as "0 entitlement" with no trace of why — make it discoverable.
      result.errors.push(`Policy ${p.id}: employee_leave_balance batch insert failed — ${balInsErr.message}`)
      console.warn(
        `[leave-entitlement-service] yearly credit employee_leave_balance batch insert failed policy=${p.id} year=${leaveYear}:`,
        balInsErr.message,
      )
      continue
    }

    const insertedIds = new Set((inserted ?? []).map((r: any) => r.employee_id as string))
    result.skipped += toInsert.length - insertedIds.size

    result.employees_processed += insertedIds.size
    let creditedDays = 0
    for (const id of insertedIds) creditedDays += daysByEmp.get(id) ?? 0
    result.total_days_credited = round1(result.total_days_credited + creditedDays)
  }

  return result
}

// ── Batch: Carry-forward ───────────────────────────────────────────────────────

/**
 * runCarryForward — at year-end, move eligible balance to the next year.
 *
 * Rules:
 *   • Only runs for leave types with carry_forward_enabled = true
 *   • Carry amount = min(current_balance, carry_forward_max_days)
 *     If carry_forward_max_days = null, carry the full remaining balance
 *   • Adds the carry amount on top of any existing toYear balance
 *     (toYear balance may already have a yearly credit from runYearlyCredit)
 *
 * Idempotency note:
 *   This function adds the carry-forward amount; running it twice would
 *   double-credit.  Run it exactly once per year transition, typically
 *   Dec 31 → Jan 1 (calendar) or Mar 31 → Apr 1 (financial).
 *
 * @param fromYear  the ending leave year (e.g. 2025)
 * @param toYear    the starting leave year (fromYear + 1)
 */
export async function runCarryForward(
  supabase: SupabaseClient,
  tenantId: string,
  fromYear: number,
  toYear:   number,
): Promise<BatchResult> {
  const result: BatchResult = {
    employees_processed:   0,
    total_days_credited:   0,
    skipped:               0,
    errors:                [],
    processed_employee_ids: [],
  }

  const { data: policies, error: pErr } = await supabase
    .from('leave_policies')
    .select('*, leave_types!inner(id, name, is_active)')
    .eq('tenant_id',            tenantId)
    .eq('carry_forward_enabled', true)
    .eq('leave_types.is_active', true)

  if (pErr) {
    result.errors.push(`Failed to fetch policies: ${pErr.message}`)
    return result
  }
  if (!policies?.length) return result

  for (const policy of policies as any[]) {
    const p           = policy as LeavePolicy
    const leaveTypeId = p.leave_type_id

    // Fetch all employees who have a positive balance in fromYear
    const { data: balances, error: bErr } = await supabase
      .from('employee_leave_balance')
      .select('employee_id, balance')
      .eq('tenant_id',     tenantId)
      .eq('leave_type_id', leaveTypeId)
      .eq('year',          fromYear)
      .gt('balance',       0)

    if (bErr) {
      result.errors.push(`Failed to fetch balances for type ${leaveTypeId}: ${bErr.message}`)
      continue
    }
    if (!balances?.length) continue

    let toYearBalanceMap: Map<string, number>
    try {
      toYearBalanceMap = await fetchBalanceMap(supabase, tenantId, leaveTypeId, toYear)
    } catch (err: any) {
      result.errors.push(`Policy ${p.id}: toYear balance pre-fetch failed — ${err?.message ?? 'unknown error'}`)
      continue
    }

    const carryByEmp: Map<string, number> = new Map()
    const upserts: Record<string, unknown>[] = []

    for (const b of balances) {
      const balance  = Number(b.balance)
      const maxCarry = p.carry_forward_max_days
      const carryAmt = maxCarry != null ? Math.min(balance, maxCarry) : balance

      if (carryAmt <= 0) { result.skipped++; continue }

      // Add carry-forward on top of any existing toYear balance (e.g. a prior
      // yearly credit) — matches the original per-employee insert-or-update.
      const existingBal = toYearBalanceMap.get(b.employee_id) ?? 0
      carryByEmp.set(b.employee_id, carryAmt)
      upserts.push({
        tenant_id:     tenantId,
        employee_id:   b.employee_id,
        leave_type_id: leaveTypeId,
        year:          toYear,
        balance:       round1(existingBal + carryAmt),
        updated_at:    new Date().toISOString(),
      })
    }

    if (!upserts.length) continue

    const { error: upErr } = await supabase
      // lint-tenant-ok: upserts rows already carry tenant_id (pushed with tenant_id: tenantId above) — upsert payload is tenant-scoped even though the literal isn't inline in this query chain
      .from('employee_leave_balance')
      .upsert(upserts, { onConflict: 'tenant_id,employee_id,leave_type_id,year' })

    if (upErr) {
      // A missing carry-forward balance row silently manifests to the
      // employee as "0 entitlement" with no trace of why.
      result.errors.push(`Policy ${p.id}: employee_leave_balance batch write failed — ${upErr.message}`)
      console.warn(
        `[leave-entitlement-service] carry-forward employee_leave_balance batch upsert failed policy=${p.id} toYear=${toYear}:`,
        upErr.message,
      )
      continue
    }

    result.employees_processed += upserts.length
    let creditedDays = 0
    for (const amt of carryByEmp.values()) creditedDays += amt
    result.total_days_credited = round1(result.total_days_credited + creditedDays)
  }

  return result
}

// ── Engine-aware batch accrual (Step 7) ───────────────────────────────────────
//
// These functions read from leave_policy_rules for employees that have a named
// policy assignment, and fall back to the legacy leave_policies table for the
// rest.  They also write to leave_accrual_ledger for auditable ledger entries.
//
// Design:
//   • Batch-fetch all assignments for the tenant in one query
//   • Build per-employee policy_id map
//   • Load unique policy rules in one further query per policy
//   • Process each employee with their resolved rules
//   • Write ledger entries in addition to updating employee_leave_balance
//
// Existing public functions (runMonthlyAccrual, runYearlyCredit, runCarryForward)
// are NOT changed — they still handle legacy-only tenants correctly.
// Call runEngineMontlyAccrual / runEngineYearlyCredit from the scheduler when
// the engine is active for a tenant.

/** Shape of a leave_policy_rules row as needed by the engine accrual */
interface EnginePolicyRule {
  id:                     string
  policy_id:              string
  leave_type_id:          string
  accrual_type:           'monthly' | 'quarterly' | 'yearly' | 'upfront'
  accrual_days_per_year:  number
  max_accrual_balance:    number | null
  eligibility_days:       number
  prorate_on_joining:     boolean
  carry_forward_enabled:  boolean
  carry_forward_max_days: number | null
  expiry_days:            number | null
  effective_from:         string | null
  effective_to:           string | null
}

interface EnginePolicy {
  id:        string
  year_type: 'calendar' | 'financial'
}

/**
 * Compute quarterly accrual days for an engine policy rule.
 * Each quarter = accrual_days_per_year / 4, rounded to 1 dp.
 */
function computeEngineQuarterlyAmount(rule: EnginePolicyRule): number {
  return round1(rule.accrual_days_per_year / 4)
}

/**
 * runEngineMonthlyAccrual — engine-aware version of runMonthlyAccrual.
 *
 * Processes every active employee against the FULL scope-resolution chain
 * — employee > department > work_location > site > default — not just
 * employees with a personal (employee-scope) override.
 *
 * SYSTEM_AUDIT_2026-10-14 checkpoint 14 — this used to query ONLY
 * scope_type='employee' leave_policy_assignments. Department/work_location/
 * site/default-scoped assignments are a real, fully-supported configuration
 * surface (masters/leave-policy-assignments.ts's own scope_type check
 * constraint and SCOPE_PRIORITY map) — the most common real-world shape,
 * since most employees are covered by a broader scope rather than a named
 * individual override. Every such employee received ZERO accrual from this
 * function, confirmed via scripts/db/verify-accrual-scope-gap.mjs. Fixed by
 * resolving the same priority order in memory for every employee × every
 * leave type with an active monthly/quarterly rule anywhere in the tenant
 * — resolveScopeCandidates()/resolveApplicableRule() below mirror
 * resolve_engine_policy_rule() (migration 470), the canonical SQL resolver
 * also used as the authoritative conflict check inside
 * credit_engine_accrual_atomic and credit_monthly_accrual_batch. Both are
 * tested to agree (scripts/db/verify-scoped-policy-accrual.mjs).
 *
 * Supports monthly AND quarterly accrual types from leave_policy_rules.
 * For quarterly types, credits only on the first month of each quarter
 * (months 1, 4, 7, 10 for calendar year; 4, 7, 10, 1 for financial year).
 *
 * Writes ledger entries in addition to updating employee_leave_balance.
 * Employees ALSO covered by an active leave_accrual_rules (System A) row
 * for the same leave type are not credited here — credit_engine_accrual_
 * atomic detects that overlap inside its own transaction and records it
 * in leave_accrual_conflicts instead (SYSTEM_AUDIT_2026-10-14 checkpoint
 * 14's second confirmed defect — see migration 470's header).
 *
 * @param year   leave year
 * @param month  1-indexed month (1 = January)
 * @param asOf   YYYY-MM-DD for effective-date filtering (default: year-month-01)
 */
export async function runEngineMonthlyAccrual(
  supabase: SupabaseClient,
  tenantId: string,
  year:     number,
  month:    number,
  asOf?:    string,
): Promise<BatchResult> {
  const result: BatchResult = {
    employees_processed:   0,
    total_days_credited:   0,
    skipped:               0,
    errors:                [],
    processed_employee_ids: [],
    conflicted:             0,
  }

  const effectiveAsOf = asOf ?? `${year}-${String(month).padStart(2, '0')}-01`
  const runDate       = effectiveAsOf
  const runPeriod     = `${year}-${String(month).padStart(2, '0')}`

  // ── Fetch ALL active assignments (every scope type) active on the
  // accrual date. scope_type='employee' can scale with employee count;
  // the others are naturally small (bounded by # departments/work
  // locations/sites + at most one 'default' row) — fetchAllRows handles
  // both without a CLAUDE.md-class truncation risk either way.
  let assignments: Array<{ scope_type: string; scope_id: string | null; policy_id: string }>
  try {
    assignments = await fetchAllRows((from, to) =>
      supabase
        .from('leave_policy_assignments')
        .select('scope_type, scope_id, policy_id')
        .eq('tenant_id', tenantId)
        .or(`effective_from.is.null,effective_from.lte.${effectiveAsOf}`)
        .or(`effective_to.is.null,effective_to.gte.${effectiveAsOf}`)
        .range(from, to),
    )
  } catch (err) {
    result.errors.push(`Failed to fetch assignments: ${(err as Error).message}`)
    return result
  }

  if (!assignments.length) return result

  // Index: scope_type -> scope_id (or '' for default) -> policy_id. The
  // DB-level UNIQUE (tenant_id, scope_type, scope_id) guarantees at most
  // one row per key, so this index can never collide.
  const assignmentIndex = new Map<string, Map<string, string>>()
  for (const a of assignments) {
    const byScopeId = assignmentIndex.get(a.scope_type) ?? new Map<string, string>()
    byScopeId.set(a.scope_id ?? '', a.policy_id)
    assignmentIndex.set(a.scope_type, byScopeId)
  }

  // ── Load policy masters + rules for every referenced policy ────────────
  const policyIds = [...new Set(assignments.map(a => a.policy_id))]

  const [{ data: masters }, { data: rules }] = await Promise.all([
    supabase
      .from('leave_policy_masters')
      .select('id, year_type')
      .in('id', policyIds)
      .eq('tenant_id', tenantId),
    supabase
      .from('leave_policy_rules')
      .select(`
        id, policy_id, leave_type_id,
        accrual_type, accrual_days_per_year, max_accrual_balance,
        eligibility_days, prorate_on_joining,
        carry_forward_enabled, carry_forward_max_days,
        expiry_days, effective_from, effective_to
      `)
      .in('policy_id', policyIds)
      .eq('tenant_id', tenantId)
      .in('accrual_type', ['monthly', 'quarterly']),
  ])

  const masterMap = new Map<string, EnginePolicy>(
    ((masters ?? []) as EnginePolicy[]).map(m => [m.id, m]),
  )

  // rulesByPolicyAndType[policy_id][leave_type_id] = rule (effective-dated)
  const rulesByPolicyAndType = new Map<string, Map<string, EnginePolicyRule>>()
  const allLeaveTypeIds = new Set<string>()
  for (const rule of (rules ?? []) as EnginePolicyRule[]) {
    if (rule.effective_from && effectiveAsOf < rule.effective_from) continue
    if (rule.effective_to   && effectiveAsOf > rule.effective_to)   continue
    const byType = rulesByPolicyAndType.get(rule.policy_id) ?? new Map<string, EnginePolicyRule>()
    byType.set(rule.leave_type_id, rule)
    rulesByPolicyAndType.set(rule.policy_id, byType)
    allLeaveTypeIds.add(rule.leave_type_id)
  }
  if (!allLeaveTypeIds.size) return result

  // ── Canonical scope-priority resolver (mirrors resolve_engine_policy_
  // rule() in migration 470, the SQL ground truth used for the execution-
  // time conflict check — kept in sync and tested to agree, see
  // scripts/db/verify-scoped-policy-accrual.mjs).
  const SCOPE_PRIORITY = ['employee', 'department', 'work_location', 'site', 'default'] as const
  function resolveApplicableRule(
    emp: { id: string; department_id: string | null; work_location_id: string | null; site_id: string | null },
    leaveTypeId: string,
  ): EnginePolicyRule | null {
    for (const scopeType of SCOPE_PRIORITY) {
      const scopeId =
        scopeType === 'employee'      ? emp.id :
        scopeType === 'department'    ? emp.department_id :
        scopeType === 'work_location' ? emp.work_location_id :
        scopeType === 'site'          ? emp.site_id :
        /* default */                   null
      if (scopeType !== 'default' && !scopeId) continue
      const policyId = assignmentIndex.get(scopeType)?.get(scopeId ?? '')
      if (!policyId) continue
      const rule = rulesByPolicyAndType.get(policyId)?.get(leaveTypeId)
      if (rule) return rule
    }
    return null
  }

  // ── Fetch all active employees in this tenant, with the scope columns
  // the resolver needs. employees.department_id/work_location_id/site_id
  // are kept in sync with job_history's current row by
  // trg_sync_employee_job_fields (migration 470's header), so no join is
  // needed — the same "current, not historical-as-of" semantics the
  // existing lifecycle/duration resolvers already use.
  let employees: Array<{
    id: string; joining_date: string | null
    department_id: string | null; work_location_id: string | null; site_id: string | null
  }>
  try {
    employees = await fetchAllRows((from, to) =>
      supabase
        .from('employees')
        .select('id, joining_date, department_id, work_location_id, site_id')
        .eq('tenant_id', tenantId)
        .eq('status',    'active')
        .order('id')
        .range(from, to),
    )
  } catch (err) {
    result.errors.push(`Failed to fetch employees: ${(err as Error).message}`)
    return result
  }

  const asOfDate = new Date(`${effectiveAsOf}T12:00:00.000Z`)

  // ── Process every employee × every leave type with an active rule ──────
  for (const emp of employees) {
    if (!emp.joining_date) { result.skipped++; continue }

    for (const leaveTypeId of allLeaveTypeIds) {
      const rule = resolveApplicableRule(emp, leaveTypeId)
      if (!rule) continue   // not covered by any scope for this leave type

      const master = masterMap.get(rule.policy_id)
      if (!master) { result.skipped++; continue }
      const yearType = master.year_type as 'calendar' | 'financial'

      const syntheticPolicy: LeavePolicy = {
        id:                     rule.id,
        tenant_id:              tenantId,
        leave_type_id:          leaveTypeId,
        accrual_type:           rule.accrual_type === 'quarterly' ? 'monthly' : rule.accrual_type,
        accrual_days_per_year:  Number(rule.accrual_days_per_year),
        max_accrual_balance:    rule.max_accrual_balance != null ? Number(rule.max_accrual_balance) : null,
        eligibility_days:       rule.eligibility_days,
        prorate_on_joining:     rule.prorate_on_joining,
        carry_forward_enabled:  rule.carry_forward_enabled,
        carry_forward_max_days: rule.carry_forward_max_days != null ? Number(rule.carry_forward_max_days) : null,
        year_type:              yearType,
        expiry_days:            rule.expiry_days ?? null,
      }

      const elig = checkEligibility(emp.joining_date, syntheticPolicy, asOfDate)
      if (!elig.eligible) { result.skipped++; continue }

      let accrualAmount = 0
      if (rule.accrual_type === 'monthly') {
        accrualAmount = round1(Number(rule.accrual_days_per_year) / 12)
      } else if (rule.accrual_type === 'quarterly') {
        const QUARTER_START_MONTHS = [1, 4, 7, 10] as const
        if (!(QUARTER_START_MONTHS as readonly number[]).includes(month)) {
          result.skipped++; continue
        }
        accrualAmount = computeEngineQuarterlyAmount(rule)
      }
      if (accrualAmount <= 0) { result.skipped++; continue }

      try {
        // credit_engine_accrual_atomic (migrations 469 + 470) does the
        // ledger insert + balance credit in one transaction, AND — as of
        // migration 470 — checks inside that SAME transaction whether
        // leave_accrual_rules (System A) also has an active rule for this
        // leave type as of this date. If so it skips crediting and records
        // the conflict in leave_accrual_conflicts instead of double-
        // crediting; `creditResult.conflict` distinguishes that from a
        // plain idempotent replay (`creditResult.skipped` with
        // `conflict: false`).
        const { data: creditResult, error: creditErr } = await supabase.rpc('credit_engine_accrual_atomic', {
          p_tenant_id:     tenantId,
          p_employee_id:   emp.id,
          p_leave_type_id: leaveTypeId,
          p_accrual_type:  rule.accrual_type,
          p_days:          accrualAmount,
          p_year:          year,
          p_accrued_on:    runDate,
          p_notes:         `Engine ${rule.accrual_type} accrual — policy ${rule.policy_id}`,
          p_max_balance:   rule.max_accrual_balance ?? null,
          p_period:        runPeriod,
        })
        if (creditErr) throw new Error(creditErr.message)
        const typedResult = creditResult as { skipped: boolean; conflict: boolean }
        if (typedResult.skipped) {
          if (typedResult.conflict) result.conflicted = (result.conflicted ?? 0) + 1
          else result.skipped++
          continue
        }

        result.employees_processed++
        result.total_days_credited = round1(result.total_days_credited + accrualAmount)
        if (!result.processed_employee_ids.includes(emp.id)) {
          result.processed_employee_ids.push(emp.id)
        }
      } catch (err: any) {
        result.errors.push(
          `emp ${emp.id} / type ${leaveTypeId}: ${err?.message ?? 'unknown error'}`,
        )
      }
    }
  }

  return result
}

/**
 * runEngineYearlyCredit — engine-aware version of runYearlyCredit.
 *
 * Processes employees with an active named policy assignment that have
 * yearly or upfront accrual rules.  Writes ledger entries.
 *
 * @param leaveYear   leave year integer
 * @param asOf        YYYY-MM-DD for effective-date filtering
 */
export async function runEngineYearlyCredit(
  supabase:  SupabaseClient,
  tenantId:  string,
  leaveYear: number,
  asOf?:     string,
): Promise<BatchResult> {
  const result: BatchResult = {
    employees_processed:   0,
    total_days_credited:   0,
    skipped:               0,
    errors:                [],
    processed_employee_ids: [],
    conflicted:             0,
  }

  // Default asOf to Jan 1 of the leave year
  const effectiveAsOf = asOf ?? `${leaveYear}-01-01`
  const runDate       = effectiveAsOf
  const runPeriod     = String(leaveYear)

  // SYSTEM_AUDIT_2026-10-14 checkpoint 14 — same full scope-chain fix as
  // runEngineMonthlyAccrual above (see its header comment for the full
  // writeup): fetch EVERY active assignment (every scope type), not just
  // scope_type='employee', and resolve per employee × leave type via the
  // same priority order mirrored from resolve_engine_policy_rule()
  // (migration 470).
  let assignments: Array<{ scope_type: string; scope_id: string | null; policy_id: string }>
  try {
    assignments = await fetchAllRows((from, to) =>
      supabase
        .from('leave_policy_assignments')
        .select('scope_type, scope_id, policy_id')
        .eq('tenant_id', tenantId)
        .or(`effective_from.is.null,effective_from.lte.${effectiveAsOf}`)
        .or(`effective_to.is.null,effective_to.gte.${effectiveAsOf}`)
        .range(from, to),
    )
  } catch (err) {
    result.errors.push(`Failed to fetch assignments: ${(err as Error).message}`)
    return result
  }

  if (!assignments.length) return result

  const assignmentIndex = new Map<string, Map<string, string>>()
  for (const a of assignments) {
    const byScopeId = assignmentIndex.get(a.scope_type) ?? new Map<string, string>()
    byScopeId.set(a.scope_id ?? '', a.policy_id)
    assignmentIndex.set(a.scope_type, byScopeId)
  }

  const policyIds = [...new Set(assignments.map(a => a.policy_id))]

  const [{ data: masters }, { data: rules }] = await Promise.all([
    supabase.from('leave_policy_masters')
      .select('id, year_type')
      .in('id', policyIds)
      .eq('tenant_id', tenantId),
    supabase.from('leave_policy_rules')
      .select(`
        id, policy_id, leave_type_id,
        accrual_type, accrual_days_per_year, max_accrual_balance,
        eligibility_days, prorate_on_joining,
        carry_forward_enabled, carry_forward_max_days,
        expiry_days, effective_from, effective_to
      `)
      .in('policy_id', policyIds)
      .eq('tenant_id', tenantId)
      .in('accrual_type', ['yearly', 'upfront']),
  ])

  const masterMap = new Map<string, EnginePolicy>(
    ((masters ?? []) as EnginePolicy[]).map(m => [m.id, m]),
  )

  const rulesByPolicyAndType = new Map<string, Map<string, EnginePolicyRule>>()
  const allLeaveTypeIds = new Set<string>()
  for (const rule of (rules ?? []) as EnginePolicyRule[]) {
    if (rule.effective_from && effectiveAsOf < rule.effective_from) continue
    if (rule.effective_to   && effectiveAsOf > rule.effective_to)   continue
    const byType = rulesByPolicyAndType.get(rule.policy_id) ?? new Map<string, EnginePolicyRule>()
    byType.set(rule.leave_type_id, rule)
    rulesByPolicyAndType.set(rule.policy_id, byType)
    allLeaveTypeIds.add(rule.leave_type_id)
  }
  if (!allLeaveTypeIds.size) return result

  const SCOPE_PRIORITY = ['employee', 'department', 'work_location', 'site', 'default'] as const
  function resolveApplicableRule(
    emp: { id: string; department_id: string | null; work_location_id: string | null; site_id: string | null },
    leaveTypeId: string,
  ): EnginePolicyRule | null {
    for (const scopeType of SCOPE_PRIORITY) {
      const scopeId =
        scopeType === 'employee'      ? emp.id :
        scopeType === 'department'    ? emp.department_id :
        scopeType === 'work_location' ? emp.work_location_id :
        scopeType === 'site'          ? emp.site_id :
        /* default */                   null
      if (scopeType !== 'default' && !scopeId) continue
      const policyId = assignmentIndex.get(scopeType)?.get(scopeId ?? '')
      if (!policyId) continue
      const rule = rulesByPolicyAndType.get(policyId)?.get(leaveTypeId)
      if (rule) return rule
    }
    return null
  }

  let employees: Array<{
    id: string; joining_date: string | null
    department_id: string | null; work_location_id: string | null; site_id: string | null
  }>
  try {
    employees = await fetchAllRows((from, to) =>
      supabase
        .from('employees')
        .select('id, joining_date, department_id, work_location_id, site_id')
        .eq('tenant_id', tenantId)
        .eq('status',    'active')
        .order('id')
        .range(from, to),
    )
  } catch (err) {
    result.errors.push(`Failed to fetch employees: ${(err as Error).message}`)
    return result
  }

  const asOfDate = new Date(`${effectiveAsOf}T12:00:00.000Z`)

  for (const emp of employees) {
    if (!emp.joining_date) { result.skipped++; continue }

    for (const leaveTypeId of allLeaveTypeIds) {
      const rule = resolveApplicableRule(emp, leaveTypeId)
      if (!rule) continue

      const master = masterMap.get(rule.policy_id)
      if (!master) { result.skipped++; continue }
      const yearType = master.year_type as 'calendar' | 'financial'

      const syntheticPolicy: LeavePolicy = {
        id:                     rule.id,
        tenant_id:              tenantId,
        leave_type_id:          leaveTypeId,
        accrual_type:           rule.accrual_type as 'yearly' | 'upfront',
        accrual_days_per_year:  Number(rule.accrual_days_per_year),
        max_accrual_balance:    rule.max_accrual_balance != null ? Number(rule.max_accrual_balance) : null,
        eligibility_days:       rule.eligibility_days,
        prorate_on_joining:     rule.prorate_on_joining,
        carry_forward_enabled:  rule.carry_forward_enabled,
        carry_forward_max_days: rule.carry_forward_max_days != null ? Number(rule.carry_forward_max_days) : null,
        year_type:              yearType,
        expiry_days:            rule.expiry_days ?? null,
      }

      const days = computeEntitlement(emp.joining_date, syntheticPolicy, leaveYear)
      if (days <= 0) { result.skipped++; continue }

      const elig = checkEligibility(emp.joining_date, syntheticPolicy, asOfDate)
      if (!elig.eligible) { result.skipped++; continue }

      try {
        let expiresOn: string | null = null
        if (rule.expiry_days) {
          const exp = new Date(`${effectiveAsOf}T12:00:00.000Z`)
          exp.setUTCDate(exp.getUTCDate() + rule.expiry_days)
          expiresOn = exp.toISOString().slice(0, 10)
        }

        // SYSTEM_AUDIT_2026-10-14 checkpoint 14 — reuses the SAME atomic
        // RPC as the monthly path (migrations 469 + 470): the ledger
        // row's uniqueness on (employee, leave_type, year, accrual_type,
        // accrued_on) is what actually enforces "grant once per year" —
        // accrued_on is always this leave year's canonical runDate
        // (Jan 1 unless overridden), so a repeat call for the same year
        // always collides on the same key and is skipped, same guarantee
        // the old separate "does a balance row already exist" pre-check
        // was reaching for, but now race-safe and atomic with the credit
        // itself, and conflict-checked against System A
        // (leave_accrual_rules) the same way the monthly path is.
        const { data: creditResult, error: creditErr } = await supabase.rpc('credit_engine_accrual_atomic', {
          p_tenant_id:     tenantId,
          p_employee_id:   emp.id,
          p_leave_type_id: leaveTypeId,
          p_accrual_type:  rule.accrual_type,
          p_days:          days,
          p_year:          leaveYear,
          p_accrued_on:    runDate,
          p_expires_on:    expiresOn,
          p_notes:         `Engine ${rule.accrual_type} credit — policy ${rule.policy_id}`,
          p_max_balance:   rule.max_accrual_balance ?? null,
          p_period:        runPeriod,
        })
        if (creditErr) throw new Error(creditErr.message)
        const typedResult = creditResult as { skipped: boolean; conflict: boolean }
        if (typedResult.skipped) {
          if (typedResult.conflict) result.conflicted = (result.conflicted ?? 0) + 1
          else result.skipped++
          continue
        }

        result.employees_processed++
        result.total_days_credited = round1(result.total_days_credited + days)
        if (!result.processed_employee_ids.includes(emp.id)) {
          result.processed_employee_ids.push(emp.id)
        }
      } catch (err: any) {
        result.errors.push(
          `emp ${emp.id} / type ${leaveTypeId}: ${err?.message ?? 'unknown error'}`,
        )
      }
    }
  }

  return result
}

// ── Internal helpers ───────────────────────────────────────────────────────────

/** Round to 1 decimal place (e.g. 1.25 → 1.3) */
function round1(n: number): number {
  return Math.round(n * 10) / 10
}

/**
 * Count calendar months from `from` through `to` (inclusive on both ends).
 * E.g. Apr 2025 → Dec 2025 = 9 months.
 * Uses the UTC month/year only — day is ignored.
 */
function monthsBetween(from: Date, to: Date): number {
  const fy = from.getUTCFullYear()
  const fm = from.getUTCMonth()
  const ty = to.getUTCFullYear()
  const tm = to.getUTCMonth()
  return (ty - fy) * 12 + (tm - fm) + 1
}
