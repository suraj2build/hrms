/**
 * Clusters CRUD — /masters/clusters
 *
 * Operational grouping of sites (Region → Cluster → Site), independent of the
 * State statutory axis. Carries a cluster/area manager (RBAC scope arrives in
 * Phase 4) and an optional parent cluster for multi-level roll-ups.
 *
 * GET    /masters/clusters           — list all clusters for the tenant
 * GET    /masters/clusters/:id       — single record
 * GET    /masters/clusters/:id/usage — count of sites referencing this cluster
 * POST   /masters/clusters           — create  (hr_admin / super_admin)
 * PUT    /masters/clusters/:id        — update  (hr_admin / super_admin)
 * DELETE /masters/clusters/:id        — delete  (hr_admin / super_admin; merge_to to reassign sites)
 */

import type { FastifyInstance } from 'fastify'
import { z }                    from 'zod'
import { generateUniqueCode }   from '../../lib/generate-code.js'
import { HR_ADMIN_ROLES } from '../../lib/rbac.js'

const SELECT_COLS =
  'id, code, name, region, cluster_manager_id, parent_cluster_id, description, is_active, created_at, updated_at'

const schema = z.object({
  name:               z.string().min(1, 'Name is required').max(120),
  code:               z.string().max(40).optional(),
  region:             z.string().max(80).optional().nullable(),
  cluster_manager_id: z.string().uuid().optional().nullable(),
  parent_cluster_id:  z.string().uuid().optional().nullable(),
  description:        z.string().max(500).optional().nullable(),
  is_active:          z.boolean().optional().default(true),
})

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export default async function clustersRoutes(fastify: FastifyInstance) {
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

  /** Validate that a referenced FK row belongs to this tenant. */
  async function belongsToTenant(table: string, id: string, tenantId: string): Promise<boolean> {
    const { data } = await fastify.supabase
      .from(table)
      .select('id')
      .eq('id', id)
      .eq('tenant_id', tenantId)
      .maybeSingle()
    return !!data
  }

  // ── GET /masters/clusters ─────────────────────────────────────────────────
  fastify.get('/', auth, async (req: any, reply) => {
    const { data, error } = await fastify.supabase
      .from('clusters')
      .select(SELECT_COLS)
      .eq('tenant_id', req.tenantId)
      .order('name')

    if (error) return reply.code(500).send({ error: 'DB_ERROR', message: error.message })
    return reply.send({ data: data ?? [] })
  })

  // ── GET /masters/clusters/:id ─────────────────────────────────────────────
  fastify.get('/:id', auth, async (req: any, reply) => {
    const { data, error } = await fastify.supabase
      .from('clusters')
      .select(SELECT_COLS)
      .eq('id', req.params.id)
      .eq('tenant_id', req.tenantId)
      .maybeSingle()

    if (error) return reply.code(500).send({ error: 'DB_ERROR', message: error.message })
    if (!data) return reply.code(404).send({ error: 'NOT_FOUND', message: 'Cluster not found' })
    return reply.send({ data })
  })

  // ── GET /masters/clusters/:id/usage ───────────────────────────────────────
  fastify.get('/:id/usage', auth, async (req: any, reply) => {
    const { id } = req.params as { id: string }
    const { count, error } = await fastify.supabase
      .from('sites')
      .select('id', { count: 'exact', head: true })
      .eq('cluster_id', id)
      .eq('tenant_id', req.tenantId)

    if (error) return reply.code(500).send({ error: 'QUERY_FAILED', message: error.message })
    return reply.send({ data: { sites: count ?? 0, total: count ?? 0 } })
  })

  // ── POST /masters/clusters ────────────────────────────────────────────────
  fastify.post('/', adminAuth, async (req: any, reply) => {
    const parsed = schema.safeParse(req.body)
    if (!parsed.success)
      return reply.code(400).send({ error: 'VALIDATION', message: parsed.error.issues[0].message })

    if (parsed.data.cluster_manager_id &&
        !(await belongsToTenant('employees', parsed.data.cluster_manager_id, req.tenantId)))
      return reply.code(400).send({ error: 'VALIDATION', message: 'Cluster manager not found in your organisation', field: 'cluster_manager_id' })

    if (parsed.data.parent_cluster_id &&
        !(await belongsToTenant('clusters', parsed.data.parent_cluster_id, req.tenantId)))
      return reply.code(400).send({ error: 'VALIDATION', message: 'Parent cluster not found in your organisation', field: 'parent_cluster_id' })

    const code = parsed.data.code?.trim() ||
      await generateUniqueCode(fastify.supabase, 'clusters', req.tenantId, parsed.data.name)

    const { data, error } = await fastify.supabase
      .from('clusters')
      .insert({ ...parsed.data, code, tenant_id: req.tenantId })
      .select(SELECT_COLS)
      .single()

    if (error) {
      if (error.code === '23505')
        return reply.code(409).send({ error: 'DUPLICATE', message: `A cluster with code "${code}" or name "${parsed.data.name}" already exists` })
      return reply.code(500).send({ error: 'DB_ERROR', message: error.message })
    }
    return reply.code(201).send({ data })
  })

  // ── PUT /masters/clusters/:id ─────────────────────────────────────────────
  fastify.put('/:id', adminAuth, async (req: any, reply) => {
    const { id } = req.params as { id: string }
    const parsed = schema.partial().safeParse(req.body)
    if (!parsed.success)
      return reply.code(400).send({ error: 'VALIDATION', message: parsed.error.issues[0].message })

    if (parsed.data.cluster_manager_id &&
        !(await belongsToTenant('employees', parsed.data.cluster_manager_id, req.tenantId)))
      return reply.code(400).send({ error: 'VALIDATION', message: 'Cluster manager not found in your organisation', field: 'cluster_manager_id' })

    if (parsed.data.parent_cluster_id) {
      if (parsed.data.parent_cluster_id === id)
        return reply.code(400).send({ error: 'VALIDATION', message: 'A cluster cannot be its own parent', field: 'parent_cluster_id' })
      if (!(await belongsToTenant('clusters', parsed.data.parent_cluster_id, req.tenantId)))
        return reply.code(400).send({ error: 'VALIDATION', message: 'Parent cluster not found in your organisation', field: 'parent_cluster_id' })
    }

    const { data, error } = await fastify.supabase
      .from('clusters')
      .update(parsed.data)
      .eq('id', id)
      .eq('tenant_id', req.tenantId)
      .select(SELECT_COLS)
      .single()

    if (error) {
      if (error.code === '23505')
        return reply.code(409).send({ error: 'DUPLICATE', message: 'Another cluster already uses that code or name' })
      return reply.code(500).send({ error: 'DB_ERROR', message: error.message })
    }
    if (!data) return reply.code(404).send({ error: 'NOT_FOUND', message: 'Cluster not found' })
    return reply.send({ data })
  })

  // ── DELETE /masters/clusters/:id ──────────────────────────────────────────
  fastify.delete('/:id', adminAuth, async (req: any, reply) => {
    const { id } = req.params as { id: string }
    const mergeTo = (req.body as any)?.merge_to as string | undefined

    if (mergeTo && !UUID_RE.test(mergeTo))
      return reply.code(400).send({ error: 'VALIDATION', message: 'merge_to must be a valid UUID' })

    const { count, error: countErr } = await fastify.supabase
      .from('sites')
      .select('id', { count: 'exact', head: true })
      .eq('cluster_id', id)
      .eq('tenant_id', req.tenantId)

    if (countErr) return reply.code(500).send({ error: 'QUERY_FAILED', message: 'Failed to check usage' })
    const usageCount = count ?? 0

    if (usageCount > 0 && !mergeTo)
      return reply.code(409).send({
        error:   'IN_USE',
        usageCount,
        message: `Cluster is assigned to ${usageCount} site${usageCount !== 1 ? 's' : ''}. Provide merge_to to reassign.`,
      })

    if (mergeTo && usageCount > 0) {
      const { error: reassignErr } = await fastify.supabase
        .from('sites')
        .update({ cluster_id: mergeTo })
        .eq('cluster_id', id)
        .eq('tenant_id', req.tenantId)
      if (reassignErr) return reply.code(500).send({ error: 'REASSIGN_FAILED', message: reassignErr.message })
    }

    const { error } = await fastify.supabase
      .from('clusters')
      .delete()
      .eq('id', id)
      .eq('tenant_id', req.tenantId)

    if (error) return reply.code(500).send({ error: 'DB_ERROR', message: error.message })
    return reply.code(204).send()
  })
}
