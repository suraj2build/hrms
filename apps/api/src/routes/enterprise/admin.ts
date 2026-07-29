import type { FastifyInstance } from 'fastify'
import { slaService }            from '../../platform/operations/sla/sla.service.js'
import type { SlaBreachEvent }   from '../../platform/operations/types/operations-types.js'
import { governanceEvaluator }   from '../../platform/governance/evaluators/event-evaluator.js'
import { requireRole, HR_ADMIN_ROLES } from '../../lib/rbac.js'
import { serverError, ErrorCode } from '../../lib/api-errors.js'

export default async function adminRoutes(fastify: FastifyInstance) {

  // scanBreaches() returns newly-detected breaches across ALL tenants (it has
  // no tenant filter), so this must persist the full unfiltered result — not
  // just the calling tenant's slice — or another tenant's breach would be
  // detected-and-discarded here and never appear in GET /operations/sla/breaches,
  // which reads from this table and previously had nothing to ever read
  // (scanBreaches() only ever appended to its own in-memory array).
  async function persistBreaches(breaches: SlaBreachEvent[]): Promise<void> {
    if (breaches.length === 0) return
    const { error } = await fastify.supabase.from('sla_breach_events').insert(
      breaches.map(b => ({
        tenant_id:       b.tenant_id,
        sla_id:          b.sla_id,
        entity_id:       b.entity_id,
        entity_type:     b.entity_type,
        breach_severity: b.breach_severity,
        description:     b.description,
        explainability:  b.explainability,
        breached_at:     b.breached_at,
      })),
    )
    if (error) {
      fastify.log.error({ err: error }, '[adminRoutes] failed to persist SLA breach events')
      // scanBreaches() already flipped these to breached=true in-memory before
      // persistence was attempted — without reverting that flag, the
      // `!status.breached` guard in scanBreaches() would never re-detect (and
      // thus never re-attempt persisting) this breach again, permanently
      // losing it from sla_breach_events on a single transient DB failure.
      slaService.unmarkBreached(breaches)
    }
  }

  // GET /enterprise/queue
  // scanBreaches()/getTracked() operate on a process-global, cross-tenant
  // in-memory store (fresh audit finding) — getTracked(orgId) already
  // supports tenant filtering, but scanBreaches() must scan every tracked
  // entry across all tenants to detect newly-overdue ones (breach status is
  // computed by elapsed time, not queryable per tenant), so the returned
  // breach list is filtered to this tenant AFTER the scan rather than
  // during it. Also added the same HR-admin gate the sibling mutation
  // routes below already have — this endpoint returns entity ids/severity
  // for payroll/compliance/incident SLAs, not general-employee data.
  fastify.get('/queue', { preHandler: [fastify.authenticate, requireRole(...HR_ADMIN_ROLES)] }, async (req: any, reply) => {
    try {
      const allNewBreaches = slaService.scanBreaches()
      await persistBreaches(allNewBreaches)
      const sla_breaches   = allNewBreaches.filter(b => b.tenant_id === req.tenantId)
      const pending_sla    = slaService.getTracked(req.tenantId)
      const listener_health = governanceEvaluator.listenerHealth(req.tenantId)

      return reply.send({
        sla_breaches,
        pending_sla_count: pending_sla.length,
        listener_health,
        computed_at: new Date().toISOString(),
      })
    } catch (err: unknown) {
      return serverError(req, reply, err, ErrorCode.QUERY_FAILED, 'Failed to fetch operations queue')
    }
  })

  // POST /enterprise/sla/scan
  fastify.post('/sla/scan', { preHandler: [fastify.authenticate, requireRole(...HR_ADMIN_ROLES)] }, async (req: any, reply) => {
    try {
      const allNewBreaches = slaService.scanBreaches()
      await persistBreaches(allNewBreaches)
      const breaches = allNewBreaches.filter(b => b.tenant_id === req.tenantId)
      return reply.send({
        breaches,
        count:      breaches.length,
        scanned_at: new Date().toISOString(),
      })
    } catch (err: unknown) {
      return serverError(req, reply, err, ErrorCode.COMPUTE_FAILED, 'Failed to scan SLA breaches')
    }
  })

  // GET /enterprise/health
  fastify.get('/health', { preHandler: [fastify.authenticate] }, async (req: any, reply) => {
    try {
      const listeners     = governanceEvaluator.listenerHealth(req.tenantId)
      const listenerCount = listeners.length
      const tracked       = slaService.getTracked(req.tenantId)

      const checks = {
        event_publisher: { status: 'ok' as const },
        governance_evaluator: { status: 'ok' as const, listener_count: listenerCount },
        sla_service:          { status: 'ok' as const, active_slas: tracked.length },
        signal_suppressor:    { status: 'ok' as const },
      }

      const hasIssue = Object.values(checks).some(
        (c) => (c as { status: string }).status !== 'ok',
      )
      const overallStatus: 'healthy' | 'degraded' | 'critical' = hasIssue ? 'degraded' : 'healthy'

      return reply.send({
        status:     overallStatus,
        checks,
        checked_at: new Date().toISOString(),
      })
    } catch (err: unknown) {
      return serverError(req, reply, err, ErrorCode.COMPUTE_FAILED, 'Failed to compute health status')
    }
  })

  // POST /enterprise/listeners/:name/reset
  fastify.post('/listeners/:name/reset', { preHandler: [fastify.authenticate, requireRole(...HR_ADMIN_ROLES)] }, async (req: any, reply) => {
    try {
      const { name } = req.params as { name: string }
      governanceEvaluator.resetListener(req.tenantId, name)
      return reply.send({ reset: true, listener: name })
    } catch (err: unknown) {
      return serverError(req, reply, err, ErrorCode.UPDATE_FAILED, 'Failed to reset listener')
    }
  })
}
