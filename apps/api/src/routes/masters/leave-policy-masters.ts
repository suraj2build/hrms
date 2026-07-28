/**
 * Leave Policy Masters — /masters/leave-policy-masters
 *
 * Named policy bundles.  Each master can have many rules (one per leave type)
 * and many assignments (employee / department / site / default).
 *
 * Endpoints:
 *   GET    /                    — list all policy masters (with rule count + assignment count)
 *   GET    /:id                 — one master with its full rule list
 *   POST   /                    — create a new policy master
 *   PUT    /:id                 — update name / description / is_default / year_type / is_active
 *   DELETE /:id                 — delete (blocked if assignments exist)
 *
 * Access:
 *   read  — any authenticated user in the tenant
 *   write — hr_admin / super_admin
 */

import type { FastifyInstance } from 'fastify'
import { z }                    from 'zod'
import { logAction }            from '../../lib/audit-service.js'
import {
  publishPolicy,
  requestReview,
  archivePolicy,
  rollbackPolicyToVersion,
} from '../../lib/policy-governance.js'
import { resolveEffectivePolicyForEmployee } from '../../lib/leave-policy-service.js'
import { HR_ADMIN_ROLES }                    from '../../lib/rbac.js'
import { serverError, ErrorCode }            from '../../lib/api-errors.js'
const masterSchema = z.object({
  name:        z.string().min(1).max(100),
  description: z.string().max(500).optional(),
  is_default:  z.boolean().default(false),
  year_type:   z.enum(['calendar', 'financial']).default('calendar'),
  is_active:   z.boolean().default(true),
})

export default async function leavePolicyMastersRoutes(fastify: FastifyInstance) {
  const auth = { preHandler: [fastify.authenticate] }

  function requireAdmin(req: any, reply: any): boolean {
    if (!(HR_ADMIN_ROLES as readonly string[]).includes(req.userRole)) {
      reply.code(403).send({ error: 'FORBIDDEN', message: 'HR admin access required' })
      return false
    }
    return true
  }

  // ── GET / ──────────────────────────────────────────────────────────────────
  // List all policy masters with rule + assignment counts.
  fastify.get('/', auth, async (req: any, reply) => {
    const { data, error } = await fastify.supabase
      .from('leave_policy_masters')
      .select(`
        id, name, description, is_default, year_type, is_active,
        status, version, effective_from, published_by, published_at, publish_notes,
        created_at, updated_at,
        leave_policy_rules(id),
        leave_policy_assignments(id, scope_type, scope_id)
      `)
      .eq('tenant_id', req.tenantId)
      .order('name')

    if (error) {
      return serverError(req, reply, error, ErrorCode.QUERY_FAILED, 'Failed to fetch leave policy masters')
    }

    const rows = (data ?? []).map((m: any) => ({
      id:               m.id,
      name:             m.name,
      description:      m.description,
      is_default:       m.is_default,
      year_type:        m.year_type,
      is_active:        m.is_active,
      status:           m.status,
      version:          m.version,
      effective_from:   m.effective_from,
      published_at:     m.published_at,
      publish_notes:    m.publish_notes,
      created_at:       m.created_at,
      updated_at:       m.updated_at,
      rule_count:       (m.leave_policy_rules ?? []).length,
      assignment_count: (m.leave_policy_assignments ?? []).length,
      assignments:      (m.leave_policy_assignments ?? []).map((a: any) => ({
        id:         a.id,
        scope_type: a.scope_type,
        scope_id:   a.scope_id,
      })),
    }))

    return reply.send({ data: rows })
  })

  // ── GET /:id ───────────────────────────────────────────────────────────────
  // Single policy master with all its rules and assignments.
  fastify.get('/:id', auth, async (req: any, reply) => {
    const { id } = req.params as { id: string }

    const { data, error } = await fastify.supabase
      .from('leave_policy_masters')
      .select(`
        id, name, description, is_default, year_type, is_active,
        status, version, effective_from, published_by, published_at, publish_notes,
        created_at, updated_at,
        leave_policy_rules(
          id, leave_type_id, accrual_type, accrual_days_per_year,
          max_accrual_balance, eligibility_days, prorate_on_joining,
          carry_forward_enabled, carry_forward_max_days,
          expiry_days, max_consecutive_days, min_gap_days,
          created_at, updated_at,
          leave_types(id, name, is_paid, is_active)
        ),
        leave_policy_assignments(
          id, scope_type, scope_id, created_at
        )
      `)
      .eq('tenant_id', req.tenantId)
      .eq('id', id)
      .maybeSingle()

    if (error) {
      return serverError(req, reply, error, ErrorCode.QUERY_FAILED, 'Failed to fetch leave policy master')
    }
    if (!data) {
      return reply.code(404).send({ error: 'NOT_FOUND', message: 'Policy not found' })
    }

    return reply.send({ data })
  })

  // ── POST / ─────────────────────────────────────────────────────────────────
  fastify.post('/', auth, async (req: any, reply) => {
    if (!requireAdmin(req, reply)) return

    const parsed = masterSchema.safeParse(req.body)
    if (!parsed.success) {
      return reply.code(400).send({
        error:   'VALIDATION_ERROR',
        message: parsed.error.issues[0]?.message,
      })
    }

    // If setting is_default=true, clear existing default first (atomic via trigger
    // would be ideal, but here we do it manually in a transaction-like pattern).
    if (parsed.data.is_default) {
      await fastify.supabase
        .from('leave_policy_masters')
        .update({ is_default: false, updated_at: new Date().toISOString() })
        .eq('tenant_id', req.tenantId)
        .eq('is_default', true)
    }

    const { data, error } = await fastify.supabase
      .from('leave_policy_masters')
      .insert({
        tenant_id:   req.tenantId,
        ...parsed.data,
      })
      .select('id, name, description, is_default, year_type, is_active, created_at')
      .single()

    if (error) {
      if (error.code === '23505') {
        // idx_leave_policy_masters_one_default (migration 054) guards
        // against two concurrent is_default=true requests both clearing
        // the old default before either sets the new one — disambiguate
        // that race from an actual duplicate name so the message isn't
        // misleading (a name violation and a default-flag violation hit
        // the same 23505 code but are different constraints).
        if (error.message?.includes('idx_leave_policy_masters_one_default')) {
          return reply.code(409).send({
            error:   'CONFLICT',
            message: 'Another request just changed the default policy — please retry',
          })
        }
        return reply.code(409).send({
          error:   'DUPLICATE',
          message: `A policy named "${parsed.data.name}" already exists`,
        })
      }
      return serverError(req, reply, error, ErrorCode.INSERT_FAILED, 'Failed to create policy')
    }

    await logAction(fastify.supabase, {
      tenantId:    req.tenantId,
      tableName:   'leave_policy_masters',
      recordId:    (data as any).id,
      action:      'INSERT',
      performedBy: req.userId,
      newData:     data,
    })

    return reply.code(201).send({ data })
  })

  // ── PUT /:id ───────────────────────────────────────────────────────────────
  fastify.put('/:id', auth, async (req: any, reply) => {
    if (!requireAdmin(req, reply)) return

    const { id } = req.params as { id: string }
    const parsed = masterSchema.partial().safeParse(req.body)
    if (!parsed.success) {
      return reply.code(400).send({
        error:   'VALIDATION_ERROR',
        message: parsed.error.issues[0]?.message,
      })
    }

    // Verify the policy belongs to this tenant
    const { data: existing } = await fastify.supabase
      .from('leave_policy_masters')
      .select('id')
      .eq('id', id)
      .eq('tenant_id', req.tenantId)
      .maybeSingle()

    if (!existing) {
      return reply.code(404).send({ error: 'NOT_FOUND', message: 'Policy not found' })
    }

    // If promoting to default, demote the current default
    if (parsed.data.is_default === true) {
      await fastify.supabase
        .from('leave_policy_masters')
        .update({ is_default: false, updated_at: new Date().toISOString() })
        .eq('tenant_id', req.tenantId)
        .eq('is_default', true)
        .neq('id', id)
    }

    const { data, error } = await fastify.supabase
      .from('leave_policy_masters')
      .update({ ...parsed.data, updated_at: new Date().toISOString() })
      .eq('id', id)
      .eq('tenant_id', req.tenantId)
      .select('id, name, description, is_default, year_type, is_active, updated_at')
      .single()

    if (error) {
      if (error.code === '23505') {
        if (error.message?.includes('idx_leave_policy_masters_one_default')) {
          return reply.code(409).send({
            error:   'CONFLICT',
            message: 'Another request just changed the default policy — please retry',
          })
        }
        return reply.code(409).send({ error: 'DUPLICATE', message: 'A policy with that name already exists' })
      }
      return serverError(req, reply, error, ErrorCode.UPDATE_FAILED, 'Failed to update policy')
    }
    if (!data) {
      return reply.code(404).send({ error: 'NOT_FOUND', message: 'Policy not found' })
    }

    await logAction(fastify.supabase, {
      tenantId:    req.tenantId,
      tableName:   'leave_policy_masters',
      recordId:    id,
      action:      'UPDATE',
      performedBy: req.userId,
      oldData:     { id },
      newData:     parsed.data,
    })

    return reply.send({ data })
  })

  // ── DELETE /:id ────────────────────────────────────────────────────────────
  // Block deletion when active assignments exist (prevents orphaned employees).
  fastify.delete('/:id', auth, async (req: any, reply) => {
    if (!requireAdmin(req, reply)) return

    const { id } = req.params as { id: string }

    // Check for existing assignments
    const { count, error: countErr } = await fastify.supabase
      .from('leave_policy_assignments')
      .select('id', { count: 'exact', head: true })
      .eq('tenant_id', req.tenantId)
      .eq('policy_id', id)
    if (countErr) return serverError(req, reply, countErr, ErrorCode.QUERY_FAILED, 'Failed to check policy assignments')

    if ((count ?? 0) > 0) {
      return reply.code(409).send({
        error:   'HAS_ASSIGNMENTS',
        message: `Cannot delete: ${count} assignment(s) use this policy. Remove them first.`,
      })
    }

    // Cascade via FK will remove leave_policy_rules too
    const { error } = await fastify.supabase
      .from('leave_policy_masters')
      .delete()
      .eq('id', id)
      .eq('tenant_id', req.tenantId)

    if (error) {
      return serverError(req, reply, error, ErrorCode.DELETE_FAILED, 'Failed to delete leave policy master')
    }

    await logAction(fastify.supabase, {
      tenantId:    req.tenantId,
      tableName:   'leave_policy_masters',
      recordId:    id,
      action:      'DELETE',
      performedBy: req.userId,
      oldData:     { id },
    })

    return reply.code(204).send()
  })

  // ── Governance: conflict detection ─────────────────────────────────────────
  // GET /conflicts — detect duplicate scope assignments and multiple defaults.
  // Registered before /:id so the static segment is matched first.
  fastify.get('/conflicts', auth, async (req: any, reply) => {
    if (!requireAdmin(req, reply)) return

    const { detectPolicyConflicts } = await import('../../lib/policy-governance.js')
    const conflicts = await detectPolicyConflicts(fastify.supabase, req.tenantId)
    return reply.send({ data: conflicts })
  })

  // ── Governance: version history ────────────────────────────────────────────
  // GET /:id/versions — list immutable snapshots for a policy.
  fastify.get('/:id/versions', auth, async (req: any, reply) => {
    const { id } = req.params as { id: string }

    const { data, error } = await fastify.supabase
      .from('leave_policy_versions')
      .select('id, version, snapshot_at, snapshot_by, reason')
      .eq('tenant_id', req.tenantId)
      .eq('policy_id', id)
      .order('version', { ascending: false })

    if (error) return serverError(req, reply, error, ErrorCode.QUERY_FAILED, 'Failed to fetch policy versions')
    return reply.send({ data: data ?? [] })
  })

  // ── Governance: change log ─────────────────────────────────────────────────
  // GET /:id/change-log — structured field-level audit trail.
  fastify.get('/:id/change-log', auth, async (req: any, reply) => {
    const { id } = req.params as { id: string }

    const { data, error } = await fastify.supabase
      .from('policy_change_log')
      .select('id, operation, changed_by, changed_at, field_changes, comment')
      .eq('tenant_id', req.tenantId)
      .eq('table_name', 'leave_policy_masters')
      .eq('record_id', id)
      .order('changed_at', { ascending: false })
      .limit(200)

    if (error) return serverError(req, reply, error, ErrorCode.QUERY_FAILED, 'Failed to fetch policy change log')
    return reply.send({ data: data ?? [] })
  })

  // ── Governance: request review ─────────────────────────────────────────────
  // POST /:id/request-review — transition draft → review.
  fastify.post('/:id/request-review', auth, async (req: any, reply) => {
    if (!requireAdmin(req, reply)) return
    const { id } = req.params as { id: string }
    const { comment } = (req.body ?? {}) as { comment?: string }

    const result = await requestReview(
      fastify.supabase, req.tenantId, id, req.userId, comment,
    )
    if (!result.success) return reply.code(400).send({ error: 'TRANSITION_ERROR', message: result.error })
    return reply.send({ data: result.master })
  })

  // ── Governance: publish ────────────────────────────────────────────────────
  // POST /:id/publish — transition draft/review → published.
  fastify.post('/:id/publish', auth, async (req: any, reply) => {
    if (!requireAdmin(req, reply)) return
    const { id } = req.params as { id: string }

    const publishSchema = z.object({
      notes:         z.string().max(1000).optional(),
      effective_from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    })
    const parsed = publishSchema.safeParse(req.body ?? {})
    if (!parsed.success) {
      return reply.code(400).send({ error: 'VALIDATION_ERROR', message: parsed.error.issues[0]?.message })
    }

    const result = await publishPolicy(
      fastify.supabase, req.tenantId, id, req.userId,
      { notes: parsed.data.notes, effectiveFrom: parsed.data.effective_from },
    )
    if (!result.success) return reply.code(400).send({ error: 'TRANSITION_ERROR', message: result.error })
    return reply.send({ data: result.master, version: result.version })
  })

  // ── Governance: archive ────────────────────────────────────────────────────
  // POST /:id/archive — transition published → archived.
  fastify.post('/:id/archive', auth, async (req: any, reply) => {
    if (!requireAdmin(req, reply)) return
    const { id } = req.params as { id: string }
    const { reason } = (req.body ?? {}) as { reason?: string }

    const result = await archivePolicy(
      fastify.supabase, req.tenantId, id, req.userId, reason,
    )
    if (!result.success) return reply.code(400).send({ error: 'TRANSITION_ERROR', message: result.error })
    return reply.send({ data: result.master })
  })

  // ── Governance: rollback ───────────────────────────────────────────────────
  // POST /:id/rollback/:version — restore from a snapshot as a new draft.
  fastify.post('/:id/rollback/:version', auth, async (req: any, reply) => {
    if (!requireAdmin(req, reply)) return
    const { id, version } = req.params as { id: string; version: string }
    const { comment } = (req.body ?? {}) as { comment?: string }

    const targetVersion = parseInt(version, 10)
    if (isNaN(targetVersion) || targetVersion < 1) {
      return reply.code(400).send({ error: 'VALIDATION_ERROR', message: 'version must be a positive integer' })
    }

    const result = await rollbackPolicyToVersion(
      fastify.supabase, req.tenantId, id, targetVersion, req.userId, comment,
    )
    if (!result.success) return reply.code(400).send({ error: 'ROLLBACK_ERROR', message: result.error })
    return reply.send({ data: result.master })
  })

  // ── Governance: simulate ───────────────────────────────────────────────────
  // GET /:id/simulate?employee_id=&date= — resolve policy for an employee
  // in simulation mode (logs as is_simulation=true, no side effects on production data).
  fastify.get('/:id/simulate', auth, async (req: any, reply) => {
    if (!requireAdmin(req, reply)) return

    const simSchema = z.object({
      employee_id: z.string().uuid(),
      date:        z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    })
    const parsed = simSchema.safeParse(req.query)
    if (!parsed.success) {
      return reply.code(400).send({ error: 'VALIDATION_ERROR', message: parsed.error.issues[0]?.message })
    }

    const { employee_id, date } = parsed.data

    // Verify employee belongs to tenant
    const { data: emp } = await fastify.supabase
      .from('employees')
      .select('id, first_name, last_name, employee_code')
      .eq('id', employee_id)
      .eq('tenant_id', req.tenantId)
      .maybeSingle()

    if (!emp) {
      return reply.code(404).send({ error: 'NOT_FOUND', message: 'Employee not found' })
    }

    const resolution = await resolveEffectivePolicyForEmployee(
      fastify.supabase,
      req.tenantId,
      employee_id,
      {
        asOf:           date,
        includeDebug:   true,
        persistLog:     true,
        triggerContext: 'simulation',
        isSimulation:   true,
      },
    )

    return reply.send({
      employee: {
        id:            (emp as any).id,
        name:          `${(emp as any).first_name} ${(emp as any).last_name}`,
        employee_code: (emp as any).employee_code,
      },
      resolution,
    })
  })
}
