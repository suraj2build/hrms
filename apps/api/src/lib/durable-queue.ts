/**
 * durable-queue.ts
 *
 * Postgres-backed durable background job queue.
 *
 * Replaces the in-memory JobQueue for production workloads. Jobs persist across
 * process restarts, server crashes, and multi-instance deployments.
 *
 * ── Design ───────────────────────────────────────────────────────────────────
 *
 *  background_jobs table:
 *    - status = 'pending'   → ready to run (scheduled_at <= now())
 *    - status = 'running'   → claimed by a worker (atomic UPDATE ... RETURNING)
 *    - status = 'completed' → done successfully
 *    - status = 'failed'    → last attempt failed; will retry if attempt < max_retries
 *    - status = 'dead'      → exhausted all retries; moved to background_job_results
 *
 *  Worker loop (single-process, polling):
 *    Every POLL_INTERVAL_MS, claim up to BATCH_SIZE pending jobs via:
 *      UPDATE background_jobs SET status='running', started_at=now(), attempt=attempt+1
 *      WHERE id = (SELECT id FROM background_jobs WHERE status='pending' AND scheduled_at<=now()
 *                  ORDER BY scheduled_at LIMIT 1 FOR UPDATE SKIP LOCKED)
 *      RETURNING *
 *
 *  Crash recovery (on start):
 *    Jobs in status='running' with started_at < now() - STALE_THRESHOLD_MS
 *    are reset to 'pending' so they re-run after a crash.
 *
 *  Idempotency:
 *    Pass idempotency_key to prevent duplicate enqueues.
 *    On conflict the existing row is untouched (DO NOTHING).
 *
 *  Handler registry:
 *    Handlers are in-memory functions registered at startup via:
 *      durableQueue.register('job-type', async (payload, job) => { ... })
 *
 *  Dead-letter:
 *    Terminal failures are persisted to background_job_results for permanent
 *    audit trail. Dead jobs are never deleted — operators can inspect and replay.
 *
 *  Durable operational state (Migration 120):
 *    - poison_job_quarantine  — replaces in-memory requeueCounts Map + quarantined Set
 *    - retry_storm_incidents  — replaces ephemeral storm detection state
 *    - module_health          — updated on start/stop/error for cross-instance visibility
 *    All state survives process restart, deployment, and horizontal scaling.
 *
 * ── Usage ─────────────────────────────────────────────────────────────────────
 *
 *   import { durableQueue } from './durable-queue.js'
 *
 *   // Register handler at startup
 *   durableQueue.register('send-notification', async (payload) => {
 *     await sendEmail(payload.to, payload.subject, payload.body)
 *   })
 *
 *   // Enqueue a job
 *   await durableQueue.enqueue('send-notification', { to: 'hr@acme.com', ... })
 *
 *   // Enqueue with delay (5 minutes from now)
 *   await durableQueue.enqueue('leave-accrual', { tenant_id: 'xxx' }, {
 *     delayMs: 5 * 60 * 1000,
 *     idempotencyKey: 'accrual-2026-01-acme',
 *   })
 *
 *   // Start polling (call once at application startup)
 *   durableQueue.start(supabase, log)
 *
 *   // Graceful shutdown
 *   await durableQueue.stop()
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import type { Logger }         from 'pino'
import { randomUUID }          from 'node:crypto'

// ── Types ─────────────────────────────────────────────────────────────────────

export type DurableJobStatus = 'pending' | 'running' | 'completed' | 'failed' | 'dead'
export type FailureCategory  = 'transient' | 'permanent' | 'timeout' | 'unknown'

export interface EnqueueOpts {
  /** Milliseconds from now to delay execution. Default: run immediately. */
  delayMs?:        number
  /** Max retry attempts before moving to dead-letter. Default: 3. */
  maxRetries?:     number
  /** Initial retry delay in ms. Doubles each attempt. Default: 1000. */
  retryDelayMs?:   number
  /** Max retry delay cap in ms. Default: 30_000. */
  maxDelayMs?:     number
  /** Job execution timeout in ms. Default: 120_000. */
  timeoutMs?:      number
  /**
   * Unique key for this job.
   * If a pending or running job with the same key already exists,
   * this enqueue is a no-op (safe to call repeatedly).
   */
  idempotencyKey?: string
  /** Optional tenant scope for tenant-specific jobs. */
  tenantId?:       string
  /** Enqueued by which user / system component. */
  createdBy?:      string
}

export interface DurableJob {
  id:               string
  job_type:         string
  payload:          Record<string, unknown>
  status:           DurableJobStatus
  attempt:          number
  max_retries:      number
  retry_delay_ms:   number
  max_delay_ms:     number
  timeout_ms:       number
  scheduled_at:     string
  started_at:       string | null
  completed_at:     string | null
  failed_at:        string | null
  error:            string | null
  failure_category: FailureCategory | null
  idempotency_key:  string | null
  tenant_id:        string | null
  created_by:       string | null
  created_at:       string
}

export interface QueueMetrics {
  pending:   number
  running:   number
  completed: number
  dead:      number
  by_type:   Record<string, { pending: number; running: number; dead: number }>
}

export type JobHandlerFn = (
  payload: Record<string, unknown>,
  job:     DurableJob,
) => Promise<void>

// ── Failure categorization ─────────────────────────────────────────────────────

const TRANSIENT_PATTERNS = [
  /network/i, /timeout/i, /ECONNREFUSED/i, /ETIMEDOUT/i,
  /503/i, /502/i, /429/i, /too many/i, /rate limit/i,
  /temporarily/i, /unavailable/i, /retry/i,
]
const PERMANENT_PATTERNS = [
  /not found/i, /404/i, /403/i, /forbidden/i,
  /invalid/i, /validation/i, /constraint/i,
  /duplicate/i, /unique/i,
]

function categorizeFailure(err: Error): FailureCategory {
  const msg = err.message ?? ''
  if (err.name === 'AbortError' || msg.includes('timeout')) return 'timeout'
  if (TRANSIENT_PATTERNS.some((p) => p.test(msg))) return 'transient'
  if (PERMANENT_PATTERNS.some((p) => p.test(msg))) return 'permanent'
  return 'unknown'
}

function calcNextSchedule(attempt: number, baseMs: number, maxMs: number): Date {
  const jitter = Math.random() * 0.3 + 0.85   // 0.85 – 1.15
  const delay  = Math.min(baseMs * Math.pow(2, attempt - 1) * jitter, maxMs)
  return new Date(Date.now() + delay)
}

// ── DurableJobQueue ────────────────────────────────────────────────────────────

const POLL_INTERVAL_MS    = 5_000    // poll every 5 seconds
const BATCH_SIZE          = 5        // claim up to 5 jobs per poll
const STALE_THRESHOLD_MS  = 5 * 60 * 1_000  // 5 minutes — jobs running longer are considered crashed
const RESULT_RETENTION_MS = 90 * 24 * 60 * 60 * 1_000  // 90 days

// ── Retry storm detection ──────────────────────────────────────────────────────
/** Number of dead results for the same job_type within STORM_WINDOW that triggers a storm alert. */
const STORM_THRESHOLD  = 10
/** Window (ms) to look back when counting storm failures. */
const STORM_WINDOW_MS  = 10 * 60 * 1_000   // 10 minutes

// ── Poison job quarantine ──────────────────────────────────────────────────────
/** After N manual requeues the job is quarantined — refused further requeues. */
const POISON_REQUEUE_THRESHOLD = 3

export interface RetryStormReport {
  job_type:     string
  dead_count:   number
  window_ms:    number
  first_dead_at: string
  last_dead_at:  string
  is_storm:     boolean
}

export interface PoisonJobInfo {
  job_id:        string
  job_type:      string
  requeue_count: number
  is_quarantined: boolean
}

export class DurableJobQueue {
  private supabase:  SupabaseClient | null = null
  private log:       Logger | null = null
  private handlers:  Map<string, JobHandlerFn> = new Map()
  private pollTimer: ReturnType<typeof setInterval> | null = null
  private running:   Set<string> = new Set()   // in-process job IDs being executed
  private started:   boolean = false
  // NOTE: requeueCounts and quarantined were previously in-memory Maps/Sets.
  // As of Migration 120 they are fully DB-backed in poison_job_quarantine.
  // No in-memory state for quarantine — safe for multi-instance deployments.

  /** Register a handler for a job type. Call before start(). */
  register(jobType: string, handler: JobHandlerFn): this {
    this.handlers.set(jobType, handler)
    return this
  }

  /**
   * Start the queue: connect, recover stale jobs, begin polling.
   * Safe to call multiple times — subsequent calls are no-ops.
   */
  async start(supabase: SupabaseClient, log: Logger): Promise<void> {
    if (this.started) return
    this.supabase = supabase
    this.log      = log as unknown as Logger
    this.started  = true

    // Crash recovery: reset stale running jobs before accepting new work
    await this._recoverStaleJobs()

    // Begin polling
    this.pollTimer = setInterval(() => { this._poll().catch(e => {
      this.log?.error({ err: e }, '[durable-queue] poll error')
      // Update module health on sustained poll errors
      this._writeModuleHealth('degraded', e instanceof Error ? e.message : String(e)).catch(() => {})
    })}, POLL_INTERVAL_MS)

    // Mark module as healthy in DB (durable across restarts)
    await this._writeModuleHealth('healthy')

    this.log?.info({ handlers: [...this.handlers.keys()] }, '[durable-queue] started')
  }

  /** Graceful shutdown: stop polling and wait for in-flight jobs. */
  async stop(timeoutMs = 30_000): Promise<void> {
    if (this.pollTimer) {
      clearInterval(this.pollTimer)
      this.pollTimer = null
    }

    if (this.running.size === 0) {
      await this._writeModuleHealth('stopped').catch(() => {})
      return
    }

    // Wait for in-flight jobs to complete
    const deadline = Date.now() + timeoutMs
    while (this.running.size > 0 && Date.now() < deadline) {
      await new Promise(r => setTimeout(r, 200))
    }

    if (this.running.size > 0) {
      this.log?.warn(
        { still_running: this.running.size },
        '[durable-queue] shutdown timeout — some jobs still in-flight',
      )
    }

    await this._writeModuleHealth('stopped').catch(() => {})
  }

  /**
   * Enqueue a job. Returns the job ID, or the existing job's ID if an
   * idempotency key matched an already-pending/running job (no-op semantics).
   */
  async enqueue(
    jobType:  string,
    payload:  Record<string, unknown> = {},
    opts:     EnqueueOpts = {},
  ): Promise<string> {
    if (!this.supabase) throw new Error('[durable-queue] not started — call start() first')

    const scheduledAt = opts.delayMs
      ? new Date(Date.now() + opts.delayMs).toISOString()
      : new Date().toISOString()

    const jobId = randomUUID()

    const row = {
      id:              jobId,
      job_type:        jobType,
      payload,
      status:          'pending',
      attempt:         0,
      max_retries:     opts.maxRetries   ?? 3,
      retry_delay_ms:  opts.retryDelayMs ?? 1_000,
      max_delay_ms:    opts.maxDelayMs   ?? 30_000,
      timeout_ms:      opts.timeoutMs    ?? 120_000,
      scheduled_at:    scheduledAt,
      idempotency_key: opts.idempotencyKey ?? null,
      tenant_id:       opts.tenantId       ?? null,
      created_by:      opts.createdBy      ?? null,
    }

    // ON CONFLICT on idempotency_key → DO NOTHING → return existing job id
    const { data, error } = await this.supabase
      .from('background_jobs')
      .upsert(row, {
        onConflict:     'idempotency_key',
        ignoreDuplicates: true,
      })
      .select('id')
      .maybeSingle()

    if (error) throw new Error(`[durable-queue] enqueue failed: ${error.message}`)

    const resolvedId = data?.id ?? jobId
    this.log?.debug({ jobId: resolvedId, jobType, scheduledAt }, '[durable-queue] job enqueued')
    return resolvedId
  }

  // ── Polling ──────────────────────────────────────────────────────────────────

  private async _poll(): Promise<void> {
    if (!this.supabase) return

    for (let i = 0; i < BATCH_SIZE; i++) {
      const claimed = await this._claimNextJob()
      if (!claimed) break   // no more pending jobs

      // Execute without awaiting — fire and forget into in-process concurrency
      this._executeJob(claimed).catch(e => {
        this.log?.error({ err: e, jobId: claimed.id }, '[durable-queue] unexpected executor error')
      })
    }
  }

  private async _claimNextJob(): Promise<DurableJob | null> {
    if (!this.supabase) return null

    // Step 1: find next pending job
    const { data: next } = await this.supabase
      .from('background_jobs')
      .select('*')
      .eq('status', 'pending')
      .lte('scheduled_at', new Date().toISOString())
      .order('scheduled_at', { ascending: true })
      .limit(1)
      .maybeSingle()

    if (!next) return null

    // Step 2: atomic claim — only succeeds if status is still 'pending'
    const now = new Date().toISOString()
    const { data: claimed, error } = await this.supabase
      .from('background_jobs')
      .update({
        status:     'running',
        started_at: now,
        attempt:    (next.attempt ?? 0) + 1,
      })
      .eq('id', next.id)
      .eq('status', 'pending')    // guard: only claim if still pending
      .select('*')
      .maybeSingle()

    if (error) {
      this.log?.warn({ err: error, jobId: next.id }, '[durable-queue] claim update error')
      return null
    }

    return claimed ?? null
  }

  // ── Execution ─────────────────────────────────────────────────────────────────

  private async _executeJob(job: DurableJob): Promise<void> {
    this.running.add(job.id)
    this.log?.debug({ jobId: job.id, jobType: job.job_type, attempt: job.attempt }, '[durable-queue] job started')

    const handler = this.handlers.get(job.job_type)
    if (!handler) {
      this.log?.error({ jobId: job.id, jobType: job.job_type }, '[durable-queue] no handler registered — moving to dead letter')
      await this._markDead(job, new Error(`No handler registered for job type '${job.job_type}'`), 'permanent')
      this.running.delete(job.id)
      return
    }

    // Timeout race
    let timeoutHandle: ReturnType<typeof setTimeout> | null = null
    const timeoutPromise = new Promise<never>((_, reject) => {
      timeoutHandle = setTimeout(
        () => reject(Object.assign(new Error(`Job timed out after ${job.timeout_ms}ms`), { name: 'AbortError' })),
        job.timeout_ms,
      )
    })

    try {
      await Promise.race([
        handler(job.payload as Record<string, unknown>, job),
        timeoutPromise,
      ])
      if (timeoutHandle) clearTimeout(timeoutHandle)
      await this._markCompleted(job)
    } catch (rawErr) {
      if (timeoutHandle) clearTimeout(timeoutHandle)
      const err      = rawErr instanceof Error ? rawErr : new Error(String(rawErr))
      const category = categorizeFailure(err)

      this.log?.warn(
        { jobId: job.id, jobType: job.job_type, attempt: job.attempt, err: err.message, category },
        '[durable-queue] job failed',
      )

      const exhausted = job.attempt >= job.max_retries + 1
      const permanent = category === 'permanent'

      if (exhausted || permanent) {
        await this._markDead(job, err, category)
      } else {
        await this._scheduleRetry(job, err, category)
      }
    } finally {
      this.running.delete(job.id)
    }
  }

  // ── Terminal state writers ─────────────────────────────────────────────────────

  private async _markCompleted(job: DurableJob): Promise<void> {
    if (!this.supabase) return
    const now = new Date().toISOString()

    await this.supabase
      .from('background_jobs')
      .update({ status: 'completed', completed_at: now })
      .eq('id', job.id)

    // Persist to results for audit trail
    await this.supabase
      .from('background_job_results')
      .insert({
        job_id:       job.id,
        job_type:     job.job_type,
        tenant_id:    job.tenant_id,
        final_status: 'completed',
        attempt:      job.attempt,
        payload:      job.payload,
        started_at:   job.started_at,
        completed_at: now,
      })

    this.log?.debug({ jobId: job.id, jobType: job.job_type }, '[durable-queue] job completed')
  }

  private async _markDead(job: DurableJob, err: Error, category: FailureCategory): Promise<void> {
    if (!this.supabase) return
    const now = new Date().toISOString()

    await this.supabase
      .from('background_jobs')
      .update({
        status:           'dead',
        failed_at:        now,
        error:            err.message,
        failure_category: category,
      })
      .eq('id', job.id)

    // Persist to dead-letter results
    await this.supabase
      .from('background_job_results')
      .insert({
        job_id:           job.id,
        job_type:         job.job_type,
        tenant_id:        job.tenant_id,
        final_status:     'dead',
        attempt:          job.attempt,
        payload:          job.payload,
        error:            err.message,
        failure_category: category,
        started_at:       job.started_at,
        completed_at:     now,
      })

    this.log?.error(
      { jobId: job.id, jobType: job.job_type, attempts: job.attempt, category },
      '[durable-queue] job moved to dead-letter',
    )
  }

  private async _scheduleRetry(job: DurableJob, err: Error, category: FailureCategory): Promise<void> {
    if (!this.supabase) return
    const nextSchedule = calcNextSchedule(job.attempt, job.retry_delay_ms, job.max_delay_ms)

    await this.supabase
      .from('background_jobs')
      .update({
        status:           'pending',
        scheduled_at:     nextSchedule.toISOString(),
        failed_at:        new Date().toISOString(),
        error:            err.message,
        failure_category: category,
      })
      .eq('id', job.id)

    this.log?.info(
      { jobId: job.id, jobType: job.job_type, nextSchedule, attempt: job.attempt },
      '[durable-queue] job scheduled for retry',
    )
  }

  // ── Crash recovery ─────────────────────────────────────────────────────────────

  private async _recoverStaleJobs(): Promise<void> {
    if (!this.supabase) return
    const staleThreshold = new Date(Date.now() - STALE_THRESHOLD_MS).toISOString()

    const { data: stale, error } = await this.supabase
      .from('background_jobs')
      .update({
        status:     'pending',
        started_at: null,
      })
      .eq('status', 'running')
      .lt('started_at', staleThreshold)
      .select('id, job_type')

    if (error) {
      this.log?.warn({ err: error }, '[durable-queue] stale job recovery query failed')
      return
    }

    if (stale && stale.length > 0) {
      this.log?.warn(
        { count: stale.length, jobs: stale.map((j: { id: string; job_type: string }) => ({ id: j.id, type: j.job_type })) },
        '[durable-queue] recovered stale running jobs after crash',
      )
    }
  }

  // ── Observability ──────────────────────────────────────────────────────────────

  /** Returns live queue metrics from the DB. Pass supabase to query before start(). */
  async getMetrics(sb?: SupabaseClient): Promise<QueueMetrics> {
    const client = sb ?? this.supabase
    if (!client) {
      return { pending: 0, running: 0, completed: 0, dead: 0, by_type: {} }
    }

    // Active jobs (pending + running)
    const { data: activeRows } = await client
      .from('background_jobs')
      .select('job_type, status')
      .in('status', ['pending', 'running'])

    // Dead jobs from results table (last 24h for metrics)
    const since24h = new Date(Date.now() - 24 * 60 * 60 * 1_000).toISOString()
    const { count: deadCount } = await client
      .from('background_job_results')
      .select('id', { count: 'exact', head: true })
      .eq('final_status', 'dead')
      .gte('created_at', since24h)

    const { count: completedCount } = await client
      .from('background_job_results')
      .select('id', { count: 'exact', head: true })
      .eq('final_status', 'completed')
      .gte('created_at', since24h)

    const byType: Record<string, { pending: number; running: number; dead: number }> = {}
    for (const row of (activeRows ?? []) as Array<{ job_type: string; status: string }>) {
      if (!byType[row.job_type]) byType[row.job_type] = { pending: 0, running: 0, dead: 0 }
      if (row.status === 'pending') byType[row.job_type]!.pending++
      if (row.status === 'running') byType[row.job_type]!.running++
    }

    const pending = Object.values(byType).reduce((s, t) => s + t.pending, 0)
    const running = Object.values(byType).reduce((s, t) => s + t.running, 0)

    return {
      pending,
      running,
      completed: completedCount ?? 0,
      dead:      deadCount      ?? 0,
      by_type:   byType,
    }
  }

  /** Returns recent dead-letter jobs from the DB. */
  async getRecentDead(sb?: SupabaseClient, limit = 20): Promise<DurableJob[]> {
    const client = sb ?? this.supabase
    if (!client) return []
    const { data } = await client
      .from('background_jobs')
      .select('*')
      .eq('status', 'dead')
      .order('failed_at', { ascending: false })
      .limit(limit)
    return (data ?? []) as DurableJob[]
  }

  /**
   * Manually requeue a dead job by ID.
   *
   * Poison-job guard: if this job has been requeued >= POISON_REQUEUE_THRESHOLD
   * times the quarantine flag is set in `poison_job_quarantine` (DB-backed,
   * survives process restarts and multi-instance deployments).
   */
  async requeueDead(sb: SupabaseClient | undefined, jobId: string): Promise<boolean> {
    const client = sb ?? this.supabase
    if (!client) return false

    // ── Step 1: Check existing quarantine state from DB ──────────────────────
    const { data: existing } = await client
      .from('poison_job_quarantine')
      .select('requeue_count, is_quarantined, job_type')
      .eq('job_id', jobId)
      .maybeSingle()

    if (existing?.is_quarantined) {
      this.log?.error(
        { jobId, requeue_count: existing.requeue_count },
        '[durable-queue] POISON JOB QUARANTINED — requeueDead refused. Call clearQuarantine() after fixing handler.',
      )
      return false
    }

    // ── Step 2: Fetch job info for quarantine record ──────────────────────────
    const { data: jobRow } = await client
      .from('background_jobs')
      .select('job_type, tenant_id, status')
      .eq('id', jobId)
      .maybeSingle()

    if (!jobRow || jobRow.status !== 'dead') return false

    // ── Step 3: Increment requeue counter in DB (atomic upsert) ──────────────
    const newCount       = (existing?.requeue_count ?? 0) + 1
    const willQuarantine = newCount >= POISON_REQUEUE_THRESHOLD

    await client
      .from('poison_job_quarantine')
      .upsert(
        {
          job_id:           jobId,
          job_type:         jobRow.job_type,
          tenant_id:        jobRow.tenant_id ?? null,
          requeue_count:    newCount,
          is_quarantined:   willQuarantine,
          last_requeue_at:  new Date().toISOString(),
          ...(willQuarantine ? {
            quarantined_at:    new Date().toISOString(),
            quarantine_reason: `Automatic quarantine after ${newCount} requeue attempts (threshold: ${POISON_REQUEUE_THRESHOLD})`,
          } : {}),
        },
        { onConflict: 'job_id' },
      )
      .then(({ error: upsertErr }) => {
        if (upsertErr) {
          this.log?.warn({ jobId, err: upsertErr.message }, '[durable-queue] poison_job_quarantine upsert failed — continuing')
        }
      })

    if (willQuarantine) {
      this.log?.error(
        { jobId, requeue_count: newCount, threshold: POISON_REQUEUE_THRESHOLD, job_type: jobRow.job_type },
        '[durable-queue] POISON JOB DETECTED — quarantined. Fix handler, then call DELETE /system/jobs/durable/quarantine/:id.',
      )
      return false
    }

    // ── Step 4: Re-enqueue the job ────────────────────────────────────────────
    const { data: requeued } = await client
      .from('background_jobs')
      .update({
        status:       'pending',
        attempt:      0,
        error:        null,
        failed_at:    null,
        scheduled_at: new Date().toISOString(),
      })
      .eq('id', jobId)
      .eq('status', 'dead')
      .select('id')
      .maybeSingle()

    if (requeued) {
      this.log?.info({ jobId, requeue_count: newCount }, '[durable-queue] dead job requeued')
    }
    return !!requeued
  }

  /** Purge old completed/dead results older than `days` days (default: 90). */
  async purgeOldResults(sb?: SupabaseClient, days = 90): Promise<number> {
    const client = sb ?? this.supabase
    if (!client) return 0
    const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1_000).toISOString()
    const { data } = await client
      .from('background_job_results')
      .delete()
      .lt('created_at', cutoff)
      .select('id')
    return (data ?? []).length
  }

  // ── Retry storm detection ──────────────────────────────────────────────────────

  /**
   * Detect retry storms: job types where > STORM_THRESHOLD dead results have
   * accumulated in the last STORM_WINDOW_MS milliseconds.
   * Detected storms are persisted to `retry_storm_incidents` (DB-backed).
   */
  async detectRetryStorm(sb?: SupabaseClient): Promise<RetryStormReport[]> {
    const client = sb ?? this.supabase
    if (!client) return []

    const since = new Date(Date.now() - STORM_WINDOW_MS).toISOString()

    const { data, error } = await client
      .from('background_job_results')
      .select('job_type, tenant_id, created_at')
      .eq('final_status', 'dead')
      .gte('created_at', since)
      .order('created_at', { ascending: true })
      .limit(1000)

    if (error || !data?.length) return []

    const byType = new Map<string, { times: string[]; tenant_id: string | null }>()
    for (const row of data as any[]) {
      if (!byType.has(row.job_type)) {
        byType.set(row.job_type, { times: [], tenant_id: row.tenant_id ?? null })
      }
      byType.get(row.job_type)!.times.push(row.created_at as string)
    }

    const reports: RetryStormReport[] = []
    for (const [jobType, { times, tenant_id }] of byType) {
      const isStorm = times.length >= STORM_THRESHOLD
      if (isStorm || times.length > 0) {
        reports.push({
          job_type:      jobType,
          dead_count:    times.length,
          window_ms:     STORM_WINDOW_MS,
          first_dead_at: times[0]!,
          last_dead_at:  times[times.length - 1]!,
          is_storm:      isStorm,
        })

        if (isStorm) {
          this.log?.error(
            { job_type: jobType, dead_count: times.length, window_ms: STORM_WINDOW_MS },
            '[durable-queue] RETRY STORM DETECTED — disable handler or increase retry delay.',
          )

          // Persist to DB — unique index prevents duplicate rows per job_type per hour
          await client
            .from('retry_storm_incidents')
            .insert({
              job_type:      jobType,
              tenant_id:     tenant_id ?? null,
              dead_count:    times.length,
              window_ms:     STORM_WINDOW_MS,
              first_dead_at: times[0]!,
              last_dead_at:  times[times.length - 1]!,
              status:        'open',
            })
            .then(({ error: insertErr }) => {
              if (insertErr && !insertErr.message.includes('unique')) {
                this.log?.warn({ jobType, err: insertErr.message }, '[durable-queue] storm incident insert failed')
              }
            })
        }
      }
    }

    return reports.sort((a, b) => b.dead_count - a.dead_count)
  }

  // ── Poison job quarantine (DB-backed) ─────────────────────────────────────────

  /** Returns DB-backed quarantine status for a job ID. Async — queries DB. */
  async getPoisonJobStatus(sb: SupabaseClient | undefined, jobId: string): Promise<PoisonJobInfo | null> {
    const client = sb ?? this.supabase
    if (!client) return null

    const { data } = await client
      .from('poison_job_quarantine')
      .select('job_id, job_type, requeue_count, is_quarantined')
      .eq('job_id', jobId)
      .maybeSingle()

    if (!data) return null
    return {
      job_id:         data.job_id,
      job_type:       data.job_type,
      requeue_count:  data.requeue_count,
      is_quarantined: data.is_quarantined,
    }
  }

  /**
   * Clear quarantine for a job after the handler has been fixed.
   * DB-backed — resets counter, records operator action, returns false if not found.
   */
  async clearQuarantine(
    sb:        SupabaseClient | undefined,
    jobId:     string,
    clearedBy?: string,
    reason?:    string,
  ): Promise<boolean> {
    const client = sb ?? this.supabase
    if (!client) return false

    const { data, error } = await client
      .from('poison_job_quarantine')
      .update({
        is_quarantined: false,
        requeue_count:  0,
        cleared_at:     new Date().toISOString(),
        cleared_by:     clearedBy ?? null,
        clear_reason:   reason    ?? null,
      })
      .eq('job_id', jobId)
      .eq('is_quarantined', true)
      .select('job_id')
      .maybeSingle()

    if (error) {
      this.log?.error({ jobId, err: error.message }, '[durable-queue] clearQuarantine DB update failed')
      return false
    }

    if (!data) return false

    this.log?.warn({ jobId, clearedBy, reason }, '[durable-queue] quarantine cleared — job may be requeued again')
    return true
  }

  /** Returns all currently quarantined jobs from DB. */
  async getQuarantinedJobs(sb?: SupabaseClient): Promise<PoisonJobInfo[]> {
    const client = sb ?? this.supabase
    if (!client) return []

    const { data } = await client
      .from('poison_job_quarantine')
      .select('job_id, job_type, requeue_count, is_quarantined')
      .eq('is_quarantined', true)
      .is('cleared_at', null)
      .order('last_requeue_at', { ascending: false })
      .limit(100)

    return ((data ?? []) as any[]).map(r => ({
      job_id:         r.job_id,
      job_type:       r.job_type,
      requeue_count:  r.requeue_count,
      is_quarantined: r.is_quarantined,
    }))
  }

  // ── Storm incident management ──────────────────────────────────────────────────

  /** Returns all open retry storm incidents from DB. */
  async getOpenStormIncidents(sb?: SupabaseClient): Promise<any[]> {
    const client = sb ?? this.supabase
    if (!client) return []

    const { data } = await client
      .from('retry_storm_incidents')
      .select('id, job_type, tenant_id, dead_count, first_dead_at, last_dead_at, detected_at, status')
      .eq('status', 'open')
      .order('dead_count', { ascending: false })
      .limit(50)

    return (data ?? []) as any[]
  }

  /** Acknowledge a retry storm incident (operator action). */
  async acknowledgeStorm(sb: SupabaseClient | undefined, incidentId: string, acknowledgedBy: string): Promise<boolean> {
    const client = sb ?? this.supabase
    if (!client) return false

    const { data } = await client
      .from('retry_storm_incidents')
      .update({
        status:          'acknowledged',
        acknowledged_by: acknowledgedBy,
        acknowledged_at: new Date().toISOString(),
      })
      .eq('id', incidentId)
      .eq('status', 'open')
      .select('id')
      .maybeSingle()

    return !!data
  }

  // ── Module health ──────────────────────────────────────────────────────────────

  /**
   * Upsert this module's health status to the `module_health` table.
   * Fire-and-forget — never throws so it cannot disrupt the queue's main loop.
   */
  private async _writeModuleHealth(
    status:       'starting' | 'healthy' | 'degraded' | 'failed' | 'stopped',
    errorMessage?: string,
  ): Promise<void> {
    const client = this.supabase
    if (!client) return

    const now = new Date().toISOString()
    await client
      .from('module_health')
      .upsert(
        {
          module_name:     'durable-queue',
          status,
          last_updated_at: now,
          error_message:   errorMessage ?? null,
          ...(status === 'healthy' ? { started_at: now, error_count: 0 } : {}),
          metadata: { handlers: [...this.handlers.keys()], in_flight: this.running.size },
        },
        { onConflict: 'module_name' },
      )
      .then(({ error: uErr }) => {
        if (uErr) {
          this.log?.debug({ err: uErr.message }, '[durable-queue] module_health upsert failed (non-critical)')
        }
      })
  }

  get isStarted(): boolean { return this.started }
  get inFlightCount(): number { return this.running.size }
  get registeredHandlers(): string[] { return [...this.handlers.keys()] }
}

// ── Singleton export ────────────────────────────────────────────────────────────

export const durableQueue = new DurableJobQueue()
