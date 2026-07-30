/**
 * Job Queue — lightweight in-process background job infrastructure.
 *
 * No external broker required. Uses Node.js event loop + setTimeout for
 * scheduling. Designed for resilience: exponential backoff, dead-letter queue,
 * retry metrics, failure categorization, queue visibility.
 *
 * Architecture:
 *   JobQueue (singleton)
 *     ├── pending[]       — queued, not yet started
 *     ├── running Set     — currently executing job IDs
 *     ├── completed[]     — last 100 successful completions (ring buffer)
 *     ├── deadLetter[]    — permanently failed jobs (exhausted retries)
 *     └── metrics{}       — counters per job type
 *
 * Usage:
 *   import { jobQueue } from './job-queue.js'
 *   jobQueue.enqueue('send-notification', async () => { ... }, { maxRetries: 3 })
 */

import { EventEmitter }  from 'node:events'
import { randomUUID }    from 'node:crypto'
import type { Logger }   from 'pino'

// ── Types ─────────────────────────────────────────────────────────────────────

export type JobStatus = 'pending' | 'running' | 'completed' | 'failed' | 'dead'

export type FailureCategory = 'transient' | 'permanent' | 'timeout' | 'unknown'

export interface JobOptions {
  /** Maximum retry attempts (default: 3). Set 0 to disable retries. */
  maxRetries?:    number
  /** Initial delay between retries in ms (default: 1000). Doubles each attempt. */
  retryDelayMs?:  number
  /** Max delay cap for exponential backoff in ms (default: 30_000). */
  maxDelayMs?:    number
  /** Job execution timeout in ms (default: 60_000). */
  timeoutMs?:     number
  /** Arbitrary metadata attached to the job for observability. */
  meta?:          Record<string, unknown>
}

export interface Job {
  id:           string
  type:         string
  status:       JobStatus
  attempt:      number
  maxRetries:   number
  retryDelayMs: number
  maxDelayMs:   number
  timeoutMs:    number
  enqueuedAt:   string
  startedAt:    string | null
  completedAt:  string | null
  failedAt:     string | null
  error:        string | null
  failureCategory: FailureCategory | null
  meta:         Record<string, unknown>
}

export interface JobMetrics {
  enqueued:  number
  started:   number
  completed: number
  failed:    number
  retried:   number
  dead:      number
}

// ── Failure categorization ────────────────────────────────────────────────────

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
  if (TRANSIENT_PATTERNS.some((p) => p.test(msg)))          return 'transient'
  if (PERMANENT_PATTERNS.some((p) => p.test(msg)))          return 'permanent'
  return 'unknown'
}

// ── Delay helper ──────────────────────────────────────────────────────────────

function calcDelay(attempt: number, base: number, max: number): number {
  const jitter = Math.random() * 0.3 + 0.85  // 0.85–1.15 jitter
  return Math.min(base * Math.pow(2, attempt - 1) * jitter, max)
}

// ── JobQueue ─────────────────────────────────────────────────────────────────

const COMPLETED_RING_SIZE = 100

type HandlerFn = () => Promise<void>

export class JobQueue extends EventEmitter {
  private pending:     Map<string, Job>    = new Map()
  private running:     Set<string>         = new Set()
  private completed:   Job[]               = []
  private deadLetter:  Job[]               = []
  private handlers:    Map<string, HandlerFn[]> = new Map()
  private metrics:     Map<string, JobMetrics>  = new Map()
  private log:         Logger | null       = null
  private concurrency: number              = 10
  private _activeSlots: number             = 0

  setLogger(log: Logger) { this.log = log }
  setConcurrency(n: number) { this.concurrency = n }

  // ── Enqueueing ──────────────────────────────────────────────────────────────

  enqueue(
    type:    string,
    handler: HandlerFn,
    opts?:   JobOptions,
  ): string {
    const id    = randomUUID()
    const now   = new Date().toISOString()

    const job: Job = {
      id,
      type,
      status:          'pending',
      attempt:         0,
      maxRetries:      opts?.maxRetries      ?? 3,
      retryDelayMs:    opts?.retryDelayMs    ?? 1_000,
      maxDelayMs:      opts?.maxDelayMs      ?? 30_000,
      timeoutMs:       opts?.timeoutMs       ?? 60_000,
      enqueuedAt:      now,
      startedAt:       null,
      completedAt:     null,
      failedAt:        null,
      error:           null,
      failureCategory: null,
      meta:            opts?.meta            ?? {},
    }

    this.pending.set(id, job)
    this._bumpMetric(type, 'enqueued')
    this._storeHandler(id, handler)

    this.log?.debug({ jobId: id, type }, 'job enqueued')
    this.emit('enqueued', job)

    // Schedule immediately (next tick)
    setImmediate(() => this._drain())
    return id
  }

  // ── Schedule with delay ─────────────────────────────────────────────────────

  schedule(
    type:       string,
    handler:    HandlerFn,
    delayMs:    number,
    opts?:      Omit<JobOptions, 'retryDelayMs' | 'maxDelayMs'>,
  ): string {
    const id    = randomUUID()
    const now   = new Date().toISOString()

    const job: Job = {
      id,
      type,
      status:          'pending',
      attempt:         0,
      maxRetries:      opts?.maxRetries ?? 3,
      retryDelayMs:    1_000,
      maxDelayMs:      30_000,
      timeoutMs:       opts?.timeoutMs  ?? 60_000,
      enqueuedAt:      now,
      startedAt:       null,
      completedAt:     null,
      failedAt:        null,
      error:           null,
      failureCategory: null,
      meta:            opts?.meta       ?? {},
    }

    this.pending.set(id, job)
    this._bumpMetric(type, 'enqueued')
    this._storeHandler(id, handler)

    setTimeout(() => this._drain(), delayMs)
    return id
  }

  // ── Queue drain ─────────────────────────────────────────────────────────────

  private _drain() {
    if (this._activeSlots >= this.concurrency) return

    for (const [id, job] of this.pending) {
      if (this._activeSlots >= this.concurrency) break
      this.pending.delete(id)
      this._execute(id, job)
    }
  }

  private async _execute(id: string, job: Job) {
    this._activeSlots++
    this.running.add(id)

    job.status    = 'running'
    job.startedAt = new Date().toISOString()
    job.attempt++

    this._bumpMetric(job.type, 'started')
    this.emit('started', job)
    this.log?.debug({ jobId: id, type: job.type, attempt: job.attempt }, 'job started')

    try {
      const handler = this._popHandler(id)
      if (!handler) {
        this.log?.error({ jobId: id }, 'job handler not found — discarding')
        this._finalize(job, new Error('Handler not found'))
        return
      }

      // Race handler against timeout
      let timer: ReturnType<typeof setTimeout> | null = null
      const timeoutPromise = new Promise<never>((_, reject) => {
        timer = setTimeout(
          () => reject(Object.assign(new Error(`Job timed out after ${job.timeoutMs}ms`), { name: 'AbortError' })),
          job.timeoutMs,
        )
      })

      try {
        await Promise.race([handler(), timeoutPromise])
        if (timer) clearTimeout(timer)
        this._succeed(job)
      } catch (rawErr) {
        if (timer) clearTimeout(timer)
        this._finalize(job, rawErr instanceof Error ? rawErr : new Error(String(rawErr)), handler)
      }
    } finally {
      // Must run for every exit path, including the "handler not found" early
      // return above — otherwise _activeSlots/running never decrement and
      // this slot is leaked forever, eventually stalling the whole queue.
      this.running.delete(id)
      this._activeSlots = Math.max(0, this._activeSlots - 1)
      setImmediate(() => this._drain())
    }
  }

  private _succeed(job: Job) {
    job.status      = 'completed'
    job.completedAt = new Date().toISOString()
    this._bumpMetric(job.type, 'completed')
    this.emit('completed', job)
    this.log?.debug({ jobId: job.id, type: job.type, attempt: job.attempt }, 'job completed')

    // Ring buffer
    this.completed.push({ ...job })
    if (this.completed.length > COMPLETED_RING_SIZE) {
      this.completed.shift()
    }
  }

  private _finalize(job: Job, err: Error, handler?: HandlerFn) {
    job.error            = err.message
    job.failureCategory  = categorizeFailure(err)
    job.failedAt         = new Date().toISOString()

    this.log?.warn({ jobId: job.id, type: job.type, attempt: job.attempt, err: err.message, category: job.failureCategory }, 'job failed')

    const exhausted = job.attempt >= job.maxRetries + 1
    const permanent = job.failureCategory === 'permanent'

    if (exhausted || permanent) {
      // Dead-letter
      job.status = 'dead'
      this.deadLetter.push({ ...job })
      this._bumpMetric(job.type, 'dead')
      this.emit('dead', job)
      this.log?.error({ jobId: job.id, type: job.type, attempts: job.attempt }, 'job moved to dead-letter queue')
    } else if (handler) {
      // Retry with backoff
      job.status = 'pending'
      const delay = calcDelay(job.attempt, job.retryDelayMs, job.maxDelayMs)
      this._bumpMetric(job.type, 'retried')
      this.emit('retry', job)
      this.log?.info({ jobId: job.id, type: job.type, delayMs: delay, attempt: job.attempt }, 'job scheduled for retry')

      setTimeout(() => {
        this._storeHandler(job.id, handler)
        this.pending.set(job.id, job)
        this._drain()
      }, delay)
    } else {
      job.status = 'dead'
      this.deadLetter.push({ ...job })
      this._bumpMetric(job.type, 'dead')
      this.emit('dead', job)
    }

    this._bumpMetric(job.type, 'failed')
    this.emit('failed', job)
  }

  // ── Handler registry ─────────────────────────────────────────────────────────

  private _storeHandler(id: string, fn: HandlerFn) {
    this.handlers.set(id, [fn])
  }

  private _popHandler(id: string): HandlerFn | undefined {
    const arr = this.handlers.get(id)
    this.handlers.delete(id)
    return arr?.[0]
  }

  // ── Metrics ──────────────────────────────────────────────────────────────────

  private _bumpMetric(type: string, key: keyof JobMetrics) {
    const m = this.metrics.get(type) ?? { enqueued: 0, started: 0, completed: 0, failed: 0, retried: 0, dead: 0 }
    m[key]++
    this.metrics.set(type, m)
  }

  getMetrics(): Record<string, JobMetrics> {
    return Object.fromEntries(this.metrics)
  }

  // ── Visibility ───────────────────────────────────────────────────────────────

  getQueueSnapshot(): {
    pending:    number
    running:    number
    completed:  number
    deadLetter: number
    metrics:    Record<string, JobMetrics>
    recentDead: Job[]
  } {
    return {
      pending:    this.pending.size,
      running:    this.running.size,
      completed:  this.completed.length,
      deadLetter: this.deadLetter.length,
      metrics:    this.getMetrics(),
      recentDead: this.deadLetter.slice(-10),
    }
  }

  getDeadLetterJobs(): Job[] {
    return [...this.deadLetter]
  }

  /** Manually retry a dead-letter job. */
  retryDead(jobId: string, handler: HandlerFn): boolean {
    const idx = this.deadLetter.findIndex((j) => j.id === jobId)
    if (idx === -1) return false
    const [job] = this.deadLetter.splice(idx, 1)
    job.status  = 'pending'
    job.error   = null
    job.failedAt = null
    job.attempt = 0
    this.pending.set(job.id, job)
    this._storeHandler(job.id, handler)
    this._drain()
    return true
  }

  /** Purge dead-letter queue (admin action). */
  purgeDeadLetter() {
    const count = this.deadLetter.length
    this.deadLetter = []
    return count
  }
}

// ── Singleton export ──────────────────────────────────────────────────────────

export const jobQueue = new JobQueue()
