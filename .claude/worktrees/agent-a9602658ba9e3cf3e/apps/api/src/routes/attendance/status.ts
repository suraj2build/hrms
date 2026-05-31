/**
 * GET /attendance/process/status
 *
 * Returns the current processing lock state for the caller's tenant.
 * Protected — requires authenticated user.
 *
 * Response:
 *   { is_running: boolean, started_at: string | null, started_by: string | null }
 *
 * UI uses this to disable the "Process Attendance" button and show a
 * "Processing…" badge while a job is active.
 */
import type { FastifyInstance } from 'fastify'

export default async function statusRoute(fastify: FastifyInstance) {
  fastify.get(
    '/attendance/process/status',
    { preHandler: [fastify.authenticate] },
    async (req, reply) => {
      const { data, error } = await fastify.supabase
        .from('attendance_processing_lock')
        .select('is_running, started_at, started_by, lock_ttl_seconds')
        .eq('tenant_id', req.tenantId)
        .maybeSingle()

      if (error) {
        req.log.error({ err: error, module: 'attendance', route: 'status' }, 'status query failed')
        return reply.code(500).send({ error: 'QUERY_FAILED', message: 'Could not fetch processing status' })
      }

      // No lock row yet (tenant has never processed) → not running
      return reply.send({
        is_running:       data?.is_running       ?? false,
        started_at:       data?.started_at       ?? null,
        started_by:       data?.started_by       ?? null,
        lock_ttl_seconds: data?.lock_ttl_seconds ?? 900,
      })
    },
  )
}
