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
import { HR_ADMIN_ROLES } from '../../lib/rbac.js'
import { serverError, notFound, conflictError, ErrorCode } from '../../lib/api-errors.js'

const schema = z.object({
  name:              z.string().min(1, 'Name is required').max(50, 'Name must be 50 characters or less'),
  is_paid:           z.boolean().default(true),
  allow_sandwich:    z.boolean().default(false),
  allow_half_day:    z.boolean().default(false),
  allow_hourly:      z.boolean().default(false),
  max_hours_per_day: z.number().positive().max(24).nullable().optional(),
  is_active:         z.boolean().default(true),
})

// expected_version is optional so this stays backward-compatible with a
// frontend that hasn't been updated to send it yet (PEND-105 Phase C) — the
// CAS check below only runs when a caller actually provides it.
const updateSchema = schema.partial().extend({
  expected_version: z.number().int().positive().optional(),
})

export default async function leaveTypesRoutes(fastify: FastifyInstance) {
  const auth = { preHandler: [fastify.authenticate] }

  function requireAdmin(
    req: { userRole: string },
    reply: { code: (n: number) => { send: (b: unknown) => unknown } },
  ): boolean {
    if (!(HR_ADMIN_ROLES as readonly string[]).includes(req.userRole)) {
      reply.code(403).send({ error: 'FORBIDDEN', message: 'HR admin access required' })
      return false
    }
    return true
  }

  // ── GET /masters/leave-types ──────────────────────────────────────────────────
  fastify.get('/', auth, async (req: any, reply) => {
    const { data, error } = await fastify.supabase
      .from('leave_types')
      .select('id, name, is_paid, allow_sandwich, allow_half_day, allow_hourly, max_hours_per_day, is_active, version, created_at')
      .eq('tenant_id', req.tenantId)
      .order('name')

    if (error) {
      return serverError(req, reply, error, ErrorCode.QUERY_FAILED, 'Failed to fetch leave types')
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
      return serverError(req, reply, error, ErrorCode.INSERT_FAILED, 'Failed to seed standard leave types')
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
      .select('id, name, is_paid, allow_sandwich, allow_half_day, allow_hourly, max_hours_per_day, is_active, version, created_at')
      .single()

    if (error) {
      if (error.code === '23505') {
        return reply.code(409).send({
          error:   'DUPLICATE',
          message: `Leave type "${parsed.data.name}" already exists`,
        })
      }
      return serverError(req, reply, error, ErrorCode.INSERT_FAILED, 'Failed to create leave type')
    }

    return reply.code(201).send({ data })
  })

  // ── PUT /masters/leave-types/:id ──────────────────────────────────────────────
  fastify.put('/:id', auth, async (req: any, reply) => {
    if (!requireAdmin(req, reply)) return

    const parsed = updateSchema.safeParse(req.body)
    if (!parsed.success) {
      return reply.code(400).send({
        error:   'VALIDATION_ERROR',
        message: parsed.error.issues[0]?.message,
      })
    }

    const { expected_version, ...fields } = parsed.data

    let query = fastify.supabase
      .from('leave_types')
      .update(fields)
      .eq('id', (req.params as { id: string }).id)
      .eq('tenant_id', req.tenantId)
    // PEND-105: optimistic-concurrency check — only applied when the caller
    // sends expected_version (see updateSchema comment above).
    if (expected_version !== undefined) query = query.eq('version', expected_version)

    const { data, error } = await query
      .select('id, name, is_paid, allow_sandwich, allow_half_day, allow_hourly, max_hours_per_day, is_active, version, created_at')
      .maybeSingle()

    if (error) {
      if (error.code === '23505') {
        return reply.code(409).send({ error: 'DUPLICATE', message: 'A leave type with that name already exists' })
      }
      return serverError(req, reply, error, ErrorCode.UPDATE_FAILED, 'Failed to update leave type')
    }

    if (!data) {
      // 0 rows matched — either the record doesn't exist, or it does but
      // `version` moved on since expected_version was read. Disambiguate
      // with a plain existence check so a genuinely-deleted record still
      // reports 404, not a confusing 409.
      if (expected_version !== undefined) {
        const { data: exists } = await fastify.supabase
          .from('leave_types')
          .select('id')
          .eq('id', (req.params as { id: string }).id)
          .eq('tenant_id', req.tenantId)
          .maybeSingle()
        if (exists) {
          return conflictError(reply, ErrorCode.VERSION_CONFLICT,
            'This leave type was changed by someone else. Reload and try again.')
        }
      }
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
      return serverError(req, reply, countErr, ErrorCode.QUERY_FAILED, 'Failed to check leave type usage')
    }

    if ((count ?? 0) > 0) {
      // Soft-deactivate — preserve historical data integrity
      const { data: updated, error: updateErr } = await fastify.supabase
        .from('leave_types')
        .update({ is_active: false })
        .eq('id', id)
        .eq('tenant_id', req.tenantId)
        .select('id')
        .maybeSingle()

      if (updateErr) {
        return serverError(req, reply, updateErr, ErrorCode.UPDATE_FAILED, 'Failed to deactivate leave type')
      }
      if (!updated) return notFound(reply, 'NOT_FOUND', 'Leave type not found')

      return reply.send({
        message: 'Leave type deactivated — it has existing leave requests and cannot be deleted',
        deactivated: true,
      })
    }

    // Hard delete — no applications reference this type
    const { data: deleted, error: deleteErr } = await fastify.supabase
      .from('leave_types')
      .delete()
      .eq('id', id)
      .eq('tenant_id', req.tenantId)
      .select('id')
      .maybeSingle()

    if (deleteErr) {
      return serverError(req, reply, deleteErr, ErrorCode.DELETE_FAILED, 'Failed to delete leave type')
    }
    if (!deleted) return notFound(reply, 'NOT_FOUND', 'Leave type not found')

    return reply.code(204).send()
  })
}
