/**
 * Governance intelligence API routes — read-only observability endpoints.
 *
 * Provides timeline, compliance alerts, risk summary, and open incidents
 * for the GovernanceWorkspace frontend.
 * Sprint 2: Governance Intelligence Layer.
 */

import type { FastifyInstance } from 'fastify'
import { HR_ADMIN_ROLES } from '../../lib/rbac.js'
import { serverError, ErrorCode } from '../../lib/api-errors.js'

function requireHrAdmin(req: any, reply: any, done: () => void) {
  if (!(HR_ADMIN_ROLES as readonly string[]).includes(req.userRole)) {
    reply.code(403).send({ error: 'FORBIDDEN', message: 'HR admin access required' })
    return
  }
  done()
}

// Batch-resolves entity_id -> employee name/code for entity_type === 'employee'
// rows, so compliance-alert/risk-summary panels show who a row is about
// instead of a raw entity_type:entity_id grouping key. platform_events has
// no denormalized name column, so this is a runtime join against employees.
async function buildEmployeeNameMap(
  fastify: FastifyInstance,
  tenantId: string,
  rows: Array<{ entity_id: string; entity_type: string }>,
): Promise<Record<string, { name: string; employee_code: string }>> {
  const employeeIds = rows
    .filter(r => r.entity_type === 'employee')
    .map(r => r.entity_id)

  const nameMap: Record<string, { name: string; employee_code: string }> = {}
  if (employeeIds.length === 0) return nameMap

  const { data: emps } = await fastify.supabase
    .from('employees')
    .select('id, first_name, last_name, employee_code')
    .eq('tenant_id', tenantId)
    .in('id', employeeIds)
  for (const e of (emps ?? []) as any[]) {
    nameMap[e.id] = {
      name:          [e.first_name, e.last_name].filter(Boolean).join(' ') || `Employee ${e.employee_code ?? ''}`,
      employee_code: e.employee_code ?? '',
    }
  }
  return nameMap
}

export default async function intelligenceRoutes(fastify: FastifyInstance) {
  // These are company-wide governance/compliance feeds (platform events,
  // risk scores, open incidents across all employees) — contrast with
  // sibling governance/privacy.ts, which already gates to HR admin. Was
  // previously authenticate-only, letting any employee read tenant-wide
  // compliance alerts and incident details.
  const adminAuth = { preHandler: [fastify.authenticate, requireHrAdmin] }

  // ── GET /governance/events ────────────────────────────────────────────────
  fastify.get('/events', adminAuth, async (req, reply) => {
    const { limit = '30', offset = '0' } = req.query as Record<string, string>
    const tenantId = (req as any).tenantId
    const { data, error, count } = await fastify.supabase
      .from('platform_events')
      .select('*', { count: 'exact' })
      .eq('tenant_id', tenantId)
      .order('timestamp', { ascending: false })
      .range(Number(offset), Number(offset) + Number(limit) - 1)
    if (error) return serverError(req, reply, error, ErrorCode.QUERY_FAILED, 'Failed to fetch governance events')
    return { events: data ?? [], total: count ?? 0, limit: Number(limit), offset: Number(offset) }
  })

  // ── GET /governance/compliance/alerts ─────────────────────────────────────
  // Fresh audit finding: `total` was `data.length`, which can never exceed
  // the `.limit(50)` the query itself requested — a tenant with more than
  // 50 high/critical events saw the count silently capped with no
  // truncation signal on a compliance monitoring surface. Parallel
  // count:'exact',head:true query gives the real total.
  fastify.get('/compliance/alerts', adminAuth, async (req, reply) => {
    const tenantId = (req as any).tenantId
    const [{ data, error }, { count, error: countError }] = await Promise.all([
      fastify.supabase
        .from('platform_events')
        .select('*')
        .eq('tenant_id', tenantId)
        .in('severity', ['high', 'critical'])
        .order('timestamp', { ascending: false })
        .limit(50),
      fastify.supabase
        .from('platform_events')
        .select('*', { count: 'exact', head: true })
        .eq('tenant_id', tenantId)
        .in('severity', ['high', 'critical']),
    ])
    if (error) return serverError(req, reply, error, ErrorCode.QUERY_FAILED, 'Failed to fetch compliance alerts')
    if (countError) return serverError(req, reply, countError, ErrorCode.QUERY_FAILED, 'Failed to count compliance alerts')

    const alerts = data ?? []
    const nameMap = await buildEmployeeNameMap(fastify, tenantId, alerts)
    const enriched = alerts.map((a: any) => ({
      ...a,
      employee_name: nameMap[a.entity_id]?.name          ?? null,
      employee_code: nameMap[a.entity_id]?.employee_code ?? null,
    }))
    return { alerts: enriched, total: count ?? enriched.length }
  })

  // ── GET /governance/risk/summary ──────────────────────────────────────────
  fastify.get('/risk/summary', adminAuth, async (req, reply) => {
    const tenantId = (req as any).tenantId
    const { data, error } = await fastify.supabase
      .from('platform_events')
      .select('entity_type, entity_id, severity, event_type, timestamp')
      .eq('tenant_id', tenantId)
      .in('severity', ['high', 'critical'])
      .order('timestamp', { ascending: false })
      .limit(100)
    if (error) return serverError(req, reply, error, ErrorCode.QUERY_FAILED, 'Failed to fetch risk summary')

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
    // Fresh audit finding: `total` was risks.length, computed AFTER the
    // top-20 slice below — a tenant with more than 20 distinct at-risk
    // entities always reported total: 20 regardless of the real count.
    const totalEntities = entityMap.size
    const risks = [...entityMap.values()]
      .sort((a, b) => b.score - a.score)
      .slice(0, 20)

    const nameMap = await buildEmployeeNameMap(fastify, tenantId, risks)
    const enrichedRisks = risks.map(r => ({
      ...r,
      employee_name: nameMap[r.entity_id]?.name          ?? null,
      employee_code: nameMap[r.entity_id]?.employee_code ?? null,
    }))
    return { risks: enrichedRisks, total: totalEntities }
  })

  // ── GET /governance/incidents ─────────────────────────────────────────────
  fastify.get('/incidents', adminAuth, async (req, reply) => {
    const { limit = '20' } = req.query as Record<string, string>
    const tenantId = (req as any).tenantId
    const { data, error } = await fastify.supabase
      .from('operational_incidents')
      .select('id, incident_type, severity, title, status, related_entity_type, created_at, metadata')
      .eq('tenant_id', tenantId)
      .eq('status', 'open')
      .order('created_at', { ascending: false })
      .limit(Number(limit))
    if (error) return serverError(req, reply, error, ErrorCode.QUERY_FAILED, 'Failed to fetch open incidents')
    return { incidents: data ?? [], total: (data ?? []).length }
  })
}
