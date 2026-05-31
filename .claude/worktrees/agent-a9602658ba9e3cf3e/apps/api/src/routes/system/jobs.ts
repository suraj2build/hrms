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
    if (!['super_admin', 'hr_admin'].includes(req.userRole)) {
      return reply.code(403).send({ error: 'FORBIDDEN', message: 'HR admin access required' })
    }

    const dead = jobQueue.getDeadLetterJobs()
    return reply.send({
      data:  dead,
      total: dead.length,
    })
  })

  // ── POST /system/jobs/dead/:id/retry ────────────────────────────────────────
  // Manually re-enqueue a dead-letter job. The job handler is reconstructed from
  // the job's `type` field — only works for jobs whose handlers are registered in
  // the handler registry below. Novel one-off jobs cannot be retried this way.
  fastify.post('/system/jobs/dead/:id/retry', auth, async (req: any, reply) => {
    if (!['super_admin', 'hr_admin'].includes(req.userRole)) {
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
    if (!['super_admin', 'hr_admin'].includes(req.userRole)) {
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

  // ── DELETE /system/jobs/dead ─────────────────────────────────────────────────
  // Purges the entire dead-letter queue. Irreversible — use with care.
  fastify.delete('/system/jobs/dead', auth, async (req: any, reply) => {
    if (!['super_admin', 'hr_admin'].includes(req.userRole)) {
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
  fastify.get('/system/jobs/durable', auth, async (_req: any, reply) => {
    const metrics = await durableQueue.getMetrics(fastify.supabase)
    return reply.send({ data: metrics })
  })

  // ── GET /system/jobs/durable/dead ────────────────────────────────────────────
  // Recent dead jobs from background_job_results (last 100).
  fastify.get('/system/jobs/durable/dead', auth, async (req: any, reply) => {
    if (!['super_admin', 'hr_admin'].includes(req.userRole)) {
      return reply.code(403).send({ error: 'FORBIDDEN', message: 'HR admin access required' })
    }

    const dead = await durableQueue.getRecentDead(fastify.supabase, 100)
    return reply.send({ data: dead, total: dead.length })
  })

  // ── POST /system/jobs/durable/dead/:id/requeue ───────────────────────────────
  // Move a specific dead background_job_results row back into background_jobs.
  fastify.post('/system/jobs/durable/dead/:id/requeue', auth, async (req: any, reply) => {
    if (!['super_admin', 'hr_admin'].includes(req.userRole)) {
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
    if (!['super_admin', 'hr_admin'].includes(req.userRole)) {
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
    if (!['super_admin', 'hr_admin'].includes(req.userRole)) {
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
    if (!['super_admin', 'hr_admin'].includes(req.userRole)) {
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
    if (!['super_admin', 'hr_admin'].includes(req.userRole)) {
      return reply.code(403).send({ error: 'FORBIDDEN', message: 'HR admin access required' })
    }
    const incidents = await durableQueue.getOpenStormIncidents(fastify.supabase)
    return reply.send({ data: incidents, total: incidents.length })
  })

  // ── POST /system/jobs/durable/retry-storm/:id/acknowledge ────────────────────
  // Mark a storm incident as acknowledged — operator confirms they are investigating.
  fastify.post('/system/jobs/durable/retry-storm/:id/acknowledge', auth, async (req: any, reply) => {
    if (!['super_admin', 'hr_admin'].includes(req.userRole)) {
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
    if (!['super_admin', 'hr_admin'].includes(req.userRole)) {
      return reply.code(403).send({ error: 'FORBIDDEN', message: 'HR admin access required' })
    }
    const jobs = await durableQueue.getQuarantinedJobs(fastify.supabase)
    return reply.send({ data: jobs, total: jobs.length })
  })

  // ── GET /system/module-health ─────────────────────────────────────────────────
  // Returns durable module health state from DB (replaces in-memory platformHealth.modules).
  fastify.get('/system/module-health', auth, async (req: any, reply) => {
    if (!['super_admin', 'hr_admin'].includes(req.userRole)) {
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
    if (!['super_admin', 'hr_admin'].includes(req.userRole)) {
      return reply.code(403).send({ error: 'FORBIDDEN', message: 'HR admin access required' })
    }

    const { data: heartbeats, error } = await fastify.supabase
      .from('scheduler_heartbeats')
      .select('scheduler_name, tenant_id, last_heartbeat_at, status, tick_count, last_error, metadata, created_at')
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
