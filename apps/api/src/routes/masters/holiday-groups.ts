/**
 * /masters/holiday-groups
 *
 * CRUD for roster_holiday_groups — regional holiday calendars (e.g. "North India",
 * "Maharashtra", a factory/union calendar). Sites are assigned a group; a holiday
 * tagged to a group applies only to employees whose site observes that group.
 *
 *   GET    /masters/holiday-groups        list (any authenticated)
 *   POST   /masters/holiday-groups        create (hr_admin / super_admin)
 *   PUT    /masters/holiday-groups/:id     update (hr_admin / super_admin)
 *   DELETE /masters/holiday-groups/:id     delete (hr_admin / super_admin)
 */
import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { HR_ADMIN_ROLES } from '../../lib/rbac.js'
import { serverError, conflictError, ErrorCode } from '../../lib/api-errors.js'

const schema = z.object({
  name:        z.string().min(1, 'Name is required').max(120),
  code:        z.string().max(50).optional().nullable(),
  description: z.string().max(500).optional().nullable(),
  state_code:  z.string().max(10).optional().nullable(),
  is_active:   z.boolean().optional().default(true),
})

// expected_version is optional so this stays backward-compatible with a
// frontend that hasn't been updated to send it yet (PEND-105 Phase C) — the
// CAS check below only runs when a caller actually provides it.
const updateSchema = schema.partial().extend({
  expected_version: z.number().int().positive().optional(),
})

export default async function holidayGroupsRoutes(fastify: FastifyInstance) {
  const auth = { preHandler: [fastify.authenticate] }
  const isAdmin = (req: any) => (HR_ADMIN_ROLES as readonly string[]).includes(req.userRole)

  fastify.get('/', auth, async (req: any, reply) => {
    const { data, error } = await fastify.supabase
      .from('roster_holiday_groups')
      .select('id, name, code, description, state_code, is_active, version, created_at')
      .eq('tenant_id', req.tenantId)
      .order('name', { ascending: true })
    if (error) return serverError(req, reply, error, ErrorCode.QUERY_FAILED, 'Failed to fetch holiday groups')
    return reply.send({ data: data ?? [] })
  })

  fastify.post('/', auth, async (req: any, reply) => {
    if (!isAdmin(req)) return reply.code(403).send({ error: 'FORBIDDEN', message: 'HR admin access required' })
    const parsed = schema.safeParse(req.body)
    if (!parsed.success) return reply.code(400).send({ error: 'VALIDATION', message: parsed.error.issues[0]?.message })
    const { data, error } = await fastify.supabase
      .from('roster_holiday_groups')
      .insert({ ...parsed.data, tenant_id: req.tenantId })
      .select('id, name, code, description, state_code, is_active, version, created_at')
      .single()
    if (error) {
      if (error.code === '23505') return reply.code(409).send({ error: 'DUPLICATE', message: 'A holiday group with that name already exists' })
      return serverError(req, reply, error, ErrorCode.INSERT_FAILED, 'Failed to create holiday group')
    }
    return reply.code(201).send({ data })
  })

  fastify.put('/:id', auth, async (req: any, reply) => {
    if (!isAdmin(req)) return reply.code(403).send({ error: 'FORBIDDEN', message: 'HR admin access required' })
    const parsed = updateSchema.safeParse(req.body)
    if (!parsed.success) return reply.code(400).send({ error: 'VALIDATION', message: parsed.error.issues[0]?.message })
    const { expected_version, ...fields } = parsed.data
    // .maybeSingle() (not .single()) — a nonexistent/cross-tenant :id matches
    // zero rows on UPDATE ... RETURNING, which .single() treats as a
    // PGRST116 error rather than an empty result, so the 404 branch below
    // would otherwise be unreachable dead code.
    let query = fastify.supabase
      .from('roster_holiday_groups')
      .update(fields)
      .eq('id', (req.params as { id: string }).id)
      .eq('tenant_id', req.tenantId)
    // PEND-105: optimistic-concurrency check — only applied when the caller
    // sends expected_version (see updateSchema comment above).
    if (expected_version !== undefined) query = query.eq('version', expected_version)
    const { data, error } = await query
      .select('id, name, code, description, state_code, is_active, version, created_at')
      .maybeSingle()
    if (error) {
      if (error.code === '23505') return reply.code(409).send({ error: 'DUPLICATE', message: 'A holiday group with that name already exists' })
      return serverError(req, reply, error, ErrorCode.UPDATE_FAILED, 'Failed to update holiday group')
    }
    if (!data) {
      // 0 rows matched — either the record doesn't exist, or it does but
      // `version` moved on since expected_version was read. Disambiguate
      // with a plain existence check so a genuinely-deleted record still
      // reports 404, not a confusing 409.
      if (expected_version !== undefined) {
        const { data: exists } = await fastify.supabase
          .from('roster_holiday_groups')
          .select('id')
          .eq('id', (req.params as { id: string }).id)
          .eq('tenant_id', req.tenantId)
          .maybeSingle()
        if (exists) {
          return conflictError(reply, ErrorCode.VERSION_CONFLICT,
            'This holiday group was changed by someone else. Reload and try again.')
        }
      }
      return reply.code(404).send({ error: 'NOT_FOUND', message: 'Holiday group not found' })
    }
    return reply.send({ data })
  })

  fastify.delete('/:id', auth, async (req: any, reply) => {
    if (!isAdmin(req)) return reply.code(403).send({ error: 'FORBIDDEN', message: 'HR admin access required' })
    // sites.holiday_group_id and holiday_calendar.holiday_group_id are ON DELETE SET NULL,
    // so deleting a group simply un-scopes its sites/holidays (back to all-India).
    const { data, error } = await fastify.supabase
      .from('roster_holiday_groups')
      .delete()
      .eq('id', (req.params as { id: string }).id)
      .eq('tenant_id', req.tenantId)
      .select('id')
      .maybeSingle()
    if (error) return serverError(req, reply, error, ErrorCode.DELETE_FAILED, 'Failed to delete holiday group')
    if (!data) return reply.code(404).send({ error: 'NOT_FOUND', message: 'Holiday group not found' })
    return reply.code(204).send()
  })
}
