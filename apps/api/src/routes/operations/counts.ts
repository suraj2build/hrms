/**
 * GET /operational/counts
 *
 * Live badge counts for the operational header — polled every 60s by the web app.
 * Each count is computed independently and degrades to 0 if its table is missing
 * or the query fails (so a single bad table never 500s the whole endpoint).
 */
import type { FastifyInstance } from 'fastify'

async function safeCount(
  fastify: any,
  table: string,
  tenantId: string,
  filters: (q: any) => any,
): Promise<number> {
  try {
    let q = fastify.supabase.from(table).select('id', { count: 'exact', head: true }).eq('tenant_id', tenantId)
    q = filters(q)
    const { count, error } = await q
    if (error) {
      fastify.log.warn({ event: 'operational_counts.query_failed', table, err: error.message })
      return 0
    }
    return count ?? 0
  } catch (err: any) {
    fastify.log.warn({ event: 'operational_counts.exception', table, err: err?.message })
    return 0
  }
}

export default async function operationalCountsRoutes(fastify: FastifyInstance) {
  const auth = { preHandler: [fastify.authenticate] }

  fastify.get('/operational/counts', auth, async (req: any, reply) => {
    const tenantId: string = req.tenantId

    const [leaveCount, regCount, unresolved_anomalies, payroll_blockers, missing_punches] = await Promise.all([
      safeCount(fastify, 'leave_requests',            tenantId, q => q.eq('status', 'PENDING')),
      safeCount(fastify, 'attendance_regularisation', tenantId, q => q.eq('status', 'pending')),
      safeCount(fastify, 'attendance_anomalies',      tenantId, q => q.eq('resolved', false)),
      safeCount(fastify, 'payroll_run_blockers',      tenantId, q => q.eq('resolved', false)),
      safeCount(fastify, 'attendance_corrections',    tenantId, q => q.eq('status', 'pending')),
    ])
    const pending_approvals = leaveCount + regCount

    return reply.send({
      data: {
        pending_approvals,
        unresolved_anomalies,
        payroll_blockers,
        missing_punches,
      },
    })
  })
}
