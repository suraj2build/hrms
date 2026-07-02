/**
 * States CRUD — /masters/states
 *
 * India state/UT master: the statutory axis for sites. Carries the GST state
 * code plus Professional Tax (PT) and Labour Welfare Fund (LWF) applicability.
 * Seeded per tenant by migration 273; tenants may edit flags or add rows.
 *
 * GET    /masters/states           — list all states for the tenant
 * GET    /masters/states/:id       — single record
 * GET    /masters/states/:id/usage — count of sites referencing this state
 * POST   /masters/states           — create  (hr_admin / super_admin)
 * PUT    /masters/states/:id        — update  (hr_admin / super_admin)
 * DELETE /masters/states/:id        — delete  (hr_admin / super_admin; merge_to to reassign sites)
 */

import type { FastifyInstance } from 'fastify'
import { z }                    from 'zod'
import { HR_ADMIN_ROLES } from '../../lib/rbac.js'

const SELECT_COLS =
  'id, code, name, region, country, pt_applicable, lwf_applicable, lwf_frequency, min_wage_zone, is_active, created_at, updated_at'

const schema = z.object({
  code:           z.string().min(1, 'GST state code is required').max(3),
  name:           z.string().min(1, 'Name is required').max(120),
  region:         z.string().max(80).optional().nullable(),
  country:        z.string().max(80).optional().default('India'),
  pt_applicable:  z.boolean().optional().default(false),
  lwf_applicable: z.boolean().optional().default(false),
  lwf_frequency:  z.enum(['monthly', 'half_yearly', 'annual']).optional().nullable(),
  min_wage_zone:  z.string().max(80).optional().nullable(),
  is_active:      z.boolean().optional().default(true),
})

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export default async function statesRoutes(fastify: FastifyInstance) {
  const auth      = { preHandler: [fastify.authenticate] }
  const adminAuth = {
    preHandler: [
      fastify.authenticate,
      async (req: any, reply: any) => {
        if (!(HR_ADMIN_ROLES as readonly string[]).includes(req.userRole)) {
          return reply.code(403).send({ error: 'FORBIDDEN', message: 'HR admin access required' })
        }
      },
    ],
  }

  // ── GET /masters/states ───────────────────────────────────────────────────
  fastify.get('/', auth, async (req: any, reply) => {
    const { data, error } = await fastify.supabase
      .from('states')
      .select(SELECT_COLS)
      .eq('tenant_id', req.tenantId)
      .order('code')

    if (error) return reply.code(500).send({ error: 'DB_ERROR', message: error.message })
    return reply.send({ data: data ?? [] })
  })

  // ── GET /masters/states/:id ───────────────────────────────────────────────
  fastify.get('/:id', auth, async (req: any, reply) => {
    const { data, error } = await fastify.supabase
      .from('states')
      .select(SELECT_COLS)
      .eq('id', req.params.id)
      .eq('tenant_id', req.tenantId)
      .maybeSingle()

    if (error) return reply.code(500).send({ error: 'DB_ERROR', message: error.message })
    if (!data) return reply.code(404).send({ error: 'NOT_FOUND', message: 'State not found' })
    return reply.send({ data })
  })

  // ── GET /masters/states/:id/usage ─────────────────────────────────────────
  fastify.get('/:id/usage', auth, async (req: any, reply) => {
    const { id } = req.params as { id: string }
    const { count, error } = await fastify.supabase
      .from('sites')
      .select('id', { count: 'exact', head: true })
      .eq('state_id', id)
      .eq('tenant_id', req.tenantId)

    if (error) return reply.code(500).send({ error: 'QUERY_FAILED', message: error.message })
    return reply.send({ data: { sites: count ?? 0, total: count ?? 0 } })
  })

  // ── POST /masters/states ──────────────────────────────────────────────────
  fastify.post('/', adminAuth, async (req: any, reply) => {
    const parsed = schema.safeParse(req.body)
    if (!parsed.success)
      return reply.code(400).send({ error: 'VALIDATION', message: parsed.error.issues[0].message })

    const { data, error } = await fastify.supabase
      .from('states')
      .insert({ ...parsed.data, tenant_id: req.tenantId })
      .select(SELECT_COLS)
      .single()

    if (error) {
      if (error.code === '23505')
        return reply.code(409).send({
          error:   'DUPLICATE',
          message: `A state with code "${parsed.data.code}" or name "${parsed.data.name}" already exists`,
        })
      return reply.code(500).send({ error: 'DB_ERROR', message: error.message })
    }
    return reply.code(201).send({ data })
  })

  // ── PUT /masters/states/:id ───────────────────────────────────────────────
  fastify.put('/:id', adminAuth, async (req: any, reply) => {
    const parsed = schema.partial().safeParse(req.body)
    if (!parsed.success)
      return reply.code(400).send({ error: 'VALIDATION', message: parsed.error.issues[0].message })

    const { data, error } = await fastify.supabase
      .from('states')
      .update(parsed.data)
      .eq('id', req.params.id)
      .eq('tenant_id', req.tenantId)
      .select(SELECT_COLS)
      .single()

    if (error) {
      if (error.code === '23505')
        return reply.code(409).send({ error: 'DUPLICATE', message: 'Another state already uses that code or name' })
      return reply.code(500).send({ error: 'DB_ERROR', message: error.message })
    }
    if (!data) return reply.code(404).send({ error: 'NOT_FOUND', message: 'State not found' })
    return reply.send({ data })
  })

  // ── DELETE /masters/states/:id ────────────────────────────────────────────
  fastify.delete('/:id', adminAuth, async (req: any, reply) => {
    const { id } = req.params as { id: string }
    const mergeTo = (req.body as any)?.merge_to as string | undefined

    if (mergeTo && !UUID_RE.test(mergeTo))
      return reply.code(400).send({ error: 'VALIDATION', message: 'merge_to must be a valid UUID' })

    const { count, error: countErr } = await fastify.supabase
      .from('sites')
      .select('id', { count: 'exact', head: true })
      .eq('state_id', id)
      .eq('tenant_id', req.tenantId)

    if (countErr) return reply.code(500).send({ error: 'QUERY_FAILED', message: 'Failed to check usage' })
    const usageCount = count ?? 0

    if (usageCount > 0 && !mergeTo)
      return reply.code(409).send({
        error:   'IN_USE',
        usageCount,
        message: `State is referenced by ${usageCount} site${usageCount !== 1 ? 's' : ''}. Provide merge_to to reassign.`,
      })

    if (mergeTo && usageCount > 0) {
      const { error: reassignErr } = await fastify.supabase
        .from('sites')
        .update({ state_id: mergeTo })
        .eq('state_id', id)
        .eq('tenant_id', req.tenantId)
      if (reassignErr) return reply.code(500).send({ error: 'REASSIGN_FAILED', message: reassignErr.message })
    }

    const { error } = await fastify.supabase
      .from('states')
      .delete()
      .eq('id', id)
      .eq('tenant_id', req.tenantId)

    if (error) return reply.code(500).send({ error: 'DB_ERROR', message: error.message })
    return reply.code(204).send()
  })
}
