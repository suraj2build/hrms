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
import { serverError, notFound, ErrorCode } from '../../lib/api-errors.js'

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
    if (error) return serverError(req, reply, error, ErrorCode.QUERY_FAILED, 'Failed to fetch error reports')

    // Lightweight open-count summary for the nav badge / header.
    const { count, error: countError } = await fastify.supabase
      .from('error_reports').select('id', { count: 'exact', head: true }).eq('status', 'new')
    if (countError) return serverError(req, reply, countError, ErrorCode.QUERY_FAILED, 'Failed to fetch new error-report count')

    return reply.send({ data, meta: { new_count: count ?? 0 } })
  })

  // GET /owner/error-reports/:id — full detail incl. stack
  fastify.get('/owner/error-reports/:id', ownerAuth, async (req, reply) => {
    const { id } = req.params as { id: string }
    const { data, error } = await fastify.supabase
      .from('error_reports')
      .select('*, tenants(name, slug)')
      .eq('id', id)
      .maybeSingle()
    if (error) return serverError(req, reply, error, ErrorCode.QUERY_FAILED, 'Failed to fetch error report')
    if (!data) return notFound(reply, 'ERROR_REPORT_NOT_FOUND', 'Error report not found')
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
      .from('error_reports').update(updates).eq('id', id).select('id, status').maybeSingle()
    if (error) return serverError(req, reply, error, ErrorCode.UPDATE_FAILED, 'Failed to update error report')
    if (!data) return notFound(reply, 'ERROR_REPORT_NOT_FOUND', 'Error report not found')
    return reply.send({ data })
  })
}
