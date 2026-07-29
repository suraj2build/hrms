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
import { z } from 'zod'
import { DEFAULT_GUIDANCE_CONFIG, mergeGuidance } from '../../lib/guidance-defaults.js'
import { HR_ADMIN_ROLES } from '../../lib/rbac.js'
import { serverError, validationError, ErrorCode } from '../../lib/api-errors.js'

// Mirrors GuidanceConfig in lib/guidance-defaults.ts — every field optional
// (this is a partial patch), but keys/types must match exactly so an
// unknown key or wrong-typed value can't get merged into tenants.settings.
const guidancePatchSchema = z.object({
  features: z.object({
    enable_help_framework:    z.boolean().optional(),
    enable_process_guides:    z.boolean().optional(),
    enable_field_guidance:    z.boolean().optional(),
    enable_why_explanations:  z.boolean().optional(),
    enable_walkthroughs:      z.boolean().optional(),
    enable_context_assistant: z.boolean().optional(),
  }).strict().optional(),
  roles: z.object({
    employee_help_enabled: z.boolean().optional(),
    manager_help_enabled:  z.boolean().optional(),
    hr_help_enabled:       z.boolean().optional(),
    admin_help_enabled:    z.boolean().optional(),
  }).strict().optional(),
  modules: z.object({
    employee_master:        z.boolean().optional(),
    attendance:             z.boolean().optional(),
    leave:                  z.boolean().optional(),
    payroll:                z.boolean().optional(),
    compensation:           z.boolean().optional(),
    assets:                 z.boolean().optional(),
    onboarding:             z.boolean().optional(),
    separation:             z.boolean().optional(),
    executive_intelligence: z.boolean().optional(),
  }).strict().optional(),
}).strict()

export default async function guidanceRoutes(fastify: FastifyInstance) {
  const auth = { preHandler: [fastify.authenticate] }

  function requireAdmin(req: any, reply: any): boolean {
    if (!(HR_ADMIN_ROLES as readonly string[]).includes(req.userRole)) {
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
    if (error) return serverError(req, reply, error, ErrorCode.QUERY_FAILED, 'Failed to fetch guidance configuration')
    const stored = (data?.settings as any)?.guidance ?? null
    return reply.send({ data: mergeGuidance(DEFAULT_GUIDANCE_CONFIG, stored) })
  })

  // ── PUT /workspace/guidance/config ──────────────────────────────────────────
  fastify.put('/workspace/guidance/config', auth, async (req: any, reply) => {
    if (!requireAdmin(req, reply)) return
    const tenantId = req.tenantId
    const parsed = guidancePatchSchema.safeParse(req.body ?? {})
    if (!parsed.success) {
      return validationError(reply, ErrorCode.VALIDATION_ERROR, parsed.error.issues[0]?.message)
    }
    const body = parsed.data
    if (!body.features && !body.roles && !body.modules) {
      return reply.code(400).send({ error: 'NO_FIELDS', message: 'No guidance fields provided' })
    }

    // Read current settings, deep-merge the guidance sub-tree, write whole settings back.
    const { data: tenantRow, error: readErr } = await fastify.supabase
      .from('tenants').select('settings').eq('id', tenantId).single()
    if (readErr) return serverError(req, reply, readErr, ErrorCode.QUERY_FAILED, 'Failed to read current guidance settings')

    const settings = (tenantRow?.settings as Record<string, unknown>) ?? {}
    const currentGuidance = mergeGuidance(DEFAULT_GUIDANCE_CONFIG, (settings as any).guidance ?? null)
    const mergedGuidance = mergeGuidance(currentGuidance, body)

    const { error: updErr } = await fastify.supabase
      .from('tenants')
      .update({ settings: { ...settings, guidance: mergedGuidance } })
      .eq('id', tenantId)
    if (updErr) return serverError(req, reply, updErr, ErrorCode.UPDATE_FAILED, 'Failed to update guidance configuration')

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
