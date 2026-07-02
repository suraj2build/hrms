/**
 * Notification Inbox Routes
 * Personal inbox management with read/action/dismiss/snooze/bulk operations,
 * plus escalation rules and escalation tracking.
 */

import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { HR_ADMIN_ROLES } from '../../lib/rbac.js'

const ITEM_TYPES = [
  'action_required',
  'info',
  'alert',
  'reminder',
  'approval_request',
  'system',
] as const

const INBOX_SEVERITIES = ['info', 'warning', 'error', 'success'] as const

const TRIGGER_TYPES = [
  'time_based',
  'event_based',
  'threshold_breach',
  'manual',
] as const

export default async function notificationInboxRoutes(fastify: FastifyInstance) {
  const auth = { preHandler: [fastify.authenticate] }

  function requireHrAdmin(req: any, reply: any, done: () => void) {
    if (!(HR_ADMIN_ROLES as readonly string[]).includes(req.userRole)) {
      reply.code(403).send({ error: 'FORBIDDEN', message: 'HR admin access required' })
      return
    }
    done()
  }

  // ── GET /notifications/inbox ──────────────────────────────────────────────────
  fastify.get('/', auth, async (req: any, reply) => {
    const querySchema = z.object({
      status:      z.string().optional(),
      item_type:   z.string().optional(),
      entity_type: z.string().optional(),
      limit:  z.coerce.number().int().min(1).max(200).default(50),
      offset: z.coerce.number().int().min(0).default(0),
    })

    const parsed = querySchema.safeParse(req.query)
    if (!parsed.success) {
      return reply.code(400).send({ error: 'VALIDATION_ERROR', message: parsed.error.issues[0]?.message })
    }

    const { status, item_type, entity_type, limit, offset } = parsed.data
    const now = new Date().toISOString()

    let q = fastify.supabase
      .from('inbox_items')
      .select('*', { count: 'exact' })
      .eq('recipient_id', req.userId)
      .eq('tenant_id', req.tenantId)
      .or(`snoozed_until.is.null,snoozed_until.lt.${now}`)
      .order('created_at', { ascending: false })
      .range(offset, offset + limit - 1)

    if (status)      q = q.eq('status', status)
    if (item_type)   q = q.eq('item_type', item_type)
    if (entity_type) q = q.eq('entity_type', entity_type)

    const { data, error, count } = await q
    if (error) return reply.code(500).send({ error: 'QUERY_FAILED', message: error.message })

    return reply.send({ data: data ?? [], total: count ?? 0 })
  })

  // ── GET /notifications/inbox/unread-count ─────────────────────────────────────
  fastify.get('/unread-count', auth, async (req: any, reply) => {
    const { count, error } = await fastify.supabase
      .from('inbox_items')
      .select('id', { count: 'exact', head: true })
      .eq('recipient_id', req.userId)
      .eq('tenant_id', req.tenantId)
      .eq('status', 'unread')

    if (error) return reply.code(500).send({ error: 'QUERY_FAILED', message: error.message })
    return reply.send({ count: count ?? 0 })
  })

  // ── POST /notifications/inbox ─────────────────────────────────────────────────
  fastify.post('/', { preHandler: [fastify.authenticate, requireHrAdmin] }, async (req: any, reply) => {
    const schema = z.object({
      recipient_id: z.string().uuid(),
      item_type: z.enum(ITEM_TYPES),
      title: z.string().min(1),
      summary: z.string().min(1),
      severity: z.enum(INBOX_SEVERITIES).optional(),
      entity_type: z.string().optional(),
      entity_id: z.string().uuid().optional(),
      action_route: z.string().optional(),
      action_label: z.string().optional(),
      expires_at: z.string().datetime().optional(),
      correlation_id: z.string().optional(),
      metadata: z.record(z.unknown()).optional(),
    })

    const parsed = schema.safeParse(req.body)
    if (!parsed.success) {
      return reply.code(400).send({ error: 'VALIDATION_ERROR', message: parsed.error.issues[0]?.message })
    }

    const { data, error } = await fastify.supabase
      .from('inbox_items')
      .insert({
        ...parsed.data,
        tenant_id: req.tenantId,
        sender_id: req.userId,
        status: 'unread',
      })
      .select()
      .single()

    if (error) return reply.code(500).send({ error: 'INSERT_FAILED', message: error.message })
    return reply.code(201).send({ data })
  })

  // ── POST /notifications/inbox/:id/read ───────────────────────────────────────
  fastify.post('/:id/read', auth, async (req: any, reply) => {
    const { id } = req.params as { id: string }
    const now = new Date().toISOString()

    const { error } = await fastify.supabase
      .from('inbox_items')
      .update({ status: 'read', read_at: now, updated_at: now })
      .eq('id', id)
      .eq('recipient_id', req.userId)
      .eq('tenant_id', req.tenantId)

    if (error) return reply.code(500).send({ error: 'UPDATE_FAILED', message: error.message })
    return reply.send({ message: 'Marked as read' })
  })

  // ── POST /notifications/inbox/:id/action ─────────────────────────────────────
  fastify.post('/:id/action', auth, async (req: any, reply) => {
    const { id } = req.params as { id: string }
    const now = new Date().toISOString()

    const { error } = await fastify.supabase
      .from('inbox_items')
      .update({ status: 'actioned', actioned_at: now, updated_at: now })
      .eq('id', id)
      .eq('recipient_id', req.userId)
      .eq('tenant_id', req.tenantId)

    if (error) return reply.code(500).send({ error: 'UPDATE_FAILED', message: error.message })
    return reply.send({ message: 'Actioned' })
  })

  // ── POST /notifications/inbox/:id/dismiss ────────────────────────────────────
  fastify.post('/:id/dismiss', auth, async (req: any, reply) => {
    const { id } = req.params as { id: string }
    const now = new Date().toISOString()

    const { error } = await fastify.supabase
      .from('inbox_items')
      .update({ status: 'dismissed', updated_at: now })
      .eq('id', id)
      .eq('recipient_id', req.userId)
      .eq('tenant_id', req.tenantId)

    if (error) return reply.code(500).send({ error: 'UPDATE_FAILED', message: error.message })
    return reply.send({ message: 'Dismissed' })
  })

  // ── POST /notifications/inbox/:id/snooze ─────────────────────────────────────
  fastify.post('/:id/snooze', auth, async (req: any, reply) => {
    const { id } = req.params as { id: string }

    const schema = z.object({
      snoozed_until: z.string().datetime(),
    })

    const parsed = schema.safeParse(req.body)
    if (!parsed.success) {
      return reply.code(400).send({ error: 'VALIDATION_ERROR', message: parsed.error.issues[0]?.message })
    }

    const now = new Date().toISOString()

    const { error } = await fastify.supabase
      .from('inbox_items')
      .update({
        status: 'snoozed',
        snoozed_until: parsed.data.snoozed_until,
        updated_at: now,
      })
      .eq('id', id)
      .eq('recipient_id', req.userId)
      .eq('tenant_id', req.tenantId)

    if (error) return reply.code(500).send({ error: 'UPDATE_FAILED', message: error.message })
    return reply.send({ message: 'Snoozed' })
  })

  // ── POST /notifications/inbox/bulk-read ──────────────────────────────────────
  fastify.post('/bulk-read', auth, async (req: any, reply) => {
    const now = new Date().toISOString()

    const { error, count } = await fastify.supabase
      .from('inbox_items')
      .update({ status: 'read', read_at: now, updated_at: now })
      .eq('recipient_id', req.userId)
      .eq('tenant_id', req.tenantId)
      .eq('status', 'unread')

    if (error) return reply.code(500).send({ error: 'UPDATE_FAILED', message: error.message })
    return reply.send({ updated_count: count ?? 0 })
  })

  // ── GET /notifications/inbox/escalation-rules ────────────────────────────────
  fastify.get('/escalation-rules', auth, async (req: any, reply) => {
    const { data, error } = await fastify.supabase
      .from('escalation_rules')
      .select('*')
      .eq('tenant_id', req.tenantId)

    if (error) return reply.code(500).send({ error: 'QUERY_FAILED', message: error.message })
    return reply.send({ data: data ?? [] })
  })

  // ── POST /notifications/inbox/escalation-rules ───────────────────────────────
  fastify.post('/escalation-rules', { preHandler: [fastify.authenticate, requireHrAdmin] }, async (req: any, reply) => {
    const schema = z.object({
      rule_name: z.string().min(1),
      trigger_type: z.enum(TRIGGER_TYPES),
      trigger_condition: z.record(z.unknown()).optional(),
      escalation_levels: z.array(z.unknown()).optional(),
      is_active: z.boolean().optional(),
    })

    const parsed = schema.safeParse(req.body)
    if (!parsed.success) {
      return reply.code(400).send({ error: 'VALIDATION_ERROR', message: parsed.error.issues[0]?.message })
    }

    const { data, error } = await fastify.supabase
      .from('escalation_rules')
      .insert({
        ...parsed.data,
        tenant_id: req.tenantId,
      })
      .select()
      .single()

    if (error) return reply.code(500).send({ error: 'INSERT_FAILED', message: error.message })
    return reply.code(201).send({ data })
  })

  // ── GET /notifications/inbox/escalations ─────────────────────────────────────
  fastify.get('/escalations', auth, async (req: any, reply) => {
    const querySchema = z.object({
      inbox_item_id: z.string().uuid().optional(),
    })

    const parsed = querySchema.safeParse(req.query)
    if (!parsed.success) {
      return reply.code(400).send({ error: 'VALIDATION_ERROR', message: parsed.error.issues[0]?.message })
    }

    let q = fastify.supabase
      .from('inbox_escalations')
      .select('*, inbox_items(id, title, item_type, status)')
      .eq('tenant_id', req.tenantId)

    if (parsed.data.inbox_item_id) q = q.eq('inbox_item_id', parsed.data.inbox_item_id)

    const { data, error } = await q
    if (error) return reply.code(500).send({ error: 'QUERY_FAILED', message: error.message })
    return reply.send({ data: data ?? [] })
  })
}
