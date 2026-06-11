/**
 * Workforce Operations Incident System
 *
 * GET    /system/incidents                — List incidents with filters
 * GET    /system/incidents/summary        — Aggregate counts and stats
 * GET    /system/incidents/:id            — Single incident with timeline, escalations, comments
 * POST   /system/incidents                — Create incident (admin)
 * PUT    /system/incidents/:id            — Update incident (admin)
 * POST   /system/incidents/:id/escalate   — Escalate incident (admin)
 * POST   /system/incidents/:id/resolve    — Resolve incident (admin)
 * POST   /system/incidents/:id/comments   — Add comment
 *
 * Tables: operational_incidents, incident_escalations,
 *         incident_timeline_events, incident_comments
 */
import type { FastifyInstance } from 'fastify'
import { z } from 'zod'

// ── Schemas ───────────────────────────────────────────────────────────────────

const listQuerySchema = z.object({
  status:        z.enum(['open', 'in_progress', 'escalated', 'resolved', 'closed']).optional(),
  severity:      z.enum(['low', 'medium', 'high', 'critical']).optional(),
  incident_type: z.string().optional(),
  from:          z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  to:            z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  limit:         z.coerce.number().int().min(1).max(200).default(50),
  offset:        z.coerce.number().int().min(0).default(0),
})

const createBodySchema = z.object({
  incident_type:          z.string().min(1),
  severity:               z.enum(['low', 'medium', 'high', 'critical']),
  title:                  z.string().min(1),
  description:            z.string().min(1),
  employee_id:            z.string().uuid().optional(),
  department_id:          z.string().uuid().optional(),
  related_entity_type:    z.string().optional(),
  related_entity_id:      z.string().uuid().optional(),
  payroll_impact_amount:  z.number().optional(),
  affected_employee_count: z.number().int().min(0).optional(),
  sla_target_hours:       z.number().positive().optional(),
  tags:                   z.array(z.string()).optional(),
  metadata:               z.record(z.unknown()).optional(),
})

const updateBodySchema = z.object({
  status:                z.enum(['open', 'in_progress', 'escalated', 'resolved', 'closed']).optional(),
  severity:              z.enum(['low', 'medium', 'high', 'critical']).optional(),
  assigned_to:           z.string().uuid().optional(),
  resolution_note:       z.string().optional(),
  payroll_impact_amount: z.number().optional(),
}).refine(
  (d) => Object.values(d).some((v) => v !== undefined),
  { message: 'At least one field must be provided for update' },
)

const escalateBodySchema = z.object({
  escalate_to: z.string().uuid(),
  reason:      z.string().min(1),
})

const resolveBodySchema = z.object({
  resolution_note: z.string().min(1),
})

const commentBodySchema = z.object({
  content:     z.string().min(1),
  is_internal: z.boolean().optional().default(false),
})

// ── Helpers ───────────────────────────────────────────────────────────────────

const ADMIN_ROLES = ['super_admin', 'hr_admin'] as const

function isAdmin(role: string): boolean {
  return (ADMIN_ROLES as readonly string[]).includes(role)
}

async function addTimelineEvent(
  fastify: FastifyInstance,
  incidentId: string,
  tenantId: string,
  actorId: string,
  eventType: string,
  description: string,
  metadata?: Record<string, unknown>,
) {
  const { error } = await fastify.supabase.from('incident_timeline_events').insert({
    incident_id:  incidentId,
    tenant_id:    tenantId,
    actor_id:     actorId,
    event_type:   eventType,
    description,
    metadata:     metadata ?? null,
    created_at:   new Date().toISOString(),
  })
  return error
}

// ── Plugin ────────────────────────────────────────────────────────────────────

export default async function incidentsRoute(fastify: FastifyInstance) {
  const auth      = { preHandler: [fastify.authenticate] }

  // ── GET /system/incidents ─────────────────────────────────────────────────
  fastify.get('/system/incidents', auth, async (req: any, reply) => {
    const parsed = listQuerySchema.safeParse(req.query)
    if (!parsed.success) {
      return reply.code(400).send({
        error:   'VALIDATION_ERROR',
        message: parsed.error.issues[0]?.message,
      })
    }

    const { status, severity, incident_type, from, to, limit, offset } = parsed.data

    let q = fastify.supabase
      .from('operational_incidents')
      .select(
        `
        id, incident_type, severity, status, title, description,
        payroll_impact_amount, affected_employee_count,
        sla_target_hours, sla_breached, tags, metadata,
        created_at, updated_at, resolved_at,
        employee_id, department_id, assigned_to,
        related_entity_type, related_entity_id,
        employees(id, first_name, last_name, employee_code),
        profiles!operational_incidents_assigned_to_fkey(id, full_name)
        `,
        { count: 'exact' },
      )
      .eq('tenant_id', req.tenantId)
      .order('created_at', { ascending: false })
      .range(offset, offset + limit - 1)

    if (status)        q = q.eq('status', status)
    if (severity)      q = q.eq('severity', severity)
    if (incident_type) q = q.eq('incident_type', incident_type)
    if (from)          q = q.gte('created_at', `${from}T00:00:00`)
    if (to)            q = q.lte('created_at', `${to}T23:59:59`)

    const { data, error, count } = await q

    if (error) {
      req.log.error({ err: error }, 'incidents list query failed')
      return reply.code(500).send({ error: 'QUERY_FAILED', message: 'Failed to fetch incidents' })
    }

    const rows = (data ?? []).map((r: any) => ({
      id:                     r.id,
      incident_type:          r.incident_type,
      severity:               r.severity,
      status:                 r.status,
      title:                  r.title,
      description:            r.description,
      payroll_impact_amount:  r.payroll_impact_amount,
      affected_employee_count: r.affected_employee_count,
      sla_target_hours:       r.sla_target_hours,
      sla_breached:           r.sla_breached,
      tags:                   r.tags,
      metadata:               r.metadata,
      created_at:             r.created_at,
      updated_at:             r.updated_at,
      resolved_at:            r.resolved_at,
      employee_id:            r.employee_id,
      department_id:          r.department_id,
      assigned_to:            r.assigned_to,
      related_entity_type:    r.related_entity_type,
      related_entity_id:      r.related_entity_id,
      employee_name:          r.employees
        ? `${r.employees.first_name} ${r.employees.last_name}`
        : null,
      employee_code:          r.employees?.employee_code ?? null,
      assigned_to_name:       r.profiles?.full_name ?? null,
    }))

    return reply.send({ data: rows, total: count ?? 0, limit, offset })
  })

  // ── GET /system/incidents/summary ─────────────────────────────────────────
  fastify.get('/system/incidents/summary', auth, async (req: any, reply) => {
    const tenantId = req.tenantId

    // Fetch all incidents for the tenant (lightweight: only status, severity, type, sla_breached, resolved_at, created_at)
    const { data, error } = await fastify.supabase
      .from('operational_incidents')
      .select('status, severity, incident_type, sla_breached, resolved_at, created_at')
      .eq('tenant_id', tenantId)

    if (error) {
      req.log.error({ err: error }, 'incidents summary query failed')
      return reply.code(500).send({ error: 'QUERY_FAILED', message: 'Failed to fetch incident summary' })
    }

    const rows = data ?? []

    // Count by status
    const by_status: Record<string, number> = {}
    // Count by severity
    const by_severity: Record<string, number> = {}
    // Count by incident_type
    const by_type: Record<string, number> = {}
    let open_count        = 0
    let sla_breached_count = 0
    let total_resolution_hours = 0
    let resolved_count    = 0

    for (const r of rows) {
      // by_status
      by_status[r.status] = (by_status[r.status] ?? 0) + 1

      // by_severity
      by_severity[r.severity] = (by_severity[r.severity] ?? 0) + 1

      // by_type
      if (r.incident_type) {
        by_type[r.incident_type] = (by_type[r.incident_type] ?? 0) + 1
      }

      // open count: any non-terminal status
      if (!['resolved', 'closed'].includes(r.status)) {
        open_count++
      }

      // sla_breached
      if (r.sla_breached) {
        sla_breached_count++
      }

      // avg resolution hours
      if (r.status === 'resolved' && r.resolved_at && r.created_at) {
        const diffMs = new Date(r.resolved_at).getTime() - new Date(r.created_at).getTime()
        total_resolution_hours += diffMs / (1000 * 60 * 60)
        resolved_count++
      }
    }

    const avg_resolution_hours =
      resolved_count > 0
        ? parseFloat((total_resolution_hours / resolved_count).toFixed(2))
        : null

    return reply.send({
      by_status,
      by_severity,
      by_type,
      open_count,
      sla_breached_count,
      avg_resolution_hours,
    })
  })

  // ── GET /system/incidents/:id ─────────────────────────────────────────────
  fastify.get('/system/incidents/:id', auth, async (req: any, reply) => {
    const { id } = req.params as { id: string }

    // Fetch incident
    const { data: incident, error: incidentError } = await fastify.supabase
      .from('operational_incidents')
      .select(
        `
        id, incident_type, severity, status, title, description,
        payroll_impact_amount, affected_employee_count,
        sla_target_hours, sla_breached, tags, metadata,
        created_at, updated_at, resolved_at,
        employee_id, department_id, assigned_to,
        related_entity_type, related_entity_id,
        resolved_by, created_by,
        employees(id, first_name, last_name, employee_code),
        profiles!operational_incidents_assigned_to_fkey(id, full_name)
        `,
      )
      .eq('id', id)
      .eq('tenant_id', req.tenantId)
      .single()

    if (incidentError || !incident) {
      return reply.code(404).send({ error: 'NOT_FOUND', message: 'Incident not found' })
    }

    // Fetch timeline events
    const { data: timelineRaw, error: timelineError } = await fastify.supabase
      .from('incident_timeline_events')
      .select(
        `
        id, event_type, description, metadata, created_at, actor_id,
        profiles(id, full_name)
        `,
      )
      .eq('incident_id', id)
      .eq('tenant_id', req.tenantId)
      .order('created_at', { ascending: true })

    if (timelineError) {
      req.log.error({ err: timelineError }, 'incident timeline query failed')
      return reply.code(500).send({ error: 'QUERY_FAILED', message: 'Failed to fetch timeline' })
    }

    // Fetch escalations
    const { data: escalationsRaw, error: escalationsError } = await fastify.supabase
      .from('incident_escalations')
      .select(
        `
        id, reason, created_at, escalated_by, escalated_to,
        profiles!incident_escalations_escalated_to_fkey(id, full_name)
        `,
      )
      .eq('incident_id', id)
      .eq('tenant_id', req.tenantId)
      .order('created_at', { ascending: true })

    if (escalationsError) {
      req.log.error({ err: escalationsError }, 'incident escalations query failed')
      return reply.code(500).send({ error: 'QUERY_FAILED', message: 'Failed to fetch escalations' })
    }

    // Fetch comments
    const { data: commentsRaw, error: commentsError } = await fastify.supabase
      .from('incident_comments')
      .select(
        `
        id, content, is_internal, created_at, author_id,
        profiles(id, full_name)
        `,
      )
      .eq('incident_id', id)
      .eq('tenant_id', req.tenantId)
      .order('created_at', { ascending: true })

    if (commentsError) {
      req.log.error({ err: commentsError }, 'incident comments query failed')
      return reply.code(500).send({ error: 'QUERY_FAILED', message: 'Failed to fetch comments' })
    }

    const incidentData = {
      id:                     (incident as any).id,
      incident_type:          (incident as any).incident_type,
      severity:               (incident as any).severity,
      status:                 (incident as any).status,
      title:                  (incident as any).title,
      description:            (incident as any).description,
      payroll_impact_amount:  (incident as any).payroll_impact_amount,
      affected_employee_count: (incident as any).affected_employee_count,
      sla_target_hours:       (incident as any).sla_target_hours,
      sla_breached:           (incident as any).sla_breached,
      tags:                   (incident as any).tags,
      metadata:               (incident as any).metadata,
      created_at:             (incident as any).created_at,
      updated_at:             (incident as any).updated_at,
      resolved_at:            (incident as any).resolved_at,
      employee_id:            (incident as any).employee_id,
      department_id:          (incident as any).department_id,
      assigned_to:            (incident as any).assigned_to,
      related_entity_type:    (incident as any).related_entity_type,
      related_entity_id:      (incident as any).related_entity_id,
      resolved_by:            (incident as any).resolved_by,
      created_by:             (incident as any).created_by,
      employee_name:          (incident as any).employees
        ? `${(incident as any).employees.first_name} ${(incident as any).employees.last_name}`
        : null,
      employee_code:          (incident as any).employees?.employee_code ?? null,
      assigned_to_name:       (incident as any).profiles?.full_name ?? null,
    }

    const timeline = (timelineRaw ?? []).map((t: any) => ({
      id:          t.id,
      event_type:  t.event_type,
      description: t.description,
      metadata:    t.metadata,
      created_at:  t.created_at,
      actor_id:    t.actor_id,
      actor_name:  t.profiles?.full_name ?? null,
    }))

    const escalations = (escalationsRaw ?? []).map((e: any) => ({
      id:              e.id,
      reason:          e.reason,
      created_at:      e.created_at,
      escalated_by:    e.escalated_by,
      escalated_to:    e.escalated_to,
      escalated_to_name: e.profiles?.full_name ?? null,
    }))

    const comments = (commentsRaw ?? []).map((c: any) => ({
      id:          c.id,
      content:     c.content,
      is_internal: c.is_internal,
      created_at:  c.created_at,
      author_id:   c.author_id,
      author_name: c.profiles?.full_name ?? null,
    }))

    return reply.send({ data: incidentData, timeline, escalations, comments })
  })

  // ── POST /system/incidents ────────────────────────────────────────────────
  fastify.post('/system/incidents', auth, async (req: any, reply) => {
    if (!isAdmin(req.userRole)) {
      return reply.code(403).send({ error: 'FORBIDDEN', message: 'HR admin access required' })
    }

    const parsed = createBodySchema.safeParse(req.body)
    if (!parsed.success) {
      return reply.code(400).send({
        error:   'VALIDATION_ERROR',
        message: parsed.error.issues[0]?.message,
      })
    }

    const body = parsed.data

    const { data: incident, error: insertError } = await fastify.supabase
      .from('operational_incidents')
      .insert({
        tenant_id:              req.tenantId,
        created_by:             req.userId,
        status:                 'open',
        incident_type:          body.incident_type,
        severity:               body.severity,
        title:                  body.title,
        description:            body.description,
        employee_id:            body.employee_id            ?? null,
        department_id:          body.department_id          ?? null,
        related_entity_type:    body.related_entity_type    ?? null,
        related_entity_id:      body.related_entity_id      ?? null,
        payroll_impact_amount:  body.payroll_impact_amount  ?? null,
        affected_employee_count: body.affected_employee_count ?? null,
        sla_target_hours:       body.sla_target_hours       ?? null,
        tags:                   body.tags                   ?? null,
        metadata:               body.metadata               ?? null,
        sla_breached:           false,
        created_at:             new Date().toISOString(),
        updated_at:             new Date().toISOString(),
      })
      .select()
      .single()

    if (insertError || !incident) {
      req.log.error({ err: insertError }, 'incident insert failed')
      return reply.code(500).send({ error: 'INSERT_FAILED', message: 'Failed to create incident' })
    }

    const timelineErr = await addTimelineEvent(
      fastify,
      (incident as any).id,
      req.tenantId,
      req.userId,
      'created',
      `Incident created with severity "${body.severity}"`,
      { title: body.title, incident_type: body.incident_type },
    )

    if (timelineErr) {
      req.log.warn({ err: timelineErr }, 'failed to insert creation timeline event')
    }

    return reply.code(201).send({ data: incident })
  })

  // ── PUT /system/incidents/:id ─────────────────────────────────────────────
  fastify.put('/system/incidents/:id', auth, async (req: any, reply) => {
    if (!isAdmin(req.userRole)) {
      return reply.code(403).send({ error: 'FORBIDDEN', message: 'HR admin access required' })
    }

    const { id } = req.params as { id: string }

    const parsed = updateBodySchema.safeParse(req.body)
    if (!parsed.success) {
      return reply.code(400).send({
        error:   'VALIDATION_ERROR',
        message: parsed.error.issues[0]?.message,
      })
    }

    const body = parsed.data

    // Fetch existing incident to detect changes
    const { data: existing, error: fetchError } = await fastify.supabase
      .from('operational_incidents')
      .select('id, status, severity, assigned_to')
      .eq('id', id)
      .eq('tenant_id', req.tenantId)
      .single()

    if (fetchError || !existing) {
      return reply.code(404).send({ error: 'NOT_FOUND', message: 'Incident not found' })
    }

    const updatePayload: Record<string, unknown> = { updated_at: new Date().toISOString() }
    if (body.status                !== undefined) updatePayload.status                = body.status
    if (body.severity              !== undefined) updatePayload.severity              = body.severity
    if (body.assigned_to           !== undefined) updatePayload.assigned_to           = body.assigned_to
    if (body.resolution_note       !== undefined) updatePayload.resolution_note       = body.resolution_note
    if (body.payroll_impact_amount !== undefined) updatePayload.payroll_impact_amount = body.payroll_impact_amount

    const { data: updated, error: updateError } = await fastify.supabase
      .from('operational_incidents')
      .update(updatePayload)
      .eq('id', id)
      .eq('tenant_id', req.tenantId)
      .select()
      .single()

    if (updateError || !updated) {
      req.log.error({ err: updateError }, 'incident update failed')
      return reply.code(500).send({ error: 'UPDATE_FAILED', message: 'Failed to update incident' })
    }

    // Add timeline events for each meaningful change
    const timelinePromises: Promise<any>[] = []

    if (body.status !== undefined && body.status !== (existing as any).status) {
      timelinePromises.push(
        addTimelineEvent(
          fastify, id, req.tenantId, req.userId,
          'status_changed',
          `Status changed from "${(existing as any).status}" to "${body.status}"`,
          { from: (existing as any).status, to: body.status },
        ),
      )
    }

    if (body.severity !== undefined && body.severity !== (existing as any).severity) {
      timelinePromises.push(
        addTimelineEvent(
          fastify, id, req.tenantId, req.userId,
          'severity_changed',
          `Severity changed from "${(existing as any).severity}" to "${body.severity}"`,
          { from: (existing as any).severity, to: body.severity },
        ),
      )
    }

    if (body.assigned_to !== undefined && body.assigned_to !== (existing as any).assigned_to) {
      timelinePromises.push(
        addTimelineEvent(
          fastify, id, req.tenantId, req.userId,
          'assigned',
          `Incident assigned to new owner`,
          { assigned_to: body.assigned_to },
        ),
      )
    }

    const timelineResults = await Promise.all(timelinePromises)
    for (const err of timelineResults) {
      if (err) req.log.warn({ err }, 'failed to insert timeline event during update')
    }

    return reply.send({ data: updated })
  })

  // ── POST /system/incidents/:id/escalate ───────────────────────────────────
  fastify.post('/system/incidents/:id/escalate', auth, async (req: any, reply) => {
    if (!isAdmin(req.userRole)) {
      return reply.code(403).send({ error: 'FORBIDDEN', message: 'HR admin access required' })
    }

    const { id } = req.params as { id: string }

    const parsed = escalateBodySchema.safeParse(req.body)
    if (!parsed.success) {
      return reply.code(400).send({
        error:   'VALIDATION_ERROR',
        message: parsed.error.issues[0]?.message,
      })
    }

    const { escalate_to, reason } = parsed.data

    // Verify incident exists and belongs to tenant
    const { data: existing, error: fetchError } = await fastify.supabase
      .from('operational_incidents')
      .select('id, status')
      .eq('id', id)
      .eq('tenant_id', req.tenantId)
      .single()

    if (fetchError || !existing) {
      return reply.code(404).send({ error: 'NOT_FOUND', message: 'Incident not found' })
    }

    // Insert escalation record
    const { data: escalation, error: escalationError } = await fastify.supabase
      .from('incident_escalations')
      .insert({
        incident_id:  id,
        tenant_id:    req.tenantId,
        escalated_by: req.userId,
        escalated_to: escalate_to,
        reason,
        created_at:   new Date().toISOString(),
      })
      .select()
      .single()

    if (escalationError || !escalation) {
      req.log.error({ err: escalationError }, 'incident escalation insert failed')
      return reply.code(500).send({ error: 'INSERT_FAILED', message: 'Failed to create escalation' })
    }

    // Update incident status to escalated
    const { error: updateError } = await fastify.supabase
      .from('operational_incidents')
      .update({ status: 'escalated', updated_at: new Date().toISOString() })
      .eq('id', id)
      .eq('tenant_id', req.tenantId)

    if (updateError) {
      req.log.error({ err: updateError }, 'incident status update to escalated failed')
      return reply.code(500).send({ error: 'UPDATE_FAILED', message: 'Failed to update incident status' })
    }

    const timelineErr = await addTimelineEvent(
      fastify, id, req.tenantId, req.userId,
      'escalated',
      `Incident escalated: ${reason}`,
      { escalate_to, reason, escalation_id: (escalation as any).id },
    )

    if (timelineErr) {
      req.log.warn({ err: timelineErr }, 'failed to insert escalation timeline event')
    }

    return reply.code(201).send({ data: escalation })
  })

  // ── POST /system/incidents/:id/resolve ────────────────────────────────────
  fastify.post('/system/incidents/:id/resolve', auth, async (req: any, reply) => {
    if (!isAdmin(req.userRole)) {
      return reply.code(403).send({ error: 'FORBIDDEN', message: 'HR admin access required' })
    }

    const { id } = req.params as { id: string }

    const parsed = resolveBodySchema.safeParse(req.body)
    if (!parsed.success) {
      return reply.code(400).send({
        error:   'VALIDATION_ERROR',
        message: parsed.error.issues[0]?.message,
      })
    }

    const { resolution_note } = parsed.data

    // Verify incident exists
    const { data: existing, error: fetchError } = await fastify.supabase
      .from('operational_incidents')
      .select('id, status')
      .eq('id', id)
      .eq('tenant_id', req.tenantId)
      .single()

    if (fetchError || !existing) {
      return reply.code(404).send({ error: 'NOT_FOUND', message: 'Incident not found' })
    }

    if ((existing as any).status === 'resolved') {
      return reply.code(409).send({ error: 'ALREADY_RESOLVED', message: 'Incident is already resolved' })
    }

    const resolvedAt = new Date().toISOString()

    const { data: updated, error: updateError } = await fastify.supabase
      .from('operational_incidents')
      .update({
        status:          'resolved',
        resolved_by:     req.userId,
        resolved_at:     resolvedAt,
        resolution_note,
        updated_at:      resolvedAt,
      })
      .eq('id', id)
      .eq('tenant_id', req.tenantId)
      .select()
      .single()

    if (updateError || !updated) {
      req.log.error({ err: updateError }, 'incident resolve update failed')
      return reply.code(500).send({ error: 'UPDATE_FAILED', message: 'Failed to resolve incident' })
    }

    const timelineErr = await addTimelineEvent(
      fastify, id, req.tenantId, req.userId,
      'resolved',
      `Incident resolved: ${resolution_note}`,
      { resolution_note },
    )

    if (timelineErr) {
      req.log.warn({ err: timelineErr }, 'failed to insert resolution timeline event')
    }

    return reply.send({ data: updated })
  })

  // ── POST /system/incidents/:id/comments ───────────────────────────────────
  fastify.post('/system/incidents/:id/comments', auth, async (req: any, reply) => {
    // Incident management is an admin console — match the rest of this file.
    if (!isAdmin(req.userRole)) {
      return reply.code(403).send({ error: 'FORBIDDEN', message: 'Admin access required' })
    }
    const { id } = req.params as { id: string }

    const parsed = commentBodySchema.safeParse(req.body)
    if (!parsed.success) {
      return reply.code(400).send({
        error:   'VALIDATION_ERROR',
        message: parsed.error.issues[0]?.message,
      })
    }

    const { content, is_internal } = parsed.data

    // Verify incident exists and belongs to tenant
    const { data: existing, error: fetchError } = await fastify.supabase
      .from('operational_incidents')
      .select('id')
      .eq('id', id)
      .eq('tenant_id', req.tenantId)
      .single()

    if (fetchError || !existing) {
      return reply.code(404).send({ error: 'NOT_FOUND', message: 'Incident not found' })
    }

    const { data: comment, error: insertError } = await fastify.supabase
      .from('incident_comments')
      .insert({
        incident_id:  id,
        tenant_id:    req.tenantId,
        author_id:    req.userId,
        content,
        is_internal:  is_internal ?? false,
        created_at:   new Date().toISOString(),
      })
      .select()
      .single()

    if (insertError || !comment) {
      req.log.error({ err: insertError }, 'incident comment insert failed')
      return reply.code(500).send({ error: 'INSERT_FAILED', message: 'Failed to add comment' })
    }

    const timelineErr = await addTimelineEvent(
      fastify, id, req.tenantId, req.userId,
      'comment_added',
      is_internal ? 'Internal comment added' : 'Comment added',
      { comment_id: (comment as any).id, is_internal: is_internal ?? false },
    )

    if (timelineErr) {
      req.log.warn({ err: timelineErr }, 'failed to insert comment_added timeline event')
    }

    return reply.code(201).send({ data: comment })
  })
}
