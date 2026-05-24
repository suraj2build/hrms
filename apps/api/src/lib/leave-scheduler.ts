/**
 * Leave Scheduler
 *
 * Wires leave jobs to a time-based schedule using a simple in-process
 * interval — no external cron library required.
 *
 * The scheduler ticks every TICK_MS (1 hour by default) and checks
 * whether each job is due to run:
 *
 *   yearly_accrual   — Jan 1  (calendar) or Apr 1 (financial year start)
 *   monthly_accrual  — 1st–3rd of each month (safe window)
 *   carry_forward    — Dec 31 (calendar year-end) or Mar 31 (FY year-end)
 *                      Runs BEFORE co_expiry so balances reflect the
 *                      carry-forward before any expiry deductions.
 *   co_expiry        — every day (after carry_forward on year-end days)
 *
 * State is held in memory for speed; if the process restarts mid-month,
 * the `ran` keys reset to '' and the tick rechecks the leave_job_log
 * to determine whether the job already ran today / this month.
 *
 * All jobs run for every active tenant. Errors are caught per-tenant so
 * one bad tenant cannot block others.
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import {
  monthlyAccrualJob,
  yearlyAccrualJob,
  coExpiryJob,
  carryForwardJob,
} from './leave-jobs.js'
import { runMonthlyAccrual, processCarryForward } from './accrual-engine.js'

// ── Constants ──────────────────────────────────────────────────────────────────

/** How often the scheduler checks whether any job is due (milliseconds). */
const TICK_MS = 60 * 60 * 1_000   // 1 hour

/** DOM window for monthly accrual — runs any time 1 ≤ day ≤ MONTHLY_SAFE_DAYS. */
const MONTHLY_SAFE_DAYS = 3

// ── In-memory state ────────────────────────────────────────────────────────────
// Resets on restart; durability comes from leave_job_log in the database.

const ran = {
  /** 'YYYY' of the last year for which yearly accrual ran. */
  yearlyAccrual: '',
  /** 'YYYY-MM' of the last month for which monthly accrual ran. */
  monthlyAccrual: '',
  /** 'YYYY' of the last year for which carry-forward ran. */
  carryForward: '',
  /** 'YYYY-MM-DD' of the last day CO expiry ran. */
  coExpiry: '',
}

// ── Helpers ────────────────────────────────────────────────────────────────────

async function fetchAllTenantIds(supabase: SupabaseClient): Promise<string[]> {
  const { data, error } = await supabase.from('tenants').select('id')
  if (error) {
    console.error('[leave-scheduler] Failed to fetch tenants:', error.message)
    return []
  }
  return (data ?? []).map((r: { id: string }) => r.id)
}

/**
 * Check leave_job_log to see if a particular job already ran in the
 * given period key (e.g. 'YYYY-MM' for monthly accrual).
 * Used on startup to restore the `ran` state after a process restart.
 */
async function hasJobRunForKey(
  supabase: SupabaseClient,
  jobType:  string,
  paramKey: string,
  paramVal: string,
): Promise<boolean> {
  const { count } = await supabase
    .from('leave_job_log')
    .select('id', { count: 'exact', head: true })
    .eq('job_type', jobType)
    .eq('status', 'completed')
    .contains('params', { [paramKey]: paramVal })
  return (count ?? 0) > 0
}

// ── Main tick ──────────────────────────────────────────────────────────────────

async function tick(supabase: SupabaseClient): Promise<void> {
  const now       = new Date()
  const year      = now.getUTCFullYear()
  const monthIdx  = now.getUTCMonth()       // 0-indexed
  const monthNum  = monthIdx + 1            // 1-indexed
  const dom       = now.getUTCDate()
  const dayKey    = now.toISOString().slice(0, 10)
  const monthKey  = `${year}-${String(monthNum).padStart(2, '0')}`
  const yearKey   = String(year)

  let tenants: string[] | null = null
  const getTenants = async () => {
    if (!tenants) tenants = await fetchAllTenantIds(supabase)
    return tenants
  }

  // ── Year-boundary flags ──────────────────────────────────────────────────────
  // Calendar year-end:  Dec 31  →  carry-forward fromYear=year, toYear=year+1
  // Financial year-end: Mar 31  →  carry-forward fromYear=year-1, toYear=year
  // Calendar year-start:  Jan 1 (monthNum=1, dom=1)
  // Financial year-start: Apr 1 (monthNum=4, dom=1)
  const isDecYearEnd  = (monthIdx === 11 && dom === 31)
  const isMarYearEnd  = (monthIdx === 2  && dom === 31)
  const isCalYearStart = (monthNum === 1  && dom === 1)
  const isFYStart      = (monthNum === 4  && dom === 1)

  // ── 1. Yearly accrual ────────────────────────────────────────────────────────
  // Runs on Jan 1 (calendar year start) or Apr 1 (financial year start).
  // Only runs once per year — use yearKey to gate.
  if ((isCalYearStart || isFYStart) && ran.yearlyAccrual !== yearKey) {
    const leaveYear = isCalYearStart ? year : year - 1  // FY Apr 1 2026 → leave year 2026? No — FY Apr 2025 → year 2025
    // For FY: Apr 1 2025 means FY 2025 starts. For Cal: Jan 1 2025 means year 2025.
    const creditYear = isFYStart ? year : year
    console.log(`[leave-scheduler] Yearly accrual due for year ${creditYear}`)
    for (const tenantId of await getTenants()) {
      await yearlyAccrualJob(supabase, tenantId, creditYear, null, dayKey)
        .then(r => console.log(`[leave-scheduler] yearly_accrual tenant=${tenantId} credited=${r.total_days_credited} emp=${r.employees_processed}`))
        .catch((e: Error) => console.error(`[leave-scheduler] yearly_accrual error tenant=${tenantId}`, e.message))
    }
    ran.yearlyAccrual = yearKey
  }

  // ── 2. Monthly accrual ───────────────────────────────────────────────────────
  // Run within the first MONTHLY_SAFE_DAYS days of the month.
  if (dom <= MONTHLY_SAFE_DAYS && ran.monthlyAccrual !== monthKey) {
    console.log(`[leave-scheduler] Monthly accrual due for ${monthKey}`)
    for (const tenantId of await getTenants()) {
      // Legacy entitlement-based accrual
      await monthlyAccrualJob(supabase, tenantId, year, monthNum)
        .then(r => console.log(`[leave-scheduler] monthly_accrual tenant=${tenantId} credited=${r.total_days_credited} emp=${r.employees_processed}`))
        .catch((e: Error) => console.error(`[leave-scheduler] monthly_accrual error tenant=${tenantId}`, e.message))

      // New rule-based accrual engine (leave_accrual_rules)
      await runMonthlyAccrual(supabase, tenantId, year, monthNum)
        .then(r => console.log(`[leave-scheduler] rule_accrual tenant=${tenantId} credited=${r.total_days_credited} emp=${r.employees_credited} errors=${r.errors.length}`))
        .catch((e: Error) => console.error(`[leave-scheduler] rule_accrual error tenant=${tenantId}`, e.message))
    }
    ran.monthlyAccrual = monthKey
  }

  // ── 3. Carry forward ────────────────────────────────────────────────────────
  // MUST run before co_expiry on year-end days so the newly carried balance
  // is present when expiry deductions are calculated.
  //
  // Dec 31 → calendar year-end  (fromYear = current year,     toYear = year+1)
  // Mar 31 → financial year-end (fromYear = previous year,    toYear = current year)
  if ((isDecYearEnd || isMarYearEnd) && ran.carryForward !== yearKey) {
    const fromYear = isDecYearEnd ? year     : year - 1
    const toYear   = isDecYearEnd ? year + 1 : year
    console.log(`[leave-scheduler] Carry-forward due: ${fromYear} → ${toYear}`)
    for (const tenantId of await getTenants()) {
      await carryForwardJob(supabase, tenantId, fromYear, toYear)
        .then(r => console.log(`[leave-scheduler] carry_forward tenant=${tenantId} credited=${r.total_days_credited} emp=${r.employees_processed}`))
        .catch((e: Error) => console.error(`[leave-scheduler] carry_forward error tenant=${tenantId}`, e.message))
    }
    ran.carryForward = yearKey
  }

  // ── 4. CO expiry ────────────────────────────────────────────────────────────
  // Runs once per day — AFTER carry_forward so year-end carry is applied first.
  if (ran.coExpiry !== dayKey) {
    for (const tenantId of await getTenants()) {
      await coExpiryJob(supabase, tenantId, now)
        .then(r => {
          if (r.employees_processed > 0) {
            console.log(`[leave-scheduler] co_expiry tenant=${tenantId} expired=${-r.total_days_credited} emp=${r.employees_processed}`)
          }
        })
        .catch((e: Error) => console.error(`[leave-scheduler] co_expiry error tenant=${tenantId}`, e.message))
    }
    ran.coExpiry = dayKey
  }
}

// ── Startup: restore ran state from DB ────────────────────────────────────────

async function restoreState(supabase: SupabaseClient): Promise<void> {
  const now      = new Date()
  const year     = now.getUTCFullYear()
  const monthNum = now.getUTCMonth() + 1
  const dayKey   = now.toISOString().slice(0, 10)
  const monthKey = `${year}-${String(monthNum).padStart(2, '0')}`
  const yearKey  = String(year)

  try {
    const [hasYearly, hasMonthly, hasCF, hasExpiry] = await Promise.all([
      hasJobRunForKey(supabase, 'yearly_accrual',   'leave_year', yearKey),
      hasJobRunForKey(supabase, 'monthly_accrual',  'month',      monthNum.toString()),
      hasJobRunForKey(supabase, 'carry_forward',    'from_year',  (year - 1).toString()),
      hasJobRunForKey(supabase, 'co_expiry',         'as_of',      dayKey),
    ])
    if (hasYearly)  ran.yearlyAccrual  = yearKey
    if (hasMonthly) ran.monthlyAccrual = monthKey
    if (hasCF)      ran.carryForward   = yearKey
    if (hasExpiry)  ran.coExpiry       = dayKey
    console.log('[leave-scheduler] State restored:', ran)
  } catch (e: unknown) {
    console.warn('[leave-scheduler] Could not restore state from DB:', (e as Error).message)
  }
}

// ── Public API ─────────────────────────────────────────────────────────────────

/**
 * Register the leave scheduler with the given Supabase client.
 * Call once after the Supabase plugin is registered in Fastify startup.
 */
export function registerLeaveScheduler(supabase: SupabaseClient): void {
  // Restore state from DB before first tick (handles process restarts)
  restoreState(supabase)
    .then(() => tick(supabase))        // initial tick
    .then(() => {
      setInterval(() => tick(supabase).catch(console.error), TICK_MS)
      console.log(`📅 Leave scheduler active — ticking every ${TICK_MS / 60_000} min`)
    })
    .catch(console.error)
}
