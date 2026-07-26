/**
 * Cost Centers CRUD — /masters/cost-centers
 *
 * Cost centers are financial entities used for payroll allocation.
 * They are independent of the Sites / Work Locations hierarchy.
 *
 * GET    /masters/cost-centers        — list all cost centers for the tenant
 * GET    /masters/cost-centers/:id    — single record
 * POST   /masters/cost-centers        — create  (hr_admin / super_admin)
 * PUT    /masters/cost-centers/:id    — update  (hr_admin / super_admin)
 * DELETE /masters/cost-centers/:id    — delete  (hr_admin / super_admin)
 */

import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { generateUniqueCode } from '../../lib/generate-code.js'
import { HR_ADMIN_ROLES } from '../../lib/rbac.js'
import { serverError, ErrorCode } from '../../lib/api-errors.js'

const schema = z.object({
  name:        z.string().min(1, 'Name is required'),
  code:        z.string().optional(),
  description: z.string().optional(),
  is_active:   z.boolean().optional().default(true),
})

export default async function costCentersRoutes(fastify: FastifyInstance) {
  const auth = { preHandler: [fastify.authenticate] }
  const adminAuth = {
    preHandler: [
      fastify.authenticate,
      async (req: any, reply: any) => {
        if (!(HR_ADMIN_ROLES as readonly string[]).includes(req.userRole)) {
          return reply.code(403).send({
            error:   'FORBIDDEN',
            message: 'HR admin access required',
          })
        }
      },
    ],
  }

  // ── GET /masters/cost-centers ─────────────────────────────────────────────
  fastify.get('/', auth, async (req: any, reply) => {
    const { data, error } = await fastify.supabase
      .from('cost_centers')
      .select('id, name, code, description, is_active, created_at')
      .eq('tenant_id', req.tenantId)
      .order('name')

    if (error) return serverError(req, reply, error, ErrorCode.QUERY_FAILED, 'Failed to fetch cost centers')
    return reply.send({ data: data ?? [] })
  })

  // ── GET /masters/cost-centers/:id ─────────────────────────────────────────
  fastify.get('/:id', auth, async (req: any, reply) => {
    const { data, error } = await fastify.supabase
      .from('cost_centers')
      .select('id, name, code, description, is_active, created_at')
      .eq('id', req.params.id)
      .eq('tenant_id', req.tenantId)
      .maybeSingle()

    if (error) return serverError(req, reply, error, ErrorCode.QUERY_FAILED, 'Failed to fetch cost center')
    if (!data) return reply.code(404).send({ error: 'NOT_FOUND', message: 'Cost center not found' })
    return reply.send({ data })
  })

  // ── POST /masters/cost-centers ────────────────────────────────────────────
  fastify.post('/', adminAuth, async (req: any, reply) => {
    const parsed = schema.safeParse(req.body)
    if (!parsed.success)
      return reply.code(400).send({ error: 'VALIDATION', message: parsed.error.issues[0].message })

    const code = parsed.data.code?.trim() ||
      await generateUniqueCode(fastify.supabase, 'cost_centers', req.tenantId, parsed.data.name)

    const { data, error } = await fastify.supabase
      .from('cost_centers')
      .insert({ ...parsed.data, code, tenant_id: req.tenantId })
      .select('id, name, code, description, is_active, created_at')
      .single()

    if (error) {
      if (error.code === '23505') {
        return reply.code(409).send({
          error:   'DUPLICATE',
          message: `A cost center with code "${parsed.data.code}" already exists`,
        })
      }
      return serverError(req, reply, error, ErrorCode.INSERT_FAILED, 'Failed to create cost center')
    }
    return reply.code(201).send({ data })
  })

  // ── PUT /masters/cost-centers/:id ─────────────────────────────────────────
  fastify.put('/:id', adminAuth, async (req: any, reply) => {
    const parsed = schema.partial().safeParse(req.body)
    if (!parsed.success)
      return reply.code(400).send({ error: 'VALIDATION', message: parsed.error.issues[0].message })

    const { data, error } = await fastify.supabase
      .from('cost_centers')
      .update(parsed.data)
      .eq('id', req.params.id)
      .eq('tenant_id', req.tenantId)
      .select('id, name, code, description, is_active, created_at')
      .single()

    if (error) return serverError(req, reply, error, ErrorCode.UPDATE_FAILED, 'Failed to update cost center')
    if (!data) return reply.code(404).send({ error: 'NOT_FOUND', message: 'Cost center not found' })
    return reply.send({ data })
  })

  // ── GET /masters/cost-centers/:id/usage ──────────────────────────────────────
  fastify.get('/:id/usage', auth, async (req: any, reply) => {
    const { id } = req.params as { id: string }

    const { count, error } = await fastify.supabase
      .from('job_history')
      .select('id', { count: 'exact', head: true })
      .eq('cost_center_id', id)
      .eq('tenant_id', req.tenantId)

    if (error) return serverError(req, reply, error, ErrorCode.QUERY_FAILED, 'Failed to fetch cost center usage')
    return reply.send({ data: { job_history: count ?? 0, total: count ?? 0 } })
  })

  // ── DELETE /masters/cost-centers/:id ─────────────────────────────────────────
  fastify.delete('/:id', adminAuth, async (req: any, reply) => {
    const { id } = req.params as { id: string }
    const mergeTo = (req.body as any)?.merge_to as string | undefined

    if (mergeTo && !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(mergeTo)) {
      return reply.code(400).send({ error: 'VALIDATION', message: 'merge_to must be a valid UUID' })
    }

    // merge_to must resolve to a cost center in this tenant — without this,
    // job_history rows could be repointed at another tenant's cost center.
    if (mergeTo) {
      const { data: mergeTarget, error: mergeCheckErr } = await fastify.supabase
        .from('cost_centers')
        .select('id')
        .eq('id', mergeTo)
        .eq('tenant_id', req.tenantId)
        .maybeSingle()
      if (mergeCheckErr) return serverError(req, reply, mergeCheckErr, ErrorCode.QUERY_FAILED, 'Failed to verify merge target')
      if (!mergeTarget) return reply.code(400).send({ error: 'VALIDATION', message: 'merge_to must reference a cost center in your organisation' })
    }

    const { count, error: countErr } = await fastify.supabase
      .from('job_history')
      .select('id', { count: 'exact', head: true })
      .eq('cost_center_id', id)
      .eq('tenant_id', req.tenantId)

    if (countErr) return serverError(req, reply, countErr, ErrorCode.QUERY_FAILED, 'Failed to check cost center usage')

    const usageCount = count ?? 0

    if (usageCount > 0 && !mergeTo) {
      return reply.code(409).send({
        error: 'IN_USE',
        usageCount,
        message: `Cost center is assigned to ${usageCount} employee record${usageCount !== 1 ? 's' : ''}. Provide merge_to to reassign.`,
      })
    }

    if (mergeTo && usageCount > 0) {
      const { error: reassignErr } = await fastify.supabase
        .from('job_history')
        .update({ cost_center_id: mergeTo })
        .eq('cost_center_id', id)
        .eq('tenant_id', req.tenantId)
      if (reassignErr) return serverError(req, reply, reassignErr, ErrorCode.UPDATE_FAILED, 'Failed to reassign job history to the merge target cost center')
    }

    const { error } = await fastify.supabase
      .from('cost_centers')
      .delete()
      .eq('id', id)
      .eq('tenant_id', req.tenantId)

    if (error) return serverError(req, reply, error, ErrorCode.DELETE_FAILED, 'Failed to delete cost center')
    return reply.code(204).send()
  })
}
