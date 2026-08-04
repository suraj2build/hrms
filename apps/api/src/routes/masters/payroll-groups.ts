/**
 * Payroll Groups master — /masters/payroll-groups
 *
 * Payroll groups define the processing cycle for a set of employees
 * (e.g. "Monthly Staff", "Weekly Contract", "Biweekly Field").
 * Employees are assigned to a payroll group; payroll runs are scoped by group.
 *
 * DELETE protection: if any employees are assigned to this group, the record
 * is deactivated instead of deleted.
 */
import type { FastifyInstance } from 'fastify'
import { z }                   from 'zod'
import { HR_ADMIN_ROLES } from '../../lib/rbac.js'
import { serverError, notFound, conflictError, ErrorCode } from '../../lib/api-errors.js'

const payrollGroupSchema = z.object({
  code:             z.string().min(1, 'Code is required').max(50).transform(v => v.toUpperCase().trim()),
  name:             z.string().min(1, 'Name is required').max(120).transform(v => v.trim()),
  description:      z.string().max(500).optional(),
  cycle_type:       z.enum(['monthly', 'biweekly', 'weekly']).default('monthly'),
  cycle_start_day:  z.number().int().min(1).max(28).default(1),
  cutoff_day:       z.number().int().min(1).max(31).default(25),
  payout_day:       z.number().int().min(1).max(31).default(1),
  currency_code:    z.string().length(3).default('INR').transform(v => v.toUpperCase()),
  is_active:        z.boolean().optional().default(true),
})

// expected_version is optional so this stays backward-compatible with a
// frontend that hasn't been updated to send it yet (PEND-105 Phase C) — the
// CAS check below only runs when a caller actually provides it.
const payrollGroupUpdateSchema = payrollGroupSchema.partial().extend({
  expected_version: z.number().int().positive().optional(),
})

export default async function payrollGroupsRoutes(fastify: FastifyInstance) {
  const auth = { preHandler: [fastify.authenticate] }

  function requireHrAdmin(req: any, reply: any): boolean {
    if (!(HR_ADMIN_ROLES as readonly string[]).includes(req.userRole)) {
      reply.code(403).send({ error: 'FORBIDDEN', message: 'HR admin access required' })
      return false
    }
    return true
  }

  // ── GET /masters/payroll-groups ────────────────────────────────────────────
  fastify.get('/', auth, async (req: any, reply) => {
    const { data, error } = await fastify.supabase
      .from('payroll_groups')
      .select('*')
      .eq('tenant_id', req.tenantId)
      .order('name')
    if (error) return serverError(req, reply, error, ErrorCode.QUERY_FAILED, 'Failed to fetch payroll groups')
    return reply.send({ data: data ?? [] })
  })

  // ── POST /masters/payroll-groups ───────────────────────────────────────────
  fastify.post('/', auth, async (req: any, reply) => {
    if (!requireHrAdmin(req, reply)) return
    const parsed = payrollGroupSchema.safeParse(req.body)
    if (!parsed.success)
      return reply.code(400).send({ error: 'VALIDATION', message: parsed.error.issues[0]?.message })

    const { data, error } = await fastify.supabase
      .from('payroll_groups')
      .insert({ ...parsed.data, tenant_id: req.tenantId })
      .select()
      .single()

    if (error) {
      if (error.code === '23505')
        return reply.code(409).send({ error: 'DUPLICATE', message: `Payroll group code "${parsed.data.code}" already exists` })
      return serverError(req, reply, error, ErrorCode.INSERT_FAILED, 'Failed to create payroll group')
    }
    return reply.code(201).send({ data })
  })

  // ── PUT /masters/payroll-groups/:id ───────────────────────────────────────
  fastify.put('/:id', auth, async (req: any, reply) => {
    if (!requireHrAdmin(req, reply)) return
    const parsed = payrollGroupUpdateSchema.safeParse(req.body)
    if (!parsed.success)
      return reply.code(400).send({ error: 'VALIDATION', message: parsed.error.issues[0]?.message })

    const { expected_version, ...fields } = parsed.data

    // .maybeSingle() (not .single()) — a nonexistent/cross-tenant :id matches
    // zero rows on UPDATE ... RETURNING, which .single() treats as a
    // PGRST116 error rather than an empty result, so the 404 branch below
    // would otherwise be unreachable dead code.
    let query = fastify.supabase
      .from('payroll_groups')
      .update(fields)
      .eq('id', req.params.id)
      .eq('tenant_id', req.tenantId)
    // PEND-105: optimistic-concurrency check — only applied when the caller
    // sends expected_version (see payrollGroupUpdateSchema comment above).
    if (expected_version !== undefined) query = query.eq('version', expected_version)

    const { data, error } = await query
      .select()
      .maybeSingle()

    if (error) {
      if (error.code === '23505') return reply.code(409).send({ error: 'DUPLICATE', message: 'A payroll group with this code already exists' })
      return serverError(req, reply, error, ErrorCode.UPDATE_FAILED, 'Failed to update payroll group')
    }
    if (!data) {
      // 0 rows matched — either the record doesn't exist, or it does but
      // `version` moved on since expected_version was read. Disambiguate
      // with a plain existence check so a genuinely-deleted record still
      // reports 404, not a confusing 409.
      if (expected_version !== undefined) {
        const { data: exists } = await fastify.supabase
          .from('payroll_groups')
          .select('id')
          .eq('id', req.params.id)
          .eq('tenant_id', req.tenantId)
          .maybeSingle()
        if (exists) {
          return conflictError(reply, ErrorCode.VERSION_CONFLICT,
            'This payroll group was changed by someone else. Reload and try again.')
        }
      }
      return reply.code(404).send({ error: 'NOT_FOUND', message: 'Payroll group not found' })
    }
    return reply.send({ data })
  })

  // ── DELETE /masters/payroll-groups/:id ────────────────────────────────────
  fastify.delete('/:id', auth, async (req: any, reply) => {
    if (!requireHrAdmin(req, reply)) return
    const { id } = req.params as { id: string }

    // Check employees assigned to this group
    const { count, error: countErr } = await fastify.supabase
      .from('employees')
      .select('id', { count: 'exact', head: true })
      .eq('payroll_group_id', id)
      .eq('tenant_id', req.tenantId)

    if (countErr) return serverError(req, reply, countErr, ErrorCode.QUERY_FAILED, 'Failed to check payroll group usage')

    if ((count ?? 0) > 0) {
      const { data: updated, error: updErr } = await fastify.supabase
        .from('payroll_groups')
        .update({ is_active: false })
        .eq('id', id)
        .eq('tenant_id', req.tenantId)
        .select('id')
        .maybeSingle()
      if (updErr) return serverError(req, reply, updErr, ErrorCode.UPDATE_FAILED, 'Failed to deactivate payroll group')
      if (!updated) return notFound(reply, 'NOT_FOUND', 'Payroll group not found')
      return reply.send({ deactivated: true, message: `Payroll group deactivated — ${count} employee(s) assigned` })
    }

    const { data: deleted, error: delErr } = await fastify.supabase
      .from('payroll_groups')
      .delete()
      .eq('id', id)
      .eq('tenant_id', req.tenantId)
      .select('id')
      .maybeSingle()
    if (delErr) return serverError(req, reply, delErr, ErrorCode.DELETE_FAILED, 'Failed to delete payroll group')
    if (!deleted) return notFound(reply, 'NOT_FOUND', 'Payroll group not found')
    return reply.code(204).send()
  })
}
