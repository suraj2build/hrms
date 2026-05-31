/**
 * Governance intelligence API routes — read-only observability endpoints.
 *
 * Provides timeline, compliance alerts, risk summary, and open incidents
 * for the GovernanceWorkspace frontend.
 * Sprint 2: Governance Intelligence Layer.
 */

import type { FastifyInstance } from 'fastify'

export default async function intelligenceRoutes(fastify: FastifyInstance) {

  // ── GET /governance/events ────────────────────────────────────────────────
  fastify.get('/events', { preHandler: [fastify.authenticate] }, async (req, reply) => {
    const { limit = '30', offset = '0' } = req.query as Record<string, string>
    const tenantId = (req as any).user.tenant_id
    const { data, error, count } = await fastify.supabase
      .from('platform_events')
      .select('*', { count: 'exact' })
      .eq('org_id', tenantId)
      .order('timestamp', { ascending: false })
      .range(Number(offset), Number(offset) + Number(limit) - 1)
    if (error) return reply.status(500).send({ error: error.message })
    return { events: data ?? [], total: count ?? 0, limit: Number(limit), offset: Number(offset) }
  })

  // ── GET /governance/compliance/alerts ─────────────────────────────────────
  fastify.get('/compliance/alerts', { preHandler: [fastify.authenticate] }, async (req, reply) => {
    const tenantId = (req as any).user.tenant_id
    const { data, error } = await fastify.supabase
      .from('platform_events')
      .select('*')
      .eq('org_id', tenantId)
      .in('severity', ['high', 'critical'])
      .order('timestamp', { ascending: false })
      .limit(50)
    if (error) return reply.status(500).send({ error: error.message })
    return { alerts: data ?? [], total: (data ?? []).length }
  })

  // ── GET /governance/risk/summary ──────────────────────────────────────────
  fastify.get('/risk/summary', { preHandler: [fastify.authenticate] }, async (req, reply) => {
    const tenantId = (req as any).user.tenant_id
    const { data, error } = await fastify.supabase
      .from('platform_events')
      .select('entity_type, entity_id, severity, event_type, timestamp')
      .eq('org_id', tenantId)
      .in('severity', ['high', 'critical'])
      .order('timestamp', { ascending: false })
      .limit(100)
    if (error) return reply.status(500).send({ error: error.message })

    // Group by entity, compute simple cumulative score
    const entityMap = new Map<
      string,
      { entity_id: string; entity_type: string; score: number; severity: string; count: number }
    >()
    for (const row of (data ?? [])) {
      const key = `${row.entity_type}:${row.entity_id}`
      const add = row.severity === 'critical' ? 30 : 15
      const ex  = entityMap.get(key)
      if (ex) {
        ex.score = Math.min(100, ex.score + add)
        ex.count++
      } else {
        entityMap.set(key, {
          entity_id:   row.entity_id,
          entity_type: row.entity_type,
          score:       add,
          severity:    row.severity,
          count:       1,
        })
      }
    }
    const risks = [...entityMap.values()]
      .sort((a, b) => b.score - a.score)
      .slice(0, 20)
    return { risks, total: risks.length }
  })

  // ── GET /governance/incidents ─────────────────────────────────────────────
  fastify.get('/incidents', { preHandler: [fastify.authenticate] }, async (req, reply) => {
    const { limit = '20' } = req.query as Record<string, string>
    const tenantId = (req as any).user.tenant_id
    const { data, error } = await fastify.supabase
      .from('operational_incidents')
      .select('id, incident_type, severity, title, status, related_entity_type, created_at, metadata')
      .eq('tenant_id', tenantId)
      .eq('status', 'open')
      .order('created_at', { ascending: false })
      .limit(Number(limit))
    if (error) return reply.status(500).send({ error: error.message })
    return { incidents: data ?? [], total: (data ?? []).length }
  })
}
