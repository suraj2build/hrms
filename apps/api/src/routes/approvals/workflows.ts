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
  getWorkflowConfig,
}                               from '../../lib/workflow-service.js'

const HR_ROLES    = ['super_admin', 'hr_admin']
const ALLOW_ROLES = [...HR_ROLES, 'manager']

export default async function workflowsRoute(fastify: FastifyInstance) {
  const auth = { preHandler: [fastify.authenticate] }

  // ── GET /approvals/workflows/config ─────────────────────────────────────────
  fastify.get('/approvals/workflows/config', auth, async (req: any, reply) => {
    if (!HR_ROLES.includes(req.userRole)) {
      return reply.code(403).send({ error: 'FORBIDDEN', message: 'HR admin access required' })
    }

    const querySchema = z.object({
      workflow_type: z.enum(['leave', 'correction', 'regularisation']).optional(),
    })
    const parsed = querySchema.safeParse(req.query)
    if (!parsed.success) return reply.code(400).send({ error: 'VALIDATION_ERROR', message: parsed.error.issues[0]?.message })

    let q = fastify.supabase
      .from('approval_workflow_config')
      .select('id, workflow_type, level, approver_type, specific_role, label, auto_approve_after_hours, is_active, created_at')
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
    if (!HR_ROLES.includes(req.userRole)) {
      return reply.code(403).send({ error: 'FORBIDDEN', message: 'HR admin access required' })
    }

    const schema = z.object({
      workflow_type:            z.enum(['leave', 'correction', 'regularisation']),
      level:                    z.number().int().min(1).max(10),
      approver_type:            z.enum(['direct_manager', 'hr_admin', 'super_admin', 'specific_role']),
      specific_role:            z.string().max(50).optional(),
      label:                    z.string().max(100).default(''),
      auto_approve_after_hours: z.number().int().min(1).optional(),
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
    if (!HR_ROLES.includes(req.userRole)) {
      return reply.code(403).send({ error: 'FORBIDDEN', message: 'HR admin access required' })
    }

    const { id } = req.params as { id: string }
    const { error } = await fastify.supabase
      .from('approval_workflow_config')
      .delete()
      .eq('id', id)
      .eq('tenant_id', req.tenantId)

    if (error) return reply.code(500).send({ error: 'DELETE_FAILED', message: 'Failed to delete workflow config' })
    return reply.code(204).send()
  })

  // ── GET /approvals/workflows/instances ───────────────────────────────────────
  fastify.get('/approvals/workflows/instances', auth, async (req: any, reply) => {
    if (!ALLOW_ROLES.includes(req.userRole)) {
      return reply.code(403).send({ error: 'FORBIDDEN', message: 'Manager or HR access required' })
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
    if (!ALLOW_ROLES.includes(req.userRole)) {
      return reply.code(403).send({ error: 'FORBIDDEN', message: 'Manager or HR access required' })
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
    const { data: actions } = await fastify.supabase
      .from('approval_actions')
      .select('id, level, action, actor_id, comments, acted_at, profiles!inner(id, full_name)')
      .eq('instance_id', instanceId)
      .eq('tenant_id', req.tenantId)
      .order('acted_at', { ascending: true })

    return reply.send({ data: { ...inst, actions: actions ?? [] } })
  })

  // ── POST /approvals/workflows/instances/:instanceId/action ───────────────────
  fastify.post('/approvals/workflows/instances/:instanceId/action', auth, async (req: any, reply) => {
    if (!ALLOW_ROLES.includes(req.userRole)) {
      return reply.code(403).send({ error: 'FORBIDDEN', message: 'Manager or HR access required' })
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
      const code = result.error.type === 'NOT_FOUND' ? 404 : result.error.type === 'CONFLICT' ? 409 : 500
      return reply.code(code).send({ error: result.error.type, message: result.error.message })
    }

    return reply.send({ data: result.value })
  })
}
