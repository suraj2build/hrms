/**
 * Leave Policy Rules — nested under /masters/leave-policy-masters/:policyId/rules
 * and /masters/leave-policy-rules/:id
 *
 * Endpoints:
 *   GET    /masters/leave-policy-masters/:policyId/rules      — list rules for a policy
 *   POST   /masters/leave-policy-masters/:policyId/rules      — add a rule to a policy
 *   PUT    /masters/leave-policy-rules/:id                    — update a specific rule
 *   DELETE /masters/leave-policy-rules/:id                    — remove a specific rule
 *
 * Each rule defines accrual, carry-forward, eligibility, and usage constraints
 * for ONE leave type inside a named policy master.
 *
 * Access:
 *   read  — any authenticated user in the tenant
 *   write — hr_admin / super_admin
 */

import type { FastifyInstance } from 'fastify'
import { z }                    from 'zod'
import { logAction }            from '../../lib/audit-service.js'
import { HR_ADMIN_ROLES } from '../../lib/rbac.js'

const ruleSchema = z.object({
  leave_type_id:                z.string().uuid(),
  accrual_type:                 z.enum(['monthly', 'quarterly', 'yearly', 'upfront']).default('yearly'),
  accrual_days_per_year:        z.number().min(0).max(365),
  accrual_timing:               z.enum(['beginning_of_cycle', 'end_of_cycle']).default('beginning_of_cycle'),
  max_accrual_balance:          z.number().min(0).max(365).nullable().optional(),
  eligibility_days:             z.number().int().min(0).max(3650).default(0),
  prorate_on_joining:           z.boolean().default(true),
  carry_forward_enabled:        z.boolean().default(false),
  carry_forward_max_days:       z.number().min(0).max(365).nullable().optional(),
  expiry_days:                  z.number().int().min(1).nullable().optional(),
  max_consecutive_days:         z.number().int().min(1).nullable().optional(),
  min_gap_days:                 z.number().int().min(0).max(365).default(0),
  // Event-triggered grant fields (optional — NULL = regular accrual rule)
  event_trigger_date_type_id:   z.string().uuid().nullable().optional(),
  event_grant_days:             z.number().min(0.5).max(30).nullable().optional(),
  event_validity_days:          z.number().int().min(0).max(365).nullable().optional(),
})

export default async function leavePolicyRulesRoutes(fastify: FastifyInstance) {
  const auth = { preHandler: [fastify.authenticate] }

  function requireAdmin(req: any, reply: any): boolean {
    if (!(HR_ADMIN_ROLES as readonly string[]).includes(req.userRole)) {
      reply.code(403).send({ error: 'FORBIDDEN', message: 'HR admin access required' })
      return false
    }
    return true
  }

  /** Verify policy_id belongs to the tenant.  Returns null + sends 404 on failure. */
  async function verifyPolicy(
    policyId: string,
    tenantId: string,
    reply: any,
  ): Promise<{ id: string } | null> {
    const { data } = await fastify.supabase
      .from('leave_policy_masters')
      .select('id')
      .eq('id', policyId)
      .eq('tenant_id', tenantId)
      .maybeSingle()

    if (!data) {
      reply.code(404).send({ error: 'POLICY_NOT_FOUND', message: 'Policy not found' })
      return null
    }
    return data as { id: string }
  }

  // ── GET /masters/leave-policy-masters/:policyId/rules ─────────────────────
  fastify.get('/:policyId/rules', auth, async (req: any, reply) => {
    const { policyId } = req.params as { policyId: string }

    if (!await verifyPolicy(policyId, req.tenantId, reply)) return

    const { data, error } = await fastify.supabase
      .from('leave_policy_rules')
      .select(`
        id, policy_id, leave_type_id,
        accrual_type, accrual_days_per_year, accrual_timing, max_accrual_balance,
        eligibility_days, prorate_on_joining,
        carry_forward_enabled, carry_forward_max_days,
        expiry_days, max_consecutive_days, min_gap_days,
        event_trigger_date_type_id, event_grant_days, event_validity_days,
        created_at, updated_at,
        leave_types(id, name, is_paid, is_active)
      `)
      .eq('tenant_id', req.tenantId)
      .eq('policy_id', policyId)
      .order('leave_type_id')

    if (error) {
      return reply.code(500).send({ error: 'QUERY_FAILED', message: error.message })
    }

    return reply.send({ data: data ?? [] })
  })

  // ── POST /masters/leave-policy-masters/:policyId/rules ────────────────────
  fastify.post('/:policyId/rules', auth, async (req: any, reply) => {
    if (!requireAdmin(req, reply)) return

    const { policyId } = req.params as { policyId: string }

    if (!await verifyPolicy(policyId, req.tenantId, reply)) return

    const parsed = ruleSchema.safeParse(req.body)
    if (!parsed.success) {
      return reply.code(400).send({
        error:   'VALIDATION_ERROR',
        message: parsed.error.issues[0]?.message,
      })
    }

    // Verify leave_type belongs to this tenant
    const { data: lt } = await fastify.supabase
      .from('leave_types')
      .select('id')
      .eq('id', parsed.data.leave_type_id)
      .eq('tenant_id', req.tenantId)
      .maybeSingle()

    if (!lt) {
      return reply.code(404).send({
        error:   'LEAVE_TYPE_NOT_FOUND',
        message: 'Leave type not found in this tenant',
      })
    }

    const { data, error } = await fastify.supabase
      .from('leave_policy_rules')
      .insert({
        tenant_id: req.tenantId,
        policy_id: policyId,
        ...parsed.data,
      })
      .select(`
        id, policy_id, leave_type_id,
        accrual_type, accrual_days_per_year, accrual_timing, max_accrual_balance,
        eligibility_days, prorate_on_joining,
        carry_forward_enabled, carry_forward_max_days,
        expiry_days, max_consecutive_days, min_gap_days,
        event_trigger_date_type_id, event_grant_days, event_validity_days,
        created_at
      `)
      .single()

    if (error) {
      if (error.code === '23505') {
        return reply.code(409).send({
          error:   'DUPLICATE',
          message: 'A rule for this leave type already exists in this policy',
        })
      }
      return reply.code(500).send({ error: 'INSERT_FAILED', message: error.message })
    }

    await logAction(fastify.supabase, {
      tenantId:    req.tenantId,
      tableName:   'leave_policy_rules',
      recordId:    (data as any).id,
      action:      'INSERT',
      performedBy: req.userId,
      newData:     { policy_id: policyId, ...parsed.data },
    })

    return reply.code(201).send({ data })
  })

  // ── PUT /masters/leave-policy-rules/:id ───────────────────────────────────
  // NOTE: This route is registered at a DIFFERENT prefix in masters/index.ts.
  // The file exports one plugin; the index registers it at two prefixes.
  // We handle both nested and flat paths in a single plugin by treating
  // /:policyId/rules/:ruleId and /rule-update/:id as separate routes.

  // The PUT and DELETE are also registered here but the prefix will be
  // /masters/leave-policy-rules in index.ts (see registration below).
}

// ── Standalone PUT/DELETE plugin ───────────────────────────────────────────────
// Registered under /masters/leave-policy-rules prefix.

const ruleUpdateSchema = ruleSchema.omit({ leave_type_id: true }).partial()

export async function leavePolicyRulesMutationsRoutes(fastify: FastifyInstance) {
  const auth = { preHandler: [fastify.authenticate] }

  function requireAdmin(req: any, reply: any): boolean {
    if (!(HR_ADMIN_ROLES as readonly string[]).includes(req.userRole)) {
      reply.code(403).send({ error: 'FORBIDDEN', message: 'HR admin access required' })
      return false
    }
    return true
  }

  // Import audit helper (available via closure over fastify.supabase below)

  // ── PUT /:id ───────────────────────────────────────────────────────────────
  fastify.put('/:id', auth, async (req: any, reply) => {
    if (!requireAdmin(req, reply)) return

    const { id } = req.params as { id: string }

    const parsed = ruleUpdateSchema.safeParse(req.body)
    if (!parsed.success) {
      return reply.code(400).send({
        error:   'VALIDATION_ERROR',
        message: parsed.error.issues[0]?.message,
      })
    }

    // Verify the rule belongs to this tenant
    const { data: existing } = await fastify.supabase
      .from('leave_policy_rules')
      .select('id')
      .eq('id', id)
      .eq('tenant_id', req.tenantId)
      .maybeSingle()

    if (!existing) {
      return reply.code(404).send({ error: 'NOT_FOUND', message: 'Rule not found' })
    }

    const { data, error } = await fastify.supabase
      .from('leave_policy_rules')
      .update({ ...parsed.data, updated_at: new Date().toISOString() })
      .eq('id', id)
      .eq('tenant_id', req.tenantId)
      .select(`
        id, policy_id, leave_type_id,
        accrual_type, accrual_days_per_year, accrual_timing, max_accrual_balance,
        eligibility_days, prorate_on_joining,
        carry_forward_enabled, carry_forward_max_days,
        expiry_days, max_consecutive_days, min_gap_days,
        event_trigger_date_type_id, event_grant_days, event_validity_days,
        updated_at
      `)
      .single()

    if (error) {
      return reply.code(500).send({ error: 'UPDATE_FAILED', message: error.message })
    }

    await logAction(fastify.supabase, {
      tenantId:    req.tenantId,
      tableName:   'leave_policy_rules',
      recordId:    id,
      action:      'UPDATE',
      performedBy: req.userId,
      oldData:     { id },
      newData:     parsed.data,
    })

    return reply.send({ data })
  })

  // ── DELETE /:id ────────────────────────────────────────────────────────────
  fastify.delete('/:id', auth, async (req: any, reply) => {
    if (!requireAdmin(req, reply)) return

    const { id } = req.params as { id: string }

    const { error } = await fastify.supabase
      .from('leave_policy_rules')
      .delete()
      .eq('id', id)
      .eq('tenant_id', req.tenantId)

    if (error) {
      return reply.code(500).send({ error: 'DELETE_FAILED', message: error.message })
    }

    await logAction(fastify.supabase, {
      tenantId:    req.tenantId,
      tableName:   'leave_policy_rules',
      recordId:    id,
      action:      'DELETE',
      performedBy: req.userId,
      oldData:     { id },
    })

    return reply.code(204).send()
  })
}
