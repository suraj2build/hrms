/**
 * GET /attendance/process/last
 *
 * Returns the most recent attendance_processing_runs row for the caller's tenant.
 * Protected — requires authenticated user (read-only, no role restriction).
 *
 * Response shape:
 *   { run: LastRun | null }
 *
 * null when the tenant has never triggered a processing run.
 */
import type { FastifyInstance } from 'fastify'

export default async function lastRunRoute(fastify: FastifyInstance) {
  fastify.get(
    '/attendance/process/last',
    { preHandler: [fastify.authenticate] },
    async (req, reply) => {
      const { data, error } = await fastify.supabase
        .from('attendance_processing_runs')
        .select(
          'id, date, processed_count, skipped_count, incomplete_count, ' +
          'raw_logs_marked, logs_created, daily_upserted, ' +
          'duration_ms, started_at, completed_at, error_message',
        )
        .eq('tenant_id', req.tenantId)
        .order('started_at', { ascending: false })
        .limit(1)
        .maybeSingle()

      if (error) {
        req.log.error({ err: error, module: 'attendance', route: 'last-run' }, 'query failed')
        return reply.code(500).send({ error: 'QUERY_FAILED', message: 'Could not fetch last run' })
      }

      // Derive `status` (no explicit column in schema)
      const runRaw = data as any
      const run = runRaw
        ? {
            ...runRaw,
            status: runRaw.error_message
              ? 'failed'
              : runRaw.completed_at
                ? 'success'
                : 'running',
          }
        : null

      return reply.send({ run })
    },
  )
}
