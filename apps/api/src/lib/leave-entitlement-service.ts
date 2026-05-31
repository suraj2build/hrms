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
  const { data: employees, error: eErr } = await supabase
    .from('employees')
    .select('id, joining_date')
    .eq('tenant_id', tenantId)
    .eq('status', 'active')

  if (eErr) {
    result.errors.push(`Failed to fetch employees: ${eErr.message}`)
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

    for (const emp of employees) {
      if (!emp.joining_date) { result.skipped++; continue }

      const elig = checkEligibility(emp.joining_date, p, asOf)
      if (!elig.eligible) { result.skipped++; continue }

      try {
        await creditEmployeeDays(
          supabase, tenantId, emp.id, leaveTypeId,
          accrualAmount, year, p.max_accrual_balance,
        )
        result.employees_processed++
        result.total_days_credited = round1(result.total_days_credited + accrualAmount)
      } catch (err: any) {
        result.errors.push(`emp ${emp.id} / type ${leaveTypeId}: ${err?.message ?? 'unknown error'}`)
      }
    }
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

  const { data: employees, error: eErr } = await supabase
    .from('employees')
    .select('id, joining_date')
    .eq('tenant_id', tenantId)
    .eq('status', 'active')

  if (eErr) {
    result.errors.push(`Failed to fetch employees: ${eErr.message}`)
    return result
  }
  if (!employees?.length) return result

  for (const policy of policies as any[]) {
    const p           = policy as LeavePolicy
    const leaveTypeId = p.leave_type_id

    for (const emp of employees) {
      if (!emp.joining_date) { result.skipped++; continue }

      const days = computeEntitlement(emp.joining_date, p, leaveYear)
      if (days <= 0) { result.skipped++; continue }

      try {
        // Check for an existing row — prevents double-crediting on re-run
        const { data: existing } = await supabase
          .from('employee_leave_balance')
          .select('id')
          .eq('tenant_id',     tenantId)
          .eq('employee_id',   emp.id)
          .eq('leave_type_id', leaveTypeId)
          .eq('year',          leaveYear)
          .maybeSingle()

        if (existing) {
          result.skipped++
          continue
        }

        await supabase.from('employee_leave_balance').insert({
          tenant_id:     tenantId,
          employee_id:   emp.id,
          leave_type_id: leaveTypeId,
          year:          leaveYear,
          balance:       days,
          updated_at:    new Date().toISOString(),
        })

        result.employees_processed++
        result.total_days_credited = round1(result.total_days_credited + days)
      } catch (err: any) {
        result.errors.push(`emp ${emp.id} / type ${leaveTypeId}: ${err?.message ?? 'unknown error'}`)
      }
    }
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

    for (const b of balances) {
      const balance  = Number(b.balance)
      const maxCarry = p.carry_forward_max_days
      const carryAmt = maxCarry != null ? Math.min(balance, maxCarry) : balance

      if (carryAmt <= 0) { result.skipped++; continue }

      try {
        // Fetch existing toYear row (runYearlyCredit may have already run)
        const { data: existing } = await supabase
          .from('employee_leave_balance')
          .select('id, balance')
          .eq('tenant_id',     tenantId)
          .eq('employee_id',   b.employee_id)
          .eq('leave_type_id', leaveTypeId)
          .eq('year',          toYear)
          .maybeSingle()

        if (!existing) {
          // No toYear row yet — insert with carry-forward amount
          await supabase.from('employee_leave_balance').insert({
            tenant_id:     tenantId,
            employee_id:   b.employee_id,
            leave_type_id: leaveTypeId,
            year:          toYear,
            balance:       round1(carryAmt),
            updated_at:    new Date().toISOString(),
          })
        } else {
          // Add carry-forward on top of existing toYear balance (e.g. yearly credit)
          const newBal = round1(Number(existing.balance) + carryAmt)
          await supabase
            .from('employee_leave_balance')
            .update({ balance: newBal, updated_at: new Date().toISOString() })
            .eq('id', existing.id)
        }

        result.employees_processed++
        result.total_days_credited = round1(result.total_days_credited + carryAmt)
      } catch (err: any) {
        result.errors.push(
          `emp ${b.employee_id} / type ${leaveTypeId}: ${err?.message ?? 'unknown error'}`,
        )
      }
    }
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
 * Write a ledger entry to leave_accrual_ledger.  Non-fatal on error.
 *
 * Uses upsert with ignoreDuplicates so that re-running the same job for the
 * same period never creates a second entry (idempotency at the DB level via
 * uidx_accrual_ledger_idempotency on accrual types that support it).
 */
async function writeLedgerEntry(
  supabase:    SupabaseClient,
  tenantId:    string,
  employeeId:  string,
  leaveTypeId: string,
  accrualType: string,
  days:        number,
  year:        number,
  accrualDate: string,  // YYYY-MM-DD; stored in `accrued_on` (was incorrectly `run_date`)
  expiresOn:   string | null,
  note?:       string,
): Promise<void> {
  try {
    await supabase.from('leave_accrual_ledger').upsert(
      {
        tenant_id:     tenantId,
        employee_id:   employeeId,
        leave_type_id: leaveTypeId,
        accrual_type:  accrualType,
        days,
        year,
        accrued_on:    accrualDate,   // correct column name (not run_date)
        expires_on:    expiresOn,
        is_expired:    false,
        notes:         note ?? null,  // correct column name (not note)
      },
      {
        onConflict:       'tenant_id,employee_id,leave_type_id,year,accrual_type,accrued_on',
        ignoreDuplicates: true,
      },
    )
  } catch {
    // swallow — ledger write is supplemental; balance update is primary
  }
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
 * Processes employees that have an active named policy assignment.
 * Supports monthly AND quarterly accrual types from leave_policy_rules.
 * For quarterly types, credits only on the first month of each quarter
 * (months 1, 4, 7, 10 for calendar year; 4, 7, 10, 1 for financial year).
 *
 * Writes ledger entries in addition to updating employee_leave_balance.
 *
 * Employees WITHOUT a named policy assignment are handled by the legacy
 * runMonthlyAccrual — this function does NOT overlap with them.
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
  }

  const effectiveAsOf = asOf ?? `${year}-${String(month).padStart(2, '0')}-01`
  const runDate       = effectiveAsOf

  // ── Step 2: Fetch only assignments active on the accrual date ─────────
  // DB-level filters push the effective-date window to PostgREST:
  //   effective_from IS NULL  OR  effective_from <= asOf
  //   effective_to   IS NULL  OR  effective_to   >= asOf
  const { data: assignments, error: aErr } = await supabase
    .from('leave_policy_assignments')
    .select('employee_id: scope_id, policy_id, scope_type, effective_from, effective_to')
    .eq('tenant_id',  tenantId)
    .eq('scope_type', 'employee')
    .or(`effective_from.is.null,effective_from.lte.${effectiveAsOf}`)
    .or(`effective_to.is.null,effective_to.gte.${effectiveAsOf}`)

  if (aErr) {
    result.errors.push(`Failed to fetch assignments: ${aErr.message}`)
    return result
  }

  // ── Step 3: One-policy-per-employee guard ─────────────────────────────────
  // If the same employee has more than one active assignment (misconfiguration),
  // keep only the first encountered.  Because we only fetch scope_type='employee'
  // assignments, the first entry in the DB result is treated as the canonical
  // one (insertion order).  This prevents double-accrual from duplicate rows.
  const seenEmployees     = new Set<string>()
  const deduplicatedRaw   = (assignments ?? []) as Array<{
    employee_id: string; policy_id: string
  }>
  const activeAssignments = deduplicatedRaw.filter(a => {
    if (seenEmployees.has(a.employee_id)) return false
    seenEmployees.add(a.employee_id)
    return true
  })

  if (!activeAssignments.length) return result

  // ── Load unique policy masters + rules ─────────────────────────────────
  const policyIds = [...new Set(activeAssignments.map(a => a.policy_id))]

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

  // Group rules by policy_id, filtering inactive rules
  const rulesByPolicy = new Map<string, EnginePolicyRule[]>()
  for (const rule of (rules ?? []) as EnginePolicyRule[]) {
    if (rule.effective_from && effectiveAsOf < rule.effective_from) continue
    if (rule.effective_to   && effectiveAsOf > rule.effective_to)   continue
    const existing = rulesByPolicy.get(rule.policy_id) ?? []
    existing.push(rule)
    rulesByPolicy.set(rule.policy_id, existing)
  }

  // ── Fetch all active employees in this tenant ──────────────────────────
  const { data: employees, error: eErr } = await supabase
    .from('employees')
    .select('id, joining_date')
    .eq('tenant_id', tenantId)
    .eq('status',    'active')

  if (eErr) {
    result.errors.push(`Failed to fetch employees: ${eErr.message}`)
    return result
  }

  const empMap = new Map<string, { joining_date: string | null }>(
    ((employees ?? []) as Array<{ id: string; joining_date: string | null }>)
      .map(e => [e.id, { joining_date: e.joining_date }]),
  )

  const asOfDate = new Date(`${effectiveAsOf}T12:00:00.000Z`)

  // ── Process each assignment ────────────────────────────────────────────
  for (const assignment of activeAssignments) {
    const emp    = empMap.get(assignment.employee_id)
    if (!emp?.joining_date) { result.skipped++; continue }

    const master = masterMap.get(assignment.policy_id)
    if (!master) { result.skipped++; continue }

    const policyRules = rulesByPolicy.get(assignment.policy_id) ?? []
    if (!policyRules.length) { result.skipped++; continue }

    const yearType = master.year_type as 'calendar' | 'financial'

    for (const rule of policyRules) {
      const leaveTypeId = rule.leave_type_id

      // Build a synthetic LeavePolicy for eligibility check
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

      // Determine credit amount
      let accrualAmount = 0

      if (rule.accrual_type === 'monthly') {
        accrualAmount = round1(Number(rule.accrual_days_per_year) / 12)
      } else if (rule.accrual_type === 'quarterly') {
        // Step 3: quarterly accrual fires only in the four calendar quarter-start
        // months — Jan(1), Apr(4), Jul(7), Oct(10) — regardless of year_type.
        // Both calendar and financial year quarters start in these same months
        // (FY just labels them Q4/Q1/Q2/Q3 instead of Q1/Q2/Q3/Q4).
        const QUARTER_START_MONTHS = [1, 4, 7, 10] as const
        if (!(QUARTER_START_MONTHS as readonly number[]).includes(month)) {
          result.skipped++; continue
        }
        accrualAmount = computeEngineQuarterlyAmount(rule)
      }

      if (accrualAmount <= 0) { result.skipped++; continue }

      try {
        await creditEmployeeDays(
          supabase, tenantId, assignment.employee_id, leaveTypeId,
          accrualAmount, year, rule.max_accrual_balance,
        )

        await writeLedgerEntry(
          supabase, tenantId, assignment.employee_id, leaveTypeId,
          rule.accrual_type, accrualAmount, year, runDate, null,
          `Engine ${rule.accrual_type} accrual — policy ${assignment.policy_id}`,
        )

        result.employees_processed++
        result.total_days_credited = round1(result.total_days_credited + accrualAmount)
        // Step 1: track which employees were credited so Phase 2 (legacy) can skip them
        if (!result.processed_employee_ids.includes(assignment.employee_id)) {
          result.processed_employee_ids.push(assignment.employee_id)
        }
      } catch (err: any) {
        result.errors.push(
          `emp ${assignment.employee_id} / type ${leaveTypeId}: ${err?.message ?? 'unknown error'}`,
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
  }

  // Default asOf to Jan 1 of the leave year
  const effectiveAsOf = asOf ?? `${leaveYear}-01-01`
  const runDate       = effectiveAsOf

  // ── Step 2: Fetch only assignments active on the accrual date ─────────
  const { data: assignments, error: aErr } = await supabase
    .from('leave_policy_assignments')
    .select('employee_id: scope_id, policy_id, scope_type, effective_from, effective_to')
    .eq('tenant_id',  tenantId)
    .eq('scope_type', 'employee')
    .or(`effective_from.is.null,effective_from.lte.${effectiveAsOf}`)
    .or(`effective_to.is.null,effective_to.gte.${effectiveAsOf}`)

  if (aErr) {
    result.errors.push(`Failed to fetch assignments: ${aErr.message}`)
    return result
  }

  // ── Step 3: One-policy-per-employee guard (yearly) ────────────────────────
  const seenEmployeesY      = new Set<string>()
  const deduplicatedRawY    = (assignments ?? []) as Array<{
    employee_id: string; policy_id: string
  }>
  const activeAssignments   = deduplicatedRawY.filter(a => {
    if (seenEmployeesY.has(a.employee_id)) return false
    seenEmployeesY.add(a.employee_id)
    return true
  })

  if (!activeAssignments.length) return result

  const policyIds = [...new Set(activeAssignments.map(a => a.policy_id))]

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

  const rulesByPolicy = new Map<string, EnginePolicyRule[]>()
  for (const rule of (rules ?? []) as EnginePolicyRule[]) {
    if (rule.effective_from && effectiveAsOf < rule.effective_from) continue
    if (rule.effective_to   && effectiveAsOf > rule.effective_to)   continue
    const existing = rulesByPolicy.get(rule.policy_id) ?? []
    existing.push(rule)
    rulesByPolicy.set(rule.policy_id, existing)
  }

  const { data: employees, error: eErr } = await supabase
    .from('employees')
    .select('id, joining_date')
    .eq('tenant_id', tenantId)
    .eq('status',    'active')

  if (eErr) {
    result.errors.push(`Failed to fetch employees: ${eErr.message}`)
    return result
  }

  const empMap = new Map<string, { joining_date: string | null }>(
    ((employees ?? []) as Array<{ id: string; joining_date: string | null }>)
      .map(e => [e.id, { joining_date: e.joining_date }]),
  )

  const asOfDate = new Date(`${effectiveAsOf}T12:00:00.000Z`)

  for (const assignment of activeAssignments) {
    const emp    = empMap.get(assignment.employee_id)
    if (!emp?.joining_date) { result.skipped++; continue }

    const master = masterMap.get(assignment.policy_id)
    if (!master) { result.skipped++; continue }

    const policyRules = rulesByPolicy.get(assignment.policy_id) ?? []
    if (!policyRules.length) { result.skipped++; continue }

    const yearType = master.year_type as 'calendar' | 'financial'

    for (const rule of policyRules) {
      const leaveTypeId = rule.leave_type_id

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

      // Check eligibility
      const elig = checkEligibility(emp.joining_date, syntheticPolicy, asOfDate)
      if (!elig.eligible) { result.skipped++; continue }

      try {
        // Idempotency: skip if balance row already exists for this year
        const { data: existing } = await supabase
          .from('employee_leave_balance')
          .select('id')
          .eq('tenant_id',     tenantId)
          .eq('employee_id',   assignment.employee_id)
          .eq('leave_type_id', leaveTypeId)
          .eq('year',          leaveYear)
          .maybeSingle()

        if (existing) { result.skipped++; continue }

        await supabase.from('employee_leave_balance').insert({
          tenant_id:     tenantId,
          employee_id:   assignment.employee_id,
          leave_type_id: leaveTypeId,
          year:          leaveYear,
          balance:       days,
          updated_at:    new Date().toISOString(),
        })

        // Write expiring ledger entry if expiry_days is set
        let expiresOn: string | null = null
        if (rule.expiry_days) {
          const exp = new Date(`${effectiveAsOf}T12:00:00.000Z`)
          exp.setUTCDate(exp.getUTCDate() + rule.expiry_days)
          expiresOn = exp.toISOString().slice(0, 10)
        }

        await writeLedgerEntry(
          supabase, tenantId, assignment.employee_id, leaveTypeId,
          rule.accrual_type, days, leaveYear, runDate, expiresOn,
          `Engine ${rule.accrual_type} credit — policy ${assignment.policy_id}`,
        )

        result.employees_processed++
        result.total_days_credited = round1(result.total_days_credited + days)
        // Step 1: track credited employees to prevent Phase 2 double-accrual
        if (!result.processed_employee_ids.includes(assignment.employee_id)) {
          result.processed_employee_ids.push(assignment.employee_id)
        }
      } catch (err: any) {
        result.errors.push(
          `emp ${assignment.employee_id} / type ${leaveTypeId}: ${err?.message ?? 'unknown error'}`,
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
