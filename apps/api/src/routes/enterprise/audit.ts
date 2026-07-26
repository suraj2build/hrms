import type { FastifyInstance } from 'fastify'
import { requireRole, HR_ADMIN_ROLES } from '../../lib/rbac.js'
import { fetchAllRows } from '../../lib/supabase-paginate.js'
import { serverError, ErrorCode } from '../../lib/api-errors.js'

export default async function auditRoutes(fastify: FastifyInstance) {

  const hrAdminAuth = { preHandler: [fastify.authenticate, requireRole(...HR_ADMIN_ROLES)] }

  // ═══════════════════════════════════════════════════════════════════════════
  // RPT-04 — Generic audit_logs viewer (DB-change trail from logAction)
  // GET /enterprise/audit/logs?table_name=&action=&performed_by=&record_id=&from=&to=&limit=&offset=
  // ═══════════════════════════════════════════════════════════════════════════
  fastify.get('/audit/logs', hrAdminAuth, async (req: any, reply) => {
    const q = req.query as Record<string, string | undefined>
    const tenantId = req.tenantId

    const limit  = Math.min(Math.max(Number(q.limit ?? 100), 1), 200)
    const offset = Math.max(Number(q.offset ?? 0), 0)

    let qb = fastify.supabase
      .from('audit_logs')
      .select('id, table_name, record_id, action, performed_by, on_behalf_of, old_data, new_data, created_at', { count: 'exact' })
      .eq('tenant_id', tenantId)
      .order('created_at', { ascending: false })
      .range(offset, offset + limit - 1)

    if (q.table_name && q.table_name !== 'all')   qb = qb.eq('table_name', q.table_name)
    if (q.action && q.action !== 'all')           qb = qb.eq('action', q.action)
    if (q.performed_by)                           qb = qb.eq('performed_by', q.performed_by)
    if (q.record_id)                              qb = qb.eq('record_id', q.record_id)
    if (q.from)                                   qb = qb.gte('created_at', q.from)
    if (q.to)                                     qb = qb.lte('created_at', q.to)

    const { data, error, count } = await qb
    if (error) return serverError(req, reply, error, ErrorCode.QUERY_FAILED, 'Failed to fetch audit logs')

    const rows = (data ?? []) as any[]

    // Enrich performed_by → actor name (best-effort).
    const actorIds = Array.from(new Set(rows.map(r => r.performed_by).filter(Boolean)))
    const nameMap = new Map<string, string>()
    if (actorIds.length > 0) {
      const { data: profs } = await fastify.supabase
        .from('profiles')
        .select('id, full_name')
        .in('id', actorIds)
        .eq('tenant_id', tenantId)
      for (const p of (profs ?? [])) nameMap.set((p as any).id, (p as any).full_name ?? '')
    }

    const enriched = rows.map(r => ({
      ...r,
      performed_by_name: r.performed_by ? (nameMap.get(r.performed_by) ?? null) : null,
    }))

    return reply.send({ data: enriched, total: count ?? enriched.length, limit, offset })
  })

  // GET /enterprise/audit/logs/tables — distinct table_names present (for the filter dropdown)
  fastify.get('/audit/logs/tables', hrAdminAuth, async (req: any, reply) => {
    let rows: any[]
    try {
      rows = await fetchAllRows((from, to) =>
        fastify.supabase
          .from('audit_logs')
          .select('table_name')
          .eq('tenant_id', req.tenantId)
          .range(from, to),
      )
    } catch (err: unknown) {
      return serverError(req, reply, err, ErrorCode.QUERY_FAILED, 'Failed to fetch audit log tables')
    }
    const tables = Array.from(new Set(rows.map((r: any) => r.table_name))).sort()
    return reply.send({ data: tables })
  })

  // GET /enterprise/audit/export
  fastify.get('/audit/export', hrAdminAuth, async (req, reply) => {
    try {
      const query = req.query as Record<string, string | undefined>
      const tenant_id = (req as any).tenantId as string | undefined

      const EXPORT_CAP = Math.min(Number(query.limit ?? 200), 5000)
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

      // Tenant isolation is mandatory — never export another tenant's events.
      qb = qb.eq('tenant_id', tenant_id)
      if (from)        qb = qb.gte('timestamp', from)
      if (to)          qb = qb.lte('timestamp', to)
      if (module_)     qb = qb.eq('module', module_)
      if (severity)    qb = qb.eq('severity', severity)
      if (event_type)  qb = qb.eq('event_type', event_type)
      if (entity_type) qb = qb.eq('entity_type', entity_type)

      const allRows = await fetchAllRows((pageFrom, pageTo) => qb.range(pageFrom, pageTo))
      const events = allRows.slice(0, EXPORT_CAP)

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
      return serverError(req, reply, err, ErrorCode.QUERY_FAILED, 'Failed to export audit events')
    }
  })

  // GET /enterprise/audit/stats
  fastify.get('/audit/stats', hrAdminAuth, async (req, reply) => {
    try {
      const query  = req.query as Record<string, string | undefined>
      const tenant_id = (req as any).tenantId as string | undefined

      const to   = query.to   ?? new Date().toISOString()
      const from = query.from ?? new Date(Date.now() - 30 * 24 * 3_600_000).toISOString()

      let qb = fastify.supabase
        .from('platform_events')
        .select('event_id,event_type,module,actor_id,severity')
        .gte('timestamp', from)
        .lte('timestamp', to)

      // Tenant isolation is mandatory.
      qb = qb.eq('tenant_id', tenant_id)

      const events = await fetchAllRows((pageFrom, pageTo) => qb.range(pageFrom, pageTo))

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
      return serverError(req, reply, err, ErrorCode.COMPUTE_FAILED, 'Failed to compute audit stats')
    }
  })
}
