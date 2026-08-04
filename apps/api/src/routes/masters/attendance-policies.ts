/**
 * Attendance Policies — CRUD
 *
 * Attendance policies control how raw punch data is interpreted into
 * daily attendance statuses. Each tenant can have multiple named policies
 * (e.g. "Standard", "Field Staff", "Probation") with one marked as default.
 * Individual employees can be assigned to a non-default policy.
 *
 * Endpoints
 * ─────────
 * GET    /masters/attendance-policies              — list all policies for tenant
 * POST   /masters/attendance-policies              — create a new policy
 * PUT    /masters/attendance-policies/:id          — update a policy
 * DELETE /masters/attendance-policies/:id          — delete a policy (not if it is default)
 * POST   /masters/attendance-policies/:id/set-default — make this policy the default
 *
 * Employee assignment sub-resource
 * GET    /masters/attendance-policies/assignments           — list all employee assignments
 * POST   /masters/attendance-policies/assignments           — assign employee to policy
 * DELETE /masters/attendance-policies/assignments/:assignId — remove assignment
 *
 * Access: all authenticated users can read; hr_admin / super_admin for writes.
 */
import type { FastifyInstance } from 'fastify'
import { z }                   from 'zod'
import { policyService }       from '../../lib/policy-service.js'
import { HR_ADMIN_ROLES } from '../../lib/rbac.js'
import { serverError, conflictError, ErrorCode } from '../../lib/api-errors.js'
import { fetchAllRows }        from '../../lib/supabase-paginate.js'

// ── Validation schemas ────────────────────────────────────────────────────────

const policyBody = z.object({
  name:                      z.string().min(1).max(80),
  grace_minutes:             z.number().int().min(0).max(120).default(15),
  late_cap_minutes:          z.number().int().min(1).max(480).default(240),
  present_threshold_pct:     z.number().int().min(1).max(100).default(75),
  half_day_threshold_pct:    z.number().int().min(1).max(99).default(50),
  excessive_hours_threshold: z.number().min(0).max(24).default(12),
})

// expected_version is optional so this stays backward-compatible with a
// frontend that hasn't been updated to send it yet (PEND-105 Phase C) — the
// CAS check below only runs when a caller actually provides it. Maps to the
// `cas_version` column server-side — attendance_policies' own `version`
// column is an unrelated draft→published governance counter (migration 428).
const policyUpdateBody = policyBody.partial().extend({
  expected_version: z.number().int().positive().optional(),
})

const assignmentBody = z.object({
  employee_id:   z.string().uuid(),
  policy_id:     z.string().uuid(),
  effective_from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  effective_to:   z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
})

// ── Route plugin ──────────────────────────────────────────────────────────────

export default async function attendancePoliciesRoutes(fastify: FastifyInstance) {
  const auth = { preHandler: [fastify.authenticate] }

  function requireHrAdmin(req: any, reply: any): boolean {
    if (!(HR_ADMIN_ROLES as readonly string[]).includes(req.userRole)) {
      reply.code(403).send({ error: 'FORBIDDEN', message: 'HR admin access required' })
      return false
    }
    return true
  }

  // ── GET /masters/attendance-policies ─────────────────────────────────────
  fastify.get('/', auth, async (req: any, reply) => {
    const { data, error } = await fastify.supabase
      .from('attendance_policies')
      .select('*')
      .eq('tenant_id', req.tenantId)
      .order('is_default', { ascending: false })
      .order('name')

    if (error) return serverError(req, reply, error, ErrorCode.QUERY_FAILED, 'Failed to fetch attendance policies')
    return reply.send({ data: data ?? [] })
  })

  // ── POST /masters/attendance-policies ─────────────────────────────────────
  fastify.post('/', auth, async (req: any, reply) => {
    if (!requireHrAdmin(req, reply)) return

    const parsed = policyBody.safeParse(req.body)
    if (!parsed.success) {
      return reply.code(400).send({ error: 'VALIDATION_ERROR', message: parsed.error.issues[0]?.message })
    }

    const { data, error } = await fastify.supabase
      .from('attendance_policies')
      .insert({ tenant_id: req.tenantId, ...parsed.data, is_default: false })
      .select()
      .single()

    if (error) {
      if (error.code === '23505') {
        return reply.code(409).send({ error: 'DUPLICATE', message: 'A policy with this name already exists' })
      }
      return serverError(req, reply, error, ErrorCode.INSERT_FAILED, 'Failed to create attendance policy')
    }

    policyService.clearTenantCache(req.tenantId)
    return reply.code(201).send({ data })
  })

  // ── PUT /masters/attendance-policies/:id ─────────────────────────────────
  fastify.put('/:id', auth, async (req: any, reply) => {
    if (!requireHrAdmin(req, reply)) return

    const { id } = req.params as { id: string }
    const parsed = policyUpdateBody.safeParse(req.body)
    if (!parsed.success) {
      return reply.code(400).send({ error: 'VALIDATION_ERROR', message: parsed.error.issues[0]?.message })
    }

    const { expected_version, ...fields } = parsed.data

    let query = fastify.supabase
      .from('attendance_policies')
      .update({ ...fields, updated_at: new Date().toISOString() })
      .eq('id', id)
      .eq('tenant_id', req.tenantId)
    // PEND-105: optimistic-concurrency check — only applied when the caller
    // sends expected_version (see policyUpdateBody comment above). Maps to
    // `cas_version`, not `version` (see migration 428's note on this table).
    if (expected_version !== undefined) query = query.eq('cas_version', expected_version)

    const { data, error } = await query
      .select()
      .maybeSingle()

    if (error) return serverError(req, reply, error, ErrorCode.UPDATE_FAILED, 'Failed to update attendance policy')
    if (!data) {
      // 0 rows matched — either the record doesn't exist, or it does but
      // `cas_version` moved on since expected_version was read. Disambiguate
      // with a plain existence check so a genuinely-deleted record still
      // reports 404, not a confusing 409.
      if (expected_version !== undefined) {
        const { data: exists } = await fastify.supabase
          .from('attendance_policies')
          .select('id')
          .eq('id', id)
          .eq('tenant_id', req.tenantId)
          .maybeSingle()
        if (exists) {
          return conflictError(reply, ErrorCode.VERSION_CONFLICT,
            'This attendance policy was changed by someone else. Reload and try again.')
        }
      }
      return reply.code(404).send({ error: 'NOT_FOUND', message: 'Policy not found' })
    }

    policyService.clearTenantCache(req.tenantId)
    return reply.send({ data })
  })

  // ── DELETE /masters/attendance-policies/:id ──────────────────────────────
  fastify.delete('/:id', auth, async (req: any, reply) => {
    if (!requireHrAdmin(req, reply)) return

    const { id } = req.params as { id: string }

    // Cannot delete default policy
    const { data: existing } = await fastify.supabase
      .from('attendance_policies')
      .select('is_default, name')
      .eq('id', id)
      .eq('tenant_id', req.tenantId)
      .maybeSingle()

    if (!existing) return reply.code(404).send({ error: 'NOT_FOUND', message: 'Policy not found' })
    if (existing.is_default) {
      return reply.code(409).send({
        error:   'DEFAULT_POLICY',
        message: 'Cannot delete the default policy. Set another policy as default first.',
      })
    }

    // Remove employee assignments first
    await fastify.supabase
      .from('employee_attendance_policies')
      .delete()
      .eq('policy_id', id)
      .eq('tenant_id', req.tenantId)

    const { error } = await fastify.supabase
      .from('attendance_policies')
      .delete()
      .eq('id', id)
      .eq('tenant_id', req.tenantId)

    if (error) return serverError(req, reply, error, ErrorCode.DELETE_FAILED, 'Failed to delete attendance policy')

    policyService.clearTenantCache(req.tenantId)
    return reply.code(204).send()
  })

  // ── POST /masters/attendance-policies/:id/set-default ────────────────────
  fastify.post('/:id/set-default', auth, async (req: any, reply) => {
    if (!requireHrAdmin(req, reply)) return

    const { id } = req.params as { id: string }

    // Verify policy belongs to tenant
    const { data: target } = await fastify.supabase
      .from('attendance_policies')
      .select('id, name')
      .eq('id', id)
      .eq('tenant_id', req.tenantId)
      .maybeSingle()

    if (!target) return reply.code(404).send({ error: 'NOT_FOUND', message: 'Policy not found' })

    // Clear existing default
    await fastify.supabase
      .from('attendance_policies')
      .update({ is_default: false, updated_at: new Date().toISOString() })
      .eq('tenant_id', req.tenantId)
      .eq('is_default', true)

    // Set new default. idx_attendance_policies_one_default (migration 401)
    // guards against two concurrent set-default calls both clearing the old
    // default before either sets the new one, which would otherwise leave
    // two rows simultaneously is_default=true — the loser of that race hits
    // a 23505 here instead.
    const { data, error } = await fastify.supabase
      .from('attendance_policies')
      .update({ is_default: true, updated_at: new Date().toISOString() })
      .eq('id', id)
      .eq('tenant_id', req.tenantId)
      .select()
      .single()

    if (error) {
      if (error.code === '23505') {
        return reply.code(409).send({ error: 'CONFLICT', message: 'Another request just changed the default policy — please retry' })
      }
      return serverError(req, reply, error, ErrorCode.UPDATE_FAILED, 'Failed to set default policy')
    }

    policyService.clearTenantCache(req.tenantId)
    return reply.send({ data })
  })

  // ── GET /masters/attendance-policies/assignments ─────────────────────────
  fastify.get('/assignments', auth, async (req: any, reply) => {
    if (!requireHrAdmin(req, reply)) return

    // Paginated — an unbounded .select() truncates at PostgREST's 1,000-row
    // ceiling for a tenant with many non-default policy assignments.
    let data: any[]
    try {
      data = await fetchAllRows((from, to) =>
        fastify.supabase
          .from('employee_attendance_policies')
          .select(`
            id, employee_id, policy_id, effective_from, effective_to, created_at,
            employees!inner(id, first_name, last_name, employee_code),
            attendance_policies!inner(id, name)
          `)
          .eq('tenant_id', req.tenantId)
          .order('created_at', { ascending: false })
          .range(from, to),
      )
    } catch (error) {
      return serverError(req, reply, error, ErrorCode.QUERY_FAILED, 'Failed to fetch attendance policy assignments')
    }
    return reply.send({ data })
  })

  // ── POST /masters/attendance-policies/assignments ─────────────────────────
  fastify.post('/assignments', auth, async (req: any, reply) => {
    if (!requireHrAdmin(req, reply)) return

    const parsed = assignmentBody.safeParse(req.body)
    if (!parsed.success) {
      return reply.code(400).send({ error: 'VALIDATION_ERROR', message: parsed.error.issues[0]?.message })
    }

    // Validate both entities belong to tenant
    const [empRes, polRes] = await Promise.all([
      fastify.supabase.from('employees').select('id').eq('id', parsed.data.employee_id).eq('tenant_id', req.tenantId).maybeSingle(),
      fastify.supabase.from('attendance_policies').select('id').eq('id', parsed.data.policy_id).eq('tenant_id', req.tenantId).maybeSingle(),
    ])
    if (!empRes.data) return reply.code(404).send({ error: 'NOT_FOUND', message: 'Employee not found' })
    if (!polRes.data) return reply.code(404).send({ error: 'NOT_FOUND', message: 'Policy not found' })

    const { data, error } = await fastify.supabase
      .from('employee_attendance_policies')
      .upsert(
        { tenant_id: req.tenantId, ...parsed.data },
        { onConflict: 'tenant_id,employee_id' },
      )
      .select()
      .single()

    if (error) return serverError(req, reply, error, ErrorCode.UPDATE_FAILED, 'Failed to assign attendance policy to employee')

    policyService.clearTenantCache(req.tenantId)
    return reply.code(201).send({ data })
  })

  // ── DELETE /masters/attendance-policies/assignments/:assignId ─────────────
  fastify.delete('/assignments/:assignId', auth, async (req: any, reply) => {
    if (!requireHrAdmin(req, reply)) return

    const { assignId } = req.params as { assignId: string }

    const { error } = await fastify.supabase
      .from('employee_attendance_policies')
      .delete()
      .eq('id', assignId)
      .eq('tenant_id', req.tenantId)

    if (error) return serverError(req, reply, error, ErrorCode.DELETE_FAILED, 'Failed to remove attendance policy assignment')

    policyService.clearTenantCache(req.tenantId)
    return reply.code(204).send()
  })
}
