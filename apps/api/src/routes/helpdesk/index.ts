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
import { logAction } from '../../lib/audit-service.js'
import { resolveAssistantChain } from '../../lib/ai/config.js'
import { chatCompleteWithFallback } from '../../lib/ai/llm.js'

// Default SLA windows by priority (used when no tenant policy row exists).
// Response = time to first HR reply; Resolution = time to resolve/close.
const SLA_HOURS: Record<string, number> = { urgent: 4, high: 8, medium: 24, low: 48 }
const RESOLUTION_HOURS: Record<string, number> = { urgent: 24, high: 48, medium: 72, low: 120 }

// ── AI keyword-based category detection ──────────────────────────────────────
function detectCategory(text: string, currentCategory: string): { category: string; confidence: number } {
  const t = text.toLowerCase()
  const rules: [string[], number][] = [
    [['salary', 'payslip', 'pay', 'deduction', 'pf', 'esic', 'tds', 'tax', 'bonus', 'incentive', 'arrear'], 90],
    [['leave', 'absence', 'holiday', 'attendance', 'lop', 'comp off', 'overtime', 'shift'], 85],
    [['laptop', 'computer', 'system', 'software', 'access', 'login', 'password', 'email', 'network', 'printer', 'hardware', 'vpn'], 85],
    [['offer letter', 'form 16', 'experience letter', 'noc', 'relieving', 'certificate', 'document'], 80],
    [['harassment', 'grievance', 'complaint', 'unfair', 'bully', 'discrimination', 'posh'], 90],
  ]
  const categoryMap: Record<number, string> = { 0: 'payroll', 1: 'hr_query', 2: 'it_support', 3: 'hr_query', 4: 'grievance' }
  for (let i = 0; i < rules.length; i++) {
    const [keywords, conf] = rules[i]
    if (keywords.some(k => t.includes(k))) {
      return { category: categoryMap[i], confidence: conf }
    }
  }
  return { category: currentCategory, confidence: 30 }
}

const CATEGORIES = ['payroll', 'leave', 'attendance', 'it', 'facilities', 'hr_policy', 'other'] as const
const PRIORITIES = ['low', 'medium', 'high', 'urgent'] as const
const STATUSES   = ['open', 'in_progress', 'awaiting_employee', 'resolved', 'closed'] as const

/**
 * Resolve the response + resolution SLA windows (hours) for a priority.
 * Prefers the tenant's configured helpdesk_sla_policies row; falls back to the
 * built-in defaults (and degrades gracefully if the table doesn't exist yet).
 */
async function resolveSla(
  fastify: any, tenantId: string, priority: string,
): Promise<{ response_hours: number; resolution_hours: number }> {
  const fallback = {
    response_hours:   SLA_HOURS[priority] ?? 24,
    resolution_hours: RESOLUTION_HOURS[priority] ?? 72,
  }
  try {
    const { data, error } = await fastify.supabase
      .from('helpdesk_sla_policies')
      .select('response_hours, resolution_hours')
      .eq('tenant_id', tenantId)
      .eq('priority', priority)
      .maybeSingle()
    if (error || !data) return fallback
    return {
      response_hours:   Number((data as any).response_hours)   || fallback.response_hours,
      resolution_hours: Number((data as any).resolution_hours) || fallback.resolution_hours,
    }
  } catch {
    return fallback
  }
}

/**
 * Resolve SLA windows for a category from helpdesk_category_sla.
 * Returns null when no category SLA row exists so caller can fall back to priority SLA.
 */
async function resolveCategorySla(
  fastify: any, tenantId: string, category: string,
): Promise<{ response_hours: number; resolution_hours: number } | null> {
  try {
    const { data, error } = await fastify.supabase
      .from('helpdesk_category_sla')
      .select('response_hours, resolution_hours')
      .eq('tenant_id', tenantId)
      .eq('category', category)
      .maybeSingle()
    if (error || !data) return null
    return {
      response_hours:   Number((data as any).response_hours),
      resolution_hours: Number((data as any).resolution_hours),
    }
  } catch {
    return null
  }
}

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

    // AI category detection
    const aiResult = detectCategory(
      `${parsed.data.subject} ${parsed.data.description}`,
      parsed.data.category,
    )
    // Override category if AI is confident and the user left it as default/general
    const effectiveCategory =
      aiResult.confidence >= 70 && (parsed.data.category === 'other' || parsed.data.category === 'general')
        ? aiResult.category
        : parsed.data.category

    // Prefer category-based SLA; fall back to priority SLA
    const categorySla = await resolveCategorySla(fastify, req.tenantId, effectiveCategory)
    const sla         = categorySla ?? await resolveSla(fastify, req.tenantId, parsed.data.priority)
    const now         = Date.now()
    const slaDueAt    = new Date(now + sla.response_hours   * 3_600_000).toISOString()
    const resDueAt    = new Date(now + sla.resolution_hours * 3_600_000).toISOString()

    const { data, error } = await fastify.supabase
      .from('helpdesk_tickets')
      .insert({
        tenant_id:              req.tenantId,
        subject:                parsed.data.subject,
        description:            parsed.data.description,
        category:               effectiveCategory,
        priority:               parsed.data.priority,
        status:                 'open',
        employee_id:            employeeId,
        created_by:             req.userId,
        sla_hours:              sla.response_hours,
        sla_due_at:             slaDueAt,
        resolution_due_at:      resDueAt,
        ai_suggested_category:  aiResult.category,
        ai_routing_confidence:  aiResult.confidence,
      })
      .select()
      .single()

    if (error) return reply.code(500).send({ error: 'INSERT_FAILED', message: error.message })

    await logAction(fastify.supabase, {
      tenantId:    req.tenantId,
      tableName:   'helpdesk_tickets',
      recordId:    (data as any).id,
      action:      'INSERT',
      performedBy: req.userId,
      onBehalfOf:  employeeId,
      newData:     { subject: parsed.data.subject, category: parsed.data.category, priority: parsed.data.priority, status: 'open' },
    })

    // Notify HR admins (best-effort)
    await notifyHrAdmins(fastify.supabase, {
      tenantId:     req.tenantId,
      senderId:     req.userId,
      item_type:    'general',
      title:        `New helpdesk ticket: ${parsed.data.subject}`,
      summary:      `A ${parsed.data.priority} priority ${effectiveCategory} ticket was raised. Response SLA ${sla.response_hours}h, resolution ${sla.resolution_hours}h.${aiResult.confidence >= 70 ? ` AI routing: ${aiResult.category} (${aiResult.confidence}%).` : ''}`,
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
      .select('status, sla_breached_at, resolution_breached_at')
      .eq('tenant_id', req.tenantId)

    if (error) return reply.code(500).send({ error: 'DB_ERROR', message: error.message })

    const rows = (data ?? []) as any[]
    const isLive = (r: any) => !['resolved', 'closed'].includes(r.status)
    const open = rows.filter(isLive).length
    const breached = rows.filter(r => r.sla_breached_at && isLive(r)).length
    const resolutionBreached = rows.filter(r => r.resolution_breached_at && isLive(r)).length
    const byStatus: Record<string, number> = {}
    for (const r of rows) byStatus[r.status] = (byStatus[r.status] ?? 0) + 1

    return reply.send({ data: { total: rows.length, open, breached, resolution_breached: resolutionBreached, by_status: byStatus } })
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

    await logAction(fastify.supabase, {
      tenantId:    req.tenantId,
      tableName:   'helpdesk_tickets',
      recordId:    id,
      action:      'UPDATE',
      performedBy: req.userId,
      newData:     { assigned_to: parsed.data.assigned_to },
    })

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

    await logAction(fastify.supabase, {
      tenantId:    req.tenantId,
      tableName:   'helpdesk_tickets',
      recordId:    id,
      action:      'UPDATE',
      performedBy: req.userId,
      onBehalfOf:  (ticket as any).employee_id ?? null,
      oldData:     { status: (ticket as any).status },
      newData:     { status: parsed.data.status, resolution_note: parsed.data.resolution_note ?? null },
    })

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

  // ── GET /helpdesk/sla-policies — current SLA windows per priority ─────────────
  // Returns one row per priority, merging any tenant overrides over the defaults
  // so the UI always shows all four priorities.
  fastify.get('/sla-policies', hrAdminAuth, async (req: any, reply) => {
    const { data } = await fastify.supabase
      .from('helpdesk_sla_policies')
      .select('priority, response_hours, resolution_hours, updated_at')
      .eq('tenant_id', req.tenantId)

    const overrides = new Map<string, any>(((data ?? []) as any[]).map(r => [r.priority, r]))
    const policies = PRIORITIES.map(p => ({
      priority:         p,
      response_hours:   overrides.get(p)?.response_hours   ?? SLA_HOURS[p],
      resolution_hours: overrides.get(p)?.resolution_hours ?? RESOLUTION_HOURS[p],
      is_custom:        overrides.has(p),
    }))
    return reply.send({ data: policies })
  })

  // ── PUT /helpdesk/sla-policies — configure SLA windows ───────────────────────
  // Upserts the per-priority response/resolution windows for this tenant.
  fastify.put('/sla-policies', hrAdminAuth, async (req: any, reply) => {
    const schema = z.object({
      policies: z.array(z.object({
        priority:         z.enum(PRIORITIES),
        response_hours:   z.number().int().min(1).max(720),
        resolution_hours: z.number().int().min(1).max(2160),
      })).min(1),
    })
    const parsed = schema.safeParse(req.body)
    if (!parsed.success) return reply.code(400).send({ error: 'VALIDATION_ERROR', message: parsed.error.issues[0]?.message })

    const rows = parsed.data.policies.map(p => ({
      tenant_id:        req.tenantId,
      priority:         p.priority,
      response_hours:   p.response_hours,
      resolution_hours: p.resolution_hours,
      updated_at:       new Date().toISOString(),
      updated_by:       req.userId,
    }))

    const { error } = await fastify.supabase
      .from('helpdesk_sla_policies')
      .upsert(rows, { onConflict: 'tenant_id,priority' })

    if (error) return reply.code(500).send({ error: 'UPDATE_FAILED', message: error.message })

    await logAction(fastify.supabase, {
      tenantId:    req.tenantId,
      tableName:   'helpdesk_sla_policies',
      recordId:    req.tenantId,
      action:      'UPDATE',
      performedBy: req.userId,
      newData:     { policies: parsed.data.policies },
    })

    return reply.send({ data: { updated: rows.length } })
  })

  // ── CSAT: employee submits satisfaction rating after resolution ─────────────
  // POST /helpdesk/tickets/:id/csat

  fastify.post('/tickets/:id/csat', auth, async (req: any, reply) => {
    const schema = z.object({
      rating:  z.number().int().min(1).max(5),
      comment: z.string().max(1000).optional(),
    })
    const parsed = schema.safeParse(req.body)
    if (!parsed.success) return reply.code(400).send({ error: 'VALIDATION_ERROR', message: parsed.error.issues[0]?.message })

    const employeeId = await resolveCallerEmployeeId(fastify, req.userId, req.tenantId)
    if (!employeeId) return reply.code(403).send({ error: 'PROFILE_NOT_LINKED' })

    const { data: ticket } = await fastify.supabase
      .from('helpdesk_tickets')
      .select('id, employee_id, status, csat_submitted_at')
      .eq('id', req.params.id)
      .eq('tenant_id', req.tenantId)
      .maybeSingle()

    if (!ticket) return reply.code(404).send({ error: 'NOT_FOUND' })
    if ((ticket as any).employee_id !== employeeId) return reply.code(403).send({ error: 'FORBIDDEN' })
    if (!['resolved', 'closed'].includes((ticket as any).status)) return reply.code(422).send({ error: 'NOT_RESOLVED', message: 'CSAT is only available after resolution' })
    if ((ticket as any).csat_submitted_at) return reply.code(409).send({ error: 'ALREADY_RATED', message: 'You already rated this ticket' })

    const { error } = await fastify.supabase
      .from('helpdesk_tickets')
      .update({ csat_rating: parsed.data.rating, csat_comment: parsed.data.comment ?? null, csat_submitted_at: new Date().toISOString() })
      .eq('id', req.params.id)
      .eq('tenant_id', req.tenantId)

    if (error) return reply.code(500).send({ error: 'UPDATE_FAILED', message: error.message })
    return reply.code(201).send({ success: true })
  })

  // ── AI Suggest: generate a suggested HR reply ──────────────────────────────
  // GET /helpdesk/tickets/:id/ai-suggest

  fastify.get('/tickets/:id/ai-suggest', hrAdminAuth, async (req: any, reply) => {
    const { data: ticket } = await fastify.supabase
      .from('helpdesk_tickets')
      .select(`
        id, subject, description, category, priority, status,
        comments:helpdesk_ticket_comments(author_role, body, is_internal, created_at)
      `)
      .eq('id', req.params.id)
      .eq('tenant_id', req.tenantId)
      .maybeSingle()

    if (!ticket) return reply.code(404).send({ error: 'NOT_FOUND' })

    const t = ticket as any
    const publicThread = (t.comments ?? [])
      .filter((c: any) => !c.is_internal)
      .sort((a: any, b: any) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime())
      .map((c: any) => `[${c.author_role.toUpperCase()}]: ${c.body}`)
      .join('\n\n')

    const systemPrompt = `You are a helpful HR assistant drafting a professional reply to an employee helpdesk ticket.
Be empathetic, concise, and action-oriented. Do not include greetings or signatures.
Category: ${t.category}. Priority: ${t.priority}.`

    const userPrompt = `Ticket subject: "${t.subject}"
Initial description: ${t.description}

Conversation so far:
${publicThread || '(No replies yet)'}

Write a helpful, professional HR reply to address the employee's concern:`

    try {
      const chain = await resolveAssistantChain(fastify.supabase, req.tenantId)
      if (chain.length === 0) return reply.code(503).send({ error: 'AI_NOT_CONFIGURED', message: 'AI assistant is not configured for this tenant' })

      const result = await chatCompleteWithFallback(chain, {
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user',   content: userPrompt },
        ],
        temperature: 0.4,
        maxTokens:   350,
      })

      return reply.send({ suggestion: result.content.content?.trim() ?? '' })
    } catch (e: any) {
      return reply.code(503).send({ error: 'AI_ERROR', message: e.message ?? 'AI request failed' })
    }
  })

  // ── Bulk status update ─────────────────────────────────────────────────────
  // POST /helpdesk/tickets/bulk-status

  fastify.post('/tickets/bulk-status', hrAdminAuth, async (req: any, reply) => {
    const schema = z.object({
      ticket_ids:      z.array(z.string().uuid()).min(1).max(50),
      status:          z.enum(STATUSES),
      resolution_note: z.string().max(5000).optional(),
    })
    const parsed = schema.safeParse(req.body)
    if (!parsed.success) return reply.code(400).send({ error: 'VALIDATION_ERROR', message: parsed.error.issues[0]?.message })

    const now  = new Date().toISOString()
    const patch: Record<string, any> = { status: parsed.data.status }
    if (parsed.data.resolution_note) patch.resolution_note = parsed.data.resolution_note
    if (parsed.data.status === 'resolved') patch.resolved_at = now
    if (parsed.data.status === 'closed')   patch.closed_at   = now

    const { data, error } = await fastify.supabase
      .from('helpdesk_tickets')
      .update(patch)
      .in('id', parsed.data.ticket_ids)
      .eq('tenant_id', req.tenantId)
      .select('id')

    if (error) return reply.code(500).send({ error: 'UPDATE_FAILED', message: error.message })

    await logAction(fastify.supabase, {
      tenantId:    req.tenantId,
      tableName:   'helpdesk_tickets',
      recordId:    req.tenantId,
      action:      'UPDATE',
      performedBy: req.userId,
      newData:     { bulk_status: parsed.data.status, ticket_ids: parsed.data.ticket_ids },
    })

    return reply.send({ data: { updated: (data ?? []).length } })
  })

  // ── Merge ticket into another ──────────────────────────────────────────────
  // POST /helpdesk/tickets/:id/merge

  fastify.post('/tickets/:id/merge', hrAdminAuth, async (req: any, reply) => {
    const schema = z.object({ merge_into: z.string().uuid() })
    const parsed = schema.safeParse(req.body)
    if (!parsed.success) return reply.code(400).send({ error: 'VALIDATION_ERROR', message: parsed.error.issues[0]?.message })
    if (parsed.data.merge_into === req.params.id) return reply.code(422).send({ error: 'SELF_MERGE' })

    const { data: target } = await fastify.supabase
      .from('helpdesk_tickets')
      .select('id, subject')
      .eq('id', parsed.data.merge_into)
      .eq('tenant_id', req.tenantId)
      .maybeSingle()

    if (!target) return reply.code(404).send({ error: 'TARGET_NOT_FOUND' })

    const { error } = await fastify.supabase
      .from('helpdesk_tickets')
      .update({ merged_into: parsed.data.merge_into, status: 'closed' })
      .eq('id', req.params.id)
      .eq('tenant_id', req.tenantId)

    if (error) return reply.code(500).send({ error: 'UPDATE_FAILED', message: error.message })

    // Add a system note on the target ticket
    await fastify.supabase.from('helpdesk_ticket_comments').insert({
      tenant_id:   req.tenantId,
      ticket_id:   parsed.data.merge_into,
      author_id:   req.userId,
      author_role: 'hr',
      body:        `Ticket #${req.params.id.slice(-6).toUpperCase()} was merged into this ticket.`,
      is_internal: true,
    })

    return reply.send({ success: true, merged_into: parsed.data.merge_into })
  })

  // ── CSAT stats for admin dashboard ────────────────────────────────────────
  // GET /helpdesk/stats/csat

  fastify.get('/stats/csat', hrAdminAuth, async (req: any, reply) => {
    const qs = z.object({ days: z.coerce.number().int().min(1).max(365).optional().default(30) }).safeParse(req.query)
    const days = qs.success ? qs.data.days : 30
    const since = new Date()
    since.setDate(since.getDate() - days)

    const { data } = await fastify.supabase
      .from('helpdesk_tickets')
      .select('csat_rating')
      .eq('tenant_id', req.tenantId)
      .not('csat_rating', 'is', null)
      .gte('csat_submitted_at', since.toISOString())

    const ratings = ((data ?? []) as { csat_rating: number }[]).map(r => r.csat_rating)
    const distribution: Record<number, number> = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 }
    for (const r of ratings) distribution[r] = (distribution[r] ?? 0) + 1

    const avg = ratings.length ? Math.round((ratings.reduce((s, r) => s + r, 0) / ratings.length) * 10) / 10 : null

    return reply.send({
      average:      avg,
      total:        ratings.length,
      distribution,
      period_days:  days,
    })
  })

  // ── POST /helpdesk/tickets/:id/rate — employee rates a resolved ticket ────────
  // (satisfaction rating 1-5 stars; separate from CSAT which uses csat_* columns)

  fastify.post('/tickets/:id/rate', auth, async (req: any, reply) => {
    const { id } = req.params as { id: string }
    const { rating, comment } = req.body as { rating: number; comment?: string }
    if (!rating || rating < 1 || rating > 5) return reply.status(400).send({ error: 'rating must be 1-5' })
    const tenantId = req.tenantId
    // Verify ticket belongs to this tenant and is resolved
    const { data: ticket } = await fastify.supabase
      .from('helpdesk_tickets')
      .select('id, status, employee_id')
      .eq('id', id)
      .eq('tenant_id', tenantId)
      .single()
    if (!ticket) return reply.status(404).send({ error: 'Ticket not found' })
    if ((ticket as any).status !== 'resolved') return reply.status(400).send({ error: 'Can only rate resolved tickets' })
    const { error } = await fastify.supabase
      .from('helpdesk_tickets')
      .update({
        satisfaction_rating:  Math.round(rating),
        satisfaction_comment: comment || null,
        satisfaction_rated_at: new Date().toISOString(),
      })
      .eq('id', id)
      .eq('tenant_id', tenantId)
    if (error) return reply.status(500).send({ error: error.message })
    return reply.send({ data: { rated: true } })
  })

  // ── GET /helpdesk/admin/satisfaction-report ───────────────────────────────────

  fastify.get('/admin/satisfaction-report', hrAdminAuth, async (req: any, reply) => {
    const { data: tickets } = await fastify.supabase
      .from('helpdesk_tickets')
      .select('satisfaction_rating, satisfaction_comment, category, resolved_at')
      .eq('tenant_id', req.tenantId)
      .not('satisfaction_rating', 'is', null)
      .order('satisfaction_rated_at', { ascending: false })

    const rows = (tickets ?? []) as { satisfaction_rating: number; satisfaction_comment: string | null; category: string; resolved_at: string | null }[]

    const ratings = rows.map(r => r.satisfaction_rating)
    const avg_rating = ratings.length
      ? Math.round((ratings.reduce((s, r) => s + r, 0) / ratings.length) * 10) / 10
      : null

    // Total resolved (all time)
    const { count: total_resolved } = await fastify.supabase
      .from('helpdesk_tickets')
      .select('id', { count: 'exact', head: true })
      .eq('tenant_id', req.tenantId)
      .eq('status', 'resolved')

    // By category
    const byCat: Record<string, { sum: number; count: number }> = {}
    for (const r of rows) {
      if (!byCat[r.category]) byCat[r.category] = { sum: 0, count: 0 }
      byCat[r.category].sum   += r.satisfaction_rating
      byCat[r.category].count += 1
    }
    const by_category = Object.entries(byCat).map(([category, { sum, count }]) => ({
      category,
      avg_rating: Math.round((sum / count) * 10) / 10,
      count,
    })).sort((a, b) => b.count - a.count)

    // Recent comments
    const recent_comments = rows
      .filter(r => r.satisfaction_comment)
      .slice(0, 20)
      .map(r => ({
        rating:      r.satisfaction_rating,
        comment:     r.satisfaction_comment,
        category:    r.category,
        resolved_at: r.resolved_at,
      }))

    return reply.send({
      data: {
        avg_rating,
        rated_count:     ratings.length,
        total_resolved:  total_resolved ?? 0,
        by_category,
        recent_comments,
      },
    })
  })

  // ── GET /helpdesk/admin/category-sla — list category SLA windows ─────────────

  fastify.get('/admin/category-sla', hrAdminAuth, async (req: any, reply) => {
    const { data, error } = await fastify.supabase
      .from('helpdesk_category_sla')
      .select('id, category, response_hours, resolution_hours, updated_at')
      .eq('tenant_id', req.tenantId)
      .order('category', { ascending: true })

    if (error) return reply.code(500).send({ error: 'DB_ERROR', message: error.message })
    return reply.send({ data: data ?? [] })
  })

  // ── PUT /helpdesk/admin/category-sla — upsert a category SLA window ──────────

  fastify.put('/admin/category-sla', hrAdminAuth, async (req: any, reply) => {
    const schema = z.object({
      category:         z.string().min(1).max(100),
      response_hours:   z.number().int().min(1).max(720),
      resolution_hours: z.number().int().min(1).max(2160),
    })
    const parsed = schema.safeParse(req.body)
    if (!parsed.success) return reply.code(400).send({ error: 'VALIDATION_ERROR', message: parsed.error.issues[0]?.message })

    const { error } = await fastify.supabase
      .from('helpdesk_category_sla')
      .upsert(
        {
          tenant_id:        req.tenantId,
          category:         parsed.data.category,
          response_hours:   parsed.data.response_hours,
          resolution_hours: parsed.data.resolution_hours,
          updated_at:       new Date().toISOString(),
        },
        { onConflict: 'tenant_id,category' },
      )

    if (error) return reply.code(500).send({ error: 'UPDATE_FAILED', message: error.message })

    await logAction(fastify.supabase, {
      tenantId:    req.tenantId,
      tableName:   'helpdesk_category_sla',
      recordId:    req.tenantId,
      action:      'UPDATE',
      performedBy: req.userId,
      newData:     parsed.data,
    })

    return reply.send({ data: { updated: true } })
  })
}
