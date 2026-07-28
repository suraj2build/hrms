/**
 * Governance & Privacy Workspace Routes — /governance/*
 *
 * Surfaces the existing DB infrastructure (no new engines) as a readable
 * workspace for HR admins:
 *
 * GET  /governance/privacy/controls           — compliance controls catalog
 * GET  /governance/privacy/pii-access         — PII access log
 * GET  /governance/privacy/erasure-requests   — data erasure requests
 * POST /governance/privacy/erasure-requests   — raise new erasure request
 * PATCH /governance/privacy/erasure-requests/:id — update status
 * GET  /governance/privacy/health             — privacy health KPIs
 *
 * Access: super_admin / hr_admin only.
 */

import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { HR_ADMIN_ROLES } from '../../lib/rbac.js'
import { serverError, notFound, ErrorCode } from '../../lib/api-errors.js'

function requireHrAdmin(req: any, reply: any, done: () => void) {
  if (!(HR_ADMIN_ROLES as readonly string[]).includes(req.userRole)) {
    reply.code(403).send({ error: 'FORBIDDEN', message: 'HR admin access required' })
    return
  }
  done()
}

const hrAuth = (fastify: FastifyInstance) => ({
  preHandler: [fastify.authenticate, requireHrAdmin],
})

export default async function privacyRoutes(fastify: FastifyInstance) {
  const auth = hrAuth(fastify)

  // ── GET /governance/privacy/controls ─────────────────────────────────────
  // Compliance controls catalog (SOC2, DPDPA, ISO 27001)

  fastify.get('/privacy/controls', auth, async (req: any, reply) => {
    const { framework, status, limit = '200', offset = '0' } = req.query as Record<string, string>

    let q = fastify.supabase
      .from('compliance_controls')
      .select('*', { count: 'exact' })
      .order('control_id', { ascending: true })

    if (framework) q = q.eq('framework', framework)
    if (status)    q = q.eq('status', status)
    q = q.range(Number(offset), Number(offset) + Number(limit) - 1)

    const { data, error, count } = await q
    if (error) return serverError(req, reply, error, ErrorCode.QUERY_FAILED, 'Failed to fetch compliance controls')

    // Attach latest evidence snapshot per control
    const controlIds = (data ?? []).map((c: any) => c.control_id)
    let evidenceMap: Record<string, any> = {}
    if (controlIds.length > 0) {
      const { data: evidence } = await fastify.supabase
        .from('compliance_evidence_snapshots')
        .select('control_id, snapshot_date, pass, failure_reason')
        .in('control_id', controlIds)
        .order('snapshot_date', { ascending: false })

      for (const ev of (evidence ?? []) as any[]) {
        if (!evidenceMap[ev.control_id]) evidenceMap[ev.control_id] = ev
      }
    }

    const enriched = (data ?? []).map((c: any) => ({
      ...c,
      latest_evidence: evidenceMap[c.control_id] ?? null,
    }))

    return reply.send({ data: enriched, total: count ?? 0 })
  })

  // ── GET /governance/privacy/pii-access ───────────────────────────────────
  // PII access audit log

  fastify.get('/privacy/pii-access', auth, async (req: any, reply) => {
    const q = z.object({
      purpose:      z.string().optional(),
      accessor_id:  z.string().uuid().optional(),
      flagged:      z.coerce.boolean().optional(),
      from:         z.string().optional(),
      to:           z.string().optional(),
      limit:        z.coerce.number().int().min(1).max(500).default(100),
      offset:       z.coerce.number().int().min(0).default(0),
    })
    const parsed = q.safeParse(req.query)
    if (!parsed.success) return reply.code(400).send({ error: 'VALIDATION_ERROR', message: parsed.error.issues[0]?.message })
    const { purpose, accessor_id, flagged, from, to, limit, offset } = parsed.data

    let query = fastify.supabase
      .from('pii_access_log')
      .select(`
        id, accessor_id, accessor_role, accessed_table, accessed_fields,
        access_purpose, justification, record_count, accessed_at,
        flagged, flag_reason, source_ip, correlation_id
      `, { count: 'exact' })
      .eq('tenant_id', req.tenantId)
      .order('accessed_at', { ascending: false })

    if (purpose)     query = query.eq('access_purpose', purpose)
    if (accessor_id) query = query.eq('accessor_id', accessor_id)
    if (flagged !== undefined) query = query.eq('flagged', flagged)
    if (from) query = query.gte('accessed_at', from)
    if (to)   query = query.lte('accessed_at', to)
    query = query.range(offset, offset + limit - 1)

    const { data, error, count } = await query
    if (error) return serverError(req, reply, error, ErrorCode.QUERY_FAILED, 'Failed to fetch PII access log')
    return reply.send({ data: data ?? [], total: count ?? 0, limit, offset })
  })

  // ── GET /governance/privacy/erasure-requests ──────────────────────────────
  // Data erasure requests (GDPR Art. 17, DPDPA §12)

  fastify.get('/privacy/erasure-requests', auth, async (req: any, reply) => {
    const q = z.object({
      status:  z.string().optional(),
      limit:   z.coerce.number().int().min(1).max(200).default(50),
      offset:  z.coerce.number().int().min(0).default(0),
    })
    const parsed = q.safeParse(req.query)
    if (!parsed.success) return reply.code(400).send({ error: 'VALIDATION_ERROR', message: parsed.error.issues[0]?.message })
    const { status, limit, offset } = parsed.data

    let query = fastify.supabase
      .from('erasure_requests')
      .select('*', { count: 'exact' })
      .eq('tenant_id', req.tenantId)
      .order('requested_at', { ascending: false })

    if (status) query = query.eq('status', status)
    query = query.range(offset, offset + limit - 1)

    const { data, error, count } = await query
    if (error) return serverError(req, reply, error, ErrorCode.QUERY_FAILED, 'Failed to fetch erasure requests')

    const today = new Date()
    const enriched = (data ?? []).map((r: any) => ({
      ...r,
      sla_breached: r.status === 'pending' && r.sla_deadline && new Date(r.sla_deadline) < today,
    }))

    return reply.send({ data: enriched, total: count ?? 0, limit, offset })
  })

  // ── POST /governance/privacy/erasure-requests ─────────────────────────────

  fastify.post('/privacy/erasure-requests', auth, async (req: any, reply) => {
    const schema = z.object({
      subject_email:  z.string().email().optional().nullable(),
      subject_name:   z.string().optional().nullable(),
      employee_id:    z.string().uuid().optional().nullable(),
      request_source: z.enum(['subject','hr_admin','regulator','legal']).default('hr_admin'),
      notes:          z.string().optional().nullable(),
    })
    const parsed = schema.safeParse(req.body)
    if (!parsed.success) return reply.code(400).send({ error: 'VALIDATION_ERROR', message: parsed.error.issues[0]?.message })

    // Cross-tenant IDOR guard: employee_id was only zod-validated as a UUID,
    // never checked to belong to the caller's tenant, before being inserted
    // (with tenant_id: req.tenantId) into erasure_requests.
    if (parsed.data.employee_id) {
      const { data: emp } = await fastify.supabase
        .from('employees')
        .select('id')
        .eq('id', parsed.data.employee_id)
        .eq('tenant_id', req.tenantId)
        .maybeSingle()
      if (!emp) return notFound(reply, 'EMPLOYEE_NOT_FOUND', 'Employee not found')
    }

    const { data, error } = await fastify.supabase
      .from('erasure_requests')
      .insert({
        ...parsed.data,
        tenant_id:    req.tenantId,
        requested_by: req.userId,
        status:       'pending',
      })
      .select()
      .single()

    if (error) return serverError(req, reply, error, ErrorCode.INSERT_FAILED, 'Failed to create erasure request')
    return reply.code(201).send({ data })
  })

  // ── PATCH /governance/privacy/erasure-requests/:id ────────────────────────

  fastify.patch('/privacy/erasure-requests/:id', auth, async (req: any, reply) => {
    const { id } = req.params as { id: string }
    const schema = z.object({
      status:           z.enum(['in_progress','completed','rejected','partial','on_hold']).optional(),
      rejection_reason: z.string().optional().nullable(),
      fields_erased:    z.record(z.array(z.string())).optional().nullable(),
      fields_retained:  z.record(z.unknown()).optional().nullable(),
      retention_basis:  z.string().optional().nullable(),
      notes:            z.string().optional().nullable(),
    })
    const parsed = schema.safeParse(req.body)
    if (!parsed.success) return reply.code(400).send({ error: 'VALIDATION_ERROR', message: parsed.error.issues[0]?.message })

    const update: Record<string, any> = { ...parsed.data }
    if (parsed.data.status === 'completed') {
      update.completed_at = new Date().toISOString()
      update.completed_by = req.userId
    }

    const { data, error } = await fastify.supabase
      .from('erasure_requests')
      .update(update)
      .eq('id', id)
      .eq('tenant_id', req.tenantId)
      .select('id')
      .maybeSingle()

    if (error) return serverError(req, reply, error, ErrorCode.UPDATE_FAILED, 'Failed to update erasure request')
    if (!data) return notFound(reply, 'ERASURE_REQUEST_NOT_FOUND', 'Erasure request not found')
    return reply.send({ message: 'Erasure request updated' })
  })

  // ── GET /governance/privacy/evaluations ──────────────────────────────────
  // Compliance evaluation results (entity-level rule pass/fail)

  fastify.get('/privacy/evaluations', auth, async (req: any, reply) => {
    const q = z.object({
      entity_type: z.string().optional(),
      compliant:   z.coerce.boolean().optional(),
      severity:    z.enum(['info','warning','high','critical']).optional(),
      limit:       z.coerce.number().int().min(1).max(200).default(50),
      offset:      z.coerce.number().int().min(0).default(0),
    })
    const parsed = q.safeParse(req.query)
    if (!parsed.success) return reply.code(400).send({ error: 'VALIDATION_ERROR', message: parsed.error.issues[0]?.message })
    const { entity_type, compliant, severity, limit, offset } = parsed.data

    let query = fastify.supabase
      .from('compliance_evaluations')
      .select('id, entity_type, entity_id, rule_id, compliant, severity, violations, evaluated_at', { count: 'exact' })
      .eq('tenant_id', req.tenantId)
      .order('evaluated_at', { ascending: false })

    if (entity_type)           query = query.eq('entity_type', entity_type)
    if (compliant !== undefined) query = query.eq('compliant', compliant)
    if (severity)              query = query.eq('severity', severity)
    query = query.range(offset, offset + limit - 1)

    const { data, error, count } = await query
    if (error) return serverError(req, reply, error, ErrorCode.QUERY_FAILED, 'Failed to fetch compliance evaluations')
    return reply.send({ data: data ?? [], total: count ?? 0, limit, offset })
  })

  // ── GET /governance/privacy/retention-runs ────────────────────────────────
  // Data retention enforcement audit trail (read-only)

  fastify.get('/privacy/retention-runs', auth, async (req: any, reply) => {
    const q = z.object({
      triggered_by: z.enum(['scheduler','manual','test']).optional(),
      limit:        z.coerce.number().int().min(1).max(100).default(20),
      offset:       z.coerce.number().int().min(0).default(0),
    })
    const parsed = q.safeParse(req.query)
    if (!parsed.success) return reply.code(400).send({ error: 'VALIDATION_ERROR', message: parsed.error.issues[0]?.message })
    const { triggered_by, limit, offset } = parsed.data

    let query = fastify.supabase
      .from('retention_enforcement_runs')
      .select('id, run_at, tables_scanned, records_evaluated, records_deleted, records_anonymized, records_retained, duration_ms, errors, triggered_by', { count: 'exact' })
      .eq('tenant_id', req.tenantId)
      .order('run_at', { ascending: false })

    if (triggered_by) query = query.eq('triggered_by', triggered_by)
    query = query.range(offset, offset + limit - 1)

    const { data, error, count } = await query
    if (error) return serverError(req, reply, error, ErrorCode.QUERY_FAILED, 'Failed to fetch retention enforcement runs')
    return reply.send({ data: data ?? [], total: count ?? 0, limit, offset })
  })

  // ── GET /governance/privacy/health ───────────────────────────────────────
  // KPI summary: open requests, SLA breaches, flagged access, control health

  fastify.get('/privacy/health', auth, async (req: any, reply) => {
    const tenantId = req.tenantId
    const today = new Date().toISOString().split('T')[0]

    const [
      { data: erasureRows, error: erasureErr },
      { data: flaggedRows, error: flaggedErr },
      { data: controlRows, error: controlErr },
    ] = await Promise.all([
      fastify.supabase
        .from('erasure_requests')
        .select('status, sla_deadline')
        .eq('tenant_id', tenantId),
      fastify.supabase
        .from('pii_access_log')
        .select('id')
        .eq('tenant_id', tenantId)
        .eq('flagged', true)
        .gte('accessed_at', new Date(Date.now() - 30 * 86400000).toISOString()),
      fastify.supabase
        .from('compliance_controls')
        .select('status'),
    ])
    // A failed query here must not be reported as all-zero KPIs — that reads
    // as a clean compliance dashboard when the backend actually failed.
    const queryErr = erasureErr ?? flaggedErr ?? controlErr
    if (queryErr) return serverError(req, reply, queryErr, ErrorCode.QUERY_FAILED, 'Failed to compute privacy health KPIs')

    const erasure = (erasureRows ?? []) as any[]
    const openErasure    = erasure.filter(r => ['pending','in_progress','on_hold'].includes(r.status)).length
    const breachedSla    = erasure.filter(r => ['pending','in_progress','on_hold'].includes(r.status) && r.sla_deadline && r.sla_deadline < today).length
    const completedTotal = erasure.filter(r => r.status === 'completed').length

    const controls = (controlRows ?? []) as any[]
    const controlHealth = {
      total:       controls.length,
      implemented: controls.filter(c => c.status === 'implemented').length,
      verified:    controls.filter(c => c.status === 'verified').length,
      in_progress: controls.filter(c => c.status === 'in_progress').length,
      not_started: controls.filter(c => c.status === 'not_started').length,
      waived:      controls.filter(c => c.status === 'waived').length,
    }

    return reply.send({
      erasure_requests: {
        open:      openErasure,
        breached_sla: breachedSla,
        completed: completedTotal,
        total:     erasure.length,
      },
      flagged_pii_access_30d: (flaggedRows ?? []).length,
      control_health: controlHealth,
    })
  })
}
