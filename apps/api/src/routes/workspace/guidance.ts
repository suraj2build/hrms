/**
 * Workforce Guidance Framework — config + content routes.
 *
 * Read-only over source-of-truth; flags persisted in tenants.settings.guidance.
 * No business-logic or workflow changes. Tenant-isolated via req.tenantId.
 *
 *  GET /workspace/guidance/config   — any authenticated; resolved (defaults+overrides)
 *  PUT /workspace/guidance/config   — admin only; deep-merges partial into settings.guidance
 *  GET /workspace/guidance/content  — any authenticated; active rows for a page key
 */
import type { FastifyInstance } from 'fastify'
import { DEFAULT_GUIDANCE_CONFIG, mergeGuidance } from '../../lib/guidance-defaults.js'

export default async function guidanceRoutes(fastify: FastifyInstance) {
  const auth = { preHandler: [fastify.authenticate] }

  function requireAdmin(req: any, reply: any): boolean {
    if (!['super_admin', 'hr_admin'].includes(req.userRole)) {
      reply.code(403).send({ error: 'FORBIDDEN', message: 'HR admin access required' })
      return false
    }
    return true
  }

  // ── GET /workspace/guidance/config ──────────────────────────────────────────
  fastify.get('/workspace/guidance/config', auth, async (req: any, reply) => {
    const tenantId = req.tenantId
    const { data, error } = await fastify.supabase
      .from('tenants').select('settings').eq('id', tenantId).single()
    if (error) return reply.code(500).send({ error: 'DB_ERROR', message: error.message })
    const stored = (data?.settings as any)?.guidance ?? null
    return reply.send({ data: mergeGuidance(DEFAULT_GUIDANCE_CONFIG, stored) })
  })

  // ── PUT /workspace/guidance/config ──────────────────────────────────────────
  fastify.put('/workspace/guidance/config', auth, async (req: any, reply) => {
    if (!requireAdmin(req, reply)) return
    const tenantId = req.tenantId
    const body = (req.body ?? {}) as { features?: any; roles?: any; modules?: any }
    if (!body.features && !body.roles && !body.modules) {
      return reply.code(400).send({ error: 'NO_FIELDS', message: 'No guidance fields provided' })
    }

    // Read current settings, deep-merge the guidance sub-tree, write whole settings back.
    const { data: tenantRow, error: readErr } = await fastify.supabase
      .from('tenants').select('settings').eq('id', tenantId).single()
    if (readErr) return reply.code(500).send({ error: 'DB_ERROR', message: readErr.message })

    const settings = (tenantRow?.settings as Record<string, unknown>) ?? {}
    const currentGuidance = mergeGuidance(DEFAULT_GUIDANCE_CONFIG, (settings as any).guidance ?? null)
    const mergedGuidance = mergeGuidance(currentGuidance, body)

    const { error: updErr } = await fastify.supabase
      .from('tenants')
      .update({ settings: { ...settings, guidance: mergedGuidance } })
      .eq('id', tenantId)
    if (updErr) return reply.code(500).send({ error: 'DB_ERROR', message: updErr.message })

    return reply.send({ data: mergedGuidance })
  })

  // ── GET /workspace/guidance/content ─────────────────────────────────────────
  fastify.get('/workspace/guidance/content', auth, async (req: any, reply) => {
    const tenantId = req.tenantId
    const { module, page_key } = (req.query ?? {}) as { module?: string; page_key?: string }
    if (!module || !page_key) {
      return reply.code(400).send({ error: 'MISSING_PARAMS', message: 'module and page_key are required' })
    }
    try {
      const { data, error } = await fastify.supabase
        .from('guidance_content')
        .select('content_type, role, field_key, title, body')
        .eq('tenant_id', tenantId)
        .eq('module', module)
        .eq('page_key', page_key)
        .eq('is_active', true)
        .limit(200)
      if (error) return reply.send({ data: [] }) // table may be unmigrated — degrade to static content
      return reply.send({ data: data ?? [] })
    } catch {
      return reply.send({ data: [] })
    }
  })
}
