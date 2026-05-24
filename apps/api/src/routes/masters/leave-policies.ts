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

// ── Validation schema ──────────────────────────────────────────────────────────

const policySchema = z.object({
  leave_type_id:           z.string().uuid(),
  accrual_type:            z.enum(['monthly', 'yearly', 'upfront']).default('yearly'),
  accrual_days_per_year:   z.number().min(0).max(365),
  max_accrual_balance:     z.number().min(0).max(365).nullable().optional(),
  eligibility_days:        z.number().int().min(0).max(3650).default(0),
  prorate_on_joining:      z.boolean().default(true),
  carry_forward_enabled:   z.boolean().default(false),
  carry_forward_max_days:  z.number().min(0).max(365).nullable().optional(),
  year_type:               z.enum(['calendar', 'financial']).default('calendar'),
})

// ── Route plugin ───────────────────────────────────────────────────────────────

export default async function leavePoliciesRoutes(fastify: FastifyInstance) {
  const auth = { preHandler: [fastify.authenticate] }

  function requireAdmin(req: any, reply: any): boolean {
    if (!['super_admin', 'hr_admin'].includes(req.userRole)) {
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
      return reply.code(500).send({ error: 'QUERY_FAILED', message: error.message })
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
      return reply.code(500).send({ error: 'QUERY_FAILED', message: error.message })
    }
    if (!data) {
      return reply.code(404).send({
        error:   'NOT_FOUND',
        message: 'No policy configured for this leave type',
      })
    }
    return reply.send({ data })
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
      return reply.code(500).send({ error: 'UPSERT_FAILED', message: error.message })
    }
    return reply.code(201).send({ data })
  })

  // ── PUT /:id ───────────────────────────────────────────────────────────────
  fastify.put('/:id', auth, async (req: any, reply) => {
    if (!requireAdmin(req, reply)) return

    const partial = policySchema.omit({ leave_type_id: true }).partial()
    const parsed  = partial.safeParse(req.body)
    if (!parsed.success) {
      return reply.code(400).send({
        error:   'VALIDATION_ERROR',
        message: parsed.error.issues[0]?.message,
      })
    }

    const { data, error } = await fastify.supabase
      .from('leave_policies')
      .update({ ...parsed.data, updated_at: new Date().toISOString() })
      .eq('id',        (req.params as any).id)
      .eq('tenant_id', req.tenantId)
      .select('*')
      .single()

    if (error) {
      return reply.code(500).send({ error: 'UPDATE_FAILED', message: error.message })
    }
    if (!data) {
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
      return reply.code(500).send({ error: 'DELETE_FAILED', message: error.message })
    }
    return reply.code(204).send()
  })
}
