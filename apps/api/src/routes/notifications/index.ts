/**
 * Notifications API — R9 Minimal
 *
 * GET  /notifications              — list notifications for current user
 * GET  /notifications/count        — unread count (bell badge)
 * POST /notifications/:id/read     — mark one read
 * POST /notifications/mark-read    — mark specific IDs read
 * POST /notifications/read-all     — mark all read
 * DELETE /notifications/:id        — dismiss
 * GET  /notifications/channels     — channel list (static, for UI compatibility)
 * PUT  /notifications/channels/:id — stub (returns the value; no persistence needed yet)
 * GET  /notifications/digest/status — delivery audit log (DIGEST_SENT/DIGEST_FAILED)
 * POST /notifications/digest/run   — HR-admin: trigger a digest send immediately
 * POST /notifications/escalate     — mark items escalated
 * POST /notifications/notes        — add operational note
 */

import type { FastifyInstance } from 'fastify'
import { runDigestForTenant } from '../../lib/digest-scheduler.js'
import type { DigestFrequency } from '../../lib/digest-builder.js'
import { serverError, ErrorCode } from '../../lib/api-errors.js'

const DIGEST_FREQUENCIES: DigestFrequency[] = ['daily', 'weekly', 'monthly']

// Static channel list — in_app + email are the only active channels in R9-minimal.
// No persistence: the scheduler delivers to all HR admins unconditionally.
const CHANNEL_LIST = [
  { id: 'in_app',  channel_type: 'in_app',  is_enabled: true,  config: {} },
  { id: 'email',   channel_type: 'email',   is_enabled: true,  config: {} },
  { id: 'sms',     channel_type: 'sms',     is_enabled: false, config: {} },
  { id: 'push',    channel_type: 'push',    is_enabled: false, config: {} },
  { id: 'webhook', channel_type: 'webhook', is_enabled: false, config: {} },
]

export default async function notificationsRoutes(fastify: FastifyInstance) {
  const auth        = { preHandler: [fastify.authenticate] }
  const isHrAdmin   = (req: any) => req.userRole === 'super_admin' || req.userRole === 'hr_admin'

  // ── GET /notifications ─────────────────────────────────────────────────────
  fastify.get('/', auth, async (req: any, reply) => {
    const query   = req.query as Record<string, string>
    const limit   = Math.min(parseInt(query.limit  ?? '50', 10) || 50, 100)
    const offset  = Math.max(parseInt(query.offset ?? '0',  10) || 0,  0)

    const { data, error } = await fastify.supabase
      .from('notifications')
      .select('id, title, body, link, is_read, created_at, event_id')
      .eq('tenant_id', req.tenantId)
      .eq('recipient_id', req.userId)
      .order('created_at', { ascending: false })
      .range(offset, offset + limit - 1)

    if (error) {
      fastify.log.warn({ event: 'notifications.fetch_failed', err: error.message })
      return reply.send({ data: [], unread_count: 0, pagination: { offset, limit, returned: 0 } })
    }
    return reply.send({
      data:         data ?? [],
      unread_count: (data ?? []).filter((n: any) => !n.is_read).length,
      pagination:   { offset, limit, returned: (data ?? []).length },
    })
  })

  // ── GET /notifications/count ───────────────────────────────────────────────
  fastify.get('/count', auth, async (req: any, reply) => {
    const { count, error } = await fastify.supabase
      .from('notifications')
      .select('id', { count: 'exact', head: true })
      .eq('tenant_id', req.tenantId)
      .eq('recipient_id', req.userId)
      .eq('is_read', false)

    if (error) {
      fastify.log.warn({ event: 'notifications.count_failed', err: error.message })
      return reply.send({ unread_count: 0 })
    }
    return reply.send({ unread_count: count ?? 0 })
  })

  // ── POST /notifications/:id/read ───────────────────────────────────────────
  fastify.post('/:id/read', auth, async (req: any, reply) => {
    const { id } = req.params as { id: string }
    const { error } = await fastify.supabase
      .from('notifications')
      .update({ is_read: true, read_at: new Date().toISOString() })
      .eq('id', id)
      .eq('tenant_id', req.tenantId)
      .eq('recipient_id', req.userId)

    if (error) return reply.code(500).send({ error: 'UPDATE_FAILED', message: 'Failed to mark as read' })
    return reply.send({ success: true })
  })

  // ── POST /notifications/mark-read ─────────────────────────────────────────
  fastify.post('/mark-read', auth, async (req: any, reply) => {
    const { ids } = req.body as { ids?: string[] }
    if (!Array.isArray(ids) || !ids.length) {
      return reply.code(400).send({ error: 'INVALID_BODY', message: 'ids array required' })
    }
    const { error } = await fastify.supabase
      .from('notifications')
      .update({ is_read: true, read_at: new Date().toISOString() })
      .in('id', ids)
      .eq('tenant_id', req.tenantId)
      .eq('recipient_id', req.userId)

    if (error) return reply.code(500).send({ error: 'UPDATE_FAILED', message: 'Failed to mark as read' })
    return reply.send({ success: true })
  })

  // ── POST /notifications/read-all ──────────────────────────────────────────
  fastify.post('/read-all', auth, async (req: any, reply) => {
    const { data, error } = await fastify.supabase
      .from('notifications')
      .update({ is_read: true, read_at: new Date().toISOString() })
      .eq('tenant_id', req.tenantId)
      .eq('recipient_id', req.userId)
      .eq('is_read', false)
      .select('id')

    if (error) return reply.code(500).send({ error: 'UPDATE_FAILED', message: 'Failed to mark all as read' })
    return reply.send({ updated: (data ?? []).length })
  })

  // ── DELETE /notifications/:id ──────────────────────────────────────────────
  fastify.delete('/:id', auth, async (req: any, reply) => {
    const { id } = req.params as { id: string }
    const { error } = await fastify.supabase
      .from('notifications')
      .delete()
      .eq('id', id)
      .eq('tenant_id', req.tenantId)
      .eq('recipient_id', req.userId)

    if (error) return reply.code(500).send({ error: 'DELETE_FAILED', message: 'Failed to delete notification' })
    return reply.code(204).send()
  })

  // ── GET /notifications/channels ───────────────────────────────────────────
  // Returns the static channel list. R9-minimal: in_app + email always on,
  // no persistence needed — scheduler delivers to all HR admins unconditionally.
  fastify.get('/channels', auth, async (_req: any, reply) => {
    return reply.send({ data: CHANNEL_LIST })
  })

  // ── PUT /notifications/channels/:id ───────────────────────────────────────
  // Stub for UI compatibility — reflects the value back. R9-minimal has no
  // per-channel toggles; the full channel-settings model is deferred to R9-full.
  fastify.put('/channels/:id', auth, async (req: any, reply) => {
    const { id } = req.params as { id: string }
    const { is_enabled } = req.body as { is_enabled?: boolean }
    const ch = CHANNEL_LIST.find(c => c.channel_type === id)
    if (!ch) return reply.code(400).send({ error: 'INVALID_CHANNEL', message: `Unknown channel "${id}"` })
    return reply.send({ data: { ...ch, is_enabled: is_enabled ?? ch.is_enabled } })
  })

  // ── GET /notifications/digest/status ─────────────────────────────────────
  // Delivery status visibility — shows recent DIGEST_SENT / DIGEST_FAILED
  // audit events for this tenant. HR admin only.
  fastify.get('/digest/status', auth, async (req: any, reply) => {
    if (!isHrAdmin(req)) return reply.code(403).send({ error: 'FORBIDDEN' })
    const limit = Math.min(parseInt((req.query as any).limit ?? '50', 10) || 50, 200)

    const { data, error } = await fastify.supabase
      .from('audit_logs')
      .select('id, action, new_values:new_data, created_at')
      .eq('tenant_id', req.tenantId)
      .in('action', ['DIGEST_SENT', 'DIGEST_FAILED'])
      .order('created_at', { ascending: false })
      .limit(limit)

    if (error) {
      fastify.log.warn({ err: error.message }, 'digest/status query failed')
      return reply.send({ data: [] })
    }

    return reply.send({ data: data ?? [] })
  })

  // ── POST /notifications/digest/run ────────────────────────────────────────
  // HR admin: trigger a digest send for this tenant immediately.
  // Useful for testing delivery after RESEND_API_KEY is configured.
  // Uses a force-unique period_key so it always delivers regardless of
  // whether today's digest has already gone out.
  fastify.post('/digest/run', auth, async (req: any, reply) => {
    if (!isHrAdmin(req)) return reply.code(403).send({ error: 'FORBIDDEN', message: 'HR admin access required' })
    const { frequency } = req.body as { frequency?: string }
    if (!frequency || !DIGEST_FREQUENCIES.includes(frequency as DigestFrequency)) {
      return reply.code(400).send({ error: 'VALIDATION', message: 'frequency must be daily|weekly|monthly' })
    }

    // Get company name for the email template
    const { data: tenant } = await fastify.supabase
      .from('tenants').select('name').eq('id', req.tenantId).maybeSingle()

    try {
      const result = await runDigestForTenant(
        fastify.supabase, req.tenantId,
        frequency as DigestFrequency,
        (tenant as any)?.name,
      )
      return reply.send({ data: result })
    } catch (err: unknown) {
      return serverError(req, reply, err, ErrorCode.COMPUTE_FAILED, 'Failed to send digest')
    }
  })

  // ── POST /notifications/escalate ──────────────────────────────────────────
  // Mutates the tenant's shared inbox_items queue — HR-ops only, matching
  // /notes below (was previously auth-only, letting any employee escalate
  // arbitrary queue items).
  fastify.post('/escalate', auth, async (req: any, reply) => {
    if (!isHrAdmin(req)) {
      return reply.code(403).send({ error: 'FORBIDDEN', message: 'HR admin access required' })
    }
    const body = req.body as { item_ids?: string[] }
    if (!Array.isArray(body?.item_ids) || body.item_ids.length === 0) {
      return reply.code(400).send({ error: 'INVALID_BODY', message: 'item_ids array is required' })
    }
    if (body.item_ids.length > 100) {
      return reply.code(400).send({ error: 'TOO_MANY_IDS', message: 'Max 100 IDs per request' })
    }
    try {
      const { data, error } = await fastify.supabase
        .from('inbox_items')
        .update({ status: 'escalated' })
        .in('id', body.item_ids)
        .eq('tenant_id', req.tenantId)
        .select('id')

      if (error) {
        fastify.log.warn({ event: 'notifications.escalate_failed', err: error.message })
        return reply.send({ escalated: 0 })
      }
      return reply.send({ escalated: (data ?? []).length })
    } catch (err) {
      fastify.log.error({ err }, 'notifications/escalate: unexpected error')
      return reply.send({ escalated: 0 })
    }
  })

  // ── POST /notifications/notes ─────────────────────────────────────────────
  fastify.post('/notes', auth, async (req: any, reply) => {
    if (!isHrAdmin(req)) {
      return reply.code(403).send({ error: 'FORBIDDEN', message: 'HR admin access required' })
    }
    const body = req.body as { employee_id?: string; queue_item_id?: string; note?: string }
    if (!body?.employee_id || !body?.note?.trim()) {
      return reply.code(400).send({ error: 'INVALID_BODY', message: 'employee_id and note are required' })
    }
    try {
      const { data: emp } = await fastify.supabase
        .from('employees')
        .select('id')
        .eq('id', body.employee_id)
        .eq('tenant_id', req.tenantId)
        .maybeSingle()
      if (!emp) {
        return reply.code(400).send({ error: 'INVALID_EMPLOYEE', message: 'Employee not found' })
      }
      const { data, error } = await fastify.supabase
        .from('operational_notes')
        .insert({
          tenant_id:     req.tenantId,
          employee_id:   body.employee_id,
          queue_item_id: body.queue_item_id ?? null,
          note:          body.note.trim(),
          // Author is always the authenticated caller, never client-supplied —
          // the body previously accepted an arbitrary created_by, letting a
          // caller attribute a note to someone else.
          created_by:    req.userId,
          created_at:    new Date().toISOString(),
        })
        .select('id')
        .single()

      if (error) {
        fastify.log.warn({ event: 'notifications.notes_failed', err: error.message })
        return reply.code(201).send({ id: null, saved: false })
      }
      return reply.code(201).send({ id: (data as any).id, saved: true })
    } catch (err) {
      fastify.log.error({ err }, 'notifications/notes: unexpected error')
      return reply.code(201).send({ id: null, saved: false })
    }
  })

  // ── GET /notifications/log ─────────────────────────────────────────────────
  // Legacy stub — kept for UI compatibility (NotificationTemplates delivery log tab).
  fastify.get('/log', auth, async (_req: any, reply) => {
    return reply.send({ data: [] })
  })
}
