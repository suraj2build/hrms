/**
 * Statutory Groups master — /masters/statutory-groups
 *
 * Statutory groups define the compliance configuration for a set of employees
 * by state/region: which deductions apply (PF, ESI, PT, LWF) and at what
 * thresholds. Employees are linked via employee_bank_statutory.statutory_group_id.
 *
 * DELETE protection: deactivates if referenced by any employee_bank_statutory rows.
 */
import type { FastifyInstance } from 'fastify'
import { z }                   from 'zod'
import { logAction }           from '../../lib/audit-service.js'
import { HR_ADMIN_ROLES } from '../../lib/rbac.js'
import { serverError, notFound, conflictError, ErrorCode } from '../../lib/api-errors.js'

const statutoryGroupSchema = z.object({
  code:              z.string().min(1, 'Code is required').max(50).transform(v => v.toUpperCase().trim()),
  name:              z.string().min(1, 'Name is required').max(120).transform(v => v.trim()),
  state:             z.string().max(80).optional(),
  pf_enabled:        z.boolean().default(true),
  esi_enabled:       z.boolean().default(true),
  pt_enabled:        z.boolean().default(false),
  lwf_enabled:       z.boolean().default(false),
  // PF wage-ceiling mode (migration 227): capped | actual | default(follow tenant).
  pf_ceiling_mode:   z.enum(['capped', 'actual', 'default']).default('default'),
  pf_wage_ceiling:   z.number().min(0).optional().nullable(),
  esi_wage_ceiling:  z.number().min(0).optional().nullable(),
  pt_slab_json:      z.string().optional().nullable(),
  is_active:         z.boolean().optional().default(true),
})

// expected_version is optional so this stays backward-compatible with a
// frontend that hasn't been updated to send it yet (PEND-105 Phase C) — the
// CAS check below only runs when a caller actually provides it.
const statutoryGroupUpdateSchema = statutoryGroupSchema.partial().extend({
  expected_version: z.number().int().positive().optional(),
})

export default async function statutoryGroupsRoutes(fastify: FastifyInstance) {
  const auth = { preHandler: [fastify.authenticate] }

  function requireHrAdmin(req: any, reply: any): boolean {
    if (!(HR_ADMIN_ROLES as readonly string[]).includes(req.userRole)) {
      reply.code(403).send({ error: 'FORBIDDEN', message: 'HR admin access required' })
      return false
    }
    return true
  }

  // ── GET /masters/statutory-groups ─────────────────────────────────────────
  fastify.get('/', auth, async (req: any, reply) => {
    const { data, error } = await fastify.supabase
      .from('statutory_groups')
      .select('*')
      .eq('tenant_id', req.tenantId)
      .order('name')
    if (error) return serverError(req, reply, error, ErrorCode.QUERY_FAILED, 'Failed to fetch statutory groups')
    return reply.send({ data: data ?? [] })
  })

  // ── POST /masters/statutory-groups ────────────────────────────────────────
  fastify.post('/', auth, async (req: any, reply) => {
    if (!requireHrAdmin(req, reply)) return
    const parsed = statutoryGroupSchema.safeParse(req.body)
    if (!parsed.success)
      return reply.code(400).send({ error: 'VALIDATION', message: parsed.error.issues[0]?.message })

    const { data, error } = await fastify.supabase
      .from('statutory_groups')
      .insert({ ...parsed.data, tenant_id: req.tenantId })
      .select()
      .single()

    if (error) {
      if (error.code === '23505')
        return reply.code(409).send({ error: 'DUPLICATE', message: `Statutory group code "${parsed.data.code}" already exists` })
      return serverError(req, reply, error, ErrorCode.INSERT_FAILED, 'Failed to create statutory group')
    }
    await logAction(fastify.supabase, {
      tenantId:    req.tenantId,
      tableName:   'statutory_groups',
      recordId:    (data as any)?.id,
      action:      'INSERT',
      performedBy: req.userId,
      newData:     parsed.data as Record<string, unknown>,
    })
    return reply.code(201).send({ data })
  })

  // ── PUT /masters/statutory-groups/:id ─────────────────────────────────────
  fastify.put('/:id', auth, async (req: any, reply) => {
    if (!requireHrAdmin(req, reply)) return
    const parsed = statutoryGroupUpdateSchema.safeParse(req.body)
    if (!parsed.success)
      return reply.code(400).send({ error: 'VALIDATION', message: parsed.error.issues[0]?.message })

    const { expected_version, ...fields } = parsed.data

    // .maybeSingle() (not .single()) — a nonexistent/cross-tenant :id matches
    // zero rows on UPDATE ... RETURNING, which .single() treats as a
    // PGRST116 error rather than an empty result, so the 404 branch below
    // would otherwise be unreachable dead code.
    let query = fastify.supabase
      .from('statutory_groups')
      .update(fields)
      .eq('id', req.params.id)
      .eq('tenant_id', req.tenantId)
    // PEND-105: optimistic-concurrency check — only applied when the caller
    // sends expected_version (see statutoryGroupUpdateSchema comment above).
    if (expected_version !== undefined) query = query.eq('version', expected_version)

    const { data, error } = await query
      .select()
      .maybeSingle()

    if (error) {
      if (error.code === '23505') return reply.code(409).send({ error: 'DUPLICATE', message: 'A statutory group with this code already exists' })
      return serverError(req, reply, error, ErrorCode.UPDATE_FAILED, 'Failed to update statutory group')
    }
    if (!data) {
      // 0 rows matched — either the record doesn't exist, or it does but
      // `version` moved on since expected_version was read. Disambiguate
      // with a plain existence check so a genuinely-deleted record still
      // reports 404, not a confusing 409.
      if (expected_version !== undefined) {
        const { data: exists } = await fastify.supabase
          .from('statutory_groups')
          .select('id')
          .eq('id', req.params.id)
          .eq('tenant_id', req.tenantId)
          .maybeSingle()
        if (exists) {
          return conflictError(reply, ErrorCode.VERSION_CONFLICT,
            'This statutory group was changed by someone else. Reload and try again.')
        }
      }
      return reply.code(404).send({ error: 'NOT_FOUND', message: 'Statutory group not found' })
    }
    await logAction(fastify.supabase, {
      tenantId:    req.tenantId,
      tableName:   'statutory_groups',
      recordId:    req.params.id,
      action:      'UPDATE',
      performedBy: req.userId,
      newData:     fields as Record<string, unknown>,
    })
    return reply.send({ data })
  })

  // ── DELETE /masters/statutory-groups/:id ──────────────────────────────────
  fastify.delete('/:id', auth, async (req: any, reply) => {
    if (!requireHrAdmin(req, reply)) return
    const { id } = req.params as { id: string }

    const { count, error: countErr } = await fastify.supabase
      .from('employees')
      .select('id', { count: 'exact', head: true })
      .eq('statutory_group_id', id)
      .eq('tenant_id', req.tenantId)

    if (countErr) return serverError(req, reply, countErr, ErrorCode.QUERY_FAILED, 'Failed to check statutory group usage')

    if ((count ?? 0) > 0) {
      const { data: updated, error: updErr } = await fastify.supabase
        .from('statutory_groups')
        .update({ is_active: false })
        .eq('id', id)
        .eq('tenant_id', req.tenantId)
        .select('id')
        .maybeSingle()
      if (updErr) return serverError(req, reply, updErr, ErrorCode.UPDATE_FAILED, 'Failed to deactivate statutory group')
      if (!updated) return notFound(reply, 'NOT_FOUND', 'Statutory group not found')
      await logAction(fastify.supabase, {
        tenantId:    req.tenantId,
        tableName:   'statutory_groups',
        recordId:    id,
        action:      'DELETE',
        performedBy: req.userId,
        newData:     { is_active: false } as Record<string, unknown>,
      })
      return reply.send({ deactivated: true, message: `Statutory group deactivated — ${count} employee record(s) assigned` })
    }

    const { data: deleted, error: delErr } = await fastify.supabase
      .from('statutory_groups')
      .delete()
      .eq('id', id)
      .eq('tenant_id', req.tenantId)
      .select('id')
      .maybeSingle()
    if (delErr) return serverError(req, reply, delErr, ErrorCode.DELETE_FAILED, 'Failed to delete statutory group')
    if (!deleted) return notFound(reply, 'NOT_FOUND', 'Statutory group not found')
    await logAction(fastify.supabase, {
      tenantId:    req.tenantId,
      tableName:   'statutory_groups',
      recordId:    id,
      action:      'DELETE',
      performedBy: req.userId,
    })
    return reply.code(204).send()
  })
}
