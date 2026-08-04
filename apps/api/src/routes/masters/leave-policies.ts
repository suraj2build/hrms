/**
 * Leave Policies CRUD — /masters/leave-policies
 *
 * Endpoints:
 *   GET    /                        – list all policies (with leave_type info)
 *   GET    /by-type/:leaveTypeId    – single policy for a leave type (404 if none)
 *   POST   /                        – upsert a policy (create or overwrite)
 *   PUT    /:id                     – partial update of an existing policy
 *   DELETE /:id                     – remove a policy
 *
 * Access:  read = any authenticated user in tenant
 *          write = hr_admin / super_admin
 */

import type { FastifyInstance } from 'fastify'
import { z }                    from 'zod'
import { HR_ADMIN_ROLES } from '../../lib/rbac.js'
import { serverError, conflictError, ErrorCode } from '../../lib/api-errors.js'

// ── Validation schema ──────────────────────────────────────────────────────────

const policySchema = z.object({
  leave_type_id:                z.string().uuid(),
  accrual_type:                 z.enum(['monthly', 'quarterly', 'yearly', 'upfront']).default('yearly'),
  accrual_days_per_year:        z.number().min(0).max(365),
  max_accrual_balance:          z.number().min(0).max(365).nullable().optional(),
  eligibility_days:             z.number().int().min(0).max(3650).default(0),
  prorate_on_joining:           z.boolean().default(true),
  carry_forward_enabled:        z.boolean().default(false),
  carry_forward_max_days:       z.number().min(0).max(365).nullable().optional(),
  year_type:                    z.enum(['calendar', 'financial']).default('calendar'),
  // ── Session governance (migration 158 + 160) ────────────────────────────────
  allow_half_day:               z.boolean().default(true),
  allow_hourly_leave:           z.boolean().default(false),
  allow_cross_session:          z.boolean().default(true),
  minimum_leave_unit:           z.number().refine(v => [0.25, 0.5, 1.0].includes(v), {
    message: 'minimum_leave_unit must be 0.25, 0.5, or 1.0',
  }).default(0.5),
  maximum_sessions_per_day:     z.number().int().min(1).max(4).default(2),
  session_calculation_mode:     z.enum(['standard', 'shift_aware', 'attendance_aware']).default('standard'),
  holiday_session_handling:     z.enum(['skip', 'include', 'block']).default('skip'),
  weekoff_session_handling:     z.enum(['skip', 'include', 'sandwich_only']).default('skip'),
  fractional_rounding_mode:     z.enum(['half_up', 'half_down', 'ceil', 'floor', 'nearest_0_5', 'nearest_0_25']).default('nearest_0_5'),
  maximum_fractional_precision: z.number().default(0.5),
  hours_per_shift:              z.number().min(1).max(24).default(8),
  // DB CHECK (migration 158) requires strictly > 0 when set — NULL means "no
  // limit", but 0 is not a valid way to express that and would fail the
  // CHECK constraint.
  max_hours_per_day:            z.number().positive().max(24).nullable().optional(),
  // ── Application window governance (migration 161) ───────────────────────────
  allow_past_dated_leave:               z.boolean().default(false),
  maximum_past_days:                    z.number().int().min(0).default(0),
  allow_current_period_leave:           z.boolean().default(true),
  allow_future_leave:                   z.boolean().default(true),
  maximum_future_days:                  z.number().int().min(0).nullable().optional(),
  future_application_requires_approval: z.boolean().default(false),
  same_day_application_mode:            z.enum(['allowed', 'restricted', 'manager_override_only']).default('allowed'),
})

// expected_version is optional so this stays backward-compatible with a
// frontend that hasn't been updated to send it yet (PEND-105 Phase C) — the
// CAS check below only runs when a caller actually provides it.
const updateSchema = policySchema.omit({ leave_type_id: true }).partial().extend({
  expected_version: z.number().int().positive().optional(),
})

// ── Route plugin ───────────────────────────────────────────────────────────────

export default async function leavePoliciesRoutes(fastify: FastifyInstance) {
  const auth = { preHandler: [fastify.authenticate] }

  function requireAdmin(req: any, reply: any): boolean {
    if (!(HR_ADMIN_ROLES as readonly string[]).includes(req.userRole)) {
      reply.code(403).send({ error: 'FORBIDDEN', message: 'HR admin access required' })
      return false
    }
    return true
  }

  // ── GET / ──────────────────────────────────────────────────────────────────
  fastify.get('/', auth, async (req: any, reply) => {
    const { data, error } = await fastify.supabase
      .from('leave_policies')
      .select('*, leave_types(id, name, is_paid, is_active)')
      .eq('tenant_id', req.tenantId)
      .order('created_at')

    if (error) {
      return serverError(req, reply, error, ErrorCode.QUERY_FAILED, 'Failed to fetch leave policies')
    }
    return reply.send({ data: data ?? [] })
  })

  // ── GET /by-type/:leaveTypeId ──────────────────────────────────────────────
  fastify.get('/by-type/:leaveTypeId', auth, async (req: any, reply) => {
    const { leaveTypeId } = req.params as { leaveTypeId: string }

    const { data, error } = await fastify.supabase
      .from('leave_policies')
      .select('*, leave_types(id, name, is_paid, is_active)')
      .eq('tenant_id',     req.tenantId)
      .eq('leave_type_id', leaveTypeId)
      .maybeSingle()

    if (error) {
      return serverError(req, reply, error, ErrorCode.QUERY_FAILED, 'Failed to fetch leave policy')
    }
    // Return null data instead of 404 — frontend treats null as "no policy configured"
    return reply.send({ data: data ?? null })
  })

  // ── POST / (upsert) ────────────────────────────────────────────────────────
  fastify.post('/', auth, async (req: any, reply) => {
    if (!requireAdmin(req, reply)) return

    const parsed = policySchema.safeParse(req.body)
    if (!parsed.success) {
      return reply.code(400).send({
        error:   'VALIDATION_ERROR',
        message: parsed.error.issues[0]?.message,
      })
    }

    // Verify the leave_type belongs to this tenant
    const { data: lt } = await fastify.supabase
      .from('leave_types')
      .select('id')
      .eq('id',        parsed.data.leave_type_id)
      .eq('tenant_id', req.tenantId)
      .maybeSingle()

    if (!lt) {
      return reply.code(404).send({
        error:   'NOT_FOUND',
        message: 'Leave type not found in this tenant',
      })
    }

    const { data, error } = await fastify.supabase
      .from('leave_policies')
      .upsert(
        {
          tenant_id:   req.tenantId,
          ...parsed.data,
          updated_at:  new Date().toISOString(),
        },
        { onConflict: 'tenant_id,leave_type_id' },
      )
      .select('*')
      .single()

    if (error) {
      return serverError(req, reply, error, ErrorCode.UPDATE_FAILED, 'Failed to save leave policy')
    }
    return reply.code(201).send({ data })
  })

  // ── PUT /:id ───────────────────────────────────────────────────────────────
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
    const id = (req.params as any).id

    let query = fastify.supabase
      .from('leave_policies')
      .update({ ...fields, updated_at: new Date().toISOString() })
      .eq('id',        id)
      .eq('tenant_id', req.tenantId)
    // PEND-105: optimistic-concurrency check — only applied when the caller
    // sends expected_version (see updateSchema comment above).
    if (expected_version !== undefined) query = query.eq('version', expected_version)

    const { data, error } = await query
      .select('*')
      .maybeSingle()

    if (error) {
      return serverError(req, reply, error, ErrorCode.UPDATE_FAILED, 'Failed to update leave policy')
    }
    if (!data) {
      // 0 rows matched — either the record doesn't exist, or it does but
      // `version` moved on since expected_version was read. Disambiguate
      // with a plain existence check so a genuinely-deleted record still
      // reports 404, not a confusing 409.
      if (expected_version !== undefined) {
        const { data: exists } = await fastify.supabase
          .from('leave_policies')
          .select('id')
          .eq('id',        id)
          .eq('tenant_id', req.tenantId)
          .maybeSingle()
        if (exists) {
          return conflictError(reply, ErrorCode.VERSION_CONFLICT,
            'This leave policy was changed by someone else. Reload and try again.')
        }
      }
      return reply.code(404).send({ error: 'NOT_FOUND', message: 'Policy not found' })
    }
    return reply.send({ data })
  })

  // ── DELETE /:id ────────────────────────────────────────────────────────────
  fastify.delete('/:id', auth, async (req: any, reply) => {
    if (!requireAdmin(req, reply)) return

    const { error } = await fastify.supabase
      .from('leave_policies')
      .delete()
      .eq('id',        (req.params as any).id)
      .eq('tenant_id', req.tenantId)

    if (error) {
      return serverError(req, reply, error, ErrorCode.DELETE_FAILED, 'Failed to delete leave policy')
    }
    return reply.code(204).send()
  })
}
