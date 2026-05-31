/**
 * Important Date Types Routes — /masters/important-date-types
 *
 * Tenant-configurable event types that drive event-triggered leave grants.
 * System types (birthday, marriage_anniversary, joining_anniversary) are
 * seeded by migration 155 and cannot be deleted.
 *
 * Routes:
 *   GET    /masters/important-date-types          — list all (active + inactive)
 *   POST   /masters/important-date-types          — create custom type
 *   PUT    /masters/important-date-types/:id      — update name/description/active
 *   DELETE /masters/important-date-types/:id      — delete (system types refused)
 *
 * Protected:
 *   GET  — any authenticated user
 *   POST / PUT / DELETE — hr_admin or super_admin only
 */

import type { FastifyInstance } from 'fastify'
import { z } from 'zod'

const createSchema = z.object({
  code: z
    .string()
    .min(2)
    .max(64)
    .regex(/^[a-z][a-z0-9_]{0,63}$/, 'code must be lowercase letters, digits, and underscores only'),
  name:        z.string().min(1).max(120),
  description: z.string().max(500).optional(),
  is_active:   z.boolean().default(true),
})

const updateSchema = z.object({
  name:        z.string().min(1).max(120).optional(),
  description: z.string().max(500).optional().nullable(),
  is_active:   z.boolean().optional(),
})

export default async function importantDateTypesRoutes(fastify: FastifyInstance) {
  const auth = { preHandler: [fastify.authenticate] }

  function requireAdmin(
    req:   { userRole: string },
    reply: { code: (n: number) => { send: (b: unknown) => unknown } },
  ): boolean {
    if (!['super_admin', 'hr_admin'].includes(req.userRole)) {
      reply.code(403).send({ error: 'FORBIDDEN', message: 'HR admin access required' })
      return false
    }
    return true
  }

  // ── GET /masters/important-date-types ─────────────────────────────────────
  fastify.get('/', auth, async (req: any, reply) => {
    const includeInactive = (req.query as Record<string, string>).include_inactive === 'true'

    let query = fastify.supabase
      .from('important_date_types')
      .select('id, code, name, description, is_system, is_active, created_at')
      .eq('tenant_id', req.tenantId)
      .order('is_system', { ascending: false })
      .order('name')

    if (!includeInactive) {
      query = query.eq('is_active', true)
    }

    const { data, error } = await query

    if (error) {
      req.log.error({ err: error }, 'important-date-types list failed')
      return reply.code(500).send({ error: 'QUERY_FAILED', message: 'Failed to fetch date types' })
    }

    return reply.send({ data: data ?? [] })
  })

  // ── POST /masters/important-date-types ────────────────────────────────────
  fastify.post('/', auth, async (req: any, reply) => {
    if (!requireAdmin(req, reply)) return

    const parsed = createSchema.safeParse(req.body)
    if (!parsed.success) {
      return reply.code(400).send({
        error:   'VALIDATION_ERROR',
        message: parsed.error.issues[0]?.message,
      })
    }

    const { code, name, description, is_active } = parsed.data

    // Prevent duplicate code for this tenant
    const { data: existing } = await fastify.supabase
      .from('important_date_types')
      .select('id')
      .eq('tenant_id', req.tenantId)
      .eq('code', code)
      .maybeSingle()

    if (existing) {
      return reply.code(409).send({
        error:   'DUPLICATE_CODE',
        message: `An important date type with code '${code}' already exists`,
      })
    }

    const { data, error } = await fastify.supabase
      .from('important_date_types')
      .insert({
        tenant_id:   req.tenantId,
        code,
        name,
        description: description ?? null,
        is_system:   false,
        is_active,
      })
      .select('id, code, name, description, is_system, is_active, created_at')
      .single()

    if (error) {
      req.log.error({ err: error }, 'important-date-types create failed')
      return reply.code(500).send({ error: 'INSERT_FAILED', message: 'Failed to create date type' })
    }

    return reply.code(201).send({ data })
  })

  // ── PUT /masters/important-date-types/:id ─────────────────────────────────
  fastify.put('/:id', auth, async (req: any, reply) => {
    if (!requireAdmin(req, reply)) return

    const { id } = req.params as { id: string }

    const parsed = updateSchema.safeParse(req.body)
    if (!parsed.success) {
      return reply.code(400).send({
        error:   'VALIDATION_ERROR',
        message: parsed.error.issues[0]?.message,
      })
    }

    // Fetch existing to validate ownership
    const { data: existing } = await fastify.supabase
      .from('important_date_types')
      .select('id, is_system')
      .eq('id', id)
      .eq('tenant_id', req.tenantId)
      .maybeSingle()

    if (!existing) {
      return reply.code(404).send({ error: 'NOT_FOUND', message: 'Date type not found' })
    }

    // Build update payload — system types: allow name/description/active changes,
    // but code is always immutable (not in updateSchema).
    const updates: Record<string, unknown> = {}
    if (parsed.data.name        !== undefined) updates.name        = parsed.data.name
    if (parsed.data.description !== undefined) updates.description = parsed.data.description
    if (parsed.data.is_active   !== undefined) updates.is_active   = parsed.data.is_active

    if (!Object.keys(updates).length) {
      return reply.code(400).send({ error: 'NO_CHANGES', message: 'Nothing to update' })
    }

    const { data, error } = await fastify.supabase
      .from('important_date_types')
      .update(updates)
      .eq('id', id)
      .eq('tenant_id', req.tenantId)
      .select('id, code, name, description, is_system, is_active, updated_at')
      .single()

    if (error) {
      req.log.error({ err: error }, 'important-date-types update failed')
      return reply.code(500).send({ error: 'UPDATE_FAILED', message: 'Failed to update date type' })
    }

    return reply.send({ data })
  })

  // ── DELETE /masters/important-date-types/:id ──────────────────────────────
  fastify.delete('/:id', auth, async (req: any, reply) => {
    if (!requireAdmin(req, reply)) return

    const { id } = req.params as { id: string }

    const { data: existing } = await fastify.supabase
      .from('important_date_types')
      .select('id, is_system, code')
      .eq('id', id)
      .eq('tenant_id', req.tenantId)
      .maybeSingle()

    if (!existing) {
      return reply.code(404).send({ error: 'NOT_FOUND', message: 'Date type not found' })
    }

    const e = existing as { id: string; is_system: boolean; code: string }
    if (e.is_system) {
      return reply.code(409).send({
        error:   'SYSTEM_TYPE',
        message: `System date type '${e.code}' cannot be deleted. You can disable it instead.`,
      })
    }

    // Check whether any employee_important_dates reference this type
    const { count } = await fastify.supabase
      .from('employee_important_dates')
      .select('id', { count: 'exact', head: true })
      .eq('tenant_id', req.tenantId)
      .eq('date_type_id', id)

    if ((count ?? 0) > 0) {
      return reply.code(409).send({
        error:   'REFERENCED',
        message: 'This date type is referenced by employee records and cannot be deleted. Disable it instead.',
      })
    }

    const { error } = await fastify.supabase
      .from('important_date_types')
      .delete()
      .eq('id', id)
      .eq('tenant_id', req.tenantId)

    if (error) {
      req.log.error({ err: error }, 'important-date-types delete failed')
      return reply.code(500).send({ error: 'DELETE_FAILED', message: 'Failed to delete date type' })
    }

    return reply.code(204).send()
  })
}
