/**
 * Leave Types CRUD Routes
 *
 * GET    /masters/leave-types        — list all leave types (active + inactive)
 * POST   /masters/leave-types        — create a new leave type
 * PUT    /masters/leave-types/:id    — update a leave type
 * DELETE /masters/leave-types/:id    — soft-deactivate if in use; hard-delete if not
 *
 * Protected:
 *   GET  — any authenticated user
 *   POST / PUT / DELETE — hr_admin or super_admin only
 */
import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { STANDARD_LEAVE_TYPES } from '../../lib/standard-leave-types.js'

const schema = z.object({
  name:              z.string().min(1, 'Name is required').max(50, 'Name must be 50 characters or less'),
  is_paid:           z.boolean().default(true),
  allow_sandwich:    z.boolean().default(false),
  allow_half_day:    z.boolean().default(false),
  allow_hourly:      z.boolean().default(false),
  max_hours_per_day: z.number().min(0).max(24).nullable().optional(),
  is_active:         z.boolean().default(true),
})

export default async function leaveTypesRoutes(fastify: FastifyInstance) {
  const auth = { preHandler: [fastify.authenticate] }

  function requireAdmin(
    req: { userRole: string },
    reply: { code: (n: number) => { send: (b: unknown) => unknown } },
  ): boolean {
    if (!['super_admin', 'hr_admin'].includes(req.userRole)) {
      reply.code(403).send({ error: 'FORBIDDEN', message: 'HR admin access required' })
      return false
    }
    return true
  }

  // ── GET /masters/leave-types ──────────────────────────────────────────────────
  fastify.get('/', auth, async (req: any, reply) => {
    const { data, error } = await fastify.supabase
      .from('leave_types')
      .select('id, name, is_paid, allow_sandwich, allow_half_day, allow_hourly, max_hours_per_day, is_active, created_at')
      .eq('tenant_id', req.tenantId)
      .order('name')

    if (error) {
      req.log.error({ err: error }, 'leave types list failed')
      return reply.code(500).send({ error: 'QUERY_FAILED', message: 'Failed to fetch leave types' })
    }

    return reply.send({ data: data ?? [] })
  })

  // ── POST /masters/leave-types/seed-standard ───────────────────────────────────
  // Load the best-practice standard leave-type set. Idempotent — existing names
  // (UNIQUE tenant_id,name) are preserved.
  fastify.post('/seed-standard', auth, async (req: any, reply) => {
    if (!requireAdmin(req, reply)) return

    const rows = STANDARD_LEAVE_TYPES.map(t => ({
      tenant_id:         req.tenantId,
      name:              t.name,
      is_paid:           t.is_paid,
      allow_sandwich:    t.allow_sandwich,
      allow_half_day:    t.allow_half_day,
      allow_hourly:      t.allow_hourly,
      max_hours_per_day: t.max_hours_per_day,
      is_active:         true,
    }))

    const { data, error } = await fastify.supabase
      .from('leave_types')
      .upsert(rows, { onConflict: 'tenant_id,name', ignoreDuplicates: true })
      .select('id')

    if (error) {
      req.log.error({ err: error }, 'leave type seed failed')
      return reply.code(500).send({ error: 'SEED_FAILED', message: error.message })
    }

    const created = (data as Array<{ id: string }> | null)?.length ?? 0
    return reply.code(201).send({ data: { created, skipped: rows.length - created, total: rows.length } })
  })

  // ── POST /masters/leave-types ─────────────────────────────────────────────────
  fastify.post('/', auth, async (req: any, reply) => {
    if (!requireAdmin(req, reply)) return

    const parsed = schema.safeParse(req.body)
    if (!parsed.success) {
      return reply.code(400).send({
        error:   'VALIDATION_ERROR',
        message: parsed.error.issues[0]?.message,
      })
    }

    const { data, error } = await fastify.supabase
      .from('leave_types')
      .insert({ tenant_id: req.tenantId, ...parsed.data })
      .select('id, name, is_paid, allow_sandwich, allow_half_day, allow_hourly, max_hours_per_day, is_active, created_at')
      .single()

    if (error) {
      if (error.code === '23505') {
        return reply.code(409).send({
          error:   'DUPLICATE',
          message: `Leave type "${parsed.data.name}" already exists`,
        })
      }
      req.log.error({ err: error }, 'leave type insert failed')
      return reply.code(500).send({ error: 'INSERT_FAILED', message: 'Failed to create leave type' })
    }

    return reply.code(201).send({ data })
  })

  // ── PUT /masters/leave-types/:id ──────────────────────────────────────────────
  fastify.put('/:id', auth, async (req: any, reply) => {
    if (!requireAdmin(req, reply)) return

    const parsed = schema.partial().safeParse(req.body)
    if (!parsed.success) {
      return reply.code(400).send({
        error:   'VALIDATION_ERROR',
        message: parsed.error.issues[0]?.message,
      })
    }

    const { data, error } = await fastify.supabase
      .from('leave_types')
      .update(parsed.data)
      .eq('id', (req.params as { id: string }).id)
      .eq('tenant_id', req.tenantId)
      .select('id, name, is_paid, allow_sandwich, allow_half_day, allow_hourly, max_hours_per_day, is_active, created_at')
      .single()

    if (error) {
      if (error.code === '23505') {
        return reply.code(409).send({ error: 'DUPLICATE', message: 'A leave type with that name already exists' })
      }
      req.log.error({ err: error }, 'leave type update failed')
      return reply.code(500).send({ error: 'UPDATE_FAILED', message: 'Failed to update leave type' })
    }

    if (!data) {
      return reply.code(404).send({ error: 'NOT_FOUND', message: 'Leave type not found' })
    }

    return reply.send({ data })
  })

  // ── DELETE /masters/leave-types/:id ───────────────────────────────────────────
  // Soft-deactivates if any leave_requests reference this type;
  // hard-deletes otherwise.
  fastify.delete('/:id', auth, async (req: any, reply) => {
    if (!requireAdmin(req, reply)) return

    const id = (req.params as { id: string }).id

    // Check if any leave requests reference this type
    const { count, error: countErr } = await fastify.supabase
      .from('leave_requests')
      .select('id', { count: 'exact', head: true })
      .eq('leave_type_id', id)
      .eq('tenant_id', req.tenantId)

    if (countErr) {
      req.log.error({ err: countErr }, 'leave type usage check failed')
      return reply.code(500).send({ error: 'QUERY_FAILED', message: 'Failed to check leave type usage' })
    }

    if ((count ?? 0) > 0) {
      // Soft-deactivate — preserve historical data integrity
      const { error: updateErr } = await fastify.supabase
        .from('leave_types')
        .update({ is_active: false })
        .eq('id', id)
        .eq('tenant_id', req.tenantId)

      if (updateErr) {
        req.log.error({ err: updateErr }, 'leave type deactivate failed')
        return reply.code(500).send({ error: 'UPDATE_FAILED', message: 'Failed to deactivate leave type' })
      }

      return reply.send({
        message: 'Leave type deactivated — it has existing leave requests and cannot be deleted',
        deactivated: true,
      })
    }

    // Hard delete — no applications reference this type
    const { error: deleteErr } = await fastify.supabase
      .from('leave_types')
      .delete()
      .eq('id', id)
      .eq('tenant_id', req.tenantId)

    if (deleteErr) {
      req.log.error({ err: deleteErr }, 'leave type delete failed')
      return reply.code(500).send({ error: 'DELETE_FAILED', message: 'Failed to delete leave type' })
    }

    return reply.code(204).send()
  })
}
