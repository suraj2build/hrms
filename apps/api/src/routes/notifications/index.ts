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

  // GET /notifications
  fastify.get('/', auth, async (req: any, reply) => {
    const { data, error } = await fastify.supabase
      .from('notifications')
      .select('id, title, body, link, is_read, created_at, event_id')
      .eq('tenant_id', req.tenantId)
      .eq('recipient_id', req.userId)
      .order('created_at', { ascending: false })
      .limit(50)

    if (error) return reply.code(500).send({ error: 'QUERY_FAILED', message: 'Failed to fetch notifications' })
    return reply.send({ data: data ?? [], unread_count: (data ?? []).filter(n => !n.is_read).length })
  })

  // GET /notifications/count
  fastify.get('/count', auth, async (req: any, reply) => {
    const { count, error } = await fastify.supabase
      .from('notifications')
      .select('id', { count: 'exact', head: true })
      .eq('tenant_id', req.tenantId)
      .eq('recipient_id', req.userId)
      .eq('is_read', false)

    if (error) return reply.code(500).send({ error: 'QUERY_FAILED', message: 'Failed to fetch count' })
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

  // POST /notifications/read-all
  fastify.post('/read-all', auth, async (req: any, reply) => {
    const { error } = await fastify.supabase
      .from('notifications')
      .update({ is_read: true, read_at: new Date().toISOString() })
      .eq('tenant_id', req.tenantId)
      .eq('recipient_id', req.userId)
      .eq('is_read', false)

    if (error) return reply.code(500).send({ error: 'UPDATE_FAILED', message: 'Failed to mark all as read' })
    return reply.code(204).send()
  })
}
