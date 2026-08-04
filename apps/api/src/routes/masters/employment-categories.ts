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
import { serverError, notFound, conflictError, ErrorCode } from '../../lib/api-errors.js'

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

// expected_version is optional so this stays backward-compatible with a
// frontend that hasn't been updated to send it yet (PEND-105 Phase C) — the
// CAS check below only runs when a caller actually provides it.
const empCatUpdateSchema = empCatSchema.partial().extend({
  expected_version: z.number().int().positive().optional(),
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
    if (error) return serverError(req, reply, error, ErrorCode.QUERY_FAILED, 'Failed to fetch employment categories')
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
      return serverError(req, reply, error, ErrorCode.INSERT_FAILED, 'Failed to create employment category')
    }
    return reply.code(201).send({ data })
  })

  // ── PUT /masters/employment-categories/:id ────────────────────────────────
  fastify.put('/:id', auth, async (req: any, reply) => {
    if (!requireHrAdmin(req, reply)) return
    const parsed = empCatUpdateSchema.safeParse(req.body)
    if (!parsed.success)
      return reply.code(400).send({ error: 'VALIDATION', message: parsed.error.issues[0]?.message })

    const { expected_version, ...fields } = parsed.data

    // .maybeSingle() (not .single()) — a nonexistent/cross-tenant :id matches
    // zero rows on UPDATE ... RETURNING, which .single() treats as a
    // PGRST116 error rather than an empty result, so the 404 branch below
    // would otherwise be unreachable dead code.
    let query = fastify.supabase
      .from('employment_categories')
      .update(fields)
      .eq('id', req.params.id)
      .eq('tenant_id', req.tenantId)
    // PEND-105: optimistic-concurrency check — only applied when the caller
    // sends expected_version (see empCatUpdateSchema comment above).
    if (expected_version !== undefined) query = query.eq('version', expected_version)

    const { data, error } = await query
      .select()
      .maybeSingle()

    if (error) {
      if (error.code === '23505')
        return reply.code(409).send({ error: 'DUPLICATE', message: 'A category with this code already exists' })
      return serverError(req, reply, error, ErrorCode.UPDATE_FAILED, 'Failed to update employment category')
    }
    if (!data) {
      // 0 rows matched — either the record doesn't exist, or it does but
      // `version` moved on since expected_version was read. Disambiguate
      // with a plain existence check so a genuinely-deleted record still
      // reports 404, not a confusing 409.
      if (expected_version !== undefined) {
        const { data: exists } = await fastify.supabase
          .from('employment_categories')
          .select('id')
          .eq('id', req.params.id)
          .eq('tenant_id', req.tenantId)
          .maybeSingle()
        if (exists) {
          return conflictError(reply, ErrorCode.VERSION_CONFLICT,
            'This employment category was changed by someone else. Reload and try again.')
        }
      }
      return reply.code(404).send({ error: 'NOT_FOUND', message: 'Employment category not found' })
    }
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

    if (countErr) return serverError(req, reply, countErr, ErrorCode.QUERY_FAILED, 'Failed to check category usage')

    if ((count ?? 0) > 0) {
      const { data: updated, error: updErr } = await fastify.supabase
        .from('employment_categories')
        .update({ is_active: false })
        .eq('id', id)
        .eq('tenant_id', req.tenantId)
        .select('id')
        .maybeSingle()
      if (updErr) return serverError(req, reply, updErr, ErrorCode.UPDATE_FAILED, 'Failed to deactivate employment category')
      if (!updated) return notFound(reply, 'NOT_FOUND', 'Employment category not found')
      return reply.send({ deactivated: true, message: `Category deactivated — ${count} employee(s) assigned` })
    }

    const { data: deleted, error: delErr } = await fastify.supabase
      .from('employment_categories')
      .delete()
      .eq('id', id)
      .eq('tenant_id', req.tenantId)
      .select('id')
      .maybeSingle()
    if (delErr) return serverError(req, reply, delErr, ErrorCode.DELETE_FAILED, 'Failed to delete employment category')
    if (!deleted) return notFound(reply, 'NOT_FOUND', 'Employment category not found')
    return reply.code(204).send()
  })
}
