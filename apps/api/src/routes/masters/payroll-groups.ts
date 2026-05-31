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

export default async function payrollGroupsRoutes(fastify: FastifyInstance) {
  const auth = { preHandler: [fastify.authenticate] }

  function requireHrAdmin(req: any, reply: any): boolean {
    if (!['super_admin', 'hr_admin'].includes(req.userRole)) {
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
    if (error) return reply.code(500).send({ error: 'DB_ERROR', message: error.message })
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
      return reply.code(500).send({ error: 'DB_ERROR', message: error.message })
    }
    return reply.code(201).send({ data })
  })

  // ── PUT /masters/payroll-groups/:id ───────────────────────────────────────
  fastify.put('/:id', auth, async (req: any, reply) => {
    if (!requireHrAdmin(req, reply)) return
    const parsed = payrollGroupSchema.partial().safeParse(req.body)
    if (!parsed.success)
      return reply.code(400).send({ error: 'VALIDATION', message: parsed.error.issues[0]?.message })

    const { data, error } = await fastify.supabase
      .from('payroll_groups')
      .update(parsed.data)
      .eq('id', req.params.id)
      .eq('tenant_id', req.tenantId)
      .select()
      .single()

    if (error) return reply.code(500).send({ error: 'DB_ERROR', message: error.message })
    if (!data) return reply.code(404).send({ error: 'NOT_FOUND', message: 'Payroll group not found' })
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

    if (countErr) return reply.code(500).send({ error: 'QUERY_FAILED', message: 'Failed to check payroll group usage' })

    if ((count ?? 0) > 0) {
      const { error: updErr } = await fastify.supabase
        .from('payroll_groups')
        .update({ is_active: false })
        .eq('id', id)
        .eq('tenant_id', req.tenantId)
      if (updErr) return reply.code(500).send({ error: 'UPDATE_FAILED', message: updErr.message })
      return reply.send({ deactivated: true, message: `Payroll group deactivated — ${count} employee(s) assigned` })
    }

    const { error: delErr } = await fastify.supabase
      .from('payroll_groups')
      .delete()
      .eq('id', id)
      .eq('tenant_id', req.tenantId)
    if (delErr) return reply.code(500).send({ error: 'DELETE_FAILED', message: delErr.message })
    return reply.code(204).send()
  })
}
