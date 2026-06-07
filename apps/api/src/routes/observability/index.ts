import type { FastifyInstance } from 'fastify'
import { EventStreamService }        from '../../platform/observability/event-stream/event-stream.service.js'
import { eventTraceService }         from '../../platform/observability/trace/event-trace.service.js'
import { observabilityIntelligenceService } from '../../platform/observability/intelligence/observability-intelligence.service.js'
import type { ResolvedPlatformEvent }        from '../../platform/events/types/platform-event.js'

export default async function observabilityRoutes(fastify: FastifyInstance) {
  /**
   * GET /observability/trace/:correlationId
   * Fetch and build a structured event trace for a correlation chain.
   */
  fastify.get('/observability/trace/:correlationId', { preHandler: [fastify.authenticate] }, async (req, reply) => {
    // Always scope to the authenticated tenant — never trust a client-supplied org_id.
    const orgId: string = (req as any).tenantId
    const { correlationId } = req.params as { correlationId: string }

    const svc    = new EventStreamService((fastify as any).supabase)
    const chain  = await svc.getCorrelationChain(orgId, correlationId)
    const trace  = eventTraceService.buildTrace(correlationId, chain.events)

    return reply.send(trace)
  })

  /**
   * POST /observability/summary
   * Aggregate events into an operational summary.
   * Accepts body.events directly OR fetches via org_id + from + to query params.
   */
  fastify.post('/observability/summary', { preHandler: [fastify.authenticate] }, async (req, reply) => {
    // Always scope to the authenticated tenant — never trust a client-supplied org_id.
    const orgId: string = (req as any).tenantId
    const body          = req.body as {
      events?: ResolvedPlatformEvent[]
      period?: string
    } | undefined
    const period        = body?.period ?? 'last_24h'

    let events: ResolvedPlatformEvent[]

    if (Array.isArray(body?.events) && body.events.length > 0) {
      events = body.events
    } else {
      const from = (req.query as any).from as string | undefined
      const to   = (req.query as any).to   as string | undefined

      const svc  = new EventStreamService((fastify as any).supabase)
      const page = await svc.query({ org_id: orgId, from, to, limit: 200 })
      events     = page.events
    }

    const summary = eventTraceService.summarize(orgId, events, period)
    return reply.send(summary)
  })

  /**
   * POST /observability/heatmap
   * Build a heatmap of event activity by UTC hour + event_type.
   * Accepts body.events directly OR auto-fetches last 24h.
   */
  fastify.post('/observability/heatmap', { preHandler: [fastify.authenticate] }, async (req, reply) => {
    // Always scope to the authenticated tenant — never trust a client-supplied org_id.
    const orgId: string = (req as any).tenantId
    const body          = req.body as { events?: ResolvedPlatformEvent[] } | undefined

    let events: ResolvedPlatformEvent[]

    if (Array.isArray(body?.events) && body.events.length > 0) {
      events = body.events
    } else {
      const from = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()
      const svc  = new EventStreamService((fastify as any).supabase)
      const page = await svc.query({ org_id: orgId, from, limit: 500 })
      events     = page.events
    }

    const cells = eventTraceService.buildHeatmap(events)
    return reply.send({ cells, total_events: events.length })
  })

  /**
   * GET /observability/clusters
   * Returns event clusters from the observability intelligence service.
   */
  fastify.get('/observability/clusters', { preHandler: [fastify.authenticate] }, async (req, reply) => {
    // Always scope to the authenticated tenant — never trust a client-supplied org_id.
    const orgId: string = (req as any).tenantId

    const clusters = observabilityIntelligenceService.getClusters(orgId)
    return reply.send({ clusters })
  })
}
