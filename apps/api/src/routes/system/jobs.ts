/**
 * Job Queue Visibility API
 *
 * Exposes the durable Postgres-backed queue state to operators. Scheduler
 * heartbeat health is surfaced through the combined observability endpoint.
 *
 * (The legacy in-process JobQueue this file used to also expose was removed —
 * nothing ever enqueued into it once the codebase migrated to the durable
 * queue below, so its endpoints/KPIs always reported empty/zero.)
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
import { durableQueue }         from '../../lib/durable-queue.js'
import { eventBus }             from '../../lib/event-bus.js'
import { platformHealth }       from '../../lib/startup-health.js'
import { serverError, ErrorCode } from '../../lib/api-errors.js'
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

  // ── GET /system/jobs/automations ───────────────────────────────────────────
  // Returns the static automation registry. last_run_at/last_status/next_run_at
  // aren't tracked anywhere yet (the legacy in-memory job queue that used to
  // supply a best-effort last_status was removed — nothing ever enqueued into
  // it, so it always reported null/empty; extend with a real DB-backed run-log
  // if this needs populating).
  fastify.get('/system/jobs/automations', auth, async (req: any, reply) => {
    if (!(HR_ADMIN_ROLES as readonly string[]).includes(req.userRole)) {
      return reply.code(403).send({ error: 'FORBIDDEN', message: 'HR admin access required' })
    }

    const jobs = AUTOMATION_REGISTRY.map(job => ({
      id:          job.id,
      name:        job.name,
      description: job.description,
      schedule:    job.schedule,
      owner:       job.owner,
      is_enabled:  job.is_enabled,
      last_run_at: null,
      last_status: null,
      next_run_at: null,
    }))

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

    // A double-click or network retry of "Trigger now" would otherwise enqueue
    // the automation twice (e.g. double-crediting leave accrual for the month).
    // durableQueue.enqueue() already no-ops when a pending/running job shares
    // an idempotencyKey — pass the client's key through if it sent one.
    const iKey = (req.headers['idempotency-key'] as string | undefined)?.trim()

    try {
      const enqueuedId = await durableQueue.enqueue(
        automation.job_type,
        { triggered_by: req.userId, manual_trigger: true },
        { tenantId: req.tenantId, createdBy: req.userId, idempotencyKey: iKey || undefined },
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
      return serverError(req, reply, err, ErrorCode.COMPUTE_FAILED, 'Failed to trigger automation')
    }
  })

  // ── GET /system/observability ────────────────────────────────────────────────
  // Combined observability dashboard — event bus + platform health. The
  // job_queue section that used to appear here (backed by the legacy
  // in-memory JobQueue) was removed — nothing ever enqueued into that queue,
  // so it always reported pending/running/completed/dead_letter as 0, a
  // structurally-guaranteed false "all clear" next to the real durable-queue
  // metrics shown elsewhere on this same dashboard (GET /metrics, GET
  // /system/jobs/durable). For hr_admin / super_admin only.
  fastify.get('/system/observability', auth, async (req: any, reply) => {
    if (!(HR_ADMIN_ROLES as readonly string[]).includes(req.userRole)) {
      return reply.code(403).send({ error: 'FORBIDDEN', message: 'HR admin access required' })
    }

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
      durableQueue.getMetrics(fastify.supabase, req.tenantId),
      // Cross-tenant leak fix: background_jobs/webhook_deliveries are tenant-scoped
      // tables (webhook_deliveries.tenant_id is NOT NULL per migration 091) — without
      // .eq('tenant_id', ...) a tenant-scoped hr_admin saw platform-wide counts across
      // every tenant. Mirrors the tenant scoping already applied to the sibling
      // GET /system/jobs/durable endpoint's background_jobs query in this same file.
      fastify.supabase
        .from('background_jobs')
        .select('id', { count: 'exact', head: true })
        .eq('tenant_id', req.tenantId)
        .eq('status', 'running')
        .lt('started_at', staleThreshold),
      fastify.supabase
        .from('background_jobs')
        .select('id', { count: 'exact', head: true })
        .eq('tenant_id', req.tenantId)
        .eq('status', 'pending')
        .gt('attempt', 0),
      fastify.supabase
        .from('webhook_deliveries')
        .select('id', { count: 'exact', head: true })
        .eq('tenant_id', req.tenantId)
        .gte('created_at', since24h),
      fastify.supabase
        .from('webhook_deliveries')
        .select('id', { count: 'exact', head: true })
        .eq('tenant_id', req.tenantId)
        .eq('status', 'failed')
        .gte('created_at', since24h),
      fastify.supabase
        .from('webhook_deliveries')
        .select('id', { count: 'exact', head: true })
        .eq('tenant_id', req.tenantId)
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

  // ═══════════════════════════════════════════════════════════════════════════════
  // Durable queue endpoints (Postgres-backed)
  // ═══════════════════════════════════════════════════════════════════════════════

  // ── GET /system/jobs/durable ──────────────────────────────────────────────────
  // Live counts queried directly from background_jobs.
  // Includes stuck_running_count: jobs that have been in 'running' state longer
  // than the stale threshold (5 min) — indicates crashed workers or hung handlers.
  fastify.get('/system/jobs/durable', auth, async (req: any, reply) => {
    if (!(HR_ADMIN_ROLES as readonly string[]).includes(req.userRole)) {
      return reply.code(403).send({ error: 'FORBIDDEN', message: 'HR admin access required' })
    }

    const metrics = await durableQueue.getMetrics(fastify.supabase, req.tenantId)

    // Detect jobs stuck in 'running' longer than the stale recovery threshold (5 min).
    // These are jobs that a crashed worker held but were not yet recovered by
    // _recoverStaleJobs() (e.g., the queue is not currently started, or a new crash
    // happened after recovery). Surfacing them here lets operators act immediately.
    const STALE_THRESHOLD_MS = 5 * 60 * 1_000
    const staleThreshold = new Date(Date.now() - STALE_THRESHOLD_MS).toISOString()

    const { data: stuckJobs, error: stuckErr } = await fastify.supabase
      .from('background_jobs')
      .select('id, job_type, attempt, max_retries, started_at, tenant_id, error')
      .eq('tenant_id', (req as any).tenantId)
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

    const dead = await durableQueue.getRecentDead(fastify.supabase, req.tenantId, 100)
    return reply.send({ data: dead, total: dead.length })
  })

  // ── POST /system/jobs/durable/dead/:id/requeue ───────────────────────────────
  // Move a specific dead background_job_results row back into background_jobs.
  fastify.post('/system/jobs/durable/dead/:id/requeue', auth, async (req: any, reply) => {
    if (!(HR_ADMIN_ROLES as readonly string[]).includes(req.userRole)) {
      return reply.code(403).send({ error: 'FORBIDDEN', message: 'HR admin access required' })
    }

    const { id } = req.params as { id: string }
    const ok = await durableQueue.requeueDead(fastify.supabase, req.tenantId, id)
    if (!ok) {
      // Check if quarantined vs truly not found (DB-backed, async)
      const poison = await durableQueue.getPoisonJobStatus(fastify.supabase, req.tenantId, id)
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
    const count = await durableQueue.purgeOldResults(fastify.supabase, req.tenantId, days)
    fastify.log.warn({ days, count, purgedBy: req.userId }, 'durable job results purged')
    return reply.send({ message: `Purged ${count} result(s) older than ${days} days`, purged: count })
  })

  // ── GET /system/jobs/durable/retry-storm ─────────────────────────────────────
  // Detect retry storms: job types with > 10 dead results in the last 10 minutes.
  fastify.get('/system/jobs/durable/retry-storm', auth, async (req: any, reply) => {
    if (!(HR_ADMIN_ROLES as readonly string[]).includes(req.userRole)) {
      return reply.code(403).send({ error: 'FORBIDDEN', message: 'HR admin access required' })
    }

    const reports = await durableQueue.detectRetryStorm(fastify.supabase, req.tenantId)
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
      req.tenantId,
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
    const incidents = await durableQueue.getOpenStormIncidents(fastify.supabase, req.tenantId)
    return reply.send({ data: incidents, total: incidents.length })
  })

  // ── POST /system/jobs/durable/retry-storm/:id/acknowledge ────────────────────
  // Mark a storm incident as acknowledged — operator confirms they are investigating.
  fastify.post('/system/jobs/durable/retry-storm/:id/acknowledge', auth, async (req: any, reply) => {
    if (!(HR_ADMIN_ROLES as readonly string[]).includes(req.userRole)) {
      return reply.code(403).send({ error: 'FORBIDDEN', message: 'HR admin access required' })
    }
    const { id } = req.params as { id: string }
    const ok = await durableQueue.acknowledgeStorm(fastify.supabase, req.tenantId, id, req.userId)
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
    const jobs = await durableQueue.getQuarantinedJobs(fastify.supabase, req.tenantId)
    return reply.send({ data: jobs, total: jobs.length })
  })

  // ── GET /system/module-health ─────────────────────────────────────────────────
  // Returns durable module health state from DB (replaces in-memory platformHealth.modules).
  // Fresh-audit F4: module_health is platform-wide (no tenant_id column — its own
  // RLS policy, migration 197, restricts it to super_admin), but this route was
  // gated on HR_ADMIN_ROLES (super_admin OR hr_admin), letting any tenant's
  // hr_admin read every tenant's platform-level infra health. Tightened to match
  // the table's own documented access level.
  fastify.get('/system/module-health', auth, async (req: any, reply) => {
    if (req.userRole !== 'super_admin') {
      return reply.code(403).send({ error: 'FORBIDDEN', message: 'Platform admin access required' })
    }

    const { data: modules, error } = await fastify.supabase
      .from('module_health')
      .select('module_name, status, instance_id, started_at, last_updated_at, error_message, error_count, metadata')
      .order('module_name')

    if (error) return serverError(req, reply, error, ErrorCode.QUERY_FAILED, 'Failed to fetch module health')

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
      return serverError(req, reply, error, ErrorCode.QUERY_FAILED, 'Failed to fetch scheduler health')
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
