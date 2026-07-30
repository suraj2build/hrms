import type { FastifyInstance } from 'fastify'
import { EventStreamService }        from '../../platform/observability/event-stream/event-stream.service.js'
import { eventTraceService }         from '../../platform/observability/trace/event-trace.service.js'
import { observabilityIntelligenceService } from '../../platform/observability/intelligence/observability-intelligence.service.js'
import type { ResolvedPlatformEvent }        from '../../platform/events/types/platform-event.js'
import { requireRole, HR_ADMIN_ROLES }       from '../../lib/rbac.js'

export default async function observabilityRoutes(fastify: FastifyInstance) {
  // Every route here exposes tenant-wide event traces/clusters (compensation
  // revisions, payroll finalizations, trust-score updates, etc.) with no
  // per-employee ownership scoping. The only frontend caller is
  // EnterpriseControlCenter.tsx under the admin-only /admin/* shell, so the
  // API must enforce the same restriction rather than relying on the UI gate.
  const adminAuth = { preHandler: [fastify.authenticate, requireRole(...HR_ADMIN_ROLES)] }

  /**
   * GET /observability/trace/:correlationId
   * Fetch and build a structured event trace for a correlation chain.
   */
  fastify.get('/observability/trace/:correlationId', adminAuth, async (req, reply) => {
    // Always scope to the authenticated tenant — never trust a client-supplied tenant_id.
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
   * Accepts body.events directly OR fetches via tenant_id + from + to query params.
   */
  fastify.post('/observability/summary', adminAuth, async (req, reply) => {
    // Always scope to the authenticated tenant — never trust a client-supplied tenant_id.
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
      // Fresh audit finding: unlike the sibling /observability/heatmap
      // handler below (which defaults `from` to 24h ago), this endpoint let
      // an unsupplied `from` fall through to EventStreamService.query()'s
      // no-op filter — returning the most recent 200 events across ALL time,
      // still labeled `period: "last_24h"` in the response.
      const from = ((req.query as any).from as string | undefined)
        ?? new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()
      const to   = (req.query as any).to as string | undefined

      // Fresh audit finding: this previously called .query({..., limit: 200}),
      // silently capping the summary's total/by_module/by_severity breakdown
      // at 200 events with no truncation signal — a tenant generating more
      // than 200 events in the window (very plausible: attendance, approvals,
      // compensation revisions, payroll runs) got a wrong operational summary.
      // queryAll() fully paginates instead.
      const svc  = new EventStreamService((fastify as any).supabase)
      events     = await svc.queryAll({ tenant_id: orgId, from, to })
    }

    const summary = eventTraceService.summarize(orgId, events, period)
    return reply.send(summary)
  })

  /**
   * POST /observability/heatmap
   * Build a heatmap of event activity by UTC hour + event_type.
   * Accepts body.events directly OR auto-fetches last 24h.
   */
  fastify.post('/observability/heatmap', adminAuth, async (req, reply) => {
    // Always scope to the authenticated tenant — never trust a client-supplied tenant_id.
    const orgId: string = (req as any).tenantId
    const body          = req.body as { events?: ResolvedPlatformEvent[] } | undefined

    let events: ResolvedPlatformEvent[]
    let totalEvents: number

    if (Array.isArray(body?.events) && body.events.length > 0) {
      events     = body.events
      totalEvents = events.length
    } else {
      // Fresh audit finding: total_events was the real count (from
      // .query()'s count:'exact'), but `cells` was still built only from the
      // 500-row-capped sample — once a tenant exceeds 500 events/day the
      // heatmap became internally inconsistent (total_events said e.g. 1,400
      // but cell counts only ever summed to 500), with no truncation signal.
      // queryAll() fully paginates so cells and total_events agree.
      const from = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()
      const svc  = new EventStreamService((fastify as any).supabase)
      events      = await svc.queryAll({ tenant_id: orgId, from })
      totalEvents = events.length
    }

    const cells = eventTraceService.buildHeatmap(events)
    return reply.send({ cells, total_events: totalEvents })
  })

  /**
   * GET /observability/clusters
   * Returns event clusters from the observability intelligence service.
   */
  fastify.get('/observability/clusters', adminAuth, async (req, reply) => {
    // Always scope to the authenticated tenant — never trust a client-supplied tenant_id.
    const orgId: string = (req as any).tenantId

    const clusters = observabilityIntelligenceService.getClusters(orgId)
    return reply.send({ clusters })
  })
}
