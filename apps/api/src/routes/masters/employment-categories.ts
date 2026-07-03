/**
 * Employment Categories master — /masters/employment-categories
 *
 * Employment categories classify the nature of engagement beyond the simple
 * employment_type enum (e.g. "Regular Permanent", "Fixed Term", "Casual Daily",
 * "Third-Party Contract"). They carry eligibility flags that drive payroll,
 * compliance, and benefits rules.
 *
 * DELETE protection: deactivates if referenced by any employees.
 */
import type { FastifyInstance } from 'fastify'
import { z }                   from 'zod'
import { generateUniqueCode }  from '../../lib/generate-code.js'
import { HR_ADMIN_ROLES } from '../../lib/rbac.js'

const empCatSchema = z.object({
  code:                 z.string().max(50).optional().transform(v => v ? v.toUpperCase().trim() : v),
  name:                 z.string().min(1, 'Name is required').max(120).transform(v => v.trim()),
  description:          z.string().max(500).optional(),
  benefits_eligible:    z.boolean().default(true),
  pf_applicable:        z.boolean().default(true),
  esi_applicable:       z.boolean().default(true),
  pt_applicable:        z.boolean().default(true),
  gratuity_eligible:    z.boolean().default(true),
  notice_period_days:   z.number().int().min(0).max(365).default(30),
  probation_days:       z.number().int().min(0).max(730).default(90),
  is_active:            z.boolean().optional().default(true),
})

export default async function employmentCategoriesRoutes(fastify: FastifyInstance) {
  const auth = { preHandler: [fastify.authenticate] }

  function requireHrAdmin(req: any, reply: any): boolean {
    if (!(HR_ADMIN_ROLES as readonly string[]).includes(req.userRole)) {
      reply.code(403).send({ error: 'FORBIDDEN', message: 'HR admin access required' })
      return false
    }
    return true
  }

  // ── GET /masters/employment-categories ────────────────────────────────────
  fastify.get('/', auth, async (req: any, reply) => {
    const { data, error } = await fastify.supabase
      .from('employment_categories')
      .select('*')
      .eq('tenant_id', req.tenantId)
      .order('name')
    if (error) return reply.code(500).send({ error: 'DB_ERROR', message: error.message })
    return reply.send({ data: data ?? [] })
  })

  // ── POST /masters/employment-categories ───────────────────────────────────
  fastify.post('/', auth, async (req: any, reply) => {
    if (!requireHrAdmin(req, reply)) return
    const parsed = empCatSchema.safeParse(req.body)
    if (!parsed.success)
      return reply.code(400).send({ error: 'VALIDATION', message: parsed.error.issues[0]?.message })

    const code = parsed.data.code?.trim() ||
      await generateUniqueCode(fastify.supabase, 'employment_categories', req.tenantId, parsed.data.name)

    const { data, error } = await fastify.supabase
      .from('employment_categories')
      .insert({ ...parsed.data, code, tenant_id: req.tenantId })
      .select()
      .single()

    if (error) {
      if (error.code === '23505')
        return reply.code(409).send({ error: 'DUPLICATE', message: `Category code "${code}" already exists` })
      return reply.code(500).send({ error: 'DB_ERROR', message: error.message })
    }
    return reply.code(201).send({ data })
  })

  // ── PUT /masters/employment-categories/:id ────────────────────────────────
  fastify.put('/:id', auth, async (req: any, reply) => {
    if (!requireHrAdmin(req, reply)) return
    const parsed = empCatSchema.partial().safeParse(req.body)
    if (!parsed.success)
      return reply.code(400).send({ error: 'VALIDATION', message: parsed.error.issues[0]?.message })

    const { data, error } = await fastify.supabase
      .from('employment_categories')
      .update(parsed.data)
      .eq('id', req.params.id)
      .eq('tenant_id', req.tenantId)
      .select()
      .single()

    if (error) return reply.code(500).send({ error: 'DB_ERROR', message: error.message })
    if (!data) return reply.code(404).send({ error: 'NOT_FOUND', message: 'Employment category not found' })
    return reply.send({ data })
  })

  // ── DELETE /masters/employment-categories/:id ─────────────────────────────
  fastify.delete('/:id', auth, async (req: any, reply) => {
    if (!requireHrAdmin(req, reply)) return
    const { id } = req.params as { id: string }

    const { count, error: countErr } = await fastify.supabase
      .from('employees')
      .select('id', { count: 'exact', head: true })
      .eq('employment_category_id', id)
      .eq('tenant_id', req.tenantId)

    if (countErr) return reply.code(500).send({ error: 'QUERY_FAILED', message: 'Failed to check category usage' })

    if ((count ?? 0) > 0) {
      const { error: updErr } = await fastify.supabase
        .from('employment_categories')
        .update({ is_active: false })
        .eq('id', id)
        .eq('tenant_id', req.tenantId)
      if (updErr) return reply.code(500).send({ error: 'UPDATE_FAILED', message: updErr.message })
      return reply.send({ deactivated: true, message: `Category deactivated — ${count} employee(s) assigned` })
    }

    const { error: delErr } = await fastify.supabase
      .from('employment_categories')
      .delete()
      .eq('id', id)
      .eq('tenant_id', req.tenantId)
    if (delErr) return reply.code(500).send({ error: 'DELETE_FAILED', message: delErr.message })
    return reply.code(204).send()
  })
}
