/**
 * Approval Governance Evolution Routes
 *
 * Matrix-driven approval governance, delegations, operational overrides,
 * approval-path simulation, and governance rollback tracking.
 *
 * GET    /approvals/governance/matrices               — list approval matrices
 * GET    /approvals/governance/matrices/:id           — single matrix
 * POST   /approvals/governance/matrices               — create matrix (admin)
 * PUT    /approvals/governance/matrices/:id           — update matrix (admin)
 * DELETE /approvals/governance/matrices/:id           — soft-delete matrix (admin)
 *
 * GET    /approvals/governance/delegations            — list active delegations
 * POST   /approvals/governance/delegations            — create delegation
 * DELETE /approvals/governance/delegations/:id        — revoke delegation
 *
 * GET    /approvals/governance/overrides              — list operational overrides (admin)
 * POST   /approvals/governance/overrides              — grant override (super_admin)
 * DELETE /approvals/governance/overrides/:id          — revoke override (admin)
 *
 * POST   /approvals/governance/simulate               — simulate approval path
 *
 * GET    /approvals/governance/rollbacks              — list rollback records (admin)
 * POST   /approvals/governance/rollbacks              — log a rollback action (admin)
 *
 * Auth: all routes require JWT. Role gates applied per endpoint.
 */
import type { FastifyInstance } from 'fastify'
import { z }                    from 'zod'
import { HR_ADMIN_ROLES }       from '../../lib/rbac.js'
import { serverError, ErrorCode } from '../../lib/api-errors.js'
const SUPER_ADMIN = ['super_admin']             as const

// Fresh audit finding: entity_type/override_type were previously
// z.string().min(1).max(100) — any string accepted — while the DB CHECK
// constraints (migration 089_governance_evolution.sql) restrict both to
// fixed enums. A bad value passed validation and failed at the DB layer as
// a generic 500 instead of a clean 400.
const ENTITY_TYPES = [
  'leave_request', 'correction', 'overtime', 'comp_off',
  'separation', 'payroll_run', 'policy_change', 'roster_override',
  'expense', 'general',
] as const
const OVERRIDE_TYPES = [
  'bypass_approval', 'extend_sla', 'unlock_period',
  'force_process', 'grant_balance', 'roster_freeze_lift',
  'policy_exception',
] as const

export default async function governanceEvolutionRoutes(fastify: FastifyInstance) {
  const auth = { preHandler: [fastify.authenticate] }

  function requireAdmin(req: any, reply: any): boolean {
    if (!HR_ADMIN_ROLES.includes(req.userRole)) {
      reply.code(403).send({ error: 'FORBIDDEN', message: 'HR admin access required' })
      return false
    }
    return true
  }

  function requireSuperAdmin(req: any, reply: any): boolean {
    if (!SUPER_ADMIN.includes(req.userRole)) {
      reply.code(403).send({ error: 'FORBIDDEN', message: 'Super admin access required' })
      return false
    }
    return true
  }

  // ── GET /approvals/governance/matrices ────────────────────────────────────
  fastify.get('/approvals/governance/matrices', auth, async (req: any, reply) => {
    if (!requireAdmin(req, reply)) return

    const querySchema = z.object({
      entity_type: z.enum(ENTITY_TYPES).optional(),
      is_active:   z.enum(['true', 'false']).optional(),
    })
    const parsed = querySchema.safeParse(req.query)
    if (!parsed.success) {
      return reply.code(400).send({ error: 'VALIDATION_ERROR', message: parsed.error.issues[0]?.message })
    }

    const { entity_type, is_active } = parsed.data

    let q = fastify.supabase
      .from('approval_matrices')
      .select('*')
      .eq('tenant_id', req.tenantId)
      .order('entity_type')
      .order('name')

    if (entity_type) q = q.eq('entity_type', entity_type)
    if (is_active !== undefined) q = q.eq('is_active', is_active === 'true')

    const { data, error } = await q

    if (error) return serverError(req, reply, error, ErrorCode.QUERY_FAILED, 'Failed to fetch approval matrices')

    return reply.send({ data: data ?? [] })
  })

  // ── GET /approvals/governance/matrices/:id ────────────────────────────────
  fastify.get('/approvals/governance/matrices/:id', auth, async (req: any, reply) => {
    if (!requireAdmin(req, reply)) return

    const { id } = req.params as { id: string }

    const { data, error } = await fastify.supabase
      .from('approval_matrices')
      .select('*')
      .eq('id', id)
      .eq('tenant_id', req.tenantId)
      .maybeSingle()

    if (error) return serverError(req, reply, error, ErrorCode.QUERY_FAILED, 'Failed to fetch approval matrix')
    if (!data) {
      return reply.code(404).send({ error: 'NOT_FOUND', message: 'Approval matrix not found' })
    }

    return reply.send({ data })
  })

  // ── POST /approvals/governance/matrices ───────────────────────────────────
  fastify.post('/approvals/governance/matrices', auth, async (req: any, reply) => {
    if (!requireAdmin(req, reply)) return

    const stageSchema = z.object({
      stage_number:            z.number().int().min(1),
      approver_type:           z.string().min(1).max(100),
      approver_value:          z.string().min(1).max(200),
      condition:               z.string().max(500).optional().nullable(),
      sla_hours:               z.number().int().min(1),
      escalation_employee_id:  z.string().uuid().optional().nullable(),
    })

    const schema = z.object({
      name:               z.string().min(1).max(200),
      entity_type:        z.enum(ENTITY_TYPES),
      stages:             z.array(stageSchema).min(1, 'At least one stage is required'),
      description:        z.string().max(1000).optional().nullable(),
      payroll_threshold:  z.number().min(0).optional().nullable(),
    })

    const parsed = schema.safeParse(req.body)
    if (!parsed.success) {
      return reply.code(400).send({ error: 'VALIDATION_ERROR', message: parsed.error.issues[0]?.message })
    }

    const { data, error } = await fastify.supabase
      .from('approval_matrices')
      .insert({
        tenant_id:         req.tenantId,
        name:              parsed.data.name,
        entity_type:       parsed.data.entity_type,
        stages:            parsed.data.stages,
        description:       parsed.data.description ?? null,
        payroll_threshold: parsed.data.payroll_threshold ?? null,
        is_active:         true,
        created_by:        req.userId,
      })
      .select('*')
      .single()

    if (error) return serverError(req, reply, error, ErrorCode.INSERT_FAILED, 'Failed to create approval matrix')

    return reply.code(201).send({ data })
  })

  // ── PUT /approvals/governance/matrices/:id ────────────────────────────────
  fastify.put('/approvals/governance/matrices/:id', auth, async (req: any, reply) => {
    if (!requireAdmin(req, reply)) return

    const { id } = req.params as { id: string }

    const stageSchema = z.object({
      stage_number:           z.number().int().min(1),
      approver_type:          z.string().min(1).max(100),
      approver_value:         z.string().min(1).max(200),
      condition:              z.string().max(500).optional().nullable(),
      sla_hours:              z.number().int().min(1),
      escalation_employee_id: z.string().uuid().optional().nullable(),
    })

    const schema = z.object({
      name:              z.string().min(1).max(200).optional(),
      entity_type:       z.enum(ENTITY_TYPES).optional(),
      stages:            z.array(stageSchema).min(1).optional(),
      description:       z.string().max(1000).optional().nullable(),
      payroll_threshold: z.number().min(0).optional().nullable(),
      is_active:         z.boolean().optional(),
    })

    const parsed = schema.safeParse(req.body)
    if (!parsed.success) {
      return reply.code(400).send({ error: 'VALIDATION_ERROR', message: parsed.error.issues[0]?.message })
    }

    const updatePayload: Record<string, unknown> = { updated_at: new Date().toISOString() }
    if (parsed.data.name              !== undefined) updatePayload.name              = parsed.data.name
    if (parsed.data.entity_type       !== undefined) updatePayload.entity_type       = parsed.data.entity_type
    if (parsed.data.stages            !== undefined) updatePayload.stages            = parsed.data.stages
    if (parsed.data.description       !== undefined) updatePayload.description       = parsed.data.description
    if (parsed.data.payroll_threshold !== undefined) updatePayload.payroll_threshold = parsed.data.payroll_threshold
    if (parsed.data.is_active         !== undefined) updatePayload.is_active         = parsed.data.is_active

    const { data, error } = await fastify.supabase
      .from('approval_matrices')
      .update(updatePayload)
      .eq('id', id)
      .eq('tenant_id', req.tenantId)
      .select('*')
      .maybeSingle()

    if (error) return serverError(req, reply, error, ErrorCode.UPDATE_FAILED, 'Failed to update approval matrix')
    if (!data) {
      return reply.code(404).send({ error: 'NOT_FOUND', message: 'Approval matrix not found' })
    }

    return reply.send({ data })
  })

  // ── DELETE /approvals/governance/matrices/:id ─────────────────────────────
  fastify.delete('/approvals/governance/matrices/:id', auth, async (req: any, reply) => {
    if (!requireAdmin(req, reply)) return

    const { id } = req.params as { id: string }

    const { data, error } = await fastify.supabase
      .from('approval_matrices')
      .update({ is_active: false, updated_at: new Date().toISOString() })
      .eq('id', id)
      .eq('tenant_id', req.tenantId)
      .select('id, is_active')
      .maybeSingle()

    if (error) return serverError(req, reply, error, ErrorCode.UPDATE_FAILED, 'Failed to deactivate approval matrix')
    if (!data) {
      return reply.code(404).send({ error: 'NOT_FOUND', message: 'Approval matrix not found' })
    }

    return reply.send({ data })
  })

  // ── GET /approvals/governance/delegations ─────────────────────────────────
  fastify.get('/approvals/governance/delegations', auth, async (req: any, reply) => {
    if (!requireAdmin(req, reply)) return

    const querySchema = z.object({
      is_active: z.enum(['true', 'false']).default('true'),
    })
    const parsed = querySchema.safeParse(req.query)
    if (!parsed.success) {
      return reply.code(400).send({ error: 'VALIDATION_ERROR', message: parsed.error.issues[0]?.message })
    }

    const { data, error } = await fastify.supabase
      .from('approval_delegations')
      .select(`
        id, delegator_id, delegate_id, entity_types, valid_from, valid_until,
        reason, is_active, created_at
      `)
      .eq('tenant_id', req.tenantId)
      .eq('is_active', parsed.data.is_active === 'true')
      .order('created_at', { ascending: false })

    if (error) {
      req.log.warn({ err: error }, 'delegations query failed — returning empty')
      return reply.send({ data: [] })
    }

    return reply.send({ data: data ?? [] })
  })

  // ── POST /approvals/governance/delegations ────────────────────────────────
  fastify.post('/approvals/governance/delegations', auth, async (req: any, reply) => {
    if (!requireAdmin(req, reply)) return
    const schema = z.object({
      delegate_id:  z.string().uuid(),
      entity_types: z.array(z.string().min(1)).min(1, 'At least one entity type is required'),
      valid_from:   z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
      valid_until:  z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
      reason:       z.string().max(500).optional().nullable(),
    })

    const parsed = schema.safeParse(req.body)
    if (!parsed.success) {
      return reply.code(400).send({ error: 'VALIDATION_ERROR', message: parsed.error.issues[0]?.message })
    }

    const { data, error } = await fastify.supabase
      .from('approval_delegations')
      .insert({
        tenant_id:    req.tenantId,
        delegator_id: req.userId,
        delegate_id:  parsed.data.delegate_id,
        entity_types: parsed.data.entity_types,
        valid_from:   parsed.data.valid_from,
        valid_until:  parsed.data.valid_until,
        reason:       parsed.data.reason ?? null,
        is_active:    true,
      })
      .select('*')
      .single()

    if (error) return serverError(req, reply, error, ErrorCode.INSERT_FAILED, 'Failed to create delegation')

    return reply.code(201).send({ data })
  })

  // ── DELETE /approvals/governance/delegations/:id ──────────────────────────
  fastify.delete('/approvals/governance/delegations/:id', auth, async (req: any, reply) => {
    const { id } = req.params as { id: string }

    // Fetch delegation to check ownership
    const { data: existing, error: fetchError } = await fastify.supabase
      .from('approval_delegations')
      .select('id, delegator_id')
      .eq('id', id)
      .eq('tenant_id', req.tenantId)
      .maybeSingle()

    if (fetchError) return serverError(req, reply, fetchError, ErrorCode.QUERY_FAILED, 'Failed to fetch delegation')
    if (!existing) {
      return reply.code(404).send({ error: 'NOT_FOUND', message: 'Delegation not found' })
    }

    // Only the delegator or an admin can revoke
    const isOwner = existing.delegator_id === req.userId
    const isAdmin = HR_ADMIN_ROLES.includes(req.userRole)
    if (!isOwner && !isAdmin) {
      return reply.code(403).send({ error: 'FORBIDDEN', message: 'Only the delegator or an admin can revoke this delegation' })
    }

    const { data, error } = await fastify.supabase
      .from('approval_delegations')
      .update({
        is_active:  false,
      })
      .eq('id', id)
      .eq('tenant_id', req.tenantId)
      .select('id, is_active')
      .maybeSingle()

    if (error) return serverError(req, reply, error, ErrorCode.UPDATE_FAILED, 'Failed to revoke delegation')
    if (!data) return reply.code(404).send({ error: 'NOT_FOUND', message: 'Delegation not found' })

    return reply.send({ data })
  })

  // ── GET /approvals/governance/overrides ───────────────────────────────────
  fastify.get('/approvals/governance/overrides', auth, async (req: any, reply) => {
    if (!requireAdmin(req, reply)) return

    const querySchema = z.object({
      is_active: z.enum(['true', 'false']).default('true'),
    })
    const parsed = querySchema.safeParse(req.query)
    if (!parsed.success) {
      return reply.code(400).send({ error: 'VALIDATION_ERROR', message: parsed.error.issues[0]?.message })
    }

    const { data, error } = await fastify.supabase
      .from('operational_overrides')
      .select('*')
      .eq('tenant_id', req.tenantId)
      .eq('is_active', parsed.data.is_active === 'true')
      .order('created_at', { ascending: false })

    if (error) return serverError(req, reply, error, ErrorCode.QUERY_FAILED, 'Failed to fetch overrides')

    return reply.send({ data: data ?? [] })
  })

  // ── POST /approvals/governance/overrides ──────────────────────────────────
  fastify.post('/approvals/governance/overrides', auth, async (req: any, reply) => {
    if (!requireSuperAdmin(req, reply)) return

    const schema = z.object({
      override_type: z.enum(OVERRIDE_TYPES),
      granted_to:    z.string().uuid(),
      scope:         z.record(z.unknown()),
      reason:        z.string().min(1).max(1000),
      justification: z.string().max(2000).optional().nullable(),
      valid_until:   z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
      max_uses:      z.number().int().min(1).optional().nullable(),
    })

    const parsed = schema.safeParse(req.body)
    if (!parsed.success) {
      return reply.code(400).send({ error: 'VALIDATION_ERROR', message: parsed.error.issues[0]?.message })
    }

    const { data, error } = await fastify.supabase
      .from('operational_overrides')
      .insert({
        tenant_id:     req.tenantId,
        override_type: parsed.data.override_type,
        granted_to:    parsed.data.granted_to,
        granted_by:    req.userId,
        scope:         parsed.data.scope,
        reason:        parsed.data.reason,
        justification: parsed.data.justification ?? null,
        valid_until:   parsed.data.valid_until,
        max_uses:      parsed.data.max_uses ?? null,
        is_active:     true,
        used_count:    0,
      })
      .select('*')
      .single()

    if (error) return serverError(req, reply, error, ErrorCode.INSERT_FAILED, 'Failed to grant override')

    return reply.code(201).send({ data })
  })

  // ── DELETE /approvals/governance/overrides/:id ────────────────────────────
  fastify.delete('/approvals/governance/overrides/:id', auth, async (req: any, reply) => {
    if (!requireAdmin(req, reply)) return

    const { id } = req.params as { id: string }

    const bodySchema = z.object({
      revoke_reason: z.string().min(1).max(500),
    })
    const parsed = bodySchema.safeParse(req.body)
    if (!parsed.success) {
      return reply.code(400).send({ error: 'VALIDATION_ERROR', message: parsed.error.issues[0]?.message })
    }

    const { data, error } = await fastify.supabase
      .from('operational_overrides')
      .update({
        is_active:     false,
        revoked_at:    new Date().toISOString(),
        revoked_by:    req.userId,
        revoke_reason: parsed.data.revoke_reason,
      })
      .eq('id', id)
      .eq('tenant_id', req.tenantId)
      .select('id, is_active, revoked_at, revoked_by, revoke_reason')
      .maybeSingle()

    if (error) return serverError(req, reply, error, ErrorCode.UPDATE_FAILED, 'Failed to revoke override')
    if (!data) {
      return reply.code(404).send({ error: 'NOT_FOUND', message: 'Override not found' })
    }

    return reply.send({ data })
  })

  // ── POST /approvals/governance/simulate ───────────────────────────────────
  fastify.post('/approvals/governance/simulate', auth, async (req: any, reply) => {
    if (!requireAdmin(req, reply)) return
    const schema = z.object({
      entity_type:     z.enum(ENTITY_TYPES),
      payroll_amount:  z.number().min(0).optional().nullable(),
      department_id:   z.string().uuid().optional().nullable(),
      employee_id:     z.string().uuid().optional().nullable(),
    })

    const parsed = schema.safeParse(req.body)
    if (!parsed.success) {
      return reply.code(400).send({ error: 'VALIDATION_ERROR', message: parsed.error.issues[0]?.message })
    }

    const { entity_type, payroll_amount, department_id, employee_id } = parsed.data

    // Fetch matching matrices ordered so threshold-specific ones come first
    let q = fastify.supabase
      .from('approval_matrices')
      .select('id, name, entity_type, stages, payroll_threshold, description')
      .eq('tenant_id', req.tenantId)
      .eq('entity_type', entity_type)
      .eq('is_active', true)
      .order('payroll_threshold', { ascending: false, nullsFirst: false })

    const { data: matrices, error: matrixError } = await q

    if (matrixError) return serverError(req, reply, matrixError, ErrorCode.QUERY_FAILED, 'Failed to fetch approval matrices')

    const allMatrices = matrices ?? []

    // Select best-matching matrix:
    // If payroll_amount provided, prefer matrix whose threshold <= amount (highest threshold wins due to ordering).
    // Fall back to a matrix with no threshold.
    let selectedMatrix: any = null

    if (payroll_amount !== undefined && payroll_amount !== null) {
      selectedMatrix = allMatrices.find(
        (m: any) => m.payroll_threshold !== null && m.payroll_threshold <= payroll_amount,
      ) ?? allMatrices.find((m: any) => m.payroll_threshold === null)
    } else {
      selectedMatrix = allMatrices[0] ?? null
    }

    if (!selectedMatrix) {
      return reply.code(404).send({
        error:   'NO_MATRIX',
        message: `No active approval matrix found for entity_type '${entity_type}'`,
      })
    }

    const stages: any[] = selectedMatrix.stages ?? []
    const total_sla_hours = stages.reduce((sum: number, s: any) => sum + (s.sla_hours ?? 0), 0)

    const approval_path = stages
      .sort((a: any, b: any) => a.stage_number - b.stage_number)
      .map((s: any) => ({
        stage_number:           s.stage_number,
        approver_type:          s.approver_type,
        approver_value:         s.approver_value,
        condition:              s.condition ?? null,
        sla_hours:              s.sla_hours,
        escalation_employee_id: s.escalation_employee_id ?? null,
      }))

    // Record the simulation
    await fastify.supabase
      .from('governance_simulations')
      .insert({
        tenant_id:    req.tenantId,
        scenario:     { entity_type, payroll_amount: payroll_amount ?? null, department_id: department_id ?? null, employee_id: employee_id ?? null },
        matrix_used:  { id: selectedMatrix.id, name: selectedMatrix.name },
        result:       { approval_path, total_sla_hours },
        simulated_by: req.userId,
      })
      // Non-blocking — simulation result is still returned on insert failure
      .then(({ error: simErr }: { error: any }) => {
        if (simErr) req.log.warn({ err: simErr }, 'governance simulation record insert failed')
      })

    return reply.send({
      matrix_name:     selectedMatrix.name,
      stages:          approval_path,
      total_sla_hours,
      approval_path,
    })
  })

  // ── GET /approvals/governance/rollbacks ───────────────────────────────────
  fastify.get('/approvals/governance/rollbacks', auth, async (req: any, reply) => {
    if (!requireAdmin(req, reply)) return

    const querySchema = z.object({
      entity_type:  z.string().max(100).optional(),
      is_completed: z.enum(['true', 'false']).optional(),
    })
    const parsed = querySchema.safeParse(req.query)
    if (!parsed.success) {
      return reply.code(400).send({ error: 'VALIDATION_ERROR', message: parsed.error.issues[0]?.message })
    }

    const { entity_type, is_completed } = parsed.data

    let q = fastify.supabase
      .from('governance_rollbacks')
      .select('*')
      .eq('tenant_id', req.tenantId)
      .order('created_at', { ascending: false })

    if (entity_type)  q = q.eq('entity_type', entity_type)
    if (is_completed !== undefined) q = q.eq('is_completed', is_completed === 'true')

    const { data, error } = await q

    if (error) return serverError(req, reply, error, ErrorCode.QUERY_FAILED, 'Failed to fetch rollbacks')

    return reply.send({ data: data ?? [] })
  })

  // ── POST /approvals/governance/rollbacks ──────────────────────────────────
  fastify.post('/approvals/governance/rollbacks', auth, async (req: any, reply) => {
    if (!requireAdmin(req, reply)) return

    const schema = z.object({
      entity_type:      z.string().min(1).max(100),
      entity_id:        z.string().uuid(),
      action_type:      z.string().min(1).max(100),
      rollback_reason:  z.string().min(1).max(1000),
      before_state:     z.record(z.unknown()),
      after_state:      z.record(z.unknown()),
    })

    const parsed = schema.safeParse(req.body)
    if (!parsed.success) {
      return reply.code(400).send({ error: 'VALIDATION_ERROR', message: parsed.error.issues[0]?.message })
    }

    const { data, error } = await fastify.supabase
      .from('governance_rollbacks')
      .insert({
        tenant_id:       req.tenantId,
        entity_type:     parsed.data.entity_type,
        entity_id:       parsed.data.entity_id,
        action_type:     parsed.data.action_type,
        rollback_reason: parsed.data.rollback_reason,
        before_state:    parsed.data.before_state,
        after_state:     parsed.data.after_state,
        rolled_back_by:  req.userId,
        is_completed:    false,
      })
      .select('*')
      .single()

    if (error) return serverError(req, reply, error, ErrorCode.INSERT_FAILED, 'Failed to log rollback')

    return reply.code(201).send({ data })
  })
}
