/**
 * Owner-panel error-report triage.
 *
 *   GET   /owner/error-reports         — list (filter by ?status=, ?limit=)
 *   PATCH /owner/error-reports/:id      — update status / owner_note
 *
 * Owner auth (platform_admins), separate from tenant auth.
 */
import type { FastifyInstance } from 'fastify'
import { z } from 'zod'

const patchSchema = z.object({
  status:     z.enum(['new', 'triaged', 'resolved', 'dismissed']).optional(),
  owner_note: z.string().max(2000).optional(),
})

export default async function ownerErrorReportRoutes(fastify: FastifyInstance) {
  const ownerAuth = { preHandler: [fastify.authenticateOwner] }

  // GET /owner/error-reports?status=new&limit=100
  fastify.get('/owner/error-reports', ownerAuth, async (req, reply) => {
    const q = req.query as { status?: string; limit?: string }
    let query = fastify.supabase
      .from('error_reports')
      .select('id, tenant_id, message, url, severity, status, user_note, owner_note, created_at, resolved_at, tenants(name, slug)')
      .order('created_at', { ascending: false })
      .limit(Math.min(Number(q.limit) || 100, 500))
    if (q.status && q.status !== 'all') query = query.eq('status', q.status)

    const { data, error } = await query
    if (error) return reply.code(500).send({ error: 'DB', message: error.message })

    // Lightweight open-count summary for the nav badge / header.
    const { count } = await fastify.supabase
      .from('error_reports').select('id', { count: 'exact', head: true }).eq('status', 'new')

    return reply.send({ data, meta: { new_count: count ?? 0 } })
  })

  // GET /owner/error-reports/:id — full detail incl. stack
  fastify.get('/owner/error-reports/:id', ownerAuth, async (req, reply) => {
    const { id } = req.params as { id: string }
    const { data, error } = await fastify.supabase
      .from('error_reports')
      .select('*, tenants(name, slug)')
      .eq('id', id)
      .single()
    if (error) return reply.code(404).send({ error: 'NOT_FOUND', message: error.message })
    return reply.send({ data })
  })

  // PATCH /owner/error-reports/:id
  fastify.patch('/owner/error-reports/:id', ownerAuth, async (req, reply) => {
    const { id } = req.params as { id: string }
    const parsed = patchSchema.safeParse(req.body)
    if (!parsed.success) return reply.code(400).send({ error: 'VALIDATION', message: 'Invalid update' })

    const updates: Record<string, any> = { ...parsed.data }
    if (parsed.data.status === 'resolved' || parsed.data.status === 'dismissed') {
      updates.resolved_at = new Date().toISOString()
    } else if (parsed.data.status) {
      updates.resolved_at = null
    }

    const { data, error } = await fastify.supabase
      .from('error_reports').update(updates).eq('id', id).select('id, status').single()
    if (error) return reply.code(500).send({ error: 'DB', message: error.message })
    return reply.send({ data })
  })
}
