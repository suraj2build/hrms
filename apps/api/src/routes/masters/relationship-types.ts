import type { FastifyInstance } from 'fastify'
import { requireRole, HR_ADMIN_ROLES } from '../../lib/rbac.js'
import { z } from 'zod'
import { serverError, notFound, conflictError, ErrorCode } from '../../lib/api-errors.js'

const schema = z.object({
  name:      z.string().min(1, 'Name is required'),
  code:      z.string().min(1, 'Code is required'),
  is_active: z.boolean().optional().default(true),
})

// expected_version is optional so this stays backward-compatible with a
// frontend that hasn't been updated to send it yet (PEND-105 Phase C) — the
// CAS check below only runs when a caller actually provides it.
const updateSchema = schema.partial().extend({
  expected_version: z.number().int().positive().optional(),
})

export default async function relationshipTypesRoutes(fastify: FastifyInstance) {
  const auth = { preHandler: [fastify.authenticate] }
  const hrAdminAuth = { preHandler: [fastify.authenticate, requireRole(...HR_ADMIN_ROLES)] }

  fastify.get('/', auth, async (req: any, reply) => {
    const { data, error } = await fastify.supabase
      .from('relationship_types')
      .select('*')
      .eq('tenant_id', req.tenantId)
      .order('name')
    if (error) return serverError(req, reply, error, ErrorCode.QUERY_FAILED, 'Failed to fetch relationship types')
    return reply.send({ data })
  })

  fastify.post('/', hrAdminAuth, async (req: any, reply) => {
    const parsed = schema.safeParse(req.body)
    if (!parsed.success)
      return reply.code(400).send({ error: 'VALIDATION', message: parsed.error.issues[0].message })
    const { data, error } = await fastify.supabase
      .from('relationship_types')
      .insert({ ...parsed.data, tenant_id: req.tenantId })
      .select()
      .single()
    if (error) {
      if (error.code === '23505') return reply.code(409).send({ error: 'DUPLICATE', message: 'A relationship type with this code already exists' })
      return serverError(req, reply, error, ErrorCode.INSERT_FAILED, 'Failed to create relationship type')
    }
    return reply.code(201).send(data)
  })

  fastify.put('/:id', hrAdminAuth, async (req: any, reply) => {
    const parsed = updateSchema.safeParse(req.body)
    if (!parsed.success)
      return reply.code(400).send({ error: 'VALIDATION', message: parsed.error.issues[0].message })
    const { expected_version, ...fields } = parsed.data
    // .maybeSingle() (not .single()) — a nonexistent/cross-tenant :id matches
    // zero rows on UPDATE ... RETURNING, which .single() treats as a
    // PGRST116 error rather than an empty result, so the 404 branch below
    // would otherwise be unreachable dead code.
    let query = fastify.supabase
      .from('relationship_types')
      .update(fields)
      .eq('id', req.params.id)
      .eq('tenant_id', req.tenantId)
    // PEND-105: optimistic-concurrency check — only applied when the caller
    // sends expected_version (see updateSchema comment above).
    if (expected_version !== undefined) query = query.eq('version', expected_version)
    const { data, error } = await query
      .select()
      .maybeSingle()
    if (error) {
      if (error.code === '23505') return reply.code(409).send({ error: 'DUPLICATE', message: 'A relationship type with this code already exists' })
      return serverError(req, reply, error, ErrorCode.UPDATE_FAILED, 'Failed to update relationship type')
    }
    if (!data) {
      // 0 rows matched — either the record doesn't exist, or it does but
      // `version` moved on since expected_version was read. Disambiguate
      // with a plain existence check so a genuinely-deleted record still
      // reports 404, not a confusing 409.
      if (expected_version !== undefined) {
        const { data: exists } = await fastify.supabase
          .from('relationship_types')
          .select('id')
          .eq('id', req.params.id)
          .eq('tenant_id', req.tenantId)
          .maybeSingle()
        if (exists) {
          return conflictError(reply, ErrorCode.VERSION_CONFLICT,
            'This relationship type was changed by someone else. Reload and try again.')
        }
      }
      return reply.code(404).send({ error: 'NOT_FOUND', message: 'Relationship type not found' })
    }
    return reply.send(data)
  })

  // Always soft-deactivates — employee_family.relationship_type_id REFERENCES
  // this table with no ON DELETE clause (RESTRICT), so a hard delete on an
  // in-use type throws an unhandled 23503 FK-violation. Deactivating (like
  // every sibling master) avoids that crash entirely.
  fastify.delete('/:id', hrAdminAuth, async (req: any, reply) => {
    const { id } = req.params as { id: string }

    const { count } = await fastify.supabase
      .from('employee_family')
      .select('id', { count: 'exact', head: true })
      .eq('relationship_type_id', id)
      .eq('tenant_id', req.tenantId)
    const inUse = (count ?? 0) > 0

    const { data: updated, error } = await fastify.supabase
      .from('relationship_types')
      .update({ is_active: false })
      .eq('id', id)
      .eq('tenant_id', req.tenantId)
      .select('id')
      .maybeSingle()
    if (error) return serverError(req, reply, error, ErrorCode.UPDATE_FAILED, 'Failed to deactivate relationship type')
    if (!updated) return notFound(reply, 'NOT_FOUND', 'Relationship type not found')
    return reply.send({
      deactivated: true,
      message: inUse
        ? 'Relationship type deactivated — in use by existing family records'
        : 'Relationship type deactivated',
    })
  })
}
