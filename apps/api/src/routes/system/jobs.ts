/**
 * Job Queue Visibility API
 *
 * Exposes both the legacy in-process job queue and the new durable
 * Postgres-backed queue state to operators. Scheduler heartbeat health
 * is surfaced through the combined observability endpoint.
 *
 * Legacy queue (in-memory, cleared on restart):
 *   GET    /system/jobs           — queue snapshot (counts + metrics by type)
 *   GET    /system/jobs/dead      — dead-letter job list (last 200)
 *   POST   /system/jobs/dead/:id/retry
 *   DELETE /system/jobs/dead
 *
 * Durable queue (Postgres-backed, crash-safe):
 *   GET    /system/jobs/durable                     — live DB counts (pending/running/dead)
 *   GET    /system/jobs/durable/dead                — recent dead jobs from background_job_results
 *   POST   /system/jobs/durable/dead/:id/requeue    — requeue a specific dead job
 *   DELETE /system/jobs/durable/dead                — purge results older than N days (default 90)
 *   GET    /system/jobs/durable/retry-storm         — detect retry storms (last 10 min)
 *   GET    /system/jobs/durable/retry-storm/open    — open storm incidents from DB
 *   POST   /system/jobs/durable/retry-storm/:id/acknowledge
 *   GET    /system/jobs/durable/quarantine          — all quarantined job records
 *   DELETE /system/jobs/durable/quarantine/:id      — clear quarantine (operator override)
 *
 * Module health (durable, DB-backed):
 *   GET    /system/module-health              — all module_health rows
 *
 * Scheduler health:
 *   GET    /system/scheduler-health          — all scheduler_heartbeats rows
 */

import type { FastifyInstance } from 'fastify'
import { jobQueue }             from '../../lib/job-queue.js'
import { durableQueue }         from '../../lib/durable-queue.js'
import { eventBus }             from '../../lib/event-bus.js'
import { platformHealth }       from '../../lib/startup-health.js'
import { HR_ADMIN_ROLES }       from '../../lib/rbac.js'

// ── Automation Job Registry ──────────────────────────────────────────────────

interface AutomationJob {
  id:          string
  name:        string
  description: string
  schedule:    string
  owner:       string
  job_type:    string    // maps to job queue job_type / durable job_type
  is_enabled:  boolean
}

const AUTOMATION_REGISTRY: AutomationJob[] = [
  {
    id:          'attendance-processing',
    name:        'Attendance Processing',
    description: 'Processes raw punch logs into daily attendance records',
    schedule:    'Daily @ 01:00',
    owner:       'Attendance',
    job_type:    'process-attendance',
    is_enabled:  true,
  },
  {
    id:          'leave-accrual',
    name:        'Leave Balance Accrual',
    description: 'Credits earned leave balances to eligible employees',
    schedule:    'Monthly @ 00:05',
    owner:       'Leave',
    job_type:    'leave-accrual',
    is_enabled:  true,
  },
  {
    id:          'sla-scanner',
    name:        'SLA Scanner',
    description: 'Flags overdue leave and correction requests for escalation',
    schedule:    'Every 4 hours',
    owner:       'Operations',
    job_type:    'sla-scan',
    is_enabled:  true,
  },
  {
    id:          'anomaly-detection',
    name:        'Anomaly Detection',
    description: 'Runs ML-based anomaly detection on attendance patterns',
    schedule:    'Daily @ 02:00',
    owner:       'Intelligence',
    job_type:    'detect-anomalies',
    is_enabled:  true,
  },
  {
    id:          'intelligence-scanner',
    name:        'Intelligence Scanner',
    description: 'Emits operational insight events to the event bus',
    schedule:    'Every 6 hours',
    owner:       'Intelligence',
    job_type:    'intelligence-scan',
    is_enabled:  true,
  },
  {
    id:          'event-bus-automation',
    name:        'Event Bus Automation',
    description: 'Responds to events for SLA monitoring, balance alerts, and escalations',
    schedule:    'Event-driven',
    owner:       'Operations',
    job_type:    'event-automation',
    is_enabled:  true,
  },
]

export default async function jobQueueRoutes(fastify: FastifyInstance) {
  const auth = { preHandler: [fastify.authenticate] }

  // ── GET /system/jobs ────────────────────────────────────────────────────────
  // Returns a real-time snapshot of the job queue state.
  fastify.get('/system/jobs', auth, async (req: any, reply) => {
    const snapshot     = jobQueue.getQueueSnapshot()
    const busMetrics   = eventBus.getMetrics()
    const busHandlers  = eventBus.getHandlerCount()

    return reply.send({
      data: {
        queue:   snapshot,
        summary: {
          pending:    snapshot.pending,
          running:    snapshot.running,
          completed:  snapshot.completed,
          deadLetter: snapshot.deadLetter,
        },
        metrics: snapshot.metrics,
        event_bus: {
          handler_count: busHandlers,
          by_type:       busMetrics,
          total_emitted: Object.values(busMetrics).reduce((s, m) => s + m.emitted, 0),
          total_failed:  Object.values(busMetrics).reduce((s, m) => s + m.failed, 0),
        },
      },
    })
  })

  // ── GET /system/jobs/dead ────────────────────────────────────────────────────
  // Returns all dead-letter jobs for inspection.
  fastify.get('/system/jobs/dead', auth, async (req: any, reply) => {
    if (!(HR_ADMIN_ROLES as readonly string[]).includes(req.userRole)) {
      return reply.code(403).send({ error: 'FORBIDDEN', message: 'HR admin access required' })
    }

    const dead = jobQueue.getDeadLetterJobs()
    return reply.send({
      data:  dead,
      total: dead.length,
    })
  })

  // ── GET /system/jobs/automations ───────────────────────────────────────────
  // Returns the static automation registry enriched with live queue metrics.
  fastify.get('/system/jobs/automations', auth, async (_req: any, reply) => {
    const snapshot = jobQueue.getQueueSnapshot()

    const jobs = AUTOMATION_REGISTRY.map(job => {
      const metrics = snapshot.metrics[job.job_type]
      // Check if this job type has any recent completed or failed metrics
      const lastStatus: 'success' | 'failed' | null =
        metrics
          ? metrics.failed > 0 ? 'failed' : metrics.completed > 0 ? 'success' : null
          : null

      return {
        id:          job.id,
        name:        job.name,
        description: job.description,
        schedule:    job.schedule,
        owner:       job.owner,
        is_enabled:  job.is_enabled,
        last_run_at: null,    // not tracked in-memory queue; extend with DB if needed
        last_status: lastStatus,
        next_run_at: null,
      }
    })

    return reply.send({ data: jobs, total: jobs.length })
  })

  // ── POST /system/jobs/:jobId/trigger ────────────────────────────────────────
  // Manually trigger a registered automation job via the durable queue.
  fastify.post('/system/jobs/:jobId/trigger', auth, async (req: any, reply) => {
    if (!(HR_ADMIN_ROLES as readonly string[]).includes(req.userRole)) {
      return reply.code(403).send({ error: 'FORBIDDEN', message: 'Admin access required' })
    }

    const { jobId } = req.params as { jobId: string }

    const automation = AUTOMATION_REGISTRY.find(j => j.id === jobId)
    if (!automation) {
      return reply.code(404).send({ error: 'NOT_FOUND', message: `Automation job '${jobId}' not found` })
    }

    if (!automation.is_enabled) {
      return reply.code(409).send({ error: 'JOB_DISABLED', message: `Automation '${automation.name}' is currently disabled` })
    }

    try {
      const enqueuedId = await durableQueue.enqueue(
        automation.job_type,
        { triggered_by: req.userId, manual_trigger: true },
        { tenantId: req.tenantId, createdBy: req.userId },
      )

      fastify.log.info(
        { jobId: enqueuedId, jobType: automation.job_type, triggeredBy: req.userId },
        'automation manually triggered via /system/jobs/:jobId/trigger',
      )

      return reply.send({
        message: `Automation '${automation.name}' triggered successfully`,
        jobId:   enqueuedId,
      })
    } catch (err: any) {
      fastify.log.error({ err, automationId: jobId }, 'manual trigger failed')
      return reply.code(500).send({ error: 'TRIGGER_FAILED', message: err?.message ?? 'Failed to trigger automation' })
    }
  })

  // ── POST /system/jobs/dead/:id/retry ────────────────────────────────────────
  // Manually re-enqueue a dead-letter job. The job handler is reconstructed from
  // the job's `type` field — only works for jobs whose handlers are registered in
  // the handler registry below. Novel one-off jobs cannot be retried this way.
  fastify.post('/system/jobs/dead/:id/retry', auth, async (req: any, reply) => {
    if (!(HR_ADMIN_ROLES as readonly string[]).includes(req.userRole)) {
      return reply.code(403).send({ error: 'FORBIDDEN', message: 'HR admin access required' })
    }

    const { id } = req.params as { id: string }
    const dead   = jobQueue.getDeadLetterJobs()
    const job    = dead.find(j => j.id === id)

    if (!job) {
      return reply.code(404).send({ error: 'NOT_FOUND', message: `Dead-letter job '${id}' not found` })
    }

    // Attempt to re-enqueue with a no-op handler (operator must supply real handler).
    // This endpoint is primarily a diagnostic tool — the operator verifies the job
    // can be retried and then restores the handler externally if needed.
    // For known retriable types we log a warning.
    fastify.log.warn(
      { jobId: id, type: job.type, meta: job.meta },
      'manual dead-letter retry requested via /system/jobs API — re-enqueueing with stub handler',
    )

    // Stub handler — in production, wire real handlers through a handler registry.
    const stubHandler = async () => {
      fastify.log.info({ jobId: id, type: job.type }, 'stub retry handler executed — job marked complete')
    }

    const ok = jobQueue.retryDead(id, stubHandler)
    if (!ok) {
      return reply.code(404).send({ error: 'NOT_FOUND', message: `Job '${id}' not found in dead-letter queue` })
    }

    return reply.send({ message: `Job '${id}' re-enqueued successfully`, jobId: id })
  })

  // ── GET /system/observability ────────────────────────────────────────────────
  // Combined observability dashboard — event bus + job queue + platform health.
  // For hr_admin / super_admin only.
  fastify.get('/system/observability', auth, async (req: any, reply) => {
    if (!(HR_ADMIN_ROLES as readonly string[]).includes(req.userRole)) {
      return reply.code(403).send({ error: 'FORBIDDEN', message: 'HR admin access required' })
    }

    const snapshot   = jobQueue.getQueueSnapshot()
    const busMetrics = eventBus.getMetrics()
    const busHandlers= eventBus.getHandlerCount()

    const totalEmitted = Object.values(busMetrics).reduce((s, m) => s + m.emitted, 0)
    const totalFailed  = Object.values(busMetrics).reduce((s, m) => s + m.failed, 0)
    const failureRate  = totalEmitted > 0 ? Math.round((totalFailed / totalEmitted) * 100) : 0

    // Event bus by-type sorted by emission count desc
    const eventsByType = Object.entries(busMetrics)
      .map(([type, m]) => ({
        type,
        emitted: m.emitted,
        failed:  m.failed,
        failurePct: m.emitted > 0 ? Math.round((m.failed / m.emitted) * 100) : 0,
      }))
      .sort((a, b) => b.emitted - a.emitted)

    // Job metrics sorted by total activity
    const jobMetrics = Object.entries(snapshot.metrics)
      .map(([type, m]) => ({ type, ...m }))
      .sort((a, b) => (b.enqueued - a.enqueued))

    return reply.send({
      data: {
        timestamp: new Date().toISOString(),
        platform: {
          status:    platformHealth.status,
          startedAt: platformHealth.startedAt,
          uptimeSeconds: Math.floor(process.uptime()),
          modules:   platformHealth.modules,
          checks:    platformHealth.checks,
        },
        event_bus: {
          handler_count: busHandlers,
          total_emitted: totalEmitted,
          total_failed:  totalFailed,
          failure_rate_pct: failureRate,
          by_type:       eventsByType,
        },
        job_queue: {
          pending:    snapshot.pending,
          running:    snapshot.running,
          completed:  snapshot.completed,
          dead_letter: snapshot.deadLetter,
          by_type:    jobMetrics,
          recent_dead: snapshot.recentDead.slice(-5).map(j => ({
            id:        j.id,
            type:      j.type,
            error:     j.error,
            failedAt:  j.failedAt,
            attempts:  j.attempt,
          })),
        },
      },
    })
  })

  // ── GET /metrics ──────────────────────────────────────────────────────────────
  // Compact operational health snapshot — event bus, durable queue, webhooks,
  // scheduler heartbeats. For monitoring systems, dashboards, and health cards.
  fastify.get('/metrics', auth, async (req: any, reply) => {
    if (!(HR_ADMIN_ROLES as readonly string[]).includes(req.userRole)) {
      return reply.code(403).send({ error: 'FORBIDDEN', message: 'Admin access required' })
    }

    const busMetrics   = eventBus.getMetrics()
    const busHandlers  = eventBus.getHandlerCount()
    const totalEmitted = Object.values(busMetrics).reduce((s, m) => s + m.emitted, 0)
    const totalFailed  = Object.values(busMetrics).reduce((s, m) => s + m.failed, 0)

    // Durable queue + stuck job count in parallel with webhook delivery stats
    const staleThreshold = new Date(Date.now() - 5 * 60 * 1_000).toISOString()
    const since24h       = new Date(Date.now() - 24 * 60 * 60 * 1_000).toISOString()

    const [
      queueMetrics,
      stuckResult,
      retryResult,
      wh24hResult,
      whFailedResult,
      whPendingResult,
    ] = await Promise.all([
      durableQueue.getMetrics(fastify.supabase),
      fastify.supabase
        .from('background_jobs')
        .select('id', { count: 'exact', head: true })
        .eq('status', 'running')
        .lt('started_at', staleThreshold),
      fastify.supabase
        .from('background_jobs')
        .select('id', { count: 'exact', head: true })
        .eq('status', 'pending')
        .gt('attempt', 0),
      fastify.supabase
        .from('webhook_deliveries')
        .select('id', { count: 'exact', head: true })
        .gte('created_at', since24h),
      fastify.supabase
        .from('webhook_deliveries')
        .select('id', { count: 'exact', head: true })
        .eq('status', 'failed')
        .gte('created_at', since24h),
      fastify.supabase
        .from('webhook_deliveries')
        .select('id', { count: 'exact', head: true })
        .eq('status', 'pending'),
    ])

    const stuckJobs    = stuckResult.count   ?? 0
    const retryQueue   = retryResult.count   ?? 0
    const wh24h        = wh24hResult.count   ?? 0
    const whFailed     = whFailedResult.count ?? 0
    const whPending    = whPendingResult.count ?? 0

    const queueStatus =
      stuckJobs > 5         ? 'degraded' :
      queueMetrics.dead > 10 ? 'warning'  : 'healthy'

    const webhookStatus = whFailed > 0 ? 'degraded' : 'healthy'

    const busStatus =
      totalEmitted > 0 && totalFailed / totalEmitted > 0.1 ? 'degraded' : 'healthy'

    return reply.send({
      timestamp:  new Date().toISOString(),
      event_bus: {
        handler_count:    busHandlers,
        total_emitted:    totalEmitted,
        total_failed:     totalFailed,
        failure_rate_pct: totalEmitted > 0
          ? Math.round((totalFailed / totalEmitted) * 100)
          : 0,
        status:           busStatus,
      },
      queue: {
        pending:          queueMetrics.pending,
        running:          queueMetrics.running,
        completed_24h:    queueMetrics.completed,
        dead_24h:         queueMetrics.dead,
        retry_queue_size: retryQueue,
        stuck_jobs:       stuckJobs,
        status:           queueStatus,
      },
      webhooks: {
        deliveries_24h: wh24h,
        failed_24h:     whFailed,
        pending:        whPending,
        status:         webhookStatus,
      },
    })
  })

  // ── DELETE /system/jobs/dead ─────────────────────────────────────────────────
  // Purges the entire dead-letter queue. Irreversible — use with care.
  fastify.delete('/system/jobs/dead', auth, async (req: any, reply) => {
    if (!(HR_ADMIN_ROLES as readonly string[]).includes(req.userRole)) {
      return reply.code(403).send({ error: 'FORBIDDEN', message: 'HR admin access required' })
    }

    const count = jobQueue.purgeDeadLetter()
    fastify.log.warn(
      { count, purgedBy: req.userId },
      'dead-letter queue purged via /system/jobs API',
    )

    return reply.send({
      message: `Dead-letter queue purged — ${count} job(s) removed`,
      purged:  count,
    })
  })

  // ═══════════════════════════════════════════════════════════════════════════════
  // Durable queue endpoints (Postgres-backed)
  // ═══════════════════════════════════════════════════════════════════════════════

  // ── GET /system/jobs/durable ──────────────────────────────────────────────────
  // Live counts queried directly from background_jobs.
  // Includes stuck_running_count: jobs that have been in 'running' state longer
  // than the stale threshold (5 min) — indicates crashed workers or hung handlers.
  fastify.get('/system/jobs/durable', auth, async (_req: any, reply) => {
    const metrics = await durableQueue.getMetrics(fastify.supabase)

    // Detect jobs stuck in 'running' longer than the stale recovery threshold (5 min).
    // These are jobs that a crashed worker held but were not yet recovered by
    // _recoverStaleJobs() (e.g., the queue is not currently started, or a new crash
    // happened after recovery). Surfacing them here lets operators act immediately.
    const STALE_THRESHOLD_MS = 5 * 60 * 1_000
    const staleThreshold = new Date(Date.now() - STALE_THRESHOLD_MS).toISOString()

    const { data: stuckJobs, error: stuckErr } = await fastify.supabase
      .from('background_jobs')
      .select('id, job_type, attempt, max_retries, started_at, tenant_id, error')
      .eq('tenant_id', (_req as any).tenantId)
      .eq('status', 'running')
      .lt('started_at', staleThreshold)
      .order('started_at', { ascending: true })
      .limit(50)

    if (stuckErr) {
      fastify.log.warn({ err: stuckErr.message }, 'jobs/durable: stuck-job query failed')
    }

    const stuck = stuckJobs ?? []

    return reply.send({
      data: {
        ...metrics,
        stuck_running_count: stuck.length,
        stuck_running_jobs: stuck.map((j: any) => ({
          id:          j.id,
          job_type:    j.job_type,
          attempt:     j.attempt,
          max_retries: j.max_retries,
          started_at:  j.started_at,
          tenant_id:   j.tenant_id,
          error:       j.error ?? null,
          // How long this job has been stuck
          stuck_for_seconds: j.started_at
            ? Math.floor((Date.now() - new Date(j.started_at).getTime()) / 1000)
            : null,
        })),
      },
    })
  })

  // ── GET /system/jobs/durable/dead ────────────────────────────────────────────
  // Recent dead jobs from background_job_results (last 100).
  fastify.get('/system/jobs/durable/dead', auth, async (req: any, reply) => {
    if (!(HR_ADMIN_ROLES as readonly string[]).includes(req.userRole)) {
      return reply.code(403).send({ error: 'FORBIDDEN', message: 'HR admin access required' })
    }

    const dead = await durableQueue.getRecentDead(fastify.supabase, 100)
    return reply.send({ data: dead, total: dead.length })
  })

  // ── POST /system/jobs/durable/dead/:id/requeue ───────────────────────────────
  // Move a specific dead background_job_results row back into background_jobs.
  fastify.post('/system/jobs/durable/dead/:id/requeue', auth, async (req: any, reply) => {
    if (!(HR_ADMIN_ROLES as readonly string[]).includes(req.userRole)) {
      return reply.code(403).send({ error: 'FORBIDDEN', message: 'HR admin access required' })
    }

    const { id } = req.params as { id: string }
    const ok = await durableQueue.requeueDead(fastify.supabase, id)
    if (!ok) {
      // Check if quarantined vs truly not found (DB-backed, async)
      const poison = await durableQueue.getPoisonJobStatus(fastify.supabase, id)
      if (poison?.is_quarantined) {
        return reply.code(409).send({
          error:         'POISON_JOB_QUARANTINED',
          message:       `Job '${id}' has been quarantined after ${poison.requeue_count} failed requeue attempts. Fix the handler, then call DELETE /system/jobs/durable/quarantine/:id to clear.`,
          requeue_count: poison.requeue_count,
        })
      }
      return reply.code(404).send({ error: 'NOT_FOUND', message: `Dead job '${id}' not found in results log` })
    }

    fastify.log.warn({ jobId: id, requeuedBy: req.userId }, 'durable dead job manually requeued')
    return reply.send({ message: `Job '${id}' requeued`, jobId: id })
  })

  // ── DELETE /system/jobs/durable/dead ─────────────────────────────────────────
  // Purge background_job_results older than ?days (default 90).
  fastify.delete('/system/jobs/durable/dead', auth, async (req: any, reply) => {
    if (!(HR_ADMIN_ROLES as readonly string[]).includes(req.userRole)) {
      return reply.code(403).send({ error: 'FORBIDDEN', message: 'HR admin access required' })
    }

    const days  = parseInt((req.query as any).days ?? '90', 10) || 90
    const count = await durableQueue.purgeOldResults(fastify.supabase, days)
    fastify.log.warn({ days, count, purgedBy: req.userId }, 'durable job results purged')
    return reply.send({ message: `Purged ${count} result(s) older than ${days} days`, purged: count })
  })

  // ── GET /system/jobs/durable/retry-storm ─────────────────────────────────────
  // Detect retry storms: job types with > 10 dead results in the last 10 minutes.
  fastify.get('/system/jobs/durable/retry-storm', auth, async (req: any, reply) => {
    if (!(HR_ADMIN_ROLES as readonly string[]).includes(req.userRole)) {
      return reply.code(403).send({ error: 'FORBIDDEN', message: 'HR admin access required' })
    }

    const reports = await durableQueue.detectRetryStorm(fastify.supabase)
    const storms  = reports.filter(r => r.is_storm)
    return reply.send({
      data:         reports,
      storm_count:  storms.length,
      has_storm:    storms.length > 0,
    })
  })

  // ── DELETE /system/jobs/durable/quarantine/:id ────────────────────────────────
  // Clear quarantine for a specific poison job after the operator has fixed the handler.
  fastify.delete('/system/jobs/durable/quarantine/:id', auth, async (req: any, reply) => {
    if (!(HR_ADMIN_ROLES as readonly string[]).includes(req.userRole)) {
      return reply.code(403).send({ error: 'FORBIDDEN', message: 'HR admin access required' })
    }

    const { id }    = req.params as { id: string }
    const { reason } = req.body as { reason?: string } ?? {}
    const cleared = await durableQueue.clearQuarantine(
      fastify.supabase,
      id,
      req.userId,
      reason,
    )
    if (!cleared) {
      return reply.code(404).send({
        error:   'NOT_FOUND',
        message: `Job '${id}' not found in quarantine (not quarantined or already cleared)`,
      })
    }
    fastify.log.warn({ jobId: id, clearedBy: req.userId, reason }, 'poison job quarantine cleared')
    return reply.send({ message: `Quarantine cleared for job '${id}' — job may be requeued again` })
  })

  // ── GET /system/jobs/durable/retry-storm/open ────────────────────────────────
  // Returns open retry storm incidents from DB (durable across restarts).
  fastify.get('/system/jobs/durable/retry-storm/open', auth, async (req: any, reply) => {
    if (!(HR_ADMIN_ROLES as readonly string[]).includes(req.userRole)) {
      return reply.code(403).send({ error: 'FORBIDDEN', message: 'HR admin access required' })
    }
    const incidents = await durableQueue.getOpenStormIncidents(fastify.supabase)
    return reply.send({ data: incidents, total: incidents.length })
  })

  // ── POST /system/jobs/durable/retry-storm/:id/acknowledge ────────────────────
  // Mark a storm incident as acknowledged — operator confirms they are investigating.
  fastify.post('/system/jobs/durable/retry-storm/:id/acknowledge', auth, async (req: any, reply) => {
    if (!(HR_ADMIN_ROLES as readonly string[]).includes(req.userRole)) {
      return reply.code(403).send({ error: 'FORBIDDEN', message: 'HR admin access required' })
    }
    const { id } = req.params as { id: string }
    const ok = await durableQueue.acknowledgeStorm(fastify.supabase, id, req.userId)
    if (!ok) {
      return reply.code(404).send({ error: 'NOT_FOUND', message: `Storm incident '${id}' not found or not open` })
    }
    fastify.log.warn({ incidentId: id, acknowledgedBy: req.userId }, 'retry storm incident acknowledged')
    return reply.send({ message: `Storm incident '${id}' acknowledged` })
  })

  // ── GET /system/jobs/durable/quarantine ──────────────────────────────────────
  // Returns all currently quarantined job records from DB.
  fastify.get('/system/jobs/durable/quarantine', auth, async (req: any, reply) => {
    if (!(HR_ADMIN_ROLES as readonly string[]).includes(req.userRole)) {
      return reply.code(403).send({ error: 'FORBIDDEN', message: 'HR admin access required' })
    }
    const jobs = await durableQueue.getQuarantinedJobs(fastify.supabase)
    return reply.send({ data: jobs, total: jobs.length })
  })

  // ── GET /system/module-health ─────────────────────────────────────────────────
  // Returns durable module health state from DB (replaces in-memory platformHealth.modules).
  fastify.get('/system/module-health', auth, async (req: any, reply) => {
    if (!(HR_ADMIN_ROLES as readonly string[]).includes(req.userRole)) {
      return reply.code(403).send({ error: 'FORBIDDEN', message: 'HR admin access required' })
    }

    const { data: modules, error } = await fastify.supabase
      .from('module_health')
      .select('module_name, status, instance_id, started_at, last_updated_at, error_message, error_count, metadata')
      .order('module_name')

    if (error) {
      return reply.code(500).send({ error: 'DB_ERROR', message: error.message })
    }

    const rows = modules ?? []
    const failed   = rows.filter((m: any) => m.status === 'failed').length
    const degraded = rows.filter((m: any) => m.status === 'degraded').length
    const healthy  = rows.filter((m: any) => m.status === 'healthy').length

    return reply.send({
      data:    rows,
      total:   rows.length,
      summary: { healthy, degraded, failed },
      overall: failed > 0 ? 'failed' : degraded > 0 ? 'degraded' : 'healthy',
    })
  })

  // ═══════════════════════════════════════════════════════════════════════════════
  // Scheduler health endpoint
  // ═══════════════════════════════════════════════════════════════════════════════

  // ── GET /system/scheduler-health ─────────────────────────────────────────────
  // Returns all scheduler_heartbeats rows so operators can verify liveness.
  // A heartbeat older than 2× the scheduler's tick interval is stale/crashed.
  fastify.get('/system/scheduler-health', auth, async (req: any, reply) => {
    if (!(HR_ADMIN_ROLES as readonly string[]).includes(req.userRole)) {
      return reply.code(403).send({ error: 'FORBIDDEN', message: 'HR admin access required' })
    }

    const { data: heartbeats, error } = await fastify.supabase
      .from('scheduler_heartbeats')
      .select('scheduler_name, tenant_id, last_heartbeat_at, status, tick_count, last_error, metadata, created_at')
      .eq('tenant_id', req.tenantId)
      .order('last_heartbeat_at', { ascending: false })

    if (error) {
      // Table may not exist yet (migration pending) — return empty rather than crashing the dashboard
      const isMissing = error.message?.includes('does not exist') || (error as any).code === 'PGRST116'
      if (isMissing) {
        fastify.log.warn({ error }, 'scheduler_heartbeats table missing — run migration 182')
        return reply.send({ data: [], total: 0, stale_count: 0, healthy: true })
      }
      fastify.log.error({ error }, 'scheduler-health: failed to query heartbeats')
      return reply.code(500).send({ error: 'DB_ERROR', message: error.message })
    }

    const now = Date.now()
    const rows = (heartbeats ?? []).map((h: any) => {
      const ageMs = h.last_heartbeat_at
        ? now - new Date(h.last_heartbeat_at).getTime()
        : null
      return {
        ...h,
        age_seconds: ageMs != null ? Math.floor(ageMs / 1000) : null,
        // Flag as stale if no heartbeat within 2 hours (2× the 1h tick interval)
        is_stale: ageMs != null ? ageMs > 2 * 60 * 60 * 1_000 : true,
      }
    })

    const staleCount = rows.filter((r: any) => r.is_stale).length
    return reply.send({
      data:        rows,
      total:       rows.length,
      stale_count: staleCount,
      healthy:     staleCount === 0,
    })
  })
}
