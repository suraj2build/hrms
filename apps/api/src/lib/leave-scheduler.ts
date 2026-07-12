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
 *                      Enqueued BEFORE co_expiry so the queue worker picks
 *                      up carry-forward first on year-end days.
 *   co_expiry        — every day (after carry_forward on year-end days)
 *
 * State is held in memory for speed; if the process restarts mid-month,
 * the `ran` keys reset to '' and the tick rechecks the leave_job_log
 * to determine whether the job already ran today / this month.
 *
 * All jobs run for every active tenant. Errors are caught per-tenant so
 * one bad tenant cannot block others.
 *
 * C4 change: tick() now enqueues 6 independent durable sub-jobs instead
 * of running them synchronously. Each sub-job has its own timeout, so a
 * slow tenant cannot push the whole tick over the 120s durable-job limit.
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import type { FastifyBaseLogger } from 'fastify'
import {
  monthlyAccrualJob,
  yearlyAccrualJob,
  coExpiryJob,
  carryForwardJob,
} from './leave-jobs.js'
import { runMonthlyAccrual, processCarryForward } from './accrual-engine.js'
import { runEventGrantsForTenant }                from './leave-event-engine.js'
import { runLeaveReconciliation }                  from './leave-reconciliation.js'
import { durableQueue }                            from './durable-queue.js'

// Suppress unused-import warning — processCarryForward is re-exported for
// callers that need it directly (e.g. admin one-shot endpoints).
void processCarryForward

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
  /** 'YYYY-MM-DD' of the last day event grants ran. */
  eventGrants: '',
  /** 'YYYY-MM-DD' of the last day nightly reconciliation ran. */
  reconciliation: '',
}

/** Total ticks executed since process start. Used in heartbeat metadata. */
let tickCount = 0

// ── Helpers ────────────────────────────────────────────────────────────────────

/**
 * Upsert a heartbeat row for the leave-scheduler.
 * Called on every tick — allows operators to detect stale/crashed schedulers
 * by querying scheduler_heartbeats WHERE last_heartbeat_at < now() - 2h.
 */
async function writeHeartbeat(
  supabase:   SupabaseClient,
  log:        FastifyBaseLogger,
  status:     'ok' | 'degraded' | 'error',
  metadata?:  Record<string, unknown>,
  lastError?: string,
): Promise<void> {
  await supabase
    .from('scheduler_heartbeats')
    .upsert(
      {
        scheduler_name:    'leave-scheduler',
        tenant_id:         null,                 // global scheduler — not tenant-scoped
        last_heartbeat_at: new Date().toISOString(),
        status,
        tick_count:        tickCount,
        last_error:        lastError ?? null,
        metadata:          metadata  ?? {},
      },
      { onConflict: 'scheduler_name,tenant_id' },
    )
    .then(({ error }) => {
      if (error) log.warn({ err: error }, '[leave-scheduler] heartbeat write failed')
    })
}

async function fetchAllTenantIds(supabase: SupabaseClient, log: FastifyBaseLogger): Promise<string[]> {
  const { data, error } = await supabase.from('tenants').select('id')
  if (error) {
    log.error({ err: error }, '[leave-scheduler] Failed to fetch tenants')
    return []
  }
  return (data ?? []).map((r: { id: string }) => r.id)
}

/**
 * Check leave_job_log to see if a particular job already ran for a given
 * set of params. Accepts a params object so callers can match on multiple
 * fields simultaneously — critical for monthly accrual which must check
 * BOTH year AND month to avoid treating a prior year's January log as the
 * current year's completed run (year-boundary restart bug).
 *
 * Param values must match the types stored by startJobLog (numbers as numbers,
 * strings as strings) — Postgres JSONB containment is type-strict.
 *
 * Used on startup to restore the `ran` state after a process restart.
 */
async function hasJobRunForKey(
  supabase: SupabaseClient,
  jobType:  string,
  params:   Record<string, unknown>,
): Promise<boolean> {
  const { count } = await supabase
    .from('leave_job_log')
    .select('id', { count: 'exact', head: true })
    .eq('job_type', jobType)
    .eq('status', 'completed')
    .contains('params', params)
  return (count ?? 0) > 0
}

// ── Upload session orphan sweep ────────────────────────────────────────────────

/**
 * Mark upload sessions that are stuck in a non-terminal state as `orphaned`.
 *
 * A session is stale when it has been in `pending`, `uploading`, or `processing`
 * for longer than STALE_THRESHOLD_MS without transitioning to `completed` or
 * `failed`.  This happens when:
 *   - The browser tab was closed mid-upload
 *   - A client crash prevented the /complete or /fail call
 *   - A network failure left the session without a completion signal
 *
 * This sweep is non-destructive: storage files are NOT deleted.  Operators can
 * verify storage contents and manually re-link if needed.  The `error_message`
 * field records why the session was orphaned for observability.
 *
 * The update is cross-tenant (no tenant_id filter) — the scheduler is global.
 * Tenant isolation is preserved at the DB level by tenant_id on each row.
 *
 * Idempotent: running multiple times has no additional effect because orphaned
 * sessions are not in the source status set.
 */
const STALE_THRESHOLD_MS = 30 * 60 * 1000   // 30 minutes

async function expireStaleUploadSessions(supabase: SupabaseClient, log: FastifyBaseLogger): Promise<void> {
  const staleCutoff = new Date(Date.now() - STALE_THRESHOLD_MS).toISOString()

  const { error, count } = await supabase
    .from('upload_sessions')
    .update({
      status:              'orphaned',
      error_message:       'Session automatically orphaned: no completion signal received within 30 minutes. Storage file may still exist — verify and re-link if needed.',
      processing_ended_at: new Date().toISOString(),
    }, { count: 'exact' })
    .in('status', ['pending', 'uploading', 'processing'])
    .lt('created_at', staleCutoff)

  if (error) {
    log.warn({ err: error }, '[leave-scheduler] upload session orphan sweep failed')
  } else if ((count ?? 0) > 0) {
    log.info({ count, staleCutoff }, '[leave-scheduler] orphaned stale upload sessions')
  }
}

// ── Sub-job handlers (called by durable queue workers) ─────────────────────────
// Each function fetches tenants fresh and iterates, so a crash in one does not
// affect the other sub-jobs (which run as independent durable jobs).

export async function execLeaveYearlyAccrual(
  supabase: SupabaseClient,
  payload:  { isCalYearStart: boolean; year: number; leaveYear: number; dayKey: string },
  log:      FastifyBaseLogger,
): Promise<void> {
  const { leaveYear, dayKey } = payload
  log.info({ leaveYear }, '[leave-scheduler] job:yearly-accrual')
  for (const tenantId of await fetchAllTenantIds(supabase, log)) {
    await yearlyAccrualJob(supabase, tenantId, leaveYear, null, dayKey)
      .then(r => log.info({ tenantId, credited: r.total_days_credited, employees: r.employees_processed }, '[leave-scheduler] yearly_accrual ok'))
      .catch((e: Error) => log.error({ err: e, tenantId }, '[leave-scheduler] yearly_accrual error'))
  }
}

export async function execLeaveMonthlyAccrual(
  supabase: SupabaseClient,
  payload:  { year: number; monthNum: number },
  log:      FastifyBaseLogger,
): Promise<void> {
  const { year, monthNum } = payload
  const monthKey = `${year}-${String(monthNum).padStart(2, '0')}`
  log.info({ monthKey }, '[leave-scheduler] job:monthly-accrual')
  for (const tenantId of await fetchAllTenantIds(supabase, log)) {
    await monthlyAccrualJob(supabase, tenantId, year, monthNum)
      .then(r => log.info({ tenantId, credited: r.total_days_credited, employees: r.employees_processed }, '[leave-scheduler] monthly_accrual ok'))
      .catch((e: Error) => log.error({ err: e, tenantId }, '[leave-scheduler] monthly_accrual error'))
    await runMonthlyAccrual(supabase, tenantId, year, monthNum)
      .then(r => log.info({ tenantId, credited: r.total_days_credited, employees: r.employees_credited, errors: r.errors.length }, '[leave-scheduler] rule_accrual ok'))
      .catch((e: Error) => log.error({ err: e, tenantId }, '[leave-scheduler] rule_accrual error'))
  }
}

export async function execLeaveCarryForward(
  supabase: SupabaseClient,
  payload:  { fromYear: number; toYear: number },
  log:      FastifyBaseLogger,
): Promise<void> {
  const { fromYear, toYear } = payload
  log.info({ fromYear, toYear }, '[leave-scheduler] job:carry-forward')
  for (const tenantId of await fetchAllTenantIds(supabase, log)) {
    await carryForwardJob(supabase, tenantId, fromYear, toYear)
      .then(r => log.info({ tenantId, credited: r.total_days_credited, employees: r.employees_processed }, '[leave-scheduler] carry_forward ok'))
      .catch((e: Error) => log.error({ err: e, tenantId }, '[leave-scheduler] carry_forward error'))
  }
}

export async function execLeaveCoExpiry(
  supabase: SupabaseClient,
  payload:  { dayKey: string },
  log:      FastifyBaseLogger,
): Promise<void> {
  // Reconstruct a deterministic date from dayKey so idempotency holds even if
  // the job runs slightly after midnight (the queued dayKey stays the same).
  const asOf = new Date(`${payload.dayKey}T12:00:00.000Z`)
  for (const tenantId of await fetchAllTenantIds(supabase, log)) {
    await coExpiryJob(supabase, tenantId, asOf)
      .then(r => {
        if (r.employees_processed > 0) {
          log.info({ tenantId, expired: -r.total_days_credited, employees: r.employees_processed }, '[leave-scheduler] co_expiry ok')
        }
      })
      .catch((e: Error) => log.error({ err: e, tenantId }, '[leave-scheduler] co_expiry error'))
  }
}

export async function execLeaveEventGrants(
  supabase: SupabaseClient,
  payload:  { dayKey: string },
  log:      FastifyBaseLogger,
): Promise<void> {
  const asOf = new Date(`${payload.dayKey}T12:00:00.000Z`)
  for (const tenantId of await fetchAllTenantIds(supabase, log)) {
    await runEventGrantsForTenant(supabase, tenantId, asOf)
      .then(r => {
        if (r.granted > 0 || r.expired > 0) {
          log.info({ tenantId, granted: r.granted, skipped: r.skipped, expired: r.expired, errors: r.errors }, '[leave-scheduler] event_grants ok')
        }
      })
      .catch((e: Error) => log.error({ err: e, tenantId }, '[leave-scheduler] event_grants error'))
  }
}

export async function execLeaveReconciliationJob(
  supabase: SupabaseClient,
  payload:  { dayKey: string; reconcYear: number },
  log:      FastifyBaseLogger,
): Promise<void> {
  const { reconcYear } = payload
  for (const tenantId of await fetchAllTenantIds(supabase, log)) {
    await runLeaveReconciliation(supabase, tenantId, reconcYear, null, 'scheduler')
      .then(r => {
        if (r.issues_found > 0) {
          log.warn({ tenantId, issues: r.issues_found, severity: r.severity }, '[leave-scheduler] reconciliation issues found')
        } else {
          log.info({ tenantId }, '[leave-scheduler] reconciliation clean')
        }
      })
      .catch((e: Error) => log.error({ err: e, tenantId }, '[leave-scheduler] reconciliation error'))
  }
}

// ── Main tick ──────────────────────────────────────────────────────────────────
// tick() is now a lightweight dispatcher: it checks timing gates and enqueues
// independent durable sub-jobs rather than running the work synchronously.
// Each sub-job has its own timeout and does not block the others.

export async function tick(supabase: SupabaseClient, log: FastifyBaseLogger): Promise<void> {
  tickCount++

  const now       = new Date()
  const year      = now.getUTCFullYear()
  const monthIdx  = now.getUTCMonth()       // 0-indexed
  const monthNum  = monthIdx + 1            // 1-indexed
  const dom       = now.getUTCDate()
  const dayKey    = now.toISOString().slice(0, 10)
  const monthKey  = `${year}-${String(monthNum).padStart(2, '0')}`
  const yearKey   = String(year)

  // Write a heartbeat immediately so liveness is updated even if jobs are skipped.
  await writeHeartbeat(supabase, log, 'ok', { tick: tickCount, day: dayKey })

  // ── 0. Upload session orphan sweep ──────────────────────────────────────────
  // Stays in-process: it's fast, cross-tenant, and needs no per-tenant loop.
  await expireStaleUploadSessions(supabase, log).catch(
    (e: Error) => log.warn({ err: e }, '[leave-scheduler] upload orphan sweep error'),
  )

  // ── Year-boundary flags ──────────────────────────────────────────────────────
  const isDecYearEnd   = (monthIdx === 11 && dom === 31)
  const isMarYearEnd   = (monthIdx === 2  && dom === 31)
  const isCalYearStart = (monthNum === 1  && dom === 1)
  const isFYStart      = (monthNum === 4  && dom === 1)

  // ── 1. Yearly accrual ────────────────────────────────────────────────────────
  if ((isCalYearStart || isFYStart) && ran.yearlyAccrual !== yearKey) {
    const leaveYear = isCalYearStart ? year : year - 1
    log.info({ leaveYear }, '[leave-scheduler] yearly accrual due — enqueuing sub-job')
    await durableQueue.enqueue(
      'leave-yearly-accrual',
      { isCalYearStart, year, leaveYear, dayKey },
      { idempotencyKey: `leave-yearly-accrual:${yearKey}`, timeoutMs: 5 * 60 * 1_000 },
    ).catch((e: Error) => log.error({ err: e }, '[leave-scheduler] enqueue leave-yearly-accrual failed'))
    ran.yearlyAccrual = yearKey
  }

  // ── 2. Monthly accrual ───────────────────────────────────────────────────────
  if (dom <= MONTHLY_SAFE_DAYS && ran.monthlyAccrual !== monthKey) {
    log.info({ monthKey }, '[leave-scheduler] monthly accrual due — enqueuing sub-job')
    await durableQueue.enqueue(
      'leave-monthly-accrual',
      { year, monthNum },
      { idempotencyKey: `leave-monthly-accrual:${monthKey}`, timeoutMs: 5 * 60 * 1_000 },
    ).catch((e: Error) => log.error({ err: e }, '[leave-scheduler] enqueue leave-monthly-accrual failed'))
    ran.monthlyAccrual = monthKey
  }

  // ── 3. Carry forward ────────────────────────────────────────────────────────
  // Enqueued BEFORE co-expiry. The durable queue is FIFO for a single worker,
  // so carry-forward completes first on year-end days before CO expiry runs.
  if ((isDecYearEnd || isMarYearEnd) && ran.carryForward !== yearKey) {
    const fromYear = isDecYearEnd ? year     : year - 1
    const toYear   = isDecYearEnd ? year + 1 : year
    log.info({ fromYear, toYear }, '[leave-scheduler] carry-forward due — enqueuing sub-job')
    await durableQueue.enqueue(
      'leave-carry-forward',
      { fromYear, toYear },
      { idempotencyKey: `leave-carry-forward:${yearKey}`, timeoutMs: 5 * 60 * 1_000 },
    ).catch((e: Error) => log.error({ err: e }, '[leave-scheduler] enqueue leave-carry-forward failed'))
    ran.carryForward = yearKey
  }

  // ── 4. CO expiry ────────────────────────────────────────────────────────────
  if (ran.coExpiry !== dayKey) {
    await durableQueue.enqueue(
      'leave-co-expiry',
      { dayKey },
      { idempotencyKey: `leave-co-expiry:${dayKey}`, timeoutMs: 2 * 60 * 1_000 },
    ).catch((e: Error) => log.error({ err: e }, '[leave-scheduler] enqueue leave-co-expiry failed'))
    ran.coExpiry = dayKey
  }

  // ── 5. Event-triggered leave grants ─────────────────────────────────────────
  if (ran.eventGrants !== dayKey) {
    await durableQueue.enqueue(
      'leave-event-grants',
      { dayKey },
      { idempotencyKey: `leave-event-grants:${dayKey}`, timeoutMs: 2 * 60 * 1_000 },
    ).catch((e: Error) => log.error({ err: e }, '[leave-scheduler] enqueue leave-event-grants failed'))
    ran.eventGrants = dayKey
  }

  // ── 6. Nightly reconciliation ────────────────────────────────────────────────
  if (ran.reconciliation !== dayKey) {
    const reconcYear = now.getUTCMonth() >= 3 ? year : year - 1
    await durableQueue.enqueue(
      'leave-reconciliation',
      { dayKey, reconcYear },
      { idempotencyKey: `leave-reconciliation:${dayKey}`, timeoutMs: 3 * 60 * 1_000 },
    ).catch((e: Error) => log.error({ err: e }, '[leave-scheduler] enqueue leave-reconciliation failed'))
    ran.reconciliation = dayKey
  }
}

// ── Startup: restore ran state from DB ────────────────────────────────────────

async function restoreState(supabase: SupabaseClient, log: FastifyBaseLogger): Promise<void> {
  const now      = new Date()
  const year     = now.getUTCFullYear()
  const monthNum = now.getUTCMonth() + 1
  const dayKey   = now.toISOString().slice(0, 10)
  const monthKey = `${year}-${String(monthNum).padStart(2, '0')}`
  const yearKey  = String(year)

  try {
    const [hasYearly, hasMonthly, hasCF, hasExpiry, hasEventGrants, hasRecon] = await Promise.all([
      hasJobRunForKey(supabase, 'yearly_accrual',  { leave_year: year }),
      hasJobRunForKey(supabase, 'monthly_accrual', { year, month: monthNum }),
      hasJobRunForKey(supabase, 'carry_forward',   { from_year: year - 1 }),
      hasJobRunForKey(supabase, 'co_expiry',        { as_of: dayKey }),
      hasJobRunForKey(supabase, 'event_grants',     { as_of: dayKey }),
      hasJobRunForKey(supabase, 'reconciliation',   { as_of: dayKey }),
    ])
    if (hasYearly)     ran.yearlyAccrual  = yearKey
    if (hasMonthly)    ran.monthlyAccrual = monthKey
    if (hasCF)         ran.carryForward   = yearKey
    if (hasExpiry)     ran.coExpiry       = dayKey
    if (hasEventGrants) ran.eventGrants   = dayKey
    if (hasRecon)      ran.reconciliation = dayKey
    log.info({ ran }, '[leave-scheduler] state restored')
  } catch (e: unknown) {
    log.warn({ err: e }, '[leave-scheduler] Could not restore state from DB')
  }
}

// ── Public API ─────────────────────────────────────────────────────────────────

/**
 * Register the leave scheduler with the given Supabase client and logger.
 * Call once after the Supabase plugin is registered in Fastify startup.
 */
export function registerLeaveScheduler(supabase: SupabaseClient, log: FastifyBaseLogger): void {
  // Periodic enqueue — interval stays as lightweight ticker; durable queue
  // provides crash recovery and retry for the actual work. (ISSUE-028)
  // Hourly idempotency key prevents duplicate runs on concurrent ticks.
  setInterval(() => {
    const key = `leave-scheduler-tick:${new Date().toISOString().slice(0, 13)}`
    durableQueue.enqueue('leave-scheduler-tick', {}, { idempotencyKey: key }).catch((err: Error) => {
      log.error({ err }, '[leave-scheduler] enqueue error')
      writeHeartbeat(supabase, log, 'error', { tick: tickCount }, err.message).catch(() => undefined)
    })
  }, TICK_MS)

  // Restore state and run the first tick directly — ensures the ran.* guard
  // is populated before the first durable job fires and provides immediate
  // startup behavior if the process restarted mid-day.
  restoreState(supabase, log)
    .then(() => tick(supabase, log))
    .then(() => log.info({ tickIntervalMin: TICK_MS / 60_000 }, '[leave-scheduler] active'))
    .catch((err: Error) => {
      log.error({ err }, '[leave-scheduler] startup error (interval still active)')
      writeHeartbeat(supabase, log, 'error', { tick: tickCount }, err.message).catch(() => undefined)
    })
}
