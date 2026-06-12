/**
 * HR Helpdesk Ticketing — ESS-05
 *
 * Employee endpoints (/helpdesk/tickets/my, create, detail, comment) and HR-admin
 * endpoints (queue list, stats, assign, status update). Tickets carry an SLA
 * deadline derived from priority; the SLA scanner flags breaches.
 *
 * Registered at prefix '/helpdesk'.
 */

import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { requireRole, HR_ADMIN_ROLES } from '../../lib/rbac.js'
import { notify, notifyHrAdmins } from '../../lib/notify.js'

// SLA hours by priority — used to compute sla_due_at on creation.
const SLA_HOURS: Record<string, number> = { urgent: 4, high: 8, medium: 24, low: 48 }

const CATEGORIES = ['payroll', 'leave', 'attendance', 'it', 'facilities', 'hr_policy', 'other'] as const
const PRIORITIES = ['low', 'medium', 'high', 'urgent'] as const
const STATUSES   = ['open', 'in_progress', 'awaiting_employee', 'resolved', 'closed'] as const

async function resolveCallerEmployeeId(fastify: any, userId: string, tenantId: string): Promise<string | null> {
  const { data } = await fastify.supabase
    .from('profiles')
    .select('employee_id')
    .eq('id', userId)
    .eq('tenant_id', tenantId)
    .maybeSingle()
  return (data as any)?.employee_id ?? null
}

export default async function helpdeskRoutes(fastify: FastifyInstance) {
  const auth        = { preHandler: [fastify.authenticate] }
  const hrAdminAuth = { preHandler: [fastify.authenticate, requireRole(...HR_ADMIN_ROLES)] }

  // ═══════════════════════════════════════════════════════════════════════════
  // EMPLOYEE (ESS)
  // ═══════════════════════════════════════════════════════════════════════════

  // GET /helpdesk/tickets/my?status=open
  fastify.get('/tickets/my', auth, async (req: any, reply) => {
    const employeeId = await resolveCallerEmployeeId(fastify, req.userId, req.tenantId)
    if (!employeeId) return reply.code(403).send({ error: 'PROFILE_NOT_LINKED', message: 'Your profile is not linked to an employee record' })

    const qs = z.object({ status: z.string().optional() }).safeParse(req.query)

    let q = fastify.supabase
      .from('helpdesk_tickets')
      .select('*')
      .eq('tenant_id', req.tenantId)
      .eq('employee_id', employeeId)
      .order('created_at', { ascending: false })

    if (qs.data?.status && qs.data.status !== 'all') q = q.eq('status', qs.data.status)

    const { data, error } = await q
    if (error) return reply.code(500).send({ error: 'DB_ERROR', message: error.message })
    return reply.send({ data: data ?? [] })
  })

  // POST /helpdesk/tickets — employee creates a ticket
  fastify.post('/tickets', auth, async (req: any, reply) => {
    const employeeId = await resolveCallerEmployeeId(fastify, req.userId, req.tenantId)
    if (!employeeId) return reply.code(403).send({ error: 'PROFILE_NOT_LINKED', message: 'Your profile is not linked to an employee record' })

    const schema = z.object({
      subject:     z.string().min(3).max(200),
      description: z.string().min(5).max(5000),
      category:    z.enum(CATEGORIES).default('other'),
      priority:    z.enum(PRIORITIES).default('medium'),
    })
    const parsed = schema.safeParse(req.body)
    if (!parsed.success) return reply.code(400).send({ error: 'VALIDATION_ERROR', message: parsed.error.issues[0]?.message })

    const slaHours = SLA_HOURS[parsed.data.priority] ?? 24
    const slaDueAt = new Date(Date.now() + slaHours * 3_600_000).toISOString()

    const { data, error } = await fastify.supabase
      .from('helpdesk_tickets')
      .insert({
        tenant_id:   req.tenantId,
        subject:     parsed.data.subject,
        description: parsed.data.description,
        category:    parsed.data.category,
        priority:    parsed.data.priority,
        status:      'open',
        employee_id: employeeId,
        created_by:  req.userId,
        sla_hours:   slaHours,
        sla_due_at:  slaDueAt,
      })
      .select()
      .single()

    if (error) return reply.code(500).send({ error: 'INSERT_FAILED', message: error.message })

    // Notify HR admins (best-effort)
    await notifyHrAdmins(fastify.supabase, {
      tenantId:     req.tenantId,
      senderId:     req.userId,
      item_type:    'general',
      title:        `New helpdesk ticket: ${parsed.data.subject}`,
      summary:      `A ${parsed.data.priority} priority ${parsed.data.category} ticket was raised. SLA ${slaHours}h.`,
      severity:     parsed.data.priority === 'urgent' ? 'warning' : 'info',
      entity_type:  'helpdesk_ticket',
      entity_id:    (data as any).id,
      action_route: '/admin/helpdesk',
      action_label: 'Open helpdesk queue',
    })

    return reply.code(201).send({ data })
  })

  // GET /helpdesk/tickets/:id — detail + comments (owner or HR)
  fastify.get('/tickets/:id', auth, async (req: any, reply) => {
    const { id } = req.params as { id: string }
    const isHr = HR_ADMIN_ROLES.includes(req.userRole)

    const { data: ticket, error } = await fastify.supabase
      .from('helpdesk_tickets')
      .select('*')
      .eq('id', id)
      .eq('tenant_id', req.tenantId)
      .maybeSingle()

    if (error) return reply.code(500).send({ error: 'DB_ERROR', message: error.message })
    if (!ticket) return reply.code(404).send({ error: 'NOT_FOUND', message: 'Ticket not found' })

    if (!isHr) {
      const employeeId = await resolveCallerEmployeeId(fastify, req.userId, req.tenantId)
      if ((ticket as any).employee_id !== employeeId) {
        return reply.code(403).send({ error: 'FORBIDDEN', message: 'You can only view your own tickets' })
      }
    }

    // Comments — employees never see internal HR notes.
    let cq = fastify.supabase
      .from('helpdesk_ticket_comments')
      .select('id, author_id, author_role, body, is_internal, created_at')
      .eq('tenant_id', req.tenantId)
      .eq('ticket_id', id)
      .order('created_at', { ascending: true })

    if (!isHr) cq = cq.eq('is_internal', false)

    const { data: comments } = await cq

    return reply.send({ data: { ...ticket, comments: comments ?? [] } })
  })

  // POST /helpdesk/tickets/:id/comments — add a reply (employee owner or HR)
  fastify.post('/tickets/:id/comments', auth, async (req: any, reply) => {
    const { id } = req.params as { id: string }
    const isHr = HR_ADMIN_ROLES.includes(req.userRole)

    const schema = z.object({
      body:        z.string().min(1).max(5000),
      is_internal: z.boolean().optional(),
    })
    const parsed = schema.safeParse(req.body)
    if (!parsed.success) return reply.code(400).send({ error: 'VALIDATION_ERROR', message: parsed.error.issues[0]?.message })

    const { data: ticket } = await fastify.supabase
      .from('helpdesk_tickets')
      .select('id, employee_id, created_by, assigned_to, status, subject')
      .eq('id', id)
      .eq('tenant_id', req.tenantId)
      .maybeSingle()

    if (!ticket) return reply.code(404).send({ error: 'NOT_FOUND', message: 'Ticket not found' })

    const employeeId = isHr ? null : await resolveCallerEmployeeId(fastify, req.userId, req.tenantId)
    if (!isHr && (ticket as any).employee_id !== employeeId) {
      return reply.code(403).send({ error: 'FORBIDDEN', message: 'You can only comment on your own tickets' })
    }

    // Only HR may post internal notes.
    const isInternal = isHr ? (parsed.data.is_internal ?? false) : false

    const { data: comment, error } = await fastify.supabase
      .from('helpdesk_ticket_comments')
      .insert({
        tenant_id:   req.tenantId,
        ticket_id:   id,
        author_id:   req.userId,
        author_role: isHr ? 'hr' : 'employee',
        body:        parsed.data.body,
        is_internal: isInternal,
      })
      .select('id, author_id, author_role, body, is_internal, created_at')
      .single()

    if (error) return reply.code(500).send({ error: 'INSERT_FAILED', message: error.message })

    // Status transitions on reply + first-response capture (HR public reply).
    const patch: Record<string, any> = {}
    if (isHr && !isInternal) {
      patch.first_response_at = (ticket as any).first_response_at ?? new Date().toISOString()
      if ((ticket as any).status === 'open') patch.status = 'in_progress'
    }
    if (Object.keys(patch).length > 0) {
      await fastify.supabase.from('helpdesk_tickets').update(patch).eq('id', id).eq('tenant_id', req.tenantId)
    }

    // Notify the other party (skip for internal notes).
    if (!isInternal) {
      if (isHr) {
        // notify employee
        const { data: prof } = await fastify.supabase
          .from('profiles').select('id').eq('employee_id', (ticket as any).employee_id).eq('tenant_id', req.tenantId).maybeSingle()
        if ((prof as any)?.id) {
          await notify(fastify.supabase, {
            tenantId:     req.tenantId,
            recipientId:  (prof as any).id,
            senderId:     req.userId,
            item_type:    'general',
            title:        `HR replied to your ticket`,
            summary:      `"${(ticket as any).subject}" has a new reply from HR.`,
            severity:     'info',
            entity_type:  'helpdesk_ticket',
            entity_id:    id,
            action_route: '/ess/helpdesk',
            action_label: 'View ticket',
          })
        }
      } else if ((ticket as any).assigned_to) {
        await notify(fastify.supabase, {
          tenantId:     req.tenantId,
          recipientId:  (ticket as any).assigned_to,
          senderId:     req.userId,
          item_type:    'general',
          title:        `Employee replied to a ticket`,
          summary:      `"${(ticket as any).subject}" has a new reply.`,
          severity:     'info',
          entity_type:  'helpdesk_ticket',
          entity_id:    id,
          action_route: '/admin/helpdesk',
          action_label: 'Open ticket',
        })
      }
    }

    return reply.code(201).send({ data: comment })
  })

  // ═══════════════════════════════════════════════════════════════════════════
  // HR ADMIN
  // ═══════════════════════════════════════════════════════════════════════════

  // GET /helpdesk/tickets?status=&priority=&assigned_to=&mine=
  fastify.get('/tickets', hrAdminAuth, async (req: any, reply) => {
    const qs = z.object({
      status:      z.string().optional(),
      priority:    z.string().optional(),
      category:    z.string().optional(),
      assigned_to: z.string().optional(),
      mine:        z.string().optional(),
    }).safeParse(req.query)

    let q = fastify.supabase
      .from('helpdesk_tickets')
      .select('*, employees(first_name, last_name, employee_code)')
      .eq('tenant_id', req.tenantId)
      .order('created_at', { ascending: false })

    const f = qs.data ?? {}
    if (f.status && f.status !== 'all')     q = q.eq('status', f.status)
    if (f.priority && f.priority !== 'all') q = q.eq('priority', f.priority)
    if (f.category && f.category !== 'all') q = q.eq('category', f.category)
    if (f.mine === 'true')                  q = q.eq('assigned_to', req.userId)
    else if (f.assigned_to)                 q = q.eq('assigned_to', f.assigned_to)

    const { data, error } = await q
    if (error) return reply.code(500).send({ error: 'DB_ERROR', message: error.message })
    return reply.send({ data: data ?? [] })
  })

  // GET /helpdesk/stats — queue counts for the admin badge/header
  fastify.get('/stats', hrAdminAuth, async (req: any, reply) => {
    const { data, error } = await fastify.supabase
      .from('helpdesk_tickets')
      .select('status, sla_breached_at')
      .eq('tenant_id', req.tenantId)

    if (error) return reply.code(500).send({ error: 'DB_ERROR', message: error.message })

    const rows = (data ?? []) as any[]
    const open = rows.filter(r => !['resolved', 'closed'].includes(r.status)).length
    const breached = rows.filter(r => r.sla_breached_at && !['resolved', 'closed'].includes(r.status)).length
    const byStatus: Record<string, number> = {}
    for (const r of rows) byStatus[r.status] = (byStatus[r.status] ?? 0) + 1

    return reply.send({ data: { total: rows.length, open, breached, by_status: byStatus } })
  })

  // POST /helpdesk/tickets/:id/assign — assign to an HR agent
  fastify.post('/tickets/:id/assign', hrAdminAuth, async (req: any, reply) => {
    const { id } = req.params as { id: string }
    const schema = z.object({ assigned_to: z.string().uuid().nullable() })
    const parsed = schema.safeParse(req.body)
    if (!parsed.success) return reply.code(400).send({ error: 'VALIDATION_ERROR', message: parsed.error.issues[0]?.message })

    const { data, error } = await fastify.supabase
      .from('helpdesk_tickets')
      .update({ assigned_to: parsed.data.assigned_to })
      .eq('id', id)
      .eq('tenant_id', req.tenantId)
      .select()
      .single()

    if (error) return reply.code(500).send({ error: 'UPDATE_FAILED', message: error.message })

    // Notify the newly assigned agent.
    if (parsed.data.assigned_to) {
      await notify(fastify.supabase, {
        tenantId:     req.tenantId,
        recipientId:  parsed.data.assigned_to,
        senderId:     req.userId,
        item_type:    'general',
        title:        'A helpdesk ticket was assigned to you',
        summary:      `"${(data as any).subject}" is now assigned to you.`,
        severity:     'info',
        entity_type:  'helpdesk_ticket',
        entity_id:    id,
        action_route: '/admin/helpdesk',
        action_label: 'Open ticket',
      })
    }

    return reply.send({ data })
  })

  // POST /helpdesk/tickets/:id/status — update status / resolve with note
  fastify.post('/tickets/:id/status', hrAdminAuth, async (req: any, reply) => {
    const { id } = req.params as { id: string }
    const schema = z.object({
      status:          z.enum(STATUSES),
      resolution_note: z.string().max(5000).optional(),
    })
    const parsed = schema.safeParse(req.body)
    if (!parsed.success) return reply.code(400).send({ error: 'VALIDATION_ERROR', message: parsed.error.issues[0]?.message })

    const { data: ticket } = await fastify.supabase
      .from('helpdesk_tickets')
      .select('id, employee_id, subject, status')
      .eq('id', id)
      .eq('tenant_id', req.tenantId)
      .maybeSingle()
    if (!ticket) return reply.code(404).send({ error: 'NOT_FOUND', message: 'Ticket not found' })

    const now = new Date().toISOString()
    const patch: Record<string, any> = { status: parsed.data.status }
    if (parsed.data.resolution_note) patch.resolution_note = parsed.data.resolution_note
    if (parsed.data.status === 'resolved') patch.resolved_at = now
    if (parsed.data.status === 'closed')   patch.closed_at = now

    const { data, error } = await fastify.supabase
      .from('helpdesk_tickets')
      .update(patch)
      .eq('id', id)
      .eq('tenant_id', req.tenantId)
      .select()
      .single()

    if (error) return reply.code(500).send({ error: 'UPDATE_FAILED', message: error.message })

    // Notify the employee on resolution / status change.
    const { data: prof } = await fastify.supabase
      .from('profiles').select('id').eq('employee_id', (ticket as any).employee_id).eq('tenant_id', req.tenantId).maybeSingle()
    if ((prof as any)?.id) {
      const resolved = parsed.data.status === 'resolved' || parsed.data.status === 'closed'
      await notify(fastify.supabase, {
        tenantId:     req.tenantId,
        recipientId:  (prof as any).id,
        senderId:     req.userId,
        item_type:    'general',
        title:        resolved ? 'Your helpdesk ticket was resolved' : 'Your helpdesk ticket was updated',
        summary:      `"${(ticket as any).subject}" is now ${parsed.data.status.replace('_', ' ')}.`,
        severity:     'info',
        entity_type:  'helpdesk_ticket',
        entity_id:    id,
        action_route: '/ess/helpdesk',
        action_label: 'View ticket',
      })
    }

    return reply.send({ data })
  })

  // GET /helpdesk/agents — list HR profiles for the assignment dropdown
  fastify.get('/agents', hrAdminAuth, async (req: any, reply) => {
    const { data, error } = await fastify.supabase
      .from('profiles')
      .select('id, full_name, role')
      .eq('tenant_id', req.tenantId)
      .in('role', ['super_admin', 'hr_admin'])
      .order('full_name', { ascending: true })

    if (error) return reply.code(500).send({ error: 'DB_ERROR', message: error.message })
    return reply.send({ data: data ?? [] })
  })
}
