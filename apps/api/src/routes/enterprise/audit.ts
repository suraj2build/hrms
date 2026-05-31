import type { FastifyInstance } from 'fastify'

export default async function auditRoutes(fastify: FastifyInstance) {

  // GET /enterprise/audit/export
  fastify.get('/audit/export', async (req, reply) => {
    try {
      const query = req.query as Record<string, string | undefined>
      const org_id = (req as any).user?.org_id as string | undefined

      const limit   = Math.min(Number(query.limit ?? 200), 1000)
      const format  = query.format === 'csv' ? 'csv' : 'json'
      const from    = query.from
      const to      = query.to
      const module_  = query.module
      const severity = query.severity
      const event_type  = query.event_type
      const entity_type = query.entity_type

      let qb = fastify.supabase
        .from('platform_events')
        .select('event_id,event_type,module,entity_type,entity_id,actor_id,severity,timestamp,correlation_id')
        .order('timestamp', { ascending: false })
        .limit(limit)

      if (org_id)      qb = qb.eq('org_id', org_id)
      if (from)        qb = qb.gte('timestamp', from)
      if (to)          qb = qb.lte('timestamp', to)
      if (module_)     qb = qb.eq('module', module_)
      if (severity)    qb = qb.eq('severity', severity)
      if (event_type)  qb = qb.eq('event_type', event_type)
      if (entity_type) qb = qb.eq('entity_type', entity_type)

      const { data, error } = await qb

      if (error) {
        if (format === 'csv') {
          reply.header('Content-Type', 'text/csv')
          reply.header('Content-Disposition', 'attachment; filename="audit-export.csv"')
          return reply.send('event_id,event_type,module,entity_type,entity_id,actor_id,severity,timestamp,correlation_id\n')
        }
        return reply.send({ events: [], total: 0, error: error.message })
      }

      const events = data ?? []

      if (format === 'csv') {
        const headers = 'event_id,event_type,module,entity_type,entity_id,actor_id,severity,timestamp,correlation_id'
        const rows = events.map((e: Record<string, unknown>) => {
          const cols = [
            e.event_id       ?? '',
            e.event_type     ?? '',
            e.module         ?? '',
            e.entity_type    ?? '',
            e.entity_id      ?? '',
            e.actor_id       ?? '',
            e.severity       ?? '',
            e.timestamp      ?? '',
            e.correlation_id ?? '',
          ]
          return cols.map(v => `"${String(v).replace(/"/g, '""')}"`).join(',')
        })
        reply.header('Content-Type', 'text/csv')
        reply.header('Content-Disposition', 'attachment; filename="audit-export.csv"')
        return reply.send([headers, ...rows].join('\n'))
      }

      return reply.send({ events, total: events.length, exported_at: new Date().toISOString() })
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err)
      return reply.send({ events: [], total: 0, error: message })
    }
  })

  // GET /enterprise/audit/stats
  fastify.get('/audit/stats', async (req, reply) => {
    try {
      const query  = req.query as Record<string, string | undefined>
      const org_id = (req as any).user?.org_id as string | undefined

      const to   = query.to   ?? new Date().toISOString()
      const from = query.from ?? new Date(Date.now() - 30 * 24 * 3_600_000).toISOString()

      let qb = fastify.supabase
        .from('platform_events')
        .select('event_id,event_type,module,actor_id,severity')
        .gte('timestamp', from)
        .lte('timestamp', to)
        .limit(2000)

      if (org_id) qb = qb.eq('org_id', org_id)

      const { data, error } = await qb

      if (error) {
        return reply.send({
          total: 0,
          by_severity: { info: 0, warning: 0, high: 0, critical: 0 },
          by_module: {},
          by_event_type: {},
          top_actors: [],
          computed_at: new Date().toISOString(),
          error: error.message,
        })
      }

      const events = data ?? []

      const by_severity: Record<string, number> = { info: 0, warning: 0, high: 0, critical: 0 }
      const by_module:     Record<string, number> = {}
      const by_event_type: Record<string, number> = {}
      const actor_counts:  Record<string, number> = {}

      for (const e of events as Record<string, unknown>[]) {
        const sev = String(e.severity ?? 'info')
        by_severity[sev] = (by_severity[sev] ?? 0) + 1

        const mod = String(e.module ?? 'unknown')
        by_module[mod] = (by_module[mod] ?? 0) + 1

        const et = String(e.event_type ?? 'unknown')
        by_event_type[et] = (by_event_type[et] ?? 0) + 1

        const actor = e.actor_id ? String(e.actor_id) : null
        if (actor) {
          actor_counts[actor] = (actor_counts[actor] ?? 0) + 1
        }
      }

      const top_actors = Object.entries(actor_counts)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 10)
        .map(([actor_id, count]) => ({ actor_id, count }))

      return reply.send({
        total: events.length,
        by_severity,
        by_module,
        by_event_type,
        top_actors,
        computed_at: new Date().toISOString(),
      })
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err)
      return reply.send({
        total: 0,
        by_severity: { info: 0, warning: 0, high: 0, critical: 0 },
        by_module: {},
        by_event_type: {},
        top_actors: [],
        computed_at: new Date().toISOString(),
        error: message,
      })
    }
  })
}
