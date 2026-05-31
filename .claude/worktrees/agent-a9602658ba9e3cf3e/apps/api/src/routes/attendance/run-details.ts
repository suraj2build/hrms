/**
 * GET /attendance/process/runs         — list recent processing runs (max 50)
 * GET /attendance/process/runs/:runId  — single run detail with skipped_codes
 *
 * Both are tenant-scoped and require authentication (any role).
 *
 * Path uses /runs/ prefix to avoid shadowing:
 *   - POST /attendance/process
 *   - GET  /attendance/process/status
 *   - GET  /attendance/process/last
 *
 * List response:  { data: RunSummary[] }
 * Detail response: { run: RunDetail }
 */
import type { FastifyInstance } from 'fastify'
import { z }                   from 'zod'

export default async function runDetailsRoute(fastify: FastifyInstance) {
  const auth = { preHandler: [fastify.authenticate] }

  // ── GET /attendance/process/runs — list (registered first to avoid shadowing) ──
  fastify.get('/attendance/process/runs', auth, async (req, reply) => {
    const querySchema = z.object({
      limit: z.coerce.number().int().min(1).max(50).default(10),
    })
    const parsed = querySchema.safeParse(req.query)
    if (!parsed.success) {
      return reply.code(400).send({ error: 'VALIDATION_ERROR', message: parsed.error.issues[0]?.message })
    }
    const { limit } = parsed.data

    const { data, error } = await fastify.supabase
      .from('attendance_processing_runs')
      .select(
        'id, date, processed_count, skipped_count, incomplete_count, ' +
        'duration_ms, started_at, completed_at, error_message',
      )
      .eq('tenant_id', req.tenantId)
      .order('started_at', { ascending: false })
      .limit(limit)

    if (error) {
      req.log.error({ err: error, module: 'attendance', route: 'runs-list' }, 'query failed')
      return reply.code(500).send({ error: 'QUERY_FAILED', message: 'Could not fetch processing runs' })
    }

    // Derive `status` from columns (no explicit status column in schema)
    const rows = ((data ?? []) as any[]).map((r) => ({
      ...r,
      status: r.error_message
        ? 'failed'
        : r.completed_at
          ? 'success'
          : 'running',
    }))

    return reply.send({ data: rows })
  })

  // ── GET /attendance/process/runs/:runId — single run detail ──────────────────
  fastify.get(
    '/attendance/process/runs/:runId',
    auth,
    async (req, reply) => {
      const { runId } = req.params as { runId: string }

      const { data, error } = await fastify.supabase
        .from('attendance_processing_runs')
        .select(
          'id, date, processed_count, skipped_count, skipped_codes, ' +
          'incomplete_count, raw_logs_marked, logs_created, daily_upserted, ' +
          'duration_ms, started_at, completed_at, error_message, triggered_by',
        )
        .eq('tenant_id', req.tenantId)
        .eq('id', runId)
        .maybeSingle()

      if (error) {
        req.log.error({ err: error, module: 'attendance', route: 'run-details', run_id: runId }, 'query failed')
        return reply.code(500).send({ error: 'QUERY_FAILED', message: 'Could not fetch run details' })
      }

      if (!data) {
        return reply.code(404).send({ error: 'NOT_FOUND', message: 'Run not found' })
      }

      return reply.send({ run: data })
    },
  )
}
