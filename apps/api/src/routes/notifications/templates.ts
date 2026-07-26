/**
 * Notification Templates Routes
 * Channel configuration, template management, log viewing, and send endpoint.
 */

import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import {
  NOTIFICATION_CATEGORIES,
  NOTIFICATION_SEVERITIES,
  NOTIFICATION_CHANNELS,
  NOTIFICATION_VARIABLES,
  renderNotificationTemplate,
  resolveNotificationVariables,
  extractPlaceholders,
} from '../../lib/notification-catalog.js'
import { HR_ADMIN_ROLES } from '../../lib/rbac.js'

// SINGLE SOURCE OF TRUTH lives in lib/notification-catalog.ts — these aliases
// keep the zod enums in lockstep with the catalog (and the DB CHECK constraints).
const TEMPLATE_CATEGORIES = NOTIFICATION_CATEGORIES
const TEMPLATE_SEVERITIES = NOTIFICATION_SEVERITIES

export default async function notificationTemplatesRoutes(fastify: FastifyInstance) {
  const auth = { preHandler: [fastify.authenticate] }

  function requireHrAdmin(req: any, reply: any, done: () => void) {
    if (!(HR_ADMIN_ROLES as readonly string[]).includes(req.userRole)) {
      reply.code(403).send({ error: 'FORBIDDEN', message: 'HR admin access required' })
      return
    }
    done()
  }

  // ── GET /notifications/templates/meta ──────────────────────────────────────
  // Single source of truth for the template editor: categories, severities,
  // channels, and the variable catalog (for the placeholder picker).
  fastify.get('/meta', auth, async (_req: any, reply) => {
    return reply.send({
      data: {
        categories: NOTIFICATION_CATEGORIES,
        severities: NOTIFICATION_SEVERITIES,
        channels:   NOTIFICATION_CHANNELS,
        variables:  NOTIFICATION_VARIABLES,
      },
    })
  })


  // ── GET /notifications/templates/channels ──────────────────────────────────
  fastify.get('/channels', { preHandler: [fastify.authenticate, requireHrAdmin] }, async (req: any, reply) => {
    const { data, error } = await fastify.supabase
      .from('notification_channels')
      .select('*')
      .eq('tenant_id', req.tenantId)
      .order('channel_type', { ascending: true })

    if (error) return reply.code(500).send({ error: 'QUERY_FAILED', message: error.message })
    return reply.send({ data: data ?? [] })
  })

  // ── PUT /notifications/templates/channels/:channelType ─────────────────────
  fastify.put('/channels/:channelType', { preHandler: [fastify.authenticate, requireHrAdmin] }, async (req: any, reply) => {
    const { channelType } = req.params as { channelType: string }

    const schema = z.object({
      provider_name: z.string().optional(),
      is_active: z.boolean().optional(),
      config: z.record(z.unknown()).optional(),
    })

    const parsed = schema.safeParse(req.body)
    if (!parsed.success) {
      return reply.code(400).send({ error: 'VALIDATION_ERROR', message: parsed.error.issues[0]?.message })
    }

    const { data, error } = await fastify.supabase
      .from('notification_channels')
      .upsert({
        ...parsed.data,
        channel_type: channelType,
        tenant_id: req.tenantId,
        updated_at: new Date().toISOString(),
      }, { onConflict: 'tenant_id,channel_type' })
      .select()
      .single()

    if (error) return reply.code(500).send({ error: 'UPSERT_FAILED', message: error.message })
    return reply.send({ data })
  })

  // ── GET /notifications/templates ───────────────────────────────────────────
  fastify.get('/', auth, async (req: any, reply) => {
    const querySchema = z.object({
      category: z.string().optional(),
      is_active: z.enum(['true', 'false']).optional(),
    })

    const parsed = querySchema.safeParse(req.query)
    if (!parsed.success) {
      return reply.code(400).send({ error: 'VALIDATION_ERROR', message: parsed.error.issues[0]?.message })
    }

    let q = fastify.supabase
      .from('notification_templates')
      .select('*')
      .eq('tenant_id', req.tenantId)
      .order('template_code', { ascending: true })

    if (parsed.data.category) q = q.eq('category', parsed.data.category)
    if (parsed.data.is_active !== undefined) q = q.eq('is_active', parsed.data.is_active === 'true')

    const { data, error } = await q
    if (error) return reply.code(500).send({ error: 'QUERY_FAILED', message: error.message })
    return reply.send({ data: data ?? [] })
  })

  // ── POST /notifications/templates ──────────────────────────────────────────
  fastify.post('/', { preHandler: [fastify.authenticate, requireHrAdmin] }, async (req: any, reply) => {
    const schema = z.object({
      template_code: z.string().min(1).max(100),
      template_name: z.string().min(1).max(200),
      category: z.enum(TEMPLATE_CATEGORIES),
      severity: z.enum(TEMPLATE_SEVERITIES).optional(),
      subject: z.string().optional(),
      body_template: z.string().min(1),
      available_channels: z.array(z.string()).optional(),
      placeholders: z.array(z.string()).optional(),
      has_action_cta: z.boolean().optional(),
      cta_label: z.string().optional(),
      cta_route: z.string().optional(),
    })

    const parsed = schema.safeParse(req.body)
    if (!parsed.success) {
      return reply.code(400).send({ error: 'VALIDATION_ERROR', message: parsed.error.issues[0]?.message })
    }

    // Auto-derive placeholders from the actual subject/body so the column is a
    // true reflection of which catalog variables the template uses.
    const placeholders = extractPlaceholders(parsed.data.subject, parsed.data.body_template)

    const { data, error } = await fastify.supabase
      .from('notification_templates')
      .insert({ ...parsed.data, placeholders, tenant_id: req.tenantId, is_active: true })
      .select()
      .single()

    if (error) {
      if (error.code === '23505') {
        return reply.code(409).send({ error: 'DUPLICATE_CODE', message: 'A template with this code already exists' })
      }
      return reply.code(500).send({ error: 'INSERT_FAILED', message: error.message })
    }

    return reply.code(201).send({ data })
  })

  // ── PUT /notifications/templates/:id ───────────────────────────────────────
  fastify.put('/:id', { preHandler: [fastify.authenticate, requireHrAdmin] }, async (req: any, reply) => {
    const { id } = req.params as { id: string }

    const schema = z.object({
      template_code: z.string().min(1).max(100).optional(),
      template_name: z.string().min(1).max(200).optional(),
      category: z.enum(TEMPLATE_CATEGORIES).optional(),
      severity: z.enum(TEMPLATE_SEVERITIES).optional(),
      subject: z.string().optional(),
      body_template: z.string().optional(),
      available_channels: z.array(z.string()).optional(),
      placeholders: z.array(z.string()).optional(),
      has_action_cta: z.boolean().optional(),
      cta_label: z.string().optional(),
      cta_route: z.string().optional(),
      is_active: z.boolean().optional(),
    })

    const parsed = schema.safeParse(req.body)
    if (!parsed.success) {
      return reply.code(400).send({ error: 'VALIDATION_ERROR', message: parsed.error.issues[0]?.message })
    }

    // Re-derive placeholders whenever subject or body is edited.
    const updatePayload: Record<string, unknown> = { ...parsed.data, updated_at: new Date().toISOString() }
    if (parsed.data.subject !== undefined || parsed.data.body_template !== undefined) {
      updatePayload.placeholders = extractPlaceholders(parsed.data.subject, parsed.data.body_template)
    }

    const { data, error } = await fastify.supabase
      .from('notification_templates')
      .update(updatePayload)
      .eq('id', id)
      .eq('tenant_id', req.tenantId)
      .select()
      .single()

    if (error) return reply.code(500).send({ error: 'UPDATE_FAILED', message: error.message })
    if (!data) return reply.code(404).send({ error: 'NOT_FOUND', message: 'Template not found' })

    return reply.send({ data })
  })

  // ── GET /notifications/templates/log ───────────────────────────────────────
  fastify.get('/log', { preHandler: [fastify.authenticate, requireHrAdmin] }, async (req: any, reply) => {
    const querySchema = z.object({
      recipient_employee_id: z.string().uuid().optional(),
      status: z.string().optional(),
      from: z.string().optional(),
      to: z.string().optional(),
    })

    const parsed = querySchema.safeParse(req.query)
    if (!parsed.success) {
      return reply.code(400).send({ error: 'VALIDATION_ERROR', message: parsed.error.issues[0]?.message })
    }

    let q = fastify.supabase
      .from('notification_log')
      .select('*')
      .eq('tenant_id', req.tenantId)
      .order('created_at', { ascending: false })
      .limit(100)

    if (parsed.data.recipient_employee_id) q = q.eq('recipient_employee_id', parsed.data.recipient_employee_id)
    if (parsed.data.status) q = q.eq('status', parsed.data.status)
    if (parsed.data.from) q = q.gte('created_at', parsed.data.from)
    if (parsed.data.to) q = q.lte('created_at', parsed.data.to)

    const { data, error } = await q
    if (error) return reply.code(500).send({ error: 'QUERY_FAILED', message: error.message })
    return reply.send({ data: data ?? [] })
  })

  // ── POST /notifications/templates/send ─────────────────────────────────────
  fastify.post('/send', { preHandler: [fastify.authenticate, requireHrAdmin] }, async (req: any, reply) => {
    const schema = z.object({
      template_code: z.string().optional(),
      body: z.string().optional(),
      subject: z.string().optional(),
      recipient_employee_id: z.string().uuid().optional(),
      recipient_profile_id: z.string().uuid().optional(),
      channel: z.string().min(1),
      metadata: z.record(z.unknown()).optional(),
      correlation_id: z.string().optional(),
    })

    const parsed = schema.safeParse(req.body)
    if (!parsed.success) {
      return reply.code(400).send({ error: 'VALIDATION_ERROR', message: parsed.error.issues[0]?.message })
    }

    let body = parsed.data.body ?? ''
    let subject = parsed.data.subject ?? null
    let templateId: string | null = null

    // If template_code is provided, fetch the template
    if (parsed.data.template_code) {
      const { data: template, error: tmplErr } = await fastify.supabase
        .from('notification_templates')
        .select('id, body_template, subject')
        .eq('tenant_id', req.tenantId)
        .eq('template_code', parsed.data.template_code)
        .eq('is_active', true)
        .single()

      if (tmplErr || !template) {
        return reply.code(404).send({ error: 'TEMPLATE_NOT_FOUND', message: 'Notification template not found' })
      }

      templateId = (template as any).id
      body = (template as any).body_template
      subject = (template as any).subject ?? null
    }

    // Substitute {{variables}} using the catalog resolver. Event-specific values
    // (status, leave_type, …) can be passed in `metadata`; employee/company/date
    // are resolved from the recipient + tenant.
    const values = await resolveNotificationVariables(fastify.supabase, req.tenantId, {
      employeeId: parsed.data.recipient_employee_id ?? null,
      extra:      parsed.data.metadata ?? undefined,
    })
    body    = renderNotificationTemplate(body, values)
    subject = subject ? renderNotificationTemplate(subject, values) : subject

    const { data, error } = await fastify.supabase
      .from('notification_log')
      .insert({
        tenant_id: req.tenantId,
        template_id: templateId,
        body,
        subject,
        channel: parsed.data.channel,
        recipient_employee_id: parsed.data.recipient_employee_id ?? null,
        recipient_profile_id: parsed.data.recipient_profile_id ?? null,
        metadata: parsed.data.metadata ?? null,
        correlation_id: parsed.data.correlation_id ?? null,
        status: 'pending',
        created_at: new Date().toISOString(),
      })
      .select('id')
      .single()

    if (error) return reply.code(500).send({ error: 'INSERT_FAILED', message: error.message })

    return reply.code(201).send({ notification_id: (data as any).id })
  })
}
