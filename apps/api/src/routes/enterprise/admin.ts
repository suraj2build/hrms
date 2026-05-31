import type { FastifyInstance } from 'fastify'
import { slaService }            from '../../platform/operations/sla/sla.service.js'
import { governanceEvaluator }   from '../../platform/governance/evaluators/event-evaluator.js'

export default async function adminRoutes(fastify: FastifyInstance) {

  // GET /enterprise/queue
  fastify.get('/queue', async (_req, reply) => {
    try {
      const sla_breaches   = slaService.scanBreaches()
      const pending_sla    = slaService.getTracked()
      const listener_health = governanceEvaluator.listenerHealth()

      return reply.send({
        sla_breaches,
        pending_sla_count: pending_sla.length,
        listener_health,
        computed_at: new Date().toISOString(),
      })
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err)
      return reply.status(500).send({ error: message })
    }
  })

  // POST /enterprise/sla/scan
  fastify.post('/sla/scan', async (_req, reply) => {
    try {
      const breaches = slaService.scanBreaches()
      return reply.send({
        breaches,
        count:      breaches.length,
        scanned_at: new Date().toISOString(),
      })
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err)
      return reply.status(500).send({ error: message })
    }
  })

  // GET /enterprise/health
  fastify.get('/health', async (_req, reply) => {
    try {
      const listeners     = governanceEvaluator.listenerHealth()
      const listenerCount = listeners.length
      const tracked       = slaService.getTracked()

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
      const message = err instanceof Error ? err.message : String(err)
      return reply.status(500).send({ error: message })
    }
  })

  // POST /enterprise/listeners/:name/reset
  fastify.post('/listeners/:name/reset', async (req, reply) => {
    try {
      const { name } = req.params as { name: string }
      governanceEvaluator.resetListener(name)
      return reply.send({ reset: true, listener: name })
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err)
      return reply.status(500).send({ error: message })
    }
  })
}
