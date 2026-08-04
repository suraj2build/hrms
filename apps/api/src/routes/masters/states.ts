/**
 * States CRUD — /masters/states
 *
 * India state/UT master: the statutory axis for sites. Carries the GST state
 * code plus Professional Tax (PT) and Labour Welfare Fund (LWF) applicability.
 * Seeded per tenant by migration 273; tenants may edit flags or add rows.
 *
 * GET    /masters/states           — list all states for the tenant
 * GET    /masters/states/:id       — single record
 * GET    /masters/states/:id/usage — count of sites referencing this state
 * POST   /masters/states           — create  (hr_admin / super_admin)
 * PUT    /masters/states/:id        — update  (hr_admin / super_admin)
 * DELETE /masters/states/:id        — delete  (hr_admin / super_admin; merge_to to reassign sites)
 */

import type { FastifyInstance } from 'fastify'
import { z }                    from 'zod'
import { HR_ADMIN_ROLES } from '../../lib/rbac.js'
import { serverError, conflictError, ErrorCode } from '../../lib/api-errors.js'

const SELECT_COLS =
  'id, code, name, region, country, pt_applicable, lwf_applicable, lwf_frequency, min_wage_zone, is_active, version, created_at, updated_at'

const schema = z.object({
  code:           z.string().min(1, 'GST state code is required').max(3),
  name:           z.string().min(1, 'Name is required').max(120),
  region:         z.string().max(80).optional().nullable(),
  country:        z.string().max(80).optional().default('India'),
  pt_applicable:  z.boolean().optional().default(false),
  lwf_applicable: z.boolean().optional().default(false),
  lwf_frequency:  z.enum(['monthly', 'half_yearly', 'annual']).optional().nullable(),
  min_wage_zone:  z.string().max(80).optional().nullable(),
  is_active:      z.boolean().optional().default(true),
})

// expected_version is optional so this stays backward-compatible with a
// frontend that hasn't been updated to send it yet (PEND-105 Phase C) — the
// CAS check below only runs when a caller actually provides it.
const updateSchema = schema.partial().extend({
  expected_version: z.number().int().positive().optional(),
})

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export default async function statesRoutes(fastify: FastifyInstance) {
  const auth      = { preHandler: [fastify.authenticate] }
  const adminAuth = {
    preHandler: [
      fastify.authenticate,
      async (req: any, reply: any) => {
        if (!(HR_ADMIN_ROLES as readonly string[]).includes(req.userRole)) {
          return reply.code(403).send({ error: 'FORBIDDEN', message: 'HR admin access required' })
        }
      },
    ],
  }

  // ── GET /masters/states ───────────────────────────────────────────────────
  fastify.get('/', auth, async (req: any, reply) => {
    const { data, error } = await fastify.supabase
      .from('states')
      .select(SELECT_COLS)
      .eq('tenant_id', req.tenantId)
      .order('code')

    if (error) return serverError(req, reply, error, ErrorCode.QUERY_FAILED, 'Failed to fetch states')
    return reply.send({ data: data ?? [] })
  })

  // ── GET /masters/states/:id ───────────────────────────────────────────────
  fastify.get('/:id', auth, async (req: any, reply) => {
    const { data, error } = await fastify.supabase
      .from('states')
      .select(SELECT_COLS)
      .eq('id', req.params.id)
      .eq('tenant_id', req.tenantId)
      .maybeSingle()

    if (error) return serverError(req, reply, error, ErrorCode.QUERY_FAILED, 'Failed to fetch state')
    if (!data) return reply.code(404).send({ error: 'NOT_FOUND', message: 'State not found' })
    return reply.send({ data })
  })

  // ── GET /masters/states/:id/usage ─────────────────────────────────────────
  fastify.get('/:id/usage', auth, async (req: any, reply) => {
    const { id } = req.params as { id: string }
    const { count, error } = await fastify.supabase
      .from('sites')
      .select('id', { count: 'exact', head: true })
      .eq('state_id', id)
      .eq('tenant_id', req.tenantId)

    if (error) return serverError(req, reply, error, ErrorCode.QUERY_FAILED, 'Failed to fetch state usage')
    return reply.send({ data: { sites: count ?? 0, total: count ?? 0 } })
  })

  // ── POST /masters/states ──────────────────────────────────────────────────
  fastify.post('/', adminAuth, async (req: any, reply) => {
    const parsed = schema.safeParse(req.body)
    if (!parsed.success)
      return reply.code(400).send({ error: 'VALIDATION', message: parsed.error.issues[0].message })

    const { data, error } = await fastify.supabase
      .from('states')
      .insert({ ...parsed.data, tenant_id: req.tenantId })
      .select(SELECT_COLS)
      .single()

    if (error) {
      if (error.code === '23505')
        return reply.code(409).send({
          error:   'DUPLICATE',
          message: `A state with code "${parsed.data.code}" or name "${parsed.data.name}" already exists`,
        })
      return serverError(req, reply, error, ErrorCode.INSERT_FAILED, 'Failed to create state')
    }
    return reply.code(201).send({ data })
  })

  // ── PUT /masters/states/:id ───────────────────────────────────────────────
  fastify.put('/:id', adminAuth, async (req: any, reply) => {
    const parsed = updateSchema.safeParse(req.body)
    if (!parsed.success)
      return reply.code(400).send({ error: 'VALIDATION', message: parsed.error.issues[0].message })

    const { expected_version, ...fields } = parsed.data

    let query = fastify.supabase
      .from('states')
      .update(fields)
      .eq('id', req.params.id)
      .eq('tenant_id', req.tenantId)
    // PEND-105: optimistic-concurrency check — only applied when the caller
    // sends expected_version (see updateSchema comment above).
    if (expected_version !== undefined) query = query.eq('version', expected_version)

    const { data, error } = await query
      .select(SELECT_COLS)
      .maybeSingle()

    if (error) {
      if (error.code === '23505')
        return reply.code(409).send({ error: 'DUPLICATE', message: 'Another state already uses that code or name' })
      return serverError(req, reply, error, ErrorCode.UPDATE_FAILED, 'Failed to update state')
    }
    if (!data) {
      // 0 rows matched — either the record doesn't exist, or it does but
      // `version` moved on since expected_version was read. Disambiguate
      // with a plain existence check so a genuinely-deleted record still
      // reports 404, not a confusing 409.
      if (expected_version !== undefined) {
        const { data: exists } = await fastify.supabase
          .from('states')
          .select('id')
          .eq('id', req.params.id)
          .eq('tenant_id', req.tenantId)
          .maybeSingle()
        if (exists) {
          return conflictError(reply, ErrorCode.VERSION_CONFLICT,
            'This state was changed by someone else. Reload and try again.')
        }
      }
      return reply.code(404).send({ error: 'NOT_FOUND', message: 'State not found' })
    }
    return reply.send({ data })
  })

  // ── DELETE /masters/states/:id ────────────────────────────────────────────
  fastify.delete('/:id', adminAuth, async (req: any, reply) => {
    const { id } = req.params as { id: string }
    const mergeTo = (req.body as any)?.merge_to as string | undefined

    if (mergeTo && !UUID_RE.test(mergeTo))
      return reply.code(400).send({ error: 'VALIDATION', message: 'merge_to must be a valid UUID' })

    // merge_to === id would resolve to the record being deleted itself,
    // passing the tenant check below while every reassignment UPDATE
    // becomes a no-op and the record is deleted anyway — the referencing
    // FK (ON DELETE SET NULL) goes to NULL instead of the intended target.
    if (mergeTo === id)
      return reply.code(400).send({ error: 'VALIDATION', message: 'merge_to cannot be the same record being deleted' })

    // merge_to must resolve to a state in this tenant — without this,
    // sites rows could be repointed at another tenant's state.
    if (mergeTo) {
      const { data: mergeTarget, error: mergeCheckErr } = await fastify.supabase
        .from('states')
        .select('id')
        .eq('id', mergeTo)
        .eq('tenant_id', req.tenantId)
        .maybeSingle()
      if (mergeCheckErr) return serverError(req, reply, mergeCheckErr, ErrorCode.QUERY_FAILED, 'Failed to verify merge target')
      if (!mergeTarget) return reply.code(400).send({ error: 'VALIDATION', message: 'merge_to must reference a state in your organisation' })
    }

    const { count, error: countErr } = await fastify.supabase
      .from('sites')
      .select('id', { count: 'exact', head: true })
      .eq('state_id', id)
      .eq('tenant_id', req.tenantId)

    if (countErr) return serverError(req, reply, countErr, ErrorCode.QUERY_FAILED, 'Failed to check state usage')
    const usageCount = count ?? 0

    if (usageCount > 0 && !mergeTo)
      return reply.code(409).send({
        error:   'IN_USE',
        usageCount,
        message: `State is referenced by ${usageCount} site${usageCount !== 1 ? 's' : ''}. Provide merge_to to reassign.`,
      })

    if (mergeTo && usageCount > 0) {
      const { error: reassignErr } = await fastify.supabase
        .from('sites')
        .update({ state_id: mergeTo })
        .eq('state_id', id)
        .eq('tenant_id', req.tenantId)
      if (reassignErr) return serverError(req, reply, reassignErr, ErrorCode.UPDATE_FAILED, 'Failed to reassign sites to the merge target state')
    }

    const { error } = await fastify.supabase
      .from('states')
      .delete()
      .eq('id', id)
      .eq('tenant_id', req.tenantId)

    if (error) return serverError(req, reply, error, ErrorCode.DELETE_FAILED, 'Failed to delete state')
    return reply.code(204).send()
  })
}
