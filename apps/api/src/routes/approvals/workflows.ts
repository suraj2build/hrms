/**
 * Approval Workflows Routes
 *
 * GET  /approvals/workflows/config                          — list workflow config (admin)
 * POST /approvals/workflows/config                          — create/update level (admin)
 * DELETE /approvals/workflows/config/:id                    — remove level (admin)
 *
 * GET  /approvals/workflows/instances                       — open instances (admin/manager)
 * GET  /approvals/workflows/instances/:instanceId           — single instance with actions
 * POST /approvals/workflows/instances/:instanceId/action    — approve/reject/escalate
 *
 * Auth: all routes require JWT.
 */

import type { FastifyInstance } from 'fastify'
import { z }                    from 'zod'
import {
  getPendingWorkflowInstances,
  processWorkflowAction,
  getChainForEntity,
}                               from '../../lib/workflow-service.js'

import { HR_ADMIN_ROLES } from '../../lib/rbac.js'
import { isHrAdmin, resolveCallerEmployeeId, isDirectReport } from '../../lib/manager-scope.js'
import { serverError, notFound, ErrorCode } from '../../lib/api-errors.js'

// Workflow types the engine drives (must match the 053 enum + migrations 313/314).
const WORKFLOW_TYPES = ['leave', 'correction', 'regularisation', 'overtime', 'comp_off', 'reimbursement', 'loan', 'advance'] as const
const ENTITY_TYPES   = ['leave_request', 'attendance_correction', 'attendance_regularisation', 'overtime_request', 'comp_off_request', 'reimbursement_claim', 'employee_loan', 'advance_salary'] as const

// entity_type -> underlying request table, all of which carry employee_id.
// Used to resolve chain-read ownership for the self-or-manager-or-hr-admin check.
const ENTITY_TABLE_MAP: Record<(typeof ENTITY_TYPES)[number], string> = {
  leave_request:             'leave_requests',
  attendance_correction:     'attendance_corrections',
  attendance_regularisation: 'attendance_regularisation',
  overtime_request:          'overtime_requests',
  comp_off_request:          'comp_off_requests',
  reimbursement_claim:       'reimbursement_claims',
  employee_loan:             'employee_loans',
  advance_salary:            'advance_salary_requests',
}

export default async function workflowsRoute(fastify: FastifyInstance) {
  const auth = { preHandler: [fastify.authenticate] }

  // ── GET /approvals/workflows/config ─────────────────────────────────────────
  fastify.get('/approvals/workflows/config', auth, async (req: any, reply) => {
    if (!HR_ADMIN_ROLES.includes(req.userRole)) {
      return reply.code(403).send({ error: 'FORBIDDEN', message: 'HR admin access required' })
    }

    const querySchema = z.object({
      workflow_type: z.enum(WORKFLOW_TYPES).optional(),
    })
    const parsed = querySchema.safeParse(req.query)
    if (!parsed.success) return reply.code(400).send({ error: 'VALIDATION_ERROR', message: parsed.error.issues[0]?.message })

    let q = fastify.supabase
      .from('approval_workflow_config')
      .select('id, workflow_type, level, approver_type, specific_role, label, auto_approve_after_hours, min_amount, is_active, created_at')
      .eq('tenant_id', req.tenantId)
      .order('workflow_type')
      .order('level')

    if (parsed.data.workflow_type) q = q.eq('workflow_type', parsed.data.workflow_type)

    const { data, error } = await q
    if (error) return reply.code(500).send({ error: 'QUERY_FAILED', message: 'Failed to fetch workflow config' })
    return reply.send({ data: data ?? [] })
  })

  // ── POST /approvals/workflows/config ─────────────────────────────────────────
  fastify.post('/approvals/workflows/config', auth, async (req: any, reply) => {
    if (!HR_ADMIN_ROLES.includes(req.userRole)) {
      return reply.code(403).send({ error: 'FORBIDDEN', message: 'HR admin access required' })
    }

    const schema = z.object({
      workflow_type:            z.enum(WORKFLOW_TYPES),
      level:                    z.number().int().min(1).max(10),
      approver_type:            z.enum(['direct_manager', 'hr_admin', 'super_admin', 'specific_role']),
      specific_role:            z.string().max(50).optional(),
      label:                    z.string().max(100).default(''),
      auto_approve_after_hours: z.number().int().min(1).optional(),
      min_amount:               z.number().min(0).nullable().optional(),
      is_active:                z.boolean().default(true),
    })

    const parsed = schema.safeParse(req.body)
    if (!parsed.success) return reply.code(400).send({ error: 'VALIDATION_ERROR', message: parsed.error.issues[0]?.message })

    const { data, error } = await fastify.supabase
      .from('approval_workflow_config')
      .upsert(
        { tenant_id: req.tenantId, ...parsed.data },
        { onConflict: 'tenant_id,workflow_type,level' },
      )
      .select('id, workflow_type, level, approver_type, label, is_active')
      .single()

    if (error) return reply.code(500).send({ error: 'UPSERT_FAILED', message: 'Failed to save workflow config' })
    return reply.code(201).send({ data })
  })

  // ── DELETE /approvals/workflows/config/:id ───────────────────────────────────
  fastify.delete('/approvals/workflows/config/:id', auth, async (req: any, reply) => {
    if (!HR_ADMIN_ROLES.includes(req.userRole)) {
      return reply.code(403).send({ error: 'FORBIDDEN', message: 'HR admin access required' })
    }

    const { id } = req.params as { id: string }
    const { data, error } = await fastify.supabase
      .from('approval_workflow_config')
      .delete()
      .eq('id', id)
      .eq('tenant_id', req.tenantId)
      .select('id')
      .maybeSingle()

    if (error) return serverError(req, reply, error, ErrorCode.DELETE_FAILED, 'Failed to delete workflow config')
    if (!data) return notFound(reply, 'NOT_FOUND', 'Workflow config not found')
    return reply.code(204).send()
  })

  // ── GET /approvals/workflows/instances ───────────────────────────────────────
  // hr_admin only (fresh audit finding — this was MANAGER_ROLES, but the only
  // real caller is the admin-only Approval Workflows settings page, and the
  // underlying getPendingWorkflowInstances() query is tenant-wide with no
  // per-manager scoping — a regular manager could otherwise see every open
  // leave/loan/overtime/reimbursement request across the whole tenant, not
  // just their own reports').
  fastify.get('/approvals/workflows/instances', auth, async (req: any, reply) => {
    if (!HR_ADMIN_ROLES.includes(req.userRole)) {
      return reply.code(403).send({ error: 'FORBIDDEN', message: 'HR admin access required' })
    }

    const querySchema = z.object({
      limit:  z.coerce.number().int().min(1).max(200).default(50),
      offset: z.coerce.number().int().min(0).default(0),
    })
    const parsed = querySchema.safeParse(req.query)
    if (!parsed.success) return reply.code(400).send({ error: 'VALIDATION_ERROR', message: parsed.error.issues[0]?.message })

    const result = await getPendingWorkflowInstances(
      fastify.supabase, req.tenantId, parsed.data.limit, parsed.data.offset,
    )
    return reply.send(result)
  })

  // ── GET /approvals/workflows/instances/:instanceId ───────────────────────────
  fastify.get('/approvals/workflows/instances/:instanceId', auth, async (req: any, reply) => {
    if (!HR_ADMIN_ROLES.includes(req.userRole)) {
      return reply.code(403).send({ error: 'FORBIDDEN', message: 'HR admin access required' })
    }

    const { instanceId } = req.params as { instanceId: string }

    const { data: inst, error: instErr } = await fastify.supabase
      .from('approval_instances')
      .select('id, entity_type, entity_id, total_levels, current_level, final_approved, created_at, submitted_by')
      .eq('id', instanceId)
      .eq('tenant_id', req.tenantId)
      .maybeSingle()

    if (instErr || !inst) {
      return reply.code(404).send({ error: 'NOT_FOUND', message: 'Approval instance not found' })
    }

    // Fetch actions for timeline
    const { data: actions, error: actionsErr } = await fastify.supabase
      .from('approval_actions')
      .select('id, level, action, actor_id, comments, acted_at, profiles!inner(id, full_name)')
      .eq('instance_id', instanceId)
      .eq('tenant_id', req.tenantId)
      .order('acted_at', { ascending: true })

    if (actionsErr) return serverError(req, reply, actionsErr, ErrorCode.QUERY_FAILED, 'Failed to fetch approval actions')

    return reply.send({ data: { ...inst, actions: actions ?? [] } })
  })

  // ── POST /approvals/workflows/instances/:instanceId/action ───────────────────
  // hr_admin only (CRITICAL fresh audit finding). processWorkflowAction() only
  // checks that the actor isn't the submitter and holds a manager-tier role —
  // it does NOT verify the actor is the assigned approver for this instance's
  // current level (no direct_manager/specific_role match against
  // approval_workflow_config, unlike lib/approval-orchestrator.ts's
  // gateApprove/gateReject, which domain routes like payroll/loans.ts and
  // attendance/overtime.ts correctly use). Under MANAGER_ROLES, any manager
  // in the tenant — with no reporting relationship to the requester — could
  // approve/reject/close ANY other team's pending request by discovering its
  // instanceId via the (also tenant-wide) GET /instances list. Restricting to
  // hr_admin closes the bypass; hr_admin already has blanket approval
  // authority in the per-level model (direct_manager levels explicitly allow
  // hr_admin/super_admin to stand in), and the only real caller of this route
  // is the admin-only Approval Workflows settings page.
  fastify.post('/approvals/workflows/instances/:instanceId/action', auth, async (req: any, reply) => {
    if (!HR_ADMIN_ROLES.includes(req.userRole)) {
      return reply.code(403).send({ error: 'FORBIDDEN', message: 'HR admin access required' })
    }

    const { instanceId } = req.params as { instanceId: string }

    const schema = z.object({
      action:   z.enum(['approved', 'rejected', 'escalated', 'auto_approved']),
      comments: z.string().max(500).optional(),
    })

    const parsed = schema.safeParse(req.body)
    if (!parsed.success) return reply.code(400).send({ error: 'VALIDATION_ERROR', message: parsed.error.issues[0]?.message })

    const result = await processWorkflowAction(
      fastify.supabase,
      req.tenantId,
      instanceId,
      req.userId,
      parsed.data.action,
      parsed.data.comments,
    )

    if (!result.ok) {
      const code = result.error.type === 'NOT_FOUND' ? 404
        : result.error.type === 'CONFLICT'  ? 409
        : result.error.type === 'FORBIDDEN' ? 403
        : 500
      return reply.code(code).send({ error: result.error.type, message: result.error.message })
    }

    return reply.send({ data: result.value })
  })

  // ── GET /approvals/chain/:entityType/:entityId ───────────────────────────────
  // Chain state for ONE entity — drives the inbox/detail stepper. Self, HR admin,
  // or a manager whose direct report owns the request may read its chain — any
  // other authenticated user is blocked. (Fresh audit finding: previously any
  // authenticated user could read another employee's approval chain — including
  // approver names and free-text comments on loan/advance/reimbursement
  // requests — by supplying/guessing an entityId that wasn't theirs.)
  fastify.get('/approvals/chain/:entityType/:entityId', auth, async (req: any, reply) => {
    const paramsSchema = z.object({
      entityType: z.enum(ENTITY_TYPES),
      entityId:   z.string().uuid(),
    })
    const parsed = paramsSchema.safeParse(req.params)
    if (!parsed.success) return reply.code(400).send({ error: 'VALIDATION_ERROR', message: parsed.error.issues[0]?.message })

    if (!isHrAdmin(req.userRole)) {
      const { data: entityRow, error: entityErr } = await fastify.supabase
        .from(ENTITY_TABLE_MAP[parsed.data.entityType])
        .select('employee_id')
        .eq('id', parsed.data.entityId)
        .eq('tenant_id', req.tenantId)
        .maybeSingle()
      if (entityErr) return serverError(req, reply, entityErr, ErrorCode.QUERY_FAILED, 'Failed to resolve approval chain owner')
      const targetEmployeeId = (entityRow as { employee_id: string } | null)?.employee_id
      if (!targetEmployeeId) return reply.code(404).send({ error: 'NOT_FOUND', message: 'Request not found' })

      const myEmployeeId = await resolveCallerEmployeeId(fastify.supabase, req.userId, req.tenantId)
      const isSelf = !!myEmployeeId && myEmployeeId === targetEmployeeId
      let isManagerOfTarget = false
      if (!isSelf && req.userRole === 'manager' && myEmployeeId) {
        isManagerOfTarget = await isDirectReport(fastify.supabase, req.tenantId, myEmployeeId, targetEmployeeId)
      }
      if (!isSelf && !isManagerOfTarget) return reply.code(403).send({ error: 'FORBIDDEN', message: 'Access denied' })
    }

    const chain = await getChainForEntity(
      fastify.supabase, req.tenantId, parsed.data.entityType, parsed.data.entityId,
    )
    return reply.send({ data: chain })
  })
}
