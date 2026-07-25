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
import { fetchAllRows } from './supabase-paginate.js'
import {
  type LeavePolicy,
  type BatchResult,
  checkEligibility,
  computeEntitlement,
  computeMonthlyAccrualAmount,
  computeQuarterlyAccrualAmount,
  creditEmployeeDays,
  runEngineMonthlyAccrual,
  runEngineYearlyCredit,
} from './leave-entitlement-service.js'
import {
  evaluateAccrualLifecycle,
  type LifecyclePolicy,
  type AccrualTierRow,
  type ActiveFreeze,
  type AccrualContext,
} from './leave-accrual-lifecycle-engine.js'
import { checkCycleOwnership } from './leave-replay-engine.js'
import { writeAccrualEntry, expireAccrualEntry } from './leave-ledger-service.js'

// ── Replay infrastructure helpers ─────────────────────────────────────────────

/**
 * Generate a fully deterministic cycle key for a ledger entry.
 * Format: '{tenantId}:{employeeId}:{leaveTypeId}:{year}:{cycleDescriptor}:{accrualType}'
 *
 * cycleDescriptor examples:
 *   monthly:     'YYYY-MM'  e.g. '2026-05'
 *   quarterly:   'YYYY-QN'  e.g. '2026-Q2'
 *   yearly:      'YYYY'     e.g. '2026'
 *   carry_fwd:   'cf-YYYY'  e.g. 'cf-2026'
 */
export function generateCycleKey(
  tenantId:        string,
  employeeId:      string,
  leaveTypeId:     string,
  year:            number,
  cycleDescriptor: string,   // e.g. '2026-05', '2026-Q2', '2026'
  accrualType:     string,
): string {
  return `${tenantId}:${employeeId}:${leaveTypeId}:${year}:${cycleDescriptor}:${accrualType}`
}

/**
 * Generate a new UUID-based lineage ID for a job run.
 * All ledger entries written within the same job run share this ID.
 */
export function generateLineageId(): string {
  return crypto.randomUUID()
}

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

interface JobLogOptions {
  triggerType?: 'scheduler' | 'manual_replay' | 'recovery' | 'dry_run'
  dryRun?:      boolean
  reason?:      string
}

async function startJobLog(
  supabase:    SupabaseClient,
  tenantId:    string,
  jobType:     JobType,
  params:      Record<string, unknown>,
  triggeredBy: string | null,
  opts:        JobLogOptions = {},
): Promise<string> {
  const { data } = await supabase
    .from('leave_job_log')
    .insert({
      tenant_id:    tenantId,
      job_type:     jobType,
      status:       'running',
      params,
      triggered_by: triggeredBy,
      trigger_type: opts.dryRun ? 'dry_run' : (opts.triggerType ?? 'scheduler'),
      dry_run:      opts.dryRun ?? false,
      replay_reason: opts.reason ?? null,
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

interface LedgerWriteContext {
  /** UUID shared by all entries written in the same job run (for audit lineage) */
  lineageId?:       string
  /** Deterministic cycle key — used by the replay engine for idempotency checks */
  cycleKey?:        string
  /** If this entry was written as part of a replay, the original lineageId */
  parentReplayId?:  string
  /** Policy snapshot ID that governed this accrual (from leave_policy_snapshots) */
  snapshotId?:      string
}

/**
 * Thin delegate to writeAccrualEntry() in leave-ledger-service.
 *
 * leave-ledger-service is the SOLE write authority for leave_accrual_ledger.
 * This wrapper preserves the internal call signature used across job handlers
 * without duplicating the upsert logic.
 */
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
  ctx?:         LedgerWriteContext,
): Promise<{ skipped: boolean }> {
  return writeAccrualEntry(supabase, {
    tenantId,
    employeeId,
    leaveTypeId,
    year,
    accrualType,
    days,
    accruedOn,
    expiresOn:       expiresOn ?? undefined,
    notes,
    cycleKey:        ctx?.cycleKey,
    lineageId:       ctx?.lineageId,
    parentReplayId:  ctx?.parentReplayId,
    snapshotId:      ctx?.snapshotId,
  })
}

/**
 * Guard: return true if a job of the given type is already running for this tenant.
 *
 * Checks leave_job_log for a 'running' record started within the last 2 hours.
 * The 2-hour window prevents stale 'running' rows (from crashed jobs) from
 * permanently blocking future runs.
 *
 * Usage: call at the very start of each scheduler job; abort if true.
 */
async function isJobAlreadyRunning(
  supabase:  SupabaseClient,
  tenantId:  string,
  jobType:   JobType,
): Promise<boolean> {
  const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString()

  const { data } = await supabase
    .from('leave_job_log')
    .select('id')
    .eq('tenant_id', tenantId)
    .eq('job_type',  jobType)
    .eq('status',    'running')
    .gte('started_at', twoHoursAgo)
    .limit(1)
    .maybeSingle()

  return !!data
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
  return fetchAllRows((from, to) =>
    supabase
      .from('employees')
      .select('id, joining_date')
      .eq('tenant_id', tenantId)
      .eq('status', 'active')
      .order('id')
      .range(from, to),
  )
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
  opts:        JobLogOptions = {},
): Promise<JobResult> {
  const startedAt = Date.now()

  // Concurrency guard: abort if this job type is already running for this tenant.
  // Prevents duplicate balance credits when the scheduler fires overlapping ticks.
  if (await isJobAlreadyRunning(supabase, tenantId, 'monthly_accrual')) {
    return {
      job_id: 'skipped', job_type: 'monthly_accrual', status: 'completed',
      employees_processed: 0, total_days_credited: 0, skipped: 0,
      errors: ['Skipped: monthly_accrual already running for this tenant'],
      duration_ms: Date.now() - startedAt,
    }
  }

  // Generate a lineage ID for this job run — all ledger entries share this ID
  const lineageId = generateLineageId()
  const jobId = await startJobLog(
    supabase, tenantId, 'monthly_accrual', { year, month, lineage_id: lineageId }, triggeredBy, opts,
  )

  // Store lineage_id in the job log row for cross-referencing
  await supabase
    .from('leave_job_log')
    .update({ lineage_id: lineageId })
    .eq('id', jobId)

  let employees_processed = 0
  let total_days_credited  = 0
  let skipped              = 0
  const errors: string[]   = []

  const monthPad    = String(month).padStart(2, '0')
  const cycleLabel  = `${year}-${monthPad}`  // e.g. '2026-05'
  const quarterNum  = Math.ceil(month / 3)
  const quarterLabel = `${year}-Q${quarterNum}`   // e.g. '2026-Q2'

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

    const accrualDate    = `${year}-${monthPad}-01`
    const monthlyPolicies  = policies.filter(p => p.accrual_type === 'monthly')
    const QUARTER_MONTHS   = [1, 4, 7, 10] as const
    const quarterlyPolicies = QUARTER_MONTHS.includes(month as 1 | 4 | 7 | 10)
      ? policies.filter(p => p.accrual_type === 'quarterly')
      : []

    // ── Monthly ──────────────────────────────────────────────────────────────
    if (monthlyPolicies.length && employees.length) {
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

            // Deterministic cycle key — idempotency guard for replay
            const cycleKey = generateCycleKey(tenantId, emp.id, policy.leave_type_id, year, cycleLabel, 'monthly')

            // Ledger is the authority — write it first. Only credit the (non-
            // idempotent) balance cache when the ledger row was actually inserted,
            // so a re-run of the same cycle never double-credits the cache.
            const { skipped: alreadyCredited } = await writeLedgerEntry(
              supabase, tenantId, emp.id, policy.leave_type_id, year,
              'monthly', monthlyDays, accrualDate, expiresOn,
              `Monthly accrual ${cycleLabel}`,
              { lineageId, cycleKey },
            )
            if (alreadyCredited) { skipped++; continue }

            // Credit balance (respects max_accrual_balance cap)
            await creditEmployeeDays(
              supabase, tenantId, emp.id, policy.leave_type_id,
              monthlyDays, year, policy.max_accrual_balance ?? undefined,
            )

            employees_processed++
            total_days_credited = parseFloat((total_days_credited + monthlyDays).toFixed(2))
          } catch (e: unknown) {
            errors.push(`Emp ${emp.id} policy ${policy.id}: ${(e as Error).message}`)
          }
        }
      }
    }

    // ── Quarterly (only runs on quarter-start months: Jan/Apr/Jul/Oct) ────────
    if (quarterlyPolicies.length && employees.length) {
      for (const policy of quarterlyPolicies) {
        const quarterlyDays = computeQuarterlyAccrualAmount(policy)
        if (quarterlyDays <= 0) {
          skipped += employees.length
          continue
        }

        const expiresOn = policy.expiry_days
          ? shiftDay(accrualDate, policy.expiry_days)
          : null

        for (const emp of employees) {
          if (engineProcessed.has(emp.id)) { skipped++; continue }

          try {
            const asOfDate = new Date(`${accrualDate}T12:00:00.000Z`)
            const elig = checkEligibility(emp.joining_date, policy, asOfDate)
            if (!elig.eligible) { skipped++; continue }

            // Deterministic cycle key — idempotency guard for replay
            const cycleKey = generateCycleKey(tenantId, emp.id, policy.leave_type_id, year, quarterLabel, 'quarterly')

            // Ledger-first, then gate the non-idempotent cache credit on insertion.
            const { skipped: alreadyCredited } = await writeLedgerEntry(
              supabase, tenantId, emp.id, policy.leave_type_id, year,
              'quarterly', quarterlyDays, accrualDate, expiresOn,
              `Quarterly accrual ${quarterLabel}`,
              { lineageId, cycleKey },
            )
            if (alreadyCredited) { skipped++; continue }

            await creditEmployeeDays(
              supabase, tenantId, emp.id, policy.leave_type_id,
              quarterlyDays, year, policy.max_accrual_balance ?? undefined,
            )

            employees_processed++
            total_days_credited = parseFloat((total_days_credited + quarterlyDays).toFixed(2))
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
  opts:        JobLogOptions = {},
): Promise<JobResult> {
  const startedAt = Date.now()

  // Concurrency guard: abort if this job type is already running for this tenant.
  if (await isJobAlreadyRunning(supabase, tenantId, 'yearly_accrual')) {
    return {
      job_id: 'skipped', job_type: 'yearly_accrual', status: 'completed',
      employees_processed: 0, total_days_credited: 0, skipped: 0,
      errors: ['Skipped: yearly_accrual already running for this tenant'],
      duration_ms: Date.now() - startedAt,
    }
  }

  // Generate a lineage ID for this job run — all ledger entries share this ID
  const lineageId = generateLineageId()
  const jobId = await startJobLog(
    supabase, tenantId, 'yearly_accrual',
    { leave_year: leaveYear, as_of: asOf ?? null, lineage_id: lineageId },
    triggeredBy, opts,
  )

  // Store lineage_id in the job log row for cross-referencing
  await supabase
    .from('leave_job_log')
    .update({ lineage_id: lineageId })
    .eq('id', jobId)

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
            // Deterministic cycle key — idempotency guard for replay
            const cycleKey = generateCycleKey(
              tenantId, emp.id, policy.leave_type_id,
              leaveYear, String(leaveYear), policy.accrual_type,
            )

            await writeLedgerEntry(
              supabase, tenantId, emp.id, policy.leave_type_id, leaveYear,
              policy.accrual_type, days, yearStartStr,
              policy.expiry_days ? shiftDay(yearStartStr, policy.expiry_days) : null,
              `Yearly accrual ${leaveYear}`,
              { lineageId, cycleKey },
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
  opts:        JobLogOptions = {},
): Promise<JobResult> {
  const startedAt = Date.now()
  const asOfStr   = asOf.toISOString().slice(0, 10)
  const jobId     = await startJobLog(
    supabase, tenantId, 'co_expiry', { as_of: asOfStr }, triggeredBy, opts,
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

          // Write negative adjustment ledger entry via the authoritative ledger service
          await expireAccrualEntry(
            supabase, tenantId, group.employeeId, group.leaveTypeId, group.year,
            deductDays, asOfStr,
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
  opts:        JobLogOptions = {},
): Promise<JobResult> {
  const startedAt = Date.now()
  const jobId     = await startJobLog(
    supabase, tenantId, 'carry_forward', { from_year: fromYear, to_year: toYear }, triggeredBy, opts,
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

          // Ledger-first, then gate the non-idempotent cache credit on insertion
          // so a re-run of carry-forward doesn't double-credit toYear's balance.
          const { skipped: alreadyCarried } = await writeLedgerEntry(
            supabase, tenantId, emp.id, policy.leave_type_id, toYear,
            'carry_forward', carryDays, cfDate, null,
            `Carry-forward from ${fromYear}: ${carryDays} day(s)`,
          )
          if (alreadyCarried) { skipped++; continue }

          // Credit toYear balance
          await creditEmployeeDays(
            supabase, tenantId, emp.id, policy.leave_type_id,
            carryDays, toYear, policy.max_accrual_balance ?? undefined,
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
  opts:        JobLogOptions = {},
): Promise<JobResult> {
  const startedAt = Date.now()
  const jobId     = await startJobLog(
    supabase, tenantId, 'policy_recalculate', { leave_type_id: leaveTypeId, year }, triggeredBy, opts,
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

// ── Lifecycle Phase 3: Engine-aware accrual with full lifecycle governance ────────
//
// This is the Phase 3 layer on top of the existing Phase 1 (engine-aware) accrual.
// It integrates the leave-accrual-lifecycle-engine for:
//   • Freeze checks (skip or mark for replay)
//   • Tiered rate resolution (service-year-based rates)
//   • Advance vs earned basis determination
//   • Partial cycle proration for joining / separation months
//   • Consumability date computation (held credits for non-immediate timing)
//   • Attendance / paid-day threshold gating
//   • Service anniversary cycle filtering
//
// Usage: monthlyAccrualJob and yearlyAccrualJob call this as their Phase 1.5 step
// after the engine-aware pass but with full lifecycle context from leave_policy_rules.
//
// The function reads leave_policy_rules lifecycle columns, resolves tiers
// from leave_accrual_tiers, and checks active freezes from leave_accrual_freezes.
// It then calls evaluateAccrualLifecycle() for each employee × leave type.
// Credits are written to employee_leave_balance AND leave_accrual_ledger with
// full lifecycle metadata (earning_basis, consumption_eligible_from, tier_id, etc.)
//
// Employees already processed by Phase 1 (engine) are excluded by the caller
// via engineProcessedIds.

interface LifecycleAccrualOpts {
  year:                  number
  month:                 number          // 1-indexed; ignored for yearly
  accrualDate:           string          // YYYY-MM-DD — the credit posting date
  engineProcessedIds:    Set<string>     // exclude employees already handled
  accrualTypeFilter:     ('monthly' | 'quarterly')[] | ('yearly' | 'upfront')[]
  isYearly:              boolean
  dryRun?:               boolean
}

/**
 * Fetch active lifecycle freezes for all employees in this tenant,
 * grouped by employee_id.
 *
 * Leave_type_id = null freezes apply to all leave types.
 */
async function fetchActiveFreezesMap(
  supabase:  SupabaseClient,
  tenantId:  string,
  asOf:      string,
): Promise<Map<string, ActiveFreeze[]>> {
  const { data: freezes } = await supabase
    .from('leave_accrual_freezes')
    .select('id, employee_id, leave_type_id, freeze_from, freeze_to, reason, status')
    .eq('tenant_id', tenantId)
    .eq('status', 'active')
    .lte('freeze_from', asOf)
    .or(`freeze_to.is.null,freeze_to.gte.${asOf}`)

  const map = new Map<string, ActiveFreeze[]>()
  for (const f of (freezes ?? []) as any[]) {
    const key = `${f.employee_id}:${f.leave_type_id ?? 'all'}`
    const existing = map.get(key) ?? []
    existing.push({
      id:                  f.id,
      freeze_from:         f.freeze_from,
      freeze_to:           f.freeze_to ?? null,
      accrual_freeze_mode: 'skip' as const,  // default; enriched per-policy below
      reason:              f.reason,
    })
    map.set(key, existing)
  }
  return map
}

/**
 * Get the combined active freezes for an employee + leave type from the map.
 * Merges both leave-type-specific freezes and any-type freezes (null type).
 */
function getEmployeeFreezesForType(
  freezeMap:   Map<string, ActiveFreeze[]>,
  employeeId:  string,
  leaveTypeId: string,
): ActiveFreeze[] {
  const specific = freezeMap.get(`${employeeId}:${leaveTypeId}`)  ?? []
  const general  = freezeMap.get(`${employeeId}:all`)             ?? []
  return [...specific, ...general]
}

/**
 * Fetch tiers for all policy rules in the given policy IDs, grouped by rule_id.
 */
async function fetchTiersMap(
  supabase:   SupabaseClient,
  tenantId:   string,
  ruleIds:    string[],
): Promise<Map<string, AccrualTierRow[]>> {
  if (!ruleIds.length) return new Map()

  const { data: tiers } = await supabase
    .from('leave_accrual_tiers')
    .select('id, rule_id, service_years_from, service_years_to, accrual_days_per_year, description')
    .eq('tenant_id', tenantId)
    .in('rule_id', ruleIds)
    .order('service_years_from', { ascending: true })

  const map = new Map<string, AccrualTierRow[]>()
  for (const t of (tiers ?? []) as any[]) {
    const existing = map.get(t.rule_id) ?? []
    existing.push({
      id:                    t.id,
      service_years_from:    Number(t.service_years_from),
      service_years_to:      t.service_years_to != null ? Number(t.service_years_to) : null,
      accrual_days_per_year: Number(t.accrual_days_per_year),
      description:           t.description ?? null,
    })
    map.set(t.rule_id, existing)
  }
  return map
}

/**
 * Build a LifecyclePolicy from a leave_policy_rules row.
 * All new lifecycle columns default safely when absent (pre-migration rows).
 */
function buildLifecyclePolicy(rule: any, yearType: 'calendar' | 'financial'): LifecyclePolicy {
  return {
    id:                         rule.id,
    leave_type_id:              rule.leave_type_id,
    accrual_type:               rule.accrual_type as LifecyclePolicy['accrual_type'],
    accrual_days_per_year:      Number(rule.accrual_days_per_year),
    year_type:                  yearType,
    eligibility_days:           rule.eligibility_days ?? 0,
    minimum_service_days:       rule.minimum_service_days ?? 0,
    minimum_paid_days:          rule.minimum_paid_days ?? 0,
    minimum_attendance_pct:     Number(rule.minimum_attendance_pct ?? 0),
    accrual_earning_basis:      rule.accrual_earning_basis ?? 'earned',
    accrual_credit_timing:      rule.accrual_credit_timing ?? 'cycle_start',
    accrual_consumption_timing: rule.accrual_consumption_timing ?? 'immediate',
    future_accrual_consumable:  rule.future_accrual_consumable ?? true,
    advance_accrual_recovery_mode: rule.advance_accrual_recovery_mode ?? 'none',
    joining_cycle_handling:     rule.joining_cycle_handling ?? 'prorate',
    separation_cycle_handling:  rule.separation_cycle_handling ?? 'prorate',
    payroll_cutoff_behavior:    rule.payroll_cutoff_behavior ?? 'hold',
    accrual_freeze_mode:        rule.accrual_freeze_mode ?? 'skip',
    tiered_accrual_enabled:     rule.tiered_accrual_enabled ?? false,
    service_anniversary_cycle:  rule.service_anniversary_cycle ?? false,
  }
}

/**
 * runLifecycleMonthlyAccrual — lifecycle-aware Phase 1.5 of monthlyAccrualJob.
 *
 * Processes employees with engine policy assignments, applying the full
 * lifecycle rule set (freeze, tier, advance/earned, proration, consumability).
 *
 * Only processes employees NOT already in engineProcessedIds.
 * Writes ledger entries with lifecycle metadata.
 *
 * @returns BatchResult with processed_employee_ids for Phase 2 deduplication.
 */
export async function runLifecycleMonthlyAccrual(
  supabase:  SupabaseClient,
  tenantId:  string,
  year:      number,
  month:     number,
  asOf?:     string,
  engineProcessedIds: Set<string> = new Set(),
): Promise<BatchResult> {
  const result: import('./leave-entitlement-service.js').BatchResult = {
    employees_processed:    0,
    total_days_credited:    0,
    skipped:                0,
    errors:                 [],
    processed_employee_ids: [],
  }

  const effectiveAsOf = asOf ?? `${year}-${String(month).padStart(2, '0')}-01`

  // Fetch assignments active on accrual date (scope_type = 'employee')
  const { data: assignments, error: aErr } = await supabase
    .from('leave_policy_assignments')
    .select('employee_id: scope_id, policy_id')
    .eq('tenant_id',  tenantId)
    .eq('scope_type', 'employee')
    .or(`effective_from.is.null,effective_from.lte.${effectiveAsOf}`)
    .or(`effective_to.is.null,effective_to.gte.${effectiveAsOf}`)

  if (aErr || !assignments?.length) return result

  // Deduplicate: one policy per employee
  const seen = new Set<string>()
  const activeAssignments = (assignments as Array<{ employee_id: string; policy_id: string }>)
    .filter(a => { if (seen.has(a.employee_id)) return false; seen.add(a.employee_id); return true })

  const policyIds = [...new Set(activeAssignments.map(a => a.policy_id))]

  // Load policy masters and rules (with lifecycle columns)
  const [{ data: masters }, { data: rules }] = await Promise.all([
    supabase.from('leave_policy_masters')
      .select('id, year_type')
      .in('id', policyIds)
      .eq('tenant_id', tenantId),
    supabase.from('leave_policy_rules')
      .select(`
        id, policy_id, leave_type_id,
        accrual_type, accrual_days_per_year, max_accrual_balance,
        eligibility_days, expiry_days, effective_from, effective_to,
        minimum_service_days, minimum_paid_days, minimum_attendance_pct,
        accrual_earning_basis, accrual_credit_timing, accrual_consumption_timing,
        future_accrual_consumable, advance_accrual_recovery_mode,
        joining_cycle_handling, separation_cycle_handling,
        payroll_cutoff_behavior, accrual_freeze_mode,
        tiered_accrual_enabled, service_anniversary_cycle
      `)
      .in('policy_id', policyIds)
      .eq('tenant_id', tenantId)
      .in('accrual_type', ['monthly', 'quarterly']),
  ])

  const masterMap = new Map(((masters ?? []) as any[]).map(m => [m.id, m]))

  const rulesByPolicy = new Map<string, any[]>()
  for (const rule of (rules ?? []) as any[]) {
    if (rule.effective_from && effectiveAsOf < rule.effective_from) continue
    if (rule.effective_to   && effectiveAsOf > rule.effective_to)   continue
    const existing = rulesByPolicy.get(rule.policy_id) ?? []
    existing.push(rule)
    rulesByPolicy.set(rule.policy_id, existing)
  }

  // Fetch employees
  const employees = await fetchAllRows<any>((from, to) =>
    supabase
      .from('employees')
      .select('id, joining_date, employee_separation!employee_separation_employee_id_fkey(last_working_date)')
      .eq('tenant_id', tenantId)
      .in('status', ['active', 'inactive'])  // include recent separations for proration
      .order('id')
      .range(from, to),
  )

  for (const e of employees) {
    e.separation_date = (e.employee_separation ?? [])[0]?.last_working_date ?? null
  }
  const empMap = new Map(employees.map(e => [e.id, e]))

  // Fetch tiers and freezes in parallel
  const allRuleIds = (rules ?? []).map((r: any) => r.id)
  const [tiersMap, freezeMap] = await Promise.all([
    fetchTiersMap(supabase, tenantId, allRuleIds),
    fetchActiveFreezesMap(supabase, tenantId, effectiveAsOf),
  ])

  // Process each assignment
  for (const assignment of activeAssignments) {
    if (engineProcessedIds.has(assignment.employee_id)) { result.skipped++; continue }

    const emp = empMap.get(assignment.employee_id) as any
    if (!emp?.joining_date) { result.skipped++; continue }

    const master = masterMap.get(assignment.policy_id) as any
    if (!master) { result.skipped++; continue }

    const policyRules = rulesByPolicy.get(assignment.policy_id) ?? []
    if (!policyRules.length) { result.skipped++; continue }

    const yearType = master.year_type as 'calendar' | 'financial'

    for (const rule of policyRules) {
      // Skip quarterly rules on non-quarter-start months
      if (rule.accrual_type === 'quarterly') {
        const QUARTER_MONTHS = [1, 4, 7, 10] as const
        if (!(QUARTER_MONTHS as readonly number[]).includes(month)) { result.skipped++; continue }
      }

      const lifecyclePolicy = buildLifecyclePolicy(rule, yearType)
      const tiers           = tiersMap.get(rule.id) ?? []
      const freezes         = getEmployeeFreezesForType(freezeMap, assignment.employee_id, rule.leave_type_id)

      // Enrich freeze entries with the rule's freeze mode
      const enrichedFreezes: ActiveFreeze[] = freezes.map(f => ({
        ...f,
        accrual_freeze_mode: lifecyclePolicy.accrual_freeze_mode,
      }))

      const ctx: AccrualContext = {
        employee_id:      assignment.employee_id,
        joining_date:     emp.joining_date,
        separation_date:  emp.separation_date ?? undefined,
        cycle_year:       year,
        cycle_month:      month,
        accrual_date:     effectiveAsOf,
        policy:           lifecyclePolicy,
        tiers,
        active_freezes:   enrichedFreezes,
      }

      const lifecycle = evaluateAccrualLifecycle(ctx)

      if (!lifecycle.should_credit) {
        result.skipped++
        continue
      }

      try {
        const accrualTypeValue = lifecycle.accrual_earning_basis === 'advance'
          ? 'advance_accrual'
          : lifecycle.accrual_earning_basis === 'prorated'
            ? 'prorated_accrual'
            : rule.accrual_type  // 'monthly' or 'quarterly'

        // Ledger is the authority — pre-check its composite idempotency key and
        // only credit the (non-idempotent) balance cache when no row exists yet,
        // so a re-run of the lifecycle accrual can't double-credit the cache.
        const { data: existingLedger } = await supabase
          .from('leave_accrual_ledger')
          .select('id')
          .eq('tenant_id',     tenantId)
          .eq('employee_id',   assignment.employee_id)
          .eq('leave_type_id', rule.leave_type_id)
          .eq('year',          year)
          .eq('accrual_type',  accrualTypeValue)
          .eq('accrued_on',    effectiveAsOf)
          .maybeSingle()
        if (existingLedger) { result.skipped++; continue }

        // Write lifecycle-enriched ledger entry FIRST — the ledger is the
        // authority (see comment above); only credit the cache once the
        // ledger write is confirmed, so a rejected/failed ledger insert
        // can never leave the cache credited with no ledger row to match it.
        const { error: ledgerErr } = await supabase.from('leave_accrual_ledger').upsert(
          {
            tenant_id:                 tenantId,
            employee_id:               assignment.employee_id,
            leave_type_id:             rule.leave_type_id,
            accrual_type:              accrualTypeValue,
            days:                      lifecycle.days_to_credit,
            year,
            accrued_on:                effectiveAsOf,
            expires_on:                null,
            is_expired:                false,
            notes:                     `Lifecycle ${rule.accrual_type} accrual — ${lifecycle.explain[lifecycle.explain.length - 1]}`,
            // Lifecycle metadata columns (added in migration 159)
            accrual_earning_basis:     lifecycle.accrual_earning_basis,
            consumption_eligible_from: lifecycle.consumption_eligible_from ?? null,
            release_trigger:           lifecycle.release_trigger === 'immediate' ? 'immediate' : lifecycle.release_trigger,
            cycle_period:              lifecycle.cycle_period,
            service_years_at_accrual:  lifecycle.service_years_at_accrual,
            tier_id:                   lifecycle.applied_tier?.id ?? null,
          },
          {
            onConflict:       'tenant_id,employee_id,leave_type_id,year,accrual_type,accrued_on',
            ignoreDuplicates: true,
          },
        )
        // supabase-js does not throw on a DB error (e.g. a CHECK-constraint
        // violation) — it returns { error }, which the surrounding try/catch
        // would never see if left unchecked. Without this check the job would
        // report employees_processed++ as if it fully succeeded even though
        // no ledger row (and, previously, no cache credit either) was written
        // — a phantom-success job result with no error signal anywhere.
        if (ledgerErr) throw new Error(`ledger upsert failed: ${ledgerErr.message}`)

        await creditEmployeeDays(
          supabase, tenantId, assignment.employee_id, rule.leave_type_id,
          lifecycle.days_to_credit, year, rule.max_accrual_balance,
        )

        result.employees_processed++
        result.total_days_credited = parseFloat((result.total_days_credited + lifecycle.days_to_credit).toFixed(2))
        if (!result.processed_employee_ids.includes(assignment.employee_id)) {
          result.processed_employee_ids.push(assignment.employee_id)
        }
      } catch (err: any) {
        result.errors.push(
          `lifecycle emp ${assignment.employee_id} / type ${rule.leave_type_id}: ${err?.message ?? 'unknown'}`,
        )
      }
    }
  }

  return result
}

// ── Job 5: Entitlement Release — release held credits ─────────────────────────
//
// Scans leave_accrual_ledger for rows with:
//   consumption_eligible_from <= asOf   AND   consumption_eligible_from IS NOT NULL
//
// For each such row, records a release event in leave_entitlement_releases
// so the UI can show when the held credit became consumable.
//
// This is a lightweight audit job — it does NOT change the balance.
// The balance was already credited at accrual time.  The release event merely
// marks the date the credit became accessible to the employee.

export async function entitlementReleaseJob(
  supabase:    SupabaseClient,
  tenantId:    string,
  asOf:        Date = new Date(),
  triggeredBy: string | null = null,
  opts:        JobLogOptions = {},
): Promise<JobResult> {
  const startedAt = Date.now()
  const asOfStr   = asOf.toISOString().slice(0, 10)
  const jobId     = await startJobLog(
    supabase, tenantId, 'co_expiry',   // reuse existing job_type enum bucket
    { as_of: asOfStr, sub_type: 'entitlement_release' },
    triggeredBy, opts,
  )

  let employees_processed = 0
  let total_days_credited  = 0
  let skipped              = 0
  const errors: string[]   = []

  try {
    // Fetch ledger rows that have become consumable as of today
    const { data: heldRows, error: fetchErr } = await supabase
      .from('leave_accrual_ledger')
      .select('id, employee_id, leave_type_id, year, days, cycle_period, release_trigger, consumption_eligible_from')
      .eq('tenant_id', tenantId)
      .eq('is_expired', false)
      .lte('consumption_eligible_from', asOfStr)
      .not('consumption_eligible_from', 'is', null)

    if (fetchErr) throw new Error(fetchErr.message)
    if (!heldRows?.length) {
      await completeJobLog(supabase, jobId, 'completed', { employees_processed: 0, total_days_credited: 0, skipped: 0 }, startedAt)
      return emptyResult(jobId, 'entitlement_release', startedAt)
    }

    for (const row of heldRows as any[]) {
      try {
        // Idempotency: check if release event already recorded for this ledger entry
        const { count } = await supabase
          .from('leave_entitlement_releases')
          .select('id', { count: 'exact', head: true })
          .eq('tenant_id', tenantId)
          .eq('ledger_entry_id', row.id)

        if ((count ?? 0) > 0) { skipped++; continue }

        // Record the release event
        await supabase.from('leave_entitlement_releases').insert({
          tenant_id:       tenantId,
          employee_id:     row.employee_id,
          leave_type_id:   row.leave_type_id,
          ledger_entry_id: row.id,
          cycle_period:    row.cycle_period ?? `${row.year}`,
          days_released:   row.days,
          release_trigger: row.release_trigger ?? 'cycle_completion',
          released_at:     new Date().toISOString(),
          released_by:     triggeredBy ?? null,
          notes:           `Auto-release: consumption_eligible_from=${row.consumption_eligible_from}`,
        })

        // Clear consumption_eligible_from to prevent re-processing
        await supabase
          .from('leave_accrual_ledger')
          .update({ consumption_eligible_from: null })
          .eq('id', row.id)

        employees_processed++
        total_days_credited = parseFloat((total_days_credited + Number(row.days)).toFixed(2))
      } catch (err: any) {
        errors.push(`Release emp ${row.employee_id}: ${err?.message ?? 'unknown'}`)
      }
    }

    const result = { employees_processed, total_days_credited, skipped, errors }
    await completeJobLog(supabase, jobId, 'completed', result, startedAt)
    return { job_id: jobId, job_type: 'entitlement_release', status: 'completed', ...result, duration_ms: Date.now() - startedAt }

  } catch (e: unknown) {
    const msg = (e as Error).message
    await completeJobLog(supabase, jobId, 'failed', {}, startedAt, msg)
    return {
      job_id: jobId, job_type: 'entitlement_release', status: 'failed',
      employees_processed, total_days_credited, skipped,
      errors: [...errors, msg], duration_ms: Date.now() - startedAt,
    }
  }
}
