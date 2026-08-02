/**
 * GET /attendance/process/status
 *
 * Returns the current processing lock state for the caller's tenant.
 * Protected — requires HR admin access, matching attendance_processing_lock's
 * hr_lock_rw RLS policy (the table has no non-admin read grant, unlike the
 * sibling attendance_processing_runs table).
 *
 * Response:
 *   { is_running: boolean, started_at: string | null, started_by: string | null }
 *
 * UI uses this to disable the "Process Attendance" button and show a
 * "Processing…" badge while a job is active.
 */
import type { FastifyInstance } from 'fastify'
import { HR_ADMIN_ROLES } from '../../lib/rbac.js'
import { serverError, ErrorCode } from '../../lib/api-errors.js'

export default async function statusRoute(fastify: FastifyInstance) {
  fastify.get(
    '/attendance/process/status',
    { preHandler: [fastify.authenticate] },
    async (req: any, reply) => {
      if (!(HR_ADMIN_ROLES as readonly string[]).includes(req.userRole)) {
        return reply.code(403).send({ error: 'FORBIDDEN', message: 'HR admin access required' })
      }

      const { data, error } = await fastify.supabase
        .from('attendance_processing_lock')
        .select('is_running, started_at, started_by, lock_ttl_seconds')
        .eq('tenant_id', req.tenantId)
        .maybeSingle()

      if (error) {
        return serverError(req, reply, error, ErrorCode.QUERY_FAILED, 'Could not fetch processing status')
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
