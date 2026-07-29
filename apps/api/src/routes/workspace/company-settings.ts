/**
 * Company Settings Routes
 *
 * GET   /workspace/company              — full tenant settings + employee code config
 * PATCH /workspace/company              — update tenant profile fields
 * GET   /workspace/employee-code        — employee code sequence config
 * PATCH /workspace/employee-code        — update employee code prefix
 */

import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { HR_ADMIN_ROLES } from '../../lib/rbac.js'
import { serverError, ErrorCode } from '../../lib/api-errors.js'

const ALLOWED_SIZES   = ['1-10','11-50','51-200','201-500','501-2000','2001-5000','5001+']
const ALLOWED_INDUSTRIES = [
  'Technology','Retail','Manufacturing','Healthcare','Finance','Education',
  'Hospitality','Construction','Logistics','Media','Consulting','Other',
]

export default async function companySettingsRoutes(fastify: FastifyInstance) {
  const auth = { preHandler: [fastify.authenticate] }

  function requireAdmin(req: any, reply: any): boolean {
    if (!(HR_ADMIN_ROLES as readonly string[]).includes(req.userRole)) {
      reply.code(403).send({ error: 'FORBIDDEN', message: 'HR admin access required' })
      return false
    }
    return true
  }

  // ── GET /workspace/company ────────────────────────────────────────────────────

  fastify.get('/workspace/company', auth, async (req: any, reply) => {
    const tenantId = req.tenantId

    const [tenantRes, codeRes] = await Promise.all([
      fastify.supabase
        .from('tenants')
        .select('id, name, slug, plan, logo_url, industry, size_range, country, timezone, settings, created_at')
        .eq('id', tenantId)
        .single(),

      fastify.supabase
        .from('employee_code_sequences')
        .select('prefix, last_number')
        .eq('tenant_id', tenantId)
        .maybeSingle(),
    ])

    if (tenantRes.error) {
      return serverError(req, reply, tenantRes.error, ErrorCode.QUERY_FAILED, 'Failed to fetch company settings')
    }
    if (codeRes.error) {
      return serverError(req, reply, codeRes.error, ErrorCode.QUERY_FAILED, 'Failed to fetch employee code settings')
    }

    return reply.send({
      data: {
        ...tenantRes.data,
        employee_code: {
          prefix:      codeRes.data?.prefix      ?? 'EMP',
          last_number: codeRes.data?.last_number ?? 0,
          example:     `${codeRes.data?.prefix ?? 'EMP'}${String((codeRes.data?.last_number ?? 0) + 1).padStart(4, '0')}`,
        },
      },
    })
  })

  // ── PATCH /workspace/company ──────────────────────────────────────────────────

  const PatchCompanySchema = z.object({
    name:       z.string().min(1).max(200).optional(),
    industry:   z.string().optional(),
    size_range: z.string().optional(),
    country:    z.string().optional(),
    timezone:   z.string().min(1, 'timezone must not be empty').optional(),
    logo_url:   z.string().optional().nullable(),
    settings:   z.record(z.unknown()).optional(),
  }).passthrough()

  fastify.patch('/workspace/company', auth, async (req: any, reply) => {
    if (!requireAdmin(req, reply)) return

    const bodyParsed = PatchCompanySchema.safeParse(req.body)
    if (!bodyParsed.success) return reply.code(400).send({ error: 'VALIDATION_ERROR', message: bodyParsed.error.issues[0]?.message ?? 'Invalid request body' })

    const tenantId = req.tenantId
    const body     = bodyParsed.data

    // Only allow safe fields to be updated
    const allowed: Record<string, unknown> = {}
    if (body.name        != null) allowed.name        = String(body.name).trim().slice(0, 200)
    if (body.industry    != null) allowed.industry    = String(body.industry)
    if (body.size_range  != null) allowed.size_range  = String(body.size_range)
    if (body.country     != null) allowed.country     = String(body.country).slice(0, 5).toUpperCase()
    if (body.timezone    != null) allowed.timezone    = String(body.timezone)
    if (body.logo_url    != null) allowed.logo_url    = body.logo_url === '' ? null : String(body.logo_url)
    if (body.settings    != null && typeof body.settings === 'object') {
      // Merge into existing settings rather than overwrite. If this read
      // fails, `existing` would silently be undefined and the merge below
      // would collapse to just the new partial payload — permanently
      // discarding every previously stored setting on the subsequent
      // .update(). Bail instead of proceeding to write.
      const { data: existing, error: readErr } = await fastify.supabase
        .from('tenants')
        .select('settings')
        .eq('id', tenantId)
        .single()
      if (readErr) return serverError(req, reply, readErr, ErrorCode.QUERY_FAILED, 'Failed to read existing company settings')
      allowed.settings = { ...(existing?.settings ?? {}), ...body.settings }
    }

    if (Object.keys(allowed).length === 0) {
      return reply.code(400).send({ error: 'NO_FIELDS', message: 'No updatable fields provided' })
    }

    const { data, error } = await fastify.supabase
      .from('tenants')
      .update(allowed)
      .eq('id', tenantId)
      .select('id, name, slug, plan, logo_url, industry, size_range, country, timezone, settings')
      .single()

    if (error) return serverError(req, reply, error, ErrorCode.UPDATE_FAILED, 'Failed to update company settings')

    return reply.send({ data })
  })

  // ── GET /workspace/employee-code ─────────────────────────────────────────────

  fastify.get('/workspace/employee-code', auth, async (req: any, reply) => {
    if (!requireAdmin(req, reply)) return

    const { data, error } = await fastify.supabase
      .from('employee_code_sequences')
      .select('prefix, last_number')
      .eq('tenant_id', req.tenantId)
      .maybeSingle()

    const prefix      = data?.prefix      ?? 'EMP'
    const last_number = data?.last_number ?? 0

    return reply.send({
      data: {
        prefix,
        last_number,
        example: `${prefix}${String(last_number + 1).padStart(4, '0')}`,
        next:    `${prefix}${String(last_number + 1).padStart(4, '0')}`,
      },
    })
  })

  // ── PATCH /workspace/employee-code ───────────────────────────────────────────

  fastify.patch('/workspace/employee-code', auth, async (req: any, reply) => {
    if (!requireAdmin(req, reply)) return

    const body   = req.body as any
    const prefix = String(body.prefix ?? '').trim().toUpperCase()

    if (!prefix || prefix.length < 1 || prefix.length > 10) {
      return reply.code(400).send({ error: 'INVALID_PREFIX', message: 'Prefix must be 1–10 characters' })
    }
    if (!/^[A-Z0-9_-]+$/.test(prefix)) {
      return reply.code(400).send({ error: 'INVALID_PREFIX', message: 'Prefix must contain only letters, numbers, hyphens, or underscores' })
    }

    // Upsert — creates the sequence row if it doesn't exist yet
    const { data, error } = await fastify.supabase
      .from('employee_code_sequences')
      .upsert(
        { tenant_id: req.tenantId, prefix, updated_at: new Date().toISOString() },
        { onConflict: 'tenant_id', ignoreDuplicates: false },
      )
      .select('prefix, last_number')
      .single()

    if (error) return serverError(req, reply, error, ErrorCode.UPDATE_FAILED, 'Failed to update employee code prefix')

    return reply.send({
      data: {
        prefix:      data.prefix,
        last_number: data.last_number,
        example:     `${data.prefix}${String(data.last_number + 1).padStart(4, '0')}`,
      },
    })
  })
}
