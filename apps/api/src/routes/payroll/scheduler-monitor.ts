/**
 * Scheduler Monitoring Routes
 *
 * Read-only visibility into scheduled job execution history.
 * Jobs are logged to scheduler_job_log by individual job handlers.
 *
 * GET  /payroll/scheduler/jobs           — paginated job log
 * GET  /payroll/scheduler/status         — last run per job_type (summary)
 * POST /payroll/scheduler/retry/:jobId   — mark a failed job for retry (creates new log entry)
 */

import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { logJobStart } from '../../lib/notify.js'
import { HR_ADMIN_ROLES } from '../../lib/rbac.js'
import { serverError, ErrorCode } from '../../lib/api-errors.js'
import { fetchAllRows } from '../../lib/supabase-paginate.js'

export default async function schedulerMonitorRoutes(fastify: FastifyInstance) {
  const adminAuth = { preHandler: [fastify.authenticate, (req: any, reply: any, done: () => void) => {
    if (!(HR_ADMIN_ROLES as readonly string[]).includes(req.userRole)) {
      reply.code(403).send({ error: 'FORBIDDEN', message: 'HR admin access required' })
      return
    }
    done()
  }] }

  // ── GET /payroll/scheduler/jobs ───────────────────────────────────────────────
  // Paginated log of scheduler job executions.
  fastify.get('/jobs', adminAuth, async (req: any, reply) => {
    const querySchema = z.object({
      status:   z.enum(['started','completed','failed','timeout','cancelled']).optional(),
      job_type: z.string().optional(),
      from:     z.string().optional(),   // ISO date — filter started_at >=
      to:       z.string().optional(),   // ISO date — filter started_at <=
      limit:    z.coerce.number().int().min(1).max(200).default(50),
      offset:   z.coerce.number().int().min(0).default(0),
    })

    const parsed = querySchema.safeParse(req.query)
    if (!parsed.success) {
      return reply.code(400).send({ error: 'VALIDATION_ERROR', message: parsed.error.issues[0]?.message })
    }

    const { status, job_type, from, to, limit, offset } = parsed.data
    const tenantId = req.tenantId as string

    let q = fastify.supabase
      .from('scheduler_job_log')
      .select('*', { count: 'exact' })
      .eq('tenant_id', tenantId)
      .order('started_at', { ascending: false })
      .range(offset, offset + limit - 1)

    if (status)   q = q.eq('status', status)
    if (job_type) q = q.eq('job_type', job_type)
    if (from)     q = q.gte('started_at', from)
    if (to)       q = q.lte('started_at', to)

    const { data, error, count } = await q
    if (error) return serverError(req, reply, error, ErrorCode.QUERY_FAILED, 'Failed to fetch scheduler job log')

    return reply.send({ data: data ?? [], total: count ?? 0, limit, offset })
  })

  // ── GET /payroll/scheduler/status ─────────────────────────────────────────────
  // One row per job_type: last run time, status, duration, error message.
  // Lightweight status board for the monitoring UI.
  fastify.get('/status', adminAuth, async (req: any, reply) => {
    const tenantId = req.tenantId as string

    // Fetch recent job log entries (last 30 days) and aggregate in-process.
    // Paginated — a tenant running several frequent scheduled jobs can exceed
    // 1000 rows in a 30-day window, which would silently undercount
    // success/failure/last_30d_runs per job_type past the PostgREST cap.
    let jobs: any[]
    try {
      jobs = await fetchAllRows((from, to) =>
        fastify.supabase
          .from('scheduler_job_log')
          .select('id, job_type, job_name, status, started_at, completed_at, duration_ms, error_message, affected_count, trigger_type')
          .eq('tenant_id', tenantId)
          .gte('started_at', new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString())
          .order('started_at', { ascending: false })
          .range(from, to),
      )
    } catch (error) {
      return serverError(req, reply, error, ErrorCode.QUERY_FAILED, 'Failed to fetch scheduler status')
    }

    // Group by job_type, keep last run per type
    const byType: Record<string, {
      job_type:        string
      last_run_at:     string
      last_status:     string
      last_duration_ms: number | null
      last_error:      string | null
      last_affected:   number | null
      trigger_type:    string | null
      success_count:   number
      failure_count:   number
      last_30d_runs:   number
    }> = {}

    for (const j of (jobs ?? []) as any[]) {
      if (!byType[j.job_type]) {
        byType[j.job_type] = {
          job_type:         j.job_type,
          last_run_at:      j.started_at,
          last_status:      j.status,
          last_duration_ms: j.duration_ms ?? null,
          last_error:       j.error_message ?? null,
          last_affected:    j.affected_count ?? null,
          trigger_type:     j.trigger_type ?? null,
          success_count:    0,
          failure_count:    0,
          last_30d_runs:    0,
        }
      }
      byType[j.job_type].last_30d_runs++
      if (j.status === 'completed') byType[j.job_type].success_count++
      if (j.status === 'failed' || j.status === 'timeout') byType[j.job_type].failure_count++
    }

    const summary = Object.values(byType).sort((a, b) =>
      b.last_run_at.localeCompare(a.last_run_at),
    )

    // Overall health
    const hasFailures = summary.some(s => s.last_status === 'failed' || s.last_status === 'timeout')
    const health = hasFailures ? 'degraded' : 'healthy'

    return reply.send({
      generated_at: new Date().toISOString(),
      health,
      job_types:    summary,
      total_types:  summary.length,
    })
  })

  // ── GET /payroll/scheduler/jobs/:jobId ────────────────────────────────────────
  fastify.get('/jobs/:jobId', adminAuth, async (req: any, reply) => {
    const { jobId } = req.params as { jobId: string }

    const { data, error } = await fastify.supabase
      .from('scheduler_job_log')
      .select('*')
      .eq('id', jobId)
      .eq('tenant_id', req.tenantId)
      .single()

    if (error || !data) return reply.code(404).send({ error: 'NOT_FOUND' })
    return reply.send({ data })
  })

  // ── POST /payroll/scheduler/retry/:jobId ─────────────────────────────────────
  // Creates a NEW scheduler_job_log entry as a retry of the given failed job.
  // Does NOT actually re-execute the job (that is handled by the job runner);
  // this marks the intent and returns the new job log id for the UI to track.
  fastify.post('/retry/:jobId', adminAuth, async (req: any, reply) => {
    const { jobId } = req.params as { jobId: string }

    // Fetch original job
    const { data: original, error: fetchErr } = await fastify.supabase
      .from('scheduler_job_log')
      .select('id, job_type, job_name, status, retry_count, meta')
      .eq('id', jobId)
      .eq('tenant_id', req.tenantId)
      .single()

    if (fetchErr || !original) return reply.code(404).send({ error: 'NOT_FOUND' })

    const orig = original as any

    if (!['failed', 'timeout', 'cancelled'].includes(orig.status)) {
      return reply.code(409).send({
        error: 'INVALID_STATUS',
        message: `Only failed/timeout/cancelled jobs can be retried. Current status: ${orig.status}`,
      })
    }

    // Claim the retry atomically: fold the same status precondition into the
    // UPDATE's WHERE clause (matching imports/index.ts's retry route) so two
    // concurrent retry calls can't both pass the read-time check above and
    // both create a duplicate retry log entry / race on retry_count.
    const { data: claimed, error: claimErr } = await fastify.supabase
      .from('scheduler_job_log')
      .update({ retry_count: (orig.retry_count ?? 0) + 1 })
      .eq('id', jobId)
      .eq('tenant_id', req.tenantId)
      .in('status', ['failed', 'timeout', 'cancelled'])
      .select('id')
      .maybeSingle()

    if (claimErr) return serverError(req, reply, claimErr, ErrorCode.UPDATE_FAILED, 'Failed to claim job for retry')
    if (!claimed) {
      return reply.code(409).send({
        error: 'INVALID_STATUS',
        message: 'Job was already retried or its status changed concurrently',
      })
    }

    // Create a new log entry for the retry
    const newJobId = await logJobStart(fastify.supabase, {
      tenantId:     req.tenantId,
      job_type:     orig.job_type,
      job_name:     orig.job_name ?? undefined,
      trigger_type: 'retry',
      triggered_by: req.userId,
      meta:         {
        ...(orig.meta ?? {}),
        retry_of:    jobId,
        retry_count: (orig.retry_count ?? 0) + 1,
      },
    })

    if (!newJobId) {
      return reply.code(500).send({ error: 'RETRY_FAILED', message: 'Failed to create retry job log entry' })
    }

    return reply.code(201).send({
      retried:    true,
      original_id: jobId,
      new_job_id:  newJobId,
      job_type:    orig.job_type,
    })
  })
}
