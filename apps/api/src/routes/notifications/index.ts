/**
 * Notifications API
 * GET  /notifications          — list unread notifications for current user (max 50)
 * GET  /notifications/count    — unread count (for bell badge)
 * POST /notifications/:id/read — mark one as read
 * POST /notifications/read-all — mark all as read
 */

import type { FastifyInstance } from 'fastify'

export default async function notificationsRoutes(fastify: FastifyInstance) {
  const auth = { preHandler: [fastify.authenticate] }

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

  // GET /notifications/channels — delivery channel config (shape matches NotifChannel interface)
  fastify.get('/channels', auth, async (_req: any, reply) => {
    return reply.send({
      data: [
        { id: 'in_app',  channel_type: 'in_app',  is_enabled: true,  config: {} },
        { id: 'email',   channel_type: 'email',   is_enabled: false, config: {} },
        { id: 'sms',     channel_type: 'sms',     is_enabled: false, config: {} },
        { id: 'push',    channel_type: 'push',    is_enabled: false, config: {} },
        { id: 'webhook', channel_type: 'webhook', is_enabled: false, config: {} },
      ],
    })
  })

  // PUT /notifications/channels/:id — toggle a channel (stub — acknowledges but doesn't persist)
  fastify.put('/channels/:id', auth, async (req: any, reply) => {
    const { id } = req.params as { id: string }
    const { is_enabled } = req.body as { is_enabled: boolean }
    // In-memory stub — no DB table yet; reflect the change back so the UI updates
    return reply.send({
      data: { id, channel_type: id, is_enabled: is_enabled ?? false, config: {} },
    })
  })

  // NOTE: /notifications/templates/* is served by notificationTemplatesRoute
  // (registered separately at prefix '/notifications/templates' in index.ts).
  // Do NOT add template routes here — it causes Fastify duplicate-route crash.

  // GET /notifications/log — delivery audit log (stub — returns empty until log table exists)
  fastify.get('/log', auth, async (_req: any, reply) => {
    return reply.send({ data: [] })
  })
}
