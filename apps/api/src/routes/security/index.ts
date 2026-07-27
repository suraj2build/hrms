/**
 * Security Operations Workspace Routes — /security/*
 *
 * Surfaces the existing DB infrastructure (no new detection engine) as a
 * readable workspace for HR/security admins:
 *
 * GET  /security/events                  — security event stream
 * GET  /security/alerts                  — security alerts (open/resolved)
 * PATCH /security/alerts/:id             — update alert status
 * GET  /security/detection-rules         — detection rule catalog
 * PATCH /security/detection-rules/:id    — enable/disable or edit rule
 * GET  /security/health                  — KPI summary
 *
 * Access: hr_admin/super_admin, tenant-scoped (plus platform/null-tenant
 * events they can already see). /detection-rules is the exception — that
 * table is platform-global with no tenant filter, so both its routes are
 * locked to super_admin only (see the comments at those two routes).
 */

import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { HR_ADMIN_ROLES } from '../../lib/rbac.js'
import { serverError, notFound, ErrorCode } from '../../lib/api-errors.js'
import { fetchAllRows } from '../../lib/supabase-paginate.js'

function requireAdmin(req: any, reply: any, done: () => void) {
  if (!(HR_ADMIN_ROLES as readonly string[]).includes(req.userRole)) {
    reply.code(403).send({ error: 'FORBIDDEN', message: 'HR admin access required' })
    return
  }
  done()
}

/**
 * True when a Supabase/PostgREST error means the underlying table is not
 * provisioned (schema drift) rather than a real query failure. Lets newer,
 * optional intelligence surfaces degrade to an empty state instead of 500-ing
 * the whole workspace when a migration hasn't been applied yet.
 *
 *   PGRST205 — "Could not find the table '...' in the schema cache"
 *   42P01    — Postgres "relation ... does not exist"
 */
function isMissingTable(error: { code?: string; message?: string } | null): boolean {
  if (!error) return false
  if (error.code === 'PGRST205' || error.code === '42P01') return true
  const msg = error.message ?? ''
  return /could not find the table|does not exist/i.test(msg)
}

export default async function securityRoutes(fastify: FastifyInstance) {
  const auth = { preHandler: [fastify.authenticate, requireAdmin] }

  // ── GET /security/events ──────────────────────────────────────────────────
  // Security event stream (append-only, 90-day hot retention)

  fastify.get('/events', auth, async (req: any, reply) => {
    const q = z.object({
      event_type: z.string().optional(),
      severity:   z.string().optional(),
      actor_id:   z.string().uuid().optional(),
      from:       z.string().optional(),
      to:         z.string().optional(),
      limit:      z.coerce.number().int().min(1).max(500).default(100),
      offset:     z.coerce.number().int().min(0).default(0),
    })
    const parsed = q.safeParse(req.query)
    if (!parsed.success) return reply.code(400).send({ error: 'VALIDATION_ERROR', message: parsed.error.issues[0]?.message })
    const { event_type, severity, actor_id, from, to, limit, offset } = parsed.data

    let query = fastify.supabase
      .from('security_events')
      .select('id, event_type, severity, tenant_id, actor_id, actor_ip, target_type, target_id, event_data, occurred_at', { count: 'exact' })
      .order('occurred_at', { ascending: false })

    // Tenant-scoped OR system events (null tenant_id)
    if (req.userRole !== 'super_admin') {
      query = query.or(`tenant_id.eq.${req.tenantId},tenant_id.is.null`)
    }

    if (event_type) query = query.eq('event_type', event_type)
    if (severity)   query = query.eq('severity', severity)
    if (actor_id)   query = query.eq('actor_id', actor_id)
    if (from) query = query.gte('occurred_at', from)
    if (to)   query = query.lte('occurred_at', to)
    query = query.range(offset, offset + limit - 1)

    const { data, error, count } = await query
    if (error) return serverError(req, reply, error, ErrorCode.QUERY_FAILED, 'Failed to fetch security events')
    return reply.send({ data: data ?? [], total: count ?? 0, limit, offset })
  })

  // ── GET /security/alerts ──────────────────────────────────────────────────

  fastify.get('/alerts', auth, async (req: any, reply) => {
    const q = z.object({
      status:   z.string().optional(),
      severity: z.string().optional(),
      rule_name: z.string().optional(),
      limit:    z.coerce.number().int().min(1).max(200).default(50),
      offset:   z.coerce.number().int().min(0).default(0),
    })
    const parsed = q.safeParse(req.query)
    if (!parsed.success) return reply.code(400).send({ error: 'VALIDATION_ERROR', message: parsed.error.issues[0]?.message })
    const { status, severity, rule_name, limit, offset } = parsed.data

    let query = fastify.supabase
      .from('security_alerts')
      .select(`
        id, rule_name, severity, tenant_id, actor_id, triggered_at,
        trigger_count, trigger_window_s, status,
        acknowledged_by, acknowledged_at, resolved_by, resolved_at,
        resolution_note, mtta_seconds, mttr_seconds, escalated_at,
        created_at
      `, { count: 'exact' })
      .order('triggered_at', { ascending: false })

    if (req.userRole !== 'super_admin') {
      query = query.or(`tenant_id.eq.${req.tenantId},tenant_id.is.null`)
    }

    if (status)    query = query.eq('status', status)
    if (severity)  query = query.eq('severity', severity)
    if (rule_name) query = query.eq('rule_name', rule_name)
    query = query.range(offset, offset + limit - 1)

    const { data, error, count } = await query
    if (error) return serverError(req, reply, error, ErrorCode.QUERY_FAILED, 'Failed to fetch security alerts')
    return reply.send({ data: data ?? [], total: count ?? 0, limit, offset })
  })

  // ── PATCH /security/alerts/:id ────────────────────────────────────────────

  fastify.patch('/alerts/:id', auth, async (req: any, reply) => {
    const { id } = req.params as { id: string }
    const schema = z.object({
      status:          z.enum(['acknowledged','investigating','resolved','false_positive']),
      resolution_note: z.string().optional().nullable(),
    })
    const parsed = schema.safeParse(req.body)
    if (!parsed.success) return reply.code(400).send({ error: 'VALIDATION_ERROR', message: parsed.error.issues[0]?.message })

    const update: Record<string, any> = { status: parsed.data.status }
    if (parsed.data.resolution_note) update.resolution_note = parsed.data.resolution_note
    const now = new Date().toISOString()

    if (parsed.data.status === 'acknowledged') {
      update.acknowledged_by = req.userId
      update.acknowledged_at = now
    } else if (parsed.data.status === 'investigating') {
      update.investigated_by = req.userId
    } else if (['resolved','false_positive'].includes(parsed.data.status)) {
      update.resolved_by = req.userId
      update.resolved_at = now
    }

    // Tenant isolation: mirror the GET scope — a non-super-admin may only
    // mutate alerts belonging to their own tenant (or platform/null alerts
    // they can already see). Without this, any authed user could resolve
    // another tenant's alert by id.
    let upd = fastify.supabase
      .from('security_alerts')
      .update(update)
      .eq('id', id)
    if (req.userRole !== 'super_admin') {
      upd = upd.or(`tenant_id.eq.${req.tenantId},tenant_id.is.null`)
    }
    const { data, error } = await upd.select('id').maybeSingle()

    if (error) return serverError(req, reply, error, ErrorCode.UPDATE_FAILED, 'Failed to update alert')
    if (!data) return notFound(reply, 'ALERT_NOT_FOUND', 'Alert not found')
    return reply.send({ message: `Alert ${parsed.data.status}` })
  })

  // ── GET /security/detection-rules ────────────────────────────────────────

  fastify.get('/detection-rules', auth, async (req: any, reply) => {
    // Matches PATCH below and this file's own documented access model
    // ("super_admin only — security events contain platform-level data").
    // security_detection_rules is a platform-global table with no tenant
    // filter, so any tenant's hr_admin could otherwise read exact
    // fraud/abuse-detection thresholds (e.g. "more than 15 leave approvals
    // in 5 minutes triggers a high alert") and calibrate evasion just
    // under them.
    if (req.userRole !== 'super_admin') {
      return reply.code(403).send({ error: 'FORBIDDEN', message: 'Only super admins can view detection rules' })
    }

    const { enabled } = req.query as Record<string, string>

    let query = fastify.supabase
      .from('security_detection_rules')
      .select('*')
      .order('severity', { ascending: false })

    if (enabled !== undefined) query = query.eq('enabled', enabled === 'true')

    const { data, error } = await query
    if (error) return serverError(req, reply, error, ErrorCode.QUERY_FAILED, 'Failed to fetch detection rules')
    return reply.send({ data: data ?? [] })
  })

  // ── PATCH /security/detection-rules/:id ──────────────────────────────────

  fastify.patch('/detection-rules/:id', auth, async (req: any, reply) => {
    const { id } = req.params as { id: string }
    const schema = z.object({
      enabled:          z.boolean().optional(),
      threshold:        z.number().int().min(1).optional(),
      window_seconds:   z.number().int().min(10).optional(),
      cooldown_seconds: z.number().int().min(0).optional(),
      alert_channel:    z.enum(['slack','pagerduty','email','all']).optional(),
    })
    const parsed = schema.safeParse(req.body)
    if (!parsed.success) return reply.code(400).send({ error: 'VALIDATION_ERROR', message: parsed.error.issues[0]?.message })

    if (req.userRole !== 'super_admin') {
      return reply.code(403).send({ error: 'FORBIDDEN', message: 'Only super admins can modify detection rules' })
    }

    const { data, error } = await fastify.supabase
      .from('security_detection_rules')
      .update(parsed.data)
      .eq('id', id)
      .select('id')
      .maybeSingle()

    if (error) return serverError(req, reply, error, ErrorCode.UPDATE_FAILED, 'Failed to update detection rule')
    if (!data) return notFound(reply, 'RULE_NOT_FOUND', 'Detection rule not found')
    return reply.send({ message: 'Rule updated' })
  })

  // ── GET /security/intelligence ────────────────────────────────────────────
  // Threat intelligence signal stream (security_intelligence_events uses tenant_id)

  fastify.get('/intelligence', auth, async (req: any, reply) => {
    const q = z.object({
      signal_type: z.string().optional(),
      entity_type: z.string().optional(),
      severity:    z.enum(['info','warning','high','critical']).optional(),
      limit:       z.coerce.number().int().min(1).max(200).default(100),
      offset:      z.coerce.number().int().min(0).default(0),
    })
    const parsed = q.safeParse(req.query)
    if (!parsed.success) return reply.code(400).send({ error: 'VALIDATION_ERROR', message: parsed.error.issues[0]?.message })
    const { signal_type, entity_type, severity, limit, offset } = parsed.data

    let query = fastify.supabase
      .from('security_intelligence_events')
      .select('id, signal_type, entity_id, entity_type, severity, description, metadata, detected_at', { count: 'exact' })
      .eq('tenant_id', req.tenantId)
      .order('detected_at', { ascending: false })

    if (signal_type) query = query.eq('signal_type', signal_type)
    if (entity_type) query = query.eq('entity_type', entity_type)
    if (severity)    query = query.eq('severity', severity)
    query = query.range(offset, offset + limit - 1)

    const { data, error, count } = await query
    if (error) {
      if (isMissingTable(error)) {
        req.log.warn('security_intelligence_events table not provisioned — returning empty (apply migration 188)')
        return reply.send({ data: [], total: 0, limit, offset, unavailable: true })
      }
      return serverError(req, reply, error, ErrorCode.QUERY_FAILED, 'Failed to fetch security intelligence events')
    }
    return reply.send({ data: data ?? [], total: count ?? 0, limit, offset })
  })

  // ── GET /security/verification ────────────────────────────────────────────
  // Identity verification event log (verification_events uses tenant_id)

  fastify.get('/verification', auth, async (req: any, reply) => {
    const q = z.object({
      verification_type: z.enum(['pan','aadhaar','bank_account','ifsc','document','phone','email']).optional(),
      status:            z.enum(['verified','failed','pending','skipped','inconclusive']).optional(),
      entity_type:       z.string().optional(),
      limit:             z.coerce.number().int().min(1).max(200).default(100),
      offset:            z.coerce.number().int().min(0).default(0),
    })
    const parsed = q.safeParse(req.query)
    if (!parsed.success) return reply.code(400).send({ error: 'VALIDATION_ERROR', message: parsed.error.issues[0]?.message })
    const { verification_type, status, entity_type, limit, offset } = parsed.data

    let query = fastify.supabase
      .from('verification_events')
      .select('id, entity_id, entity_type, verification_type, status, score, flags, verified_at', { count: 'exact' })
      .eq('tenant_id', req.tenantId)
      .order('verified_at', { ascending: false })

    if (verification_type) query = query.eq('verification_type', verification_type)
    if (status)            query = query.eq('status', status)
    if (entity_type)       query = query.eq('entity_type', entity_type)
    query = query.range(offset, offset + limit - 1)

    const { data, error, count } = await query
    if (error) {
      if (isMissingTable(error)) {
        req.log.warn('verification_events table not provisioned — returning empty')
        return reply.send({ data: [], total: 0, limit, offset, unavailable: true })
      }
      return serverError(req, reply, error, ErrorCode.QUERY_FAILED, 'Failed to fetch verification events')
    }
    return reply.send({ data: data ?? [], total: count ?? 0, limit, offset })
  })

  // ── GET /security/health ──────────────────────────────────────────────────

  fastify.get('/health', auth, async (req: any, reply) => {
    const tenantId = req.tenantId

    let alerts: any[]
    let events: any[]
    let rules: any[]
    try {
      ;[alerts, events, rules] = await Promise.all([
        fetchAllRows<any>((from, to) =>
          fastify.supabase
            .from('security_alerts')
            .select('status, severity, triggered_at, mtta_seconds, mttr_seconds')
            .or(`tenant_id.eq.${tenantId},tenant_id.is.null`)
            .gte('triggered_at', new Date(Date.now() - 30 * 86400000).toISOString())
            .range(from, to),
        ),
        fetchAllRows<any>((from, to) =>
          fastify.supabase
            .from('security_events')
            .select('severity, event_type')
            .or(`tenant_id.eq.${tenantId},tenant_id.is.null`)
            .gte('occurred_at', new Date(Date.now() - 7 * 86400000).toISOString())
            .range(from, to),
        ),
        fetchAllRows<any>((from, to) =>
          fastify.supabase
            .from('security_detection_rules')
            .select('enabled, severity')
            .range(from, to),
        ),
      ])
    } catch (error) {
      return serverError(req, reply, error, ErrorCode.QUERY_FAILED, 'Failed to fetch security health metrics')
    }

    const openAlerts     = alerts.filter(a => a.status === 'open')
    const criticalOpen   = openAlerts.filter(a => a.severity === 'critical').length
    const highOpen       = openAlerts.filter(a => a.severity === 'high').length
    const resolvedAlerts = alerts.filter(a => a.status === 'resolved')

    const avgMtta = resolvedAlerts.filter(a => a.mtta_seconds != null).length
      ? Math.round(resolvedAlerts.reduce((s, a) => s + (a.mtta_seconds ?? 0), 0) / resolvedAlerts.filter(a => a.mtta_seconds != null).length)
      : null

    const avgMttr = resolvedAlerts.filter(a => a.mttr_seconds != null).length
      ? Math.round(resolvedAlerts.reduce((s, a) => s + (a.mttr_seconds ?? 0), 0) / resolvedAlerts.filter(a => a.mttr_seconds != null).length)
      : null

    const eventsBySeverity: Record<string, number> = {}
    for (const e of events) {
      eventsBySeverity[e.severity] = (eventsBySeverity[e.severity] ?? 0) + 1
    }

    return reply.send({
      alerts_30d: {
        total:         alerts.length,
        open:          openAlerts.length,
        critical_open: criticalOpen,
        high_open:     highOpen,
        resolved:      resolvedAlerts.length,
        avg_mtta_sec:  avgMtta,
        avg_mttr_sec:  avgMttr,
      },
      events_7d: {
        total: events.length,
        by_severity: eventsBySeverity,
      },
      detection_rules: {
        total:   rules.length,
        enabled: rules.filter(r => r.enabled).length,
      },
    })
  })
}
