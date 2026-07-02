/**
 * Work Locations CRUD — /masters/work-locations
 *
 * A work location is a specific office/desk address that belongs to a site
 * (physical campus / branch).  site_id is optional for backward-compat but
 * should be set for all new records.
 *
 * GET    /masters/work-locations            — list (optionally filter by site_id)
 * GET    /masters/work-locations/:id        — single record
 * POST   /masters/work-locations            — create   (hr_admin / super_admin)
 * PUT    /masters/work-locations/:id        — update   (hr_admin / super_admin)
 * DELETE /masters/work-locations/:id        — delete   (hr_admin / super_admin)
 */

import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { generateUniqueCode } from '../../lib/generate-code.js'
import { HR_ADMIN_ROLES } from '../../lib/rbac.js'

const schema = z.object({
  name:      z.string().min(1, 'Name is required'),
  code:      z.string().optional(),
  site_id:   z.string().uuid('site_id must be a valid UUID').optional().nullable(),
  address:   z.string().optional(),
  city:      z.string().optional(),
  state:     z.string().optional(),
  country:   z.string().optional().default('India'),
  pincode:   z.string().optional(),
  is_active: z.boolean().optional().default(true),
})

export default async function workLocationsRoutes(fastify: FastifyInstance) {
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

  // ── GET /masters/work-locations ────────────────────────────────────────────
  fastify.get('/', auth, async (req: any, reply) => {
    const siteId = (req.query as any)?.site_id as string | undefined

    let query = fastify.supabase
      .from('work_locations')
      .select('id, name, code, site_id, address, city, state, country, pincode, is_active, created_at')
      .eq('tenant_id', req.tenantId)
      .order('name')

    if (siteId) {
      query = query.eq('site_id', siteId)
    }

    const { data, error } = await query
    if (error) return reply.code(500).send({ error: 'DB_ERROR', message: error.message })
    return reply.send({ data: data ?? [] })
  })

  // ── GET /masters/work-locations/:id ───────────────────────────────────────
  fastify.get('/:id', auth, async (req: any, reply) => {
    const { data, error } = await fastify.supabase
      .from('work_locations')
      .select('id, name, code, site_id, address, city, state, country, pincode, is_active, created_at')
      .eq('id', req.params.id)
      .eq('tenant_id', req.tenantId)
      .maybeSingle()

    if (error) return reply.code(500).send({ error: 'DB_ERROR', message: error.message })
    if (!data) return reply.code(404).send({ error: 'NOT_FOUND', message: 'Work location not found' })
    return reply.send({ data })
  })

  // ── POST /masters/work-locations ───────────────────────────────────────────
  fastify.post('/', adminAuth, async (req: any, reply) => {
    const parsed = schema.safeParse(req.body)
    if (!parsed.success)
      return reply.code(400).send({ error: 'VALIDATION', message: parsed.error.issues[0].message })

    // Validate site_id belongs to this tenant
    if (parsed.data.site_id) {
      const { data: site } = await fastify.supabase
        .from('sites')
        .select('id')
        .eq('id', parsed.data.site_id)
        .eq('tenant_id', req.tenantId)
        .maybeSingle()
      if (!site) {
        return reply.code(400).send({
          error:   'VALIDATION',
          message: 'Site not found in your organisation',
          field:   'site_id',
        })
      }
    }

    const code = parsed.data.code?.trim() ||
      await generateUniqueCode(fastify.supabase, 'work_locations', req.tenantId, parsed.data.name)

    const { data, error } = await fastify.supabase
      .from('work_locations')
      .insert({ ...parsed.data, code, tenant_id: req.tenantId })
      .select('id, name, code, site_id, address, city, state, country, pincode, is_active, created_at')
      .single()

    if (error) {
      if (error.code === '23505') {
        return reply.code(409).send({
          error:   'DUPLICATE',
          message: `A work location with code "${parsed.data.code}" already exists`,
        })
      }
      return reply.code(500).send({ error: 'DB_ERROR', message: error.message })
    }
    return reply.code(201).send({ data })
  })

  // ── PUT /masters/work-locations/:id ───────────────────────────────────────
  fastify.put('/:id', adminAuth, async (req: any, reply) => {
    const parsed = schema.partial().safeParse(req.body)
    if (!parsed.success)
      return reply.code(400).send({ error: 'VALIDATION', message: parsed.error.issues[0].message })

    // Validate site_id belongs to this tenant (only when supplied)
    if (parsed.data.site_id) {
      const { data: site } = await fastify.supabase
        .from('sites')
        .select('id')
        .eq('id', parsed.data.site_id)
        .eq('tenant_id', req.tenantId)
        .maybeSingle()
      if (!site) {
        return reply.code(400).send({
          error:   'VALIDATION',
          message: 'Site not found in your organisation',
          field:   'site_id',
        })
      }
    }

    const { data, error } = await fastify.supabase
      .from('work_locations')
      .update(parsed.data)
      .eq('id', req.params.id)
      .eq('tenant_id', req.tenantId)
      .select('id, name, code, site_id, address, city, state, country, pincode, is_active, created_at')
      .single()

    if (error) return reply.code(500).send({ error: 'DB_ERROR', message: error.message })
    if (!data) return reply.code(404).send({ error: 'NOT_FOUND', message: 'Work location not found' })
    return reply.send({ data })
  })

  // ── GET /masters/work-locations/:id/usage ────────────────────────────────────
  fastify.get('/:id/usage', auth, async (req: any, reply) => {
    const { id } = req.params as { id: string }

    const { count, error } = await fastify.supabase
      .from('job_history')
      .select('id', { count: 'exact', head: true })
      .eq('work_location_id', id)
      .eq('tenant_id', req.tenantId)

    if (error) return reply.code(500).send({ error: 'QUERY_FAILED', message: error.message })
    return reply.send({ data: { job_history: count ?? 0, total: count ?? 0 } })
  })

  // ── DELETE /masters/work-locations/:id ───────────────────────────────────────
  fastify.delete('/:id', adminAuth, async (req: any, reply) => {
    const { id } = req.params as { id: string }
    const mergeTo = (req.body as any)?.merge_to as string | undefined

    if (mergeTo && !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(mergeTo)) {
      return reply.code(400).send({ error: 'VALIDATION', message: 'merge_to must be a valid UUID' })
    }

    const { count, error: countErr } = await fastify.supabase
      .from('job_history')
      .select('id', { count: 'exact', head: true })
      .eq('work_location_id', id)
      .eq('tenant_id', req.tenantId)

    if (countErr) return reply.code(500).send({ error: 'QUERY_FAILED', message: 'Failed to check usage' })

    const usageCount = count ?? 0

    if (usageCount > 0 && !mergeTo) {
      return reply.code(409).send({
        error: 'IN_USE',
        usageCount,
        message: `Work location is assigned to ${usageCount} employee record${usageCount !== 1 ? 's' : ''}. Provide merge_to to reassign.`,
      })
    }

    if (mergeTo && usageCount > 0) {
      const { error: reassignErr } = await fastify.supabase
        .from('job_history')
        .update({ work_location_id: mergeTo })
        .eq('work_location_id', id)
        .eq('tenant_id', req.tenantId)
      if (reassignErr) return reply.code(500).send({ error: 'REASSIGN_FAILED', message: reassignErr.message })
    }

    const { error } = await fastify.supabase
      .from('work_locations')
      .delete()
      .eq('id', id)
      .eq('tenant_id', req.tenantId)

    if (error) return reply.code(500).send({ error: 'DB_ERROR', message: error.message })
    return reply.code(204).send()
  })
}
