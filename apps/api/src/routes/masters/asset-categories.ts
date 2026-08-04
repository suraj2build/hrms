/**
 * Asset Categories master — /masters/asset-categories
 *
 * Asset categories classify company assets (Laptop, Mobile, Vehicle, Furniture…)
 * and carry depreciation rules. Individual asset records reference this category.
 *
 * Soft-delete only: since assets may have historical records, deletion always
 * deactivates rather than hard-deletes to preserve audit integrity.
 */
import type { FastifyInstance } from 'fastify'
import { z }                   from 'zod'
import { HR_ADMIN_ROLES } from '../../lib/rbac.js'
import { serverError, notFound, conflictError, ErrorCode } from '../../lib/api-errors.js'

const assetCatSchema = z.object({
  code:                  z.string().min(1, 'Code is required').max(50).transform(v => v.toUpperCase().trim()),
  name:                  z.string().min(1, 'Name is required').max(120).transform(v => v.trim()),
  description:           z.string().max(500).optional(),
  depreciation_method:   z.enum(['straight_line', 'declining_balance', 'none']).default('straight_line'),
  useful_life_years:     z.number().int().min(0).max(100).optional().nullable(),
  salvage_value_pct:     z.number().min(0).max(100).optional().default(0),
  requires_return:       z.boolean().default(true),
  is_trackable:          z.boolean().default(true),
  is_active:             z.boolean().optional().default(true),
})

// expected_version is optional so this stays backward-compatible with a
// frontend that hasn't been updated to send it yet (PEND-105 Phase C) — the
// CAS check below only runs when a caller actually provides it.
const assetCatUpdateSchema = assetCatSchema.partial().extend({
  expected_version: z.number().int().positive().optional(),
})

export default async function assetCategoriesRoutes(fastify: FastifyInstance) {
  const auth = { preHandler: [fastify.authenticate] }

  function requireHrAdmin(req: any, reply: any): boolean {
    if (!(HR_ADMIN_ROLES as readonly string[]).includes(req.userRole)) {
      reply.code(403).send({ error: 'FORBIDDEN', message: 'HR admin access required' })
      return false
    }
    return true
  }

  // ── GET /masters/asset-categories ─────────────────────────────────────────
  fastify.get('/', auth, async (req: any, reply) => {
    const { data, error } = await fastify.supabase
      .from('asset_categories')
      .select('*')
      .eq('tenant_id', req.tenantId)
      .order('name')
    if (error) return serverError(req, reply, error, ErrorCode.QUERY_FAILED, 'Failed to fetch asset categories')
    return reply.send({ data: data ?? [] })
  })

  // ── POST /masters/asset-categories ────────────────────────────────────────
  fastify.post('/', auth, async (req: any, reply) => {
    if (!requireHrAdmin(req, reply)) return
    const parsed = assetCatSchema.safeParse(req.body)
    if (!parsed.success)
      return reply.code(400).send({ error: 'VALIDATION', message: parsed.error.issues[0]?.message })

    const { data, error } = await fastify.supabase
      .from('asset_categories')
      .insert({ ...parsed.data, tenant_id: req.tenantId })
      .select()
      .single()

    if (error) {
      if (error.code === '23505')
        return reply.code(409).send({ error: 'DUPLICATE', message: `Asset category code "${parsed.data.code}" already exists` })
      return serverError(req, reply, error, ErrorCode.INSERT_FAILED, 'Failed to create asset category')
    }
    return reply.code(201).send({ data })
  })

  // ── PUT /masters/asset-categories/:id ─────────────────────────────────────
  fastify.put('/:id', auth, async (req: any, reply) => {
    if (!requireHrAdmin(req, reply)) return
    const parsed = assetCatUpdateSchema.safeParse(req.body)
    if (!parsed.success)
      return reply.code(400).send({ error: 'VALIDATION', message: parsed.error.issues[0]?.message })

    const { expected_version, ...fields } = parsed.data

    // .maybeSingle() (not .single()) — a nonexistent/cross-tenant :id matches
    // zero rows on UPDATE ... RETURNING, which .single() treats as a
    // PGRST116 error rather than an empty result, so the 404 branch below
    // would otherwise be unreachable dead code.
    let query = fastify.supabase
      .from('asset_categories')
      .update(fields)
      .eq('id', req.params.id)
      .eq('tenant_id', req.tenantId)
    // PEND-105: optimistic-concurrency check — only applied when the caller
    // sends expected_version (see assetCatUpdateSchema comment above).
    if (expected_version !== undefined) query = query.eq('version', expected_version)

    const { data, error } = await query
      .select()
      .maybeSingle()

    if (error) {
      if (error.code === '23505') return reply.code(409).send({ error: 'DUPLICATE', message: 'An asset category with this code already exists' })
      return serverError(req, reply, error, ErrorCode.UPDATE_FAILED, 'Failed to update asset category')
    }
    if (!data) {
      // 0 rows matched — either the record doesn't exist, or it does but
      // `version` moved on since expected_version was read. Disambiguate
      // with a plain existence check so a genuinely-deleted record still
      // reports 404, not a confusing 409.
      if (expected_version !== undefined) {
        const { data: exists } = await fastify.supabase
          .from('asset_categories')
          .select('id')
          .eq('id', req.params.id)
          .eq('tenant_id', req.tenantId)
          .maybeSingle()
        if (exists) {
          return conflictError(reply, ErrorCode.VERSION_CONFLICT,
            'This asset category was changed by someone else. Reload and try again.')
        }
      }
      return reply.code(404).send({ error: 'NOT_FOUND', message: 'Asset category not found' })
    }
    return reply.send({ data })
  })

  // ── DELETE /masters/asset-categories/:id ──────────────────────────────────
  // Always soft-deactivates — asset_categories must never be hard-deleted
  // to preserve audit integrity for historical asset assignments.
  fastify.delete('/:id', auth, async (req: any, reply) => {
    if (!requireHrAdmin(req, reply)) return
    const { id } = req.params as { id: string }

    // Check if any assets reference this category (graceful — table may not exist yet)
    let inUse = false
    try {
      const { count } = await fastify.supabase
        .from('assets')
        .select('id', { count: 'exact', head: true })
        .eq('category_id', id)
        .eq('tenant_id', req.tenantId)
      inUse = (count ?? 0) > 0
    } catch { /* assets table may not exist yet; fall through to deactivate */ }

    const { data: updated, error: updErr } = await fastify.supabase
      .from('asset_categories')
      .update({ is_active: false })
      .eq('id', id)
      .eq('tenant_id', req.tenantId)
      .select('id')
      .maybeSingle()

    if (updErr) return serverError(req, reply, updErr, ErrorCode.UPDATE_FAILED, 'Failed to deactivate asset category')
    if (!updated) return notFound(reply, 'NOT_FOUND', 'Asset category not found')
    return reply.send({
      deactivated: true,
      message: inUse
        ? 'Asset category deactivated — has assigned assets'
        : 'Asset category deactivated',
    })
  })
}
