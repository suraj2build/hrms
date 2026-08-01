/**
 * UAT Certification Routes — /intelligence/uat-certification
 *
 * Server-side persistence for UATCertification.tsx's per-module UAT sign-off
 * checklist (migration 420 / PEND-88). Replaces the page's original
 * localStorage-only state: marks now survive a cleared browser or a
 * different device, and the reviewer identity is the authenticated caller
 * (updated_by) rather than a free-text field anyone could type into.
 *
 *   GET /intelligence/uat-certification         list all marks for the tenant
 *   PUT /intelligence/uat-certification/:itemId  upsert one item's mark
 */
import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { HR_ADMIN_ROLES } from '../../lib/rbac.js'
import { serverError, ErrorCode } from '../../lib/api-errors.js'

export default async function uatCertificationRoutes(fastify: FastifyInstance) {
  const auth = { preHandler: [fastify.authenticate] }

  function requireHrAdmin(req: any, reply: any, done: () => void) {
    if (!(HR_ADMIN_ROLES as readonly string[]).includes(req.userRole)) {
      reply.code(403).send({ error: 'FORBIDDEN', message: 'HR admin access required' })
      return
    }
    done()
  }

  // ── GET /intelligence/uat-certification ─────────────────────────────────
  fastify.get('/', { preHandler: [fastify.authenticate, requireHrAdmin] }, async (req: any, reply) => {
    const { data, error } = await fastify.supabase
      .from('uat_certification_marks')
      .select('item_id, status, note, updated_by, updated_at, profiles!uat_certification_marks_updated_by_fkey(full_name)')
      .eq('tenant_id', req.tenantId)
    if (error) return serverError(req, reply, error, ErrorCode.QUERY_FAILED, 'Failed to fetch UAT certification marks')

    const marks = (data ?? []).map((row: any) => ({
      item_id:      row.item_id,
      status:       row.status,
      note:         row.note,
      updated_by:   row.updated_by,
      updated_by_name: row.profiles?.full_name ?? null,
      updated_at:   row.updated_at,
    }))
    return reply.send({ data: marks })
  })

  // ── PUT /intelligence/uat-certification/:itemId ─────────────────────────
  fastify.put('/:itemId', { preHandler: [fastify.authenticate, requireHrAdmin] }, async (req: any, reply) => {
    const { itemId } = req.params as { itemId: string }
    const schema = z.object({
      status: z.enum(['pending', 'pass', 'fail', 'na']),
      note:   z.string().max(2000).nullable().optional(),
    })
    const parsed = schema.safeParse(req.body)
    if (!parsed.success) return reply.code(400).send({ error: 'VALIDATION_ERROR', message: parsed.error.issues[0]?.message })

    const { data, error } = await fastify.supabase
      .from('uat_certification_marks')
      .upsert({
        tenant_id:  req.tenantId,
        item_id:    itemId,
        status:     parsed.data.status,
        note:       parsed.data.note ?? null,
        updated_by: req.userId,
        updated_at: new Date().toISOString(),
      }, { onConflict: 'tenant_id,item_id' })
      .select('item_id, status, note, updated_by, updated_at')
      .single()
    if (error) return serverError(req, reply, error, ErrorCode.UPDATE_FAILED, 'Failed to save UAT certification mark')

    return reply.send({ data })
  })

  // ── DELETE /intelligence/uat-certification — reset all marks for tenant ──
  fastify.delete('/', { preHandler: [fastify.authenticate, requireHrAdmin] }, async (req: any, reply) => {
    const { error } = await fastify.supabase
      .from('uat_certification_marks')
      .delete()
      .eq('tenant_id', req.tenantId)
    if (error) return serverError(req, reply, error, ErrorCode.DELETE_FAILED, 'Failed to reset UAT certification marks')
    return reply.send({ ok: true })
  })
}
