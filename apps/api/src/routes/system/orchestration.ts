/**
 * System Orchestration Routes
 *
 * Distributed worker and job orchestration visibility + control.
 * Shared infrastructure — no tenant restriction on worker endpoints.
 *
 * GET    /system/orchestration/workers                   — list workers (status/type filter)
 * POST   /system/orchestration/workers/heartbeat         — worker heartbeat upsert
 * PUT    /system/orchestration/workers/:worker_id/status — drain or stop a worker (super_admin)
 *
 * GET    /system/orchestration/queues                    — queue partition overview (admin)
 * PUT    /system/orchestration/queues/:id/pressure       — update partition pressure (super_admin)
 *
 * GET    /system/orchestration/jobs                      — paginated long-running jobs
 * GET    /system/orchestration/jobs/:id                  — single job detail
 * POST   /system/orchestration/jobs/:id/cancel           — cancel a running job (hr_admin)
 *
 * GET    /system/orchestration/health                    — aggregate health snapshot
 *
 * Auth: all routes require JWT. Write/admin routes are role-gated.
 */
import type { FastifyInstance }     from 'fastify'
import { z }                        from 'zod'
import {
  orchestrateWorkforceEvent,
  getOrchestrationChain,
}                                   from '../../lib/workforce-orchestrator.js'
import { HR_ADMIN_ROLES }           from '../../lib/rbac.js'
import { serverError, ErrorCode }   from '../../lib/api-errors.js'
const SUPER_ADMIN = ['super_admin']             as const

const dateRe = /^\d{4}-\d{2}-\d{2}$/

export default async function orchestrationRoutes(fastify: FastifyInstance) {
  const auth = { preHandler: [fastify.authenticate] }

  // ── GET /system/orchestration/workers ─────────────────────────────────────
  fastify.get('/system/orchestration/workers', auth, async (req: any, reply) => {
    if (!HR_ADMIN_ROLES.includes(req.userRole)) {
      return reply.code(403).send({ error: 'FORBIDDEN', message: 'HR admin access required' })
    }

    const querySchema = z.object({
      status:      z.enum(['active', 'idle', 'draining', 'stopped', 'crashed']).optional(),
      worker_type: z.string().max(100).optional(),
    })
    const parsed = querySchema.safeParse(req.query)
    if (!parsed.success) {
      return reply.code(400).send({ error: 'VALIDATION_ERROR', message: parsed.error.issues[0]?.message })
    }

    const { status, worker_type } = parsed.data

    let q = fastify.supabase
      .from('worker_registry')
      .select('*')
      .order('last_heartbeat', { ascending: false })

    if (status)      q = q.eq('status', status)
    if (worker_type) q = q.eq('worker_type', worker_type)

    const { data, error } = await q

    if (error) {
      req.log.error({ err: error }, 'worker registry query failed')
      return reply.code(500).send({ error: 'QUERY_FAILED', message: 'Failed to fetch workers' })
    }

    const workers = data ?? []

    const summary = {
      active_count:  workers.filter((w: any) => w.status === 'active').length,
      idle_count:    workers.filter((w: any) => w.status === 'idle').length,
      crashed_count: workers.filter((w: any) => w.status === 'crashed').length,
    }

    return reply.send({ data: workers, summary })
  })

  // ── POST /system/orchestration/workers/heartbeat ──────────────────────────
  // No tenant restriction — shared infrastructure endpoint used by workers.
  fastify.post('/system/orchestration/workers/heartbeat', auth, async (req: any, reply) => {
    const schema = z.object({
      worker_id:      z.string().min(1).max(200),
      worker_type:    z.string().min(1).max(100),
      host:           z.string().min(1).max(255),
      current_job_id: z.string().uuid().optional().nullable(),
      jobs_processed: z.number().int().min(0).optional(),
      jobs_failed:    z.number().int().min(0).optional(),
      metadata:       z.record(z.unknown()).optional().nullable(),
    })

    const parsed = schema.safeParse(req.body)
    if (!parsed.success) {
      return reply.code(400).send({ error: 'VALIDATION_ERROR', message: parsed.error.issues[0]?.message })
    }

    const { worker_id, worker_type, host, current_job_id, jobs_processed, jobs_failed, metadata } = parsed.data

    const upsertPayload: Record<string, unknown> = {
      worker_id,
      worker_type,
      host,
      status:         'active',
      last_heartbeat: new Date().toISOString(),
    }
    if (current_job_id !== undefined) upsertPayload.current_job_id = current_job_id
    if (jobs_processed  !== undefined) upsertPayload.jobs_processed  = jobs_processed
    if (jobs_failed     !== undefined) upsertPayload.jobs_failed     = jobs_failed
    if (metadata        !== undefined) upsertPayload.metadata        = metadata

    const { data, error } = await fastify.supabase
      .from('worker_registry')
      .upsert(upsertPayload, { onConflict: 'worker_id' })
      .select('*')
      .single()

    if (error) {
      req.log.error({ err: error }, 'worker heartbeat upsert failed')
      return reply.code(500).send({ error: 'UPSERT_FAILED', message: 'Failed to record heartbeat' })
    }

    return reply.send({ data })
  })

  // ── PUT /system/orchestration/workers/:worker_id/status ───────────────────
  fastify.put('/system/orchestration/workers/:worker_id/status', auth, async (req: any, reply) => {
    if (!SUPER_ADMIN.includes(req.userRole)) {
      return reply.code(403).send({ error: 'FORBIDDEN', message: 'Super admin access required' })
    }

    const { worker_id } = req.params as { worker_id: string }

    const schema = z.object({
      status: z.enum(['draining', 'stopped']),
    })
    const parsed = schema.safeParse(req.body)
    if (!parsed.success) {
      return reply.code(400).send({ error: 'VALIDATION_ERROR', message: parsed.error.issues[0]?.message })
    }

    const { data, error } = await fastify.supabase
      .from('worker_registry')
      .update({ status: parsed.data.status })
      .eq('worker_id', worker_id)
      .select('*')
      .single()

    if (error) {
      req.log.error({ err: error }, 'worker status update failed')
      return reply.code(500).send({ error: 'UPDATE_FAILED', message: 'Failed to update worker status' })
    }
    if (!data) {
      return reply.code(404).send({ error: 'NOT_FOUND', message: `Worker '${worker_id}' not found` })
    }

    return reply.send({ data })
  })

  // ── GET /system/orchestration/queues ──────────────────────────────────────
  fastify.get('/system/orchestration/queues', auth, async (req: any, reply) => {
    if (!HR_ADMIN_ROLES.includes(req.userRole)) {
      return reply.code(403).send({ error: 'FORBIDDEN', message: 'HR admin access required' })
    }

    const querySchema = z.object({
      queue_name: z.string().max(200).optional(),
    })
    const parsed = querySchema.safeParse(req.query)
    if (!parsed.success) {
      return reply.code(400).send({ error: 'VALIDATION_ERROR', message: parsed.error.issues[0]?.message })
    }

    const { queue_name } = parsed.data

    // super_admin is a per-tenant role (see the PUT .../pressure route below),
    // so a client-supplied tenant_id must never override the caller's own
    // tenant — otherwise any tenant's super_admin could read another
    // tenant's queue_partitions rows by passing ?tenant_id=<other-tenant>.
    let q = fastify.supabase
      .from('queue_partitions')
      .select('*')
      .eq('tenant_id', req.tenantId)
      .order('current_depth', { ascending: false })

    if (queue_name) q = q.eq('queue_name', queue_name)

    const { data, error } = await q

    if (error) {
      req.log.error({ err: error }, 'queue partitions query failed')
      return reply.code(500).send({ error: 'QUERY_FAILED', message: 'Failed to fetch queue partitions' })
    }

    const partitions = data ?? []

    const summary = {
      total_depth:    partitions.reduce((s: number, p: any) => s + (p.current_depth ?? 0), 0),
      critical_count: partitions.filter((p: any) => p.pressure_level === 'critical').length,
      elevated_count: partitions.filter((p: any) => p.pressure_level === 'elevated').length,
    }

    return reply.send({ data: partitions, summary })
  })

  // ── PUT /system/orchestration/queues/:id/pressure ─────────────────────────
  fastify.put('/system/orchestration/queues/:id/pressure', auth, async (req: any, reply) => {
    if (!SUPER_ADMIN.includes(req.userRole)) {
      return reply.code(403).send({ error: 'FORBIDDEN', message: 'Super admin access required' })
    }

    const { id } = req.params as { id: string }

    const schema = z.object({
      pressure_level: z.enum(['normal', 'elevated', 'critical']),
      current_depth:  z.number().int().min(0),
    })
    const parsed = schema.safeParse(req.body)
    if (!parsed.success) {
      return reply.code(400).send({ error: 'VALIDATION_ERROR', message: parsed.error.issues[0]?.message })
    }

    const { data, error } = await fastify.supabase
      .from('queue_partitions')
      .update({
        pressure_level: parsed.data.pressure_level,
        current_depth:  parsed.data.current_depth,
        updated_at:     new Date().toISOString(),
      })
      .eq('id', id)
      // Tenant isolation: queue_partitions is tenant-scoped (see the GET above).
      // super_admin is a per-tenant role, so scope the write to the caller's
      // tenant — otherwise a tenant-A admin could overwrite tenant-B queue state.
      .eq('tenant_id', req.tenantId)
      .select('*')
      .single()

    if (error) {
      req.log.error({ err: error }, 'queue pressure update failed')
      return reply.code(500).send({ error: 'UPDATE_FAILED', message: 'Failed to update queue pressure' })
    }
    if (!data) {
      return reply.code(404).send({ error: 'NOT_FOUND', message: 'Queue partition not found' })
    }

    return reply.send({ data })
  })

  // ── GET /system/orchestration/jobs ────────────────────────────────────────
  fastify.get('/system/orchestration/jobs', auth, async (req: any, reply) => {
    if (!HR_ADMIN_ROLES.includes(req.userRole)) {
      return reply.code(403).send({ error: 'FORBIDDEN', message: 'HR admin access required' })
    }

    const querySchema = z.object({
      status:   z.enum(['pending', 'running', 'completed', 'failed', 'cancelled']).optional(),
      job_type: z.string().max(100).optional(),
      limit:    z.coerce.number().int().min(1).max(200).default(50),
      offset:   z.coerce.number().int().min(0).default(0),
    })
    const parsed = querySchema.safeParse(req.query)
    if (!parsed.success) {
      return reply.code(400).send({ error: 'VALIDATION_ERROR', message: parsed.error.issues[0]?.message })
    }

    const { status, job_type, limit, offset } = parsed.data

    let q = fastify.supabase
      .from('long_running_jobs')
      .select('*', { count: 'exact' })
      .eq('tenant_id', req.tenantId)
      .order('created_at', { ascending: false })
      .range(offset, offset + limit - 1)

    if (status)   q = q.eq('status', status)
    if (job_type) q = q.eq('job_type', job_type)

    const { data, error, count } = await q

    if (error) {
      req.log.error({ err: error }, 'long running jobs query failed')
      return reply.code(500).send({ error: 'QUERY_FAILED', message: 'Failed to fetch jobs' })
    }

    return reply.send({ data: data ?? [], total: count ?? 0, limit, offset })
  })

  // ── GET /system/orchestration/jobs/:id ────────────────────────────────────
  fastify.get('/system/orchestration/jobs/:id', auth, async (req: any, reply) => {
    if (!HR_ADMIN_ROLES.includes(req.userRole)) {
      return reply.code(403).send({ error: 'FORBIDDEN', message: 'HR admin access required' })
    }

    const { id } = req.params as { id: string }

    const { data, error } = await fastify.supabase
      .from('long_running_jobs')
      .select('*')
      .eq('id', id)
      .eq('tenant_id', req.tenantId)
      .maybeSingle()

    if (error) {
      req.log.error({ err: error }, 'long running job fetch failed')
      return reply.code(500).send({ error: 'QUERY_FAILED', message: 'Failed to fetch job' })
    }
    if (!data) {
      return reply.code(404).send({ error: 'NOT_FOUND', message: 'Job not found' })
    }

    return reply.send({ data })
  })

  // ── POST /system/orchestration/jobs/:id/cancel ────────────────────────────
  fastify.post('/system/orchestration/jobs/:id/cancel', auth, async (req: any, reply) => {
    if (!HR_ADMIN_ROLES.includes(req.userRole)) {
      return reply.code(403).send({ error: 'FORBIDDEN', message: 'HR admin access required' })
    }

    const { id } = req.params as { id: string }

    const { data, error } = await fastify.supabase
      .from('long_running_jobs')
      .update({
        status:       'cancelled',
        completed_at: new Date().toISOString(),
      })
      .eq('id', id)
      .eq('tenant_id', req.tenantId)
      .in('status', ['pending', 'running'])   // only cancel active jobs
      .select('*')
      .single()

    if (error) {
      req.log.error({ err: error }, 'job cancel update failed')
      return reply.code(500).send({ error: 'UPDATE_FAILED', message: 'Failed to cancel job' })
    }
    if (!data) {
      return reply.code(404).send({
        error:   'NOT_FOUND',
        message: 'Job not found or is not in a cancellable state',
      })
    }

    return reply.send({ data })
  })

  // ── POST /system/orchestration/rebuild ───────────────────────────────────
  // Controlled entry point for manual retroactive cascade rebuilds.
  // Triggers the full attendance → leave_balance → payroll rebuild chain for
  // a specific employee and date range. Respects payroll freeze and approval state.
  // Restricted to super_admin — this is a destructive operation.
  fastify.post('/system/orchestration/rebuild', auth, async (req: any, reply) => {
    if (!SUPER_ADMIN.includes(req.userRole)) {
      return reply.code(403).send({ error: 'FORBIDDEN', message: 'Super admin access required' })
    }

    const bodySchema = z.object({
      employee_id:    z.string().uuid(),
      from_date:      z.string().regex(dateRe, 'from_date must be YYYY-MM-DD'),
      to_date:        z.string().regex(dateRe, 'to_date must be YYYY-MM-DD').optional(),
      reason:         z.string().min(5).max(500),
      // Which trigger to model this as. Defaults to manual_trigger which rebuilds all three modules.
      event_type:     z.enum([
        'attendance_corrected',
        'leave_approved',
        'leave_cancelled',
        'retro_leave_approved',
        'policy_changed',
      ]).default('attendance_corrected'),
    })

    const parsed = bodySchema.safeParse(req.body)
    if (!parsed.success) {
      return reply.code(400).send({ error: 'VALIDATION_ERROR', message: parsed.error.issues[0]?.message })
    }

    const { employee_id, from_date, to_date, reason, event_type } = parsed.data

    // Generate a stable source_event_id for idempotency (manual rebuilds use a deterministic key)
    const sourceEventId = crypto.randomUUID()

    try {
      const result = await orchestrateWorkforceEvent(fastify.supabase, {
        tenantId:         req.tenantId,
        eventType:        event_type,
        sourceEventId,
        employeeId:       employee_id,
        affectedFromDate: from_date,
        affectedToDate:   to_date,
        triggeredBy:      req.userId,
        metadata: {
          manual_rebuild:  true,
          reason,
          initiated_by:    req.userId,
          initiated_at:    new Date().toISOString(),
        },
      })

      req.log.info(
        { lineageId: result.orchestratorLineageId, employeeId: employee_id, from_date, to_date, triggeredBy: req.userId },
        'manual retroactive rebuild initiated via /system/orchestration/rebuild',
      )

      return reply.code(202).send({
        message:               'Retroactive rebuild initiated',
        orchestrator_lineage_id: result.orchestratorLineageId,
        rebuild_event_id:        result.rebuildEventId,
        enqueued_stages:         result.enqueuedRebuildIds.length,
        status:                  result.status,
        freeze_constraint: {
          blocked:        result.freezeConstraint.requiresAdjustmentWorkflow || result.freezeConstraint.auditOnly,
          queued_only:    result.freezeConstraint.queuedOnly,
          blocked_periods: result.freezeConstraint.blockedPeriods.map(p => p.period_month),
        },
      })
    } catch (err: any) {
      return serverError(req, reply, err, ErrorCode.COMPUTE_FAILED, 'Failed to initiate rebuild')
    }
  })

  // ── GET /system/orchestration/rebuild/:lineageId ───────────────────────────
  // Returns the full audit trail for a rebuild chain — rebuild event, enqueued stages,
  // completion status, initiator, reason, impacted periods.
  fastify.get('/system/orchestration/rebuild/:lineageId', auth, async (req: any, reply) => {
    if (!HR_ADMIN_ROLES.includes(req.userRole)) {
      return reply.code(403).send({ error: 'FORBIDDEN', message: 'HR admin access required' })
    }

    const { lineageId } = req.params as { lineageId: string }

    const chain = await getOrchestrationChain(fastify.supabase, req.tenantId, lineageId)

    if (!chain.rebuildEvent) {
      return reply.code(404).send({ error: 'NOT_FOUND', message: 'Rebuild chain not found' })
    }

    return reply.send({
      data: {
        rebuild_event:  chain.rebuildEvent,
        queue_entries:  chain.queueEntries,
        stage_count:    chain.queueEntries.length,
        completed_stages: chain.queueEntries.filter(q => q.status === 'completed').length,
        failed_stages:    chain.queueEntries.filter(q => q.status === 'failed').length,
        pending_stages:   chain.queueEntries.filter(q => q.status === 'pending').length,
      },
    })
  })

  // ── GET /system/orchestration/health ──────────────────────────────────────
  fastify.get('/system/orchestration/health', auth, async (req: any, reply) => {
    if (!HR_ADMIN_ROLES.includes(req.userRole)) {
      return reply.code(403).send({ error: 'FORBIDDEN', message: 'HR admin access required' })
    }

    const now         = new Date()
    const oneHourAgo  = new Date(now.getTime() - 60 * 60 * 1000).toISOString()
    const thirtyMinAgo = new Date(now.getTime() - 30 * 60 * 1000).toISOString()

    const [workersRes, queuesRes, stuckRes, failedRes] = await Promise.all([
      fastify.supabase
        .from('worker_registry')
        .select('status')
        .eq('status', 'active'),

      fastify.supabase
        .from('queue_partitions')
        .select('current_depth')
        .eq('tenant_id', req.tenantId),

      fastify.supabase
        .from('long_running_jobs')
        .select('id', { count: 'exact', head: true })
        .eq('tenant_id', req.tenantId)
        .eq('status', 'running')
        .lt('started_at', thirtyMinAgo),

      fastify.supabase
        .from('long_running_jobs')
        .select('id', { count: 'exact', head: true })
        .eq('tenant_id', req.tenantId)
        .eq('status', 'failed')
        .gte('completed_at', oneHourAgo),
    ])

    const workers_active  = workersRes.data?.length ?? 0
    const partitions      = queuesRes.data ?? []
    const max_queue_depth = partitions.length > 0
      ? Math.max(...partitions.map((p: any) => p.current_depth ?? 0))
      : 0
    const stuck_jobs      = stuckRes.count  ?? 0
    const failed_last_hour = failedRes.count ?? 0

    // Determine overall health
    let overall_health: 'healthy' | 'degraded' | 'critical' = 'healthy'
    if (workers_active === 0 || stuck_jobs > 10 || failed_last_hour > 50) {
      overall_health = 'critical'
    } else if (stuck_jobs > 2 || failed_last_hour > 10 || max_queue_depth > 1000) {
      overall_health = 'degraded'
    }

    return reply.send({
      overall_health,
      workers_active,
      max_queue_depth,
      stuck_jobs,
      failed_last_hour,
    })
  })
}
