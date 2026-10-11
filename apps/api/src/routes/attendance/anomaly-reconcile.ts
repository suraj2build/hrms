/**
 * POST /attendance/anomalies/reconcile
 *
 * Manual, on-demand run of the same reconciliation pass that now also runs
 * automatically once a day for every active/trial tenant (see
 * 'reconcile-anomalies' in index.ts) — kept for ops debugging and for HR to
 * trigger an out-of-band pass without waiting for the next scheduled run.
 * Core logic lives in lib/anomaly-reconciler.ts so the scheduled job and
 * this button can't drift.
 *
 * Body (optional): { from_date, to_date, dry_run }. Defaults to the last
 * 90 days, applied.
 *
 * Protected — hr_admin / super_admin only.
 */
import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { requireRole, HR_ADMIN_ROLES } from '../../lib/rbac.js'
import { serverError, ErrorCode } from '../../lib/api-errors.js'
import { reconcileAnomaliesForTenant } from '../../lib/anomaly-reconciler.js'

const bodySchema = z.object({
  from_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  to_date:   z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  dry_run:   z.boolean().optional().default(false),
})

export default async function anomalyReconcileRoute(fastify: FastifyInstance) {
  const auth = { preHandler: [fastify.authenticate, requireRole(...HR_ADMIN_ROLES)] }

  fastify.post('/attendance/anomalies/reconcile', auth, async (req: any, reply) => {
    const parsed = bodySchema.safeParse(req.body ?? {})
    if (!parsed.success) {
      return reply.code(400).send({ error: 'VALIDATION_ERROR', message: parsed.error.issues[0]?.message })
    }

    req.log.info({ event: 'anomaly_reconcile_start', ...parsed.data }, 'anomaly reconciliation pass started (manual)')

    let result
    try {
      result = await reconcileAnomaliesForTenant(fastify.supabase, req.tenantId, {
        fromDate: parsed.data.from_date, toDate: parsed.data.to_date,
        resolvedBy: req.userId, dryRun: parsed.data.dry_run,
      }, req.log)
    } catch (err) {
      return serverError(req, reply, err, ErrorCode.QUERY_FAILED, 'Failed to reconcile anomalies')
    }

    req.log.info({
      event: 'anomaly_reconcile_complete', ...result, dry_run: parsed.data.dry_run,
    }, 'anomaly reconciliation pass complete (manual)')

    return reply.send({ ...result, dry_run: parsed.data.dry_run })
  })
}
