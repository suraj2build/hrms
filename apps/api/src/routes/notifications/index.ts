/**
 * Notifications API
 * GET  /notifications          — list unread notifications for current user (max 50)
 * GET  /notifications/count    — unread count (for bell badge)
 * POST /notifications/:id/read — mark one as read
 * POST /notifications/read-all — mark all as read
 */

import type { FastifyInstance } from 'fastify'
import { runDigestForTenant } from '../../lib/digest-scheduler.js'
import type { DigestFrequency } from '../../lib/digest-builder.js'

const CHANNEL_DEFAULTS: { id: string; channel_type: string; is_enabled: boolean }[] = [
  { id: 'in_app',  channel_type: 'in_app',  is_enabled: true  },
  { id: 'email',   channel_type: 'email',   is_enabled: false },
  { id: 'sms',     channel_type: 'sms',     is_enabled: false },
  { id: 'push',    channel_type: 'push',    is_enabled: false },
  { id: 'webhook', channel_type: 'webhook', is_enabled: false },
]

const DIGEST_FREQUENCIES: DigestFrequency[] = ['daily', 'weekly', 'monthly']
const DIGEST_CHANNELS = ['in_app', 'email'] as const
// Mirrors digest-scheduler DEFAULT_PREFS — what a user gets with no explicit row.
const PREF_DEFAULTS: Record<DigestFrequency, { in_app: boolean; email: boolean }> = {
  daily:   { in_app: false, email: false },
  weekly:  { in_app: true,  email: false },
  monthly: { in_app: true,  email: false },
}

export default async function notificationsRoutes(fastify: FastifyInstance) {
  const auth = { preHandler: [fastify.authenticate] }
  const isHrAdmin = (req: any) => req.userRole === 'super_admin' || req.userRole === 'hr_admin'

  // GET /notifications?offset=0&limit=50
  // Supports pagination via ?offset (default 0) and ?limit (default 50, max 100).
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

    // Graceful degradation: if the notifications table is missing/misconfigured
    // (e.g. migrations not yet run on this DB), return an empty feed instead of 500.
    if (error) {
      fastify.log.warn({ event: 'notifications.fetch_failed', err: error.message })
      return reply.send({ data: [], unread_count: 0, pagination: { offset, limit, returned: 0 } })
    }
    return reply.send({
      data:         data ?? [],
      unread_count: (data ?? []).filter(n => !n.is_read).length,
      pagination:   { offset, limit, returned: (data ?? []).length },
    })
  })

  // GET /notifications/count
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

  // POST /notifications/:id/read
  fastify.post('/:id/read', auth, async (req: any, reply) => {
    const { id } = req.params as { id: string }
    const { error } = await fastify.supabase
      .from('notifications')
      .update({ is_read: true, read_at: new Date().toISOString() })
      .eq('id', id)
      .eq('tenant_id', req.tenantId)
      .eq('recipient_id', req.userId)

    if (error) return reply.code(500).send({ error: 'UPDATE_FAILED', message: 'Failed to mark as read' })
    return reply.code(204).send()
  })

  // POST /notifications/mark-read
  // Accepts { id: string } (single) or { ids: string[] } (bulk).
  // Returns { updated: number } — count of records actually marked.
  fastify.post('/mark-read', auth, async (req: any, reply) => {
    const body = req.body as { id?: string; ids?: string[] }

    // Normalise to an array of IDs
    let ids: string[]
    if (Array.isArray(body?.ids) && body.ids.length > 0) {
      ids = body.ids
    } else if (typeof body?.id === 'string' && body.id) {
      ids = [body.id]
    } else {
      return reply.code(400).send({ error: 'INVALID_BODY', message: 'Provide either { id } or { ids: string[] }' })
    }

    // Hard limit to prevent unbounded UPDATE
    if (ids.length > 200) {
      return reply.code(400).send({ error: 'TOO_MANY_IDS', message: 'Bulk mark-read limit is 200 IDs per request' })
    }

    try {
      const { data, error } = await fastify.supabase
        .from('notifications')
        .update({ is_read: true, read_at: new Date().toISOString() })
        .in('id', ids)
        .eq('tenant_id', req.tenantId)
        .eq('recipient_id', req.userId)
        .eq('is_read', false)          // only touch genuinely unread rows
        .select('id')

      if (error) return reply.code(500).send({ error: 'UPDATE_FAILED', message: 'Failed to mark notifications as read' })
      return reply.send({ updated: (data ?? []).length })
    } catch (err) {
      fastify.log.error({ err }, 'notifications/mark-read: unexpected error')
      return reply.code(500).send({ error: 'INTERNAL_ERROR', message: 'Unexpected error marking notifications as read' })
    }
  })

  // POST /notifications/read-all
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

  // DELETE /notifications/:id — dismiss a notification (scoped to the recipient)
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

  // GET /notifications/channels — tenant channel config (R9: now persisted in
  // notification_channel_settings; defaults merged for channels with no row yet).
  fastify.get('/channels', auth, async (req: any, reply) => {
    const { data, error } = await fastify.supabase
      .from('notification_channel_settings')
      .select('channel_type, is_enabled, config')
      .eq('tenant_id', req.tenantId)
    if (error) {
      // Graceful fallback (e.g. migration not yet run) — return defaults.
      return reply.send({ data: CHANNEL_DEFAULTS.map(c => ({ ...c, config: {} })) })
    }
    const saved = new Map((data ?? []).map((r: any) => [r.channel_type, r]))
    return reply.send({
      data: CHANNEL_DEFAULTS.map(c => {
        const row = saved.get(c.channel_type)
        return {
          id: c.channel_type,
          channel_type: c.channel_type,
          is_enabled: row ? row.is_enabled : c.is_enabled,
          config: row?.config ?? {},
        }
      }),
    })
  })

  // PUT /notifications/channels/:id — toggle a channel (R9: persisted, HR-admin only).
  fastify.put('/channels/:id', auth, async (req: any, reply) => {
    if (!isHrAdmin(req)) return reply.code(403).send({ error: 'FORBIDDEN', message: 'HR admin access required' })
    const { id } = req.params as { id: string }
    const { is_enabled } = req.body as { is_enabled: boolean }
    if (!CHANNEL_DEFAULTS.some(c => c.channel_type === id)) {
      return reply.code(400).send({ error: 'INVALID_CHANNEL', message: `Unknown channel "${id}"` })
    }
    const { error } = await fastify.supabase
      .from('notification_channel_settings')
      .upsert(
        { tenant_id: req.tenantId, channel_type: id, is_enabled: is_enabled ?? false, updated_at: new Date().toISOString() },
        { onConflict: 'tenant_id,channel_type' },
      )
    if (error) return reply.code(500).send({ error: 'DB_ERROR', message: error.message })
    return reply.send({ data: { id, channel_type: id, is_enabled: is_enabled ?? false, config: {} } })
  })

  // GET /notifications/preferences — current user's effective digest preferences.
  // Returns one entry per frequency with in_app/email flags (defaults merged).
  fastify.get('/preferences', auth, async (req: any, reply) => {
    const { data, error } = await fastify.supabase
      .from('user_notification_preferences')
      .select('frequency, channel, enabled')
      .eq('tenant_id', req.tenantId)
      .eq('user_id', req.userId)
    if (error) {
      return reply.send({ data: DIGEST_FREQUENCIES.map(f => ({ frequency: f, ...PREF_DEFAULTS[f] })) })
    }
    const rows = (data ?? []) as any[]
    return reply.send({
      data: DIGEST_FREQUENCIES.map(f => {
        const eff = { ...PREF_DEFAULTS[f] }
        for (const r of rows.filter(r => r.frequency === f)) {
          if (r.channel === 'in_app') eff.in_app = r.enabled
          if (r.channel === 'email')  eff.email  = r.enabled
        }
        return { frequency: f, ...eff }
      }),
    })
  })

  // PUT /notifications/preferences — upsert the current user's digest subscription.
  // Body: { frequency, channel, enabled }
  fastify.put('/preferences', auth, async (req: any, reply) => {
    const { frequency, channel, enabled } = req.body as { frequency?: string; channel?: string; enabled?: boolean }
    if (!frequency || !DIGEST_FREQUENCIES.includes(frequency as DigestFrequency)) {
      return reply.code(400).send({ error: 'VALIDATION', message: 'frequency must be daily|weekly|monthly' })
    }
    if (!channel || !DIGEST_CHANNELS.includes(channel as any)) {
      return reply.code(400).send({ error: 'VALIDATION', message: 'channel must be in_app|email' })
    }
    const { error } = await fastify.supabase
      .from('user_notification_preferences')
      .upsert(
        { tenant_id: req.tenantId, user_id: req.userId, frequency, channel, enabled: enabled === true, updated_at: new Date().toISOString() },
        { onConflict: 'tenant_id,user_id,frequency,channel' },
      )
    if (error) return reply.code(500).send({ error: 'DB_ERROR', message: error.message })
    return reply.send({ data: { frequency, channel, enabled: enabled === true } })
  })

  // POST /notifications/digest/run — manually push a digest now (HR-admin).
  // Body: { frequency }. force=true bypasses period de-dup so a test always sends.
  fastify.post('/digest/run', auth, async (req: any, reply) => {
    if (!isHrAdmin(req)) return reply.code(403).send({ error: 'FORBIDDEN', message: 'HR admin access required' })
    const { frequency } = req.body as { frequency?: string }
    if (!frequency || !DIGEST_FREQUENCIES.includes(frequency as DigestFrequency)) {
      return reply.code(400).send({ error: 'VALIDATION', message: 'frequency must be daily|weekly|monthly' })
    }
    try {
      const result = await runDigestForTenant(fastify.supabase, req.tenantId, frequency as DigestFrequency, { force: true })
      return reply.send({ data: result })
    } catch (err: unknown) {
      fastify.log.error({ err }, 'notifications/digest/run error')
      return reply.code(500).send({ error: 'DIGEST_ERROR', message: err instanceof Error ? err.message : 'Unknown error' })
    }
  })

  // POST /notifications/escalate — mark inbox items as escalated
  fastify.post('/escalate', auth, async (req: any, reply) => {
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
        .update({ escalated: true, escalated_at: new Date().toISOString() })
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

  // POST /notifications/notes — add an operational note for a queue item / employee
  fastify.post('/notes', auth, async (req: any, reply) => {
    const body = req.body as { employee_id?: string; queue_item_id?: string; note?: string; created_by?: string }
    if (!body?.employee_id || !body?.note?.trim()) {
      return reply.code(400).send({ error: 'INVALID_BODY', message: 'employee_id and note are required' })
    }
    try {
      const { data, error } = await fastify.supabase
        .from('operational_notes')
        .insert({
          tenant_id:     req.tenantId,
          employee_id:   body.employee_id,
          queue_item_id: body.queue_item_id ?? null,
          note:          body.note.trim(),
          created_by:    body.created_by ?? req.userId,
          created_at:    new Date().toISOString(),
        })
        .select('id')
        .single()

      if (error) {
        // Table may not exist yet — acknowledge so the UI doesn't break
        fastify.log.warn({ event: 'notifications.notes_failed', err: error.message })
        return reply.code(201).send({ id: null, saved: false })
      }
      return reply.code(201).send({ id: (data as any).id, saved: true })
    } catch (err) {
      fastify.log.error({ err }, 'notifications/notes: unexpected error')
      return reply.code(201).send({ id: null, saved: false })
    }
  })

  // NOTE: /notifications/templates/* is served by notificationTemplatesRoute
  // (registered separately at prefix '/notifications/templates' in index.ts).
  // Do NOT add template routes here — it causes Fastify duplicate-route crash.

  // GET /notifications/log — delivery audit log (stub — returns empty until log table exists)
  fastify.get('/log', auth, async (_req: any, reply) => {
    return reply.send({ data: [] })
  })
}
