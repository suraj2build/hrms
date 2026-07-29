/**
 * tds-components.ts — Tax Declaration Component Catalogue Routes
 *
 * Manages the master list of tax declaration components (80C sub-items, HRA,
 * home loan, etc.) used when employees build their declaration plans.
 *
 * Routes (prefix: /payroll/statutory/tds):
 *   GET  /components                    — list all active components
 *   GET  /components/:id                — single component
 *   POST /components           (admin)  — create custom / tenant component
 *   PUT  /components/:id       (admin)  — update component
 */

import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { logAction } from '../../../lib/audit-service.js'
import { HR_ADMIN_ROLES } from '../../../lib/rbac.js'
import { serverError, ErrorCode } from '../../../lib/api-errors.js'

// tax_declaration_components.parent_group / .declaration_type CHECK
// constraints (migration 168) — the ground truth for valid values.
const TAX_COMPONENT_PARENT_GROUPS = [
  'chapter_via', 'hra', 'house_property', 'lta', 'other_income',
  'tds_tcs', 'previous_employment', 'perquisites', 'exemptions',
] as const
const TAX_COMPONENT_DECLARATION_TYPES = [
  'amount', 'percentage', 'text', 'property', 'hra', 'deduction', 'exemption',
] as const

// ── Admin guard ───────────────────────────────────────────────────────────────

function requireHrAdmin(req: any, reply: any, done: () => void) {
  if (!(HR_ADMIN_ROLES as readonly string[]).includes(req.userRole)) {
    reply.code(403).send({ error: 'FORBIDDEN', message: 'HR admin access required' })
    return
  }
  done()
}

// ── Group sort order for consistent UI rendering ──────────────────────────────

const GROUP_ORDER = [
  'chapter_via',
  'hra',
  'house_property',
  'salary_income',
  'other_income',
  'tds_tcs',
  'previous_employment',
]

// =============================================================================
export default async function tdsComponentsRoute(fastify: FastifyInstance) {
  const auth      = { preHandler: [fastify.authenticate] }
  const adminAuth = { preHandler: [fastify.authenticate, requireHrAdmin] }

  // ===========================================================================
  // GET /components?regime=old|new|both&active=true
  // ===========================================================================
  fastify.get('/components', auth, async (req: any, reply) => {
    const qsSchema = z.object({
      regime: z.enum(['old', 'new', 'both']).optional().default('both'),
      active: z.string().optional().default('true'),
    })
    const qs = qsSchema.safeParse(req.query)
    if (!qs.success) {
      return reply.code(400).send({ error: 'VALIDATION_ERROR', message: qs.error.issues[0]?.message })
    }

    const { regime, active } = qs.data

    // Base query: system components (tenant_id IS NULL) + this tenant's custom ones
    let q = fastify.supabase
      .from('tax_declaration_components')
      .select('id, section_code, sub_section, display_name, description, parent_group, regime_eligibility, declaration_type, max_limit, proof_required, is_active, display_order, tenant_id')
      .or(`tenant_id.is.null,tenant_id.eq.${req.tenantId}`)
      .order('display_order', { ascending: true })

    if (active === 'true') {
      q = q.eq('is_active', true)
    }

    if (regime !== 'both') {
      // regime_eligibility can be 'old', 'new', or 'both'
      q = q.or(`regime_eligibility.eq.${regime},regime_eligibility.eq.both`)
    }

    const { data, error } = await q
    if (error) {
      return serverError(req, reply, error, ErrorCode.QUERY_FAILED, 'Failed to fetch tax declaration components')
    }

    const components = (data as any[]) ?? []

    // Build grouped response
    const grouped: Record<string, any[]> = {}
    for (const group of GROUP_ORDER) {
      grouped[group] = []
    }

    for (const comp of components) {
      const group = comp.parent_group ?? 'other'
      if (!grouped[group]) grouped[group] = []
      grouped[group].push(comp)
    }

    // Remove empty groups to keep response clean
    for (const key of Object.keys(grouped)) {
      if (grouped[key].length === 0) delete grouped[key]
    }

    return reply.send({ data: components, grouped })
  })

  // ===========================================================================
  // GET /components/:id
  // ===========================================================================
  fastify.get('/components/:id', auth, async (req: any, reply) => {
    const { id } = req.params as { id: string }

    const { data, error } = await fastify.supabase
      .from('tax_declaration_components')
      .select('*')
      .eq('id', id)
      .or(`tenant_id.is.null,tenant_id.eq.${req.tenantId}`)
      .maybeSingle()

    if (error) {
      return serverError(req, reply, error, ErrorCode.QUERY_FAILED, 'Failed to fetch component')
    }
    if (!data) {
      return reply.code(404).send({ error: 'NOT_FOUND', message: 'Component not found' })
    }

    return reply.send({ data })
  })

  // ===========================================================================
  // POST /components — admin creates a custom component for this tenant
  // ===========================================================================
  fastify.post('/components', adminAuth, async (req: any, reply) => {
    const schema = z.object({
      section_code:       z.string().min(1).max(50),
      // tax_declaration_components.section_name is NOT NULL with no default
      // (migration 168) — this endpoint previously never collected or
      // inserted it, so every POST failed the DB constraint and returned a
      // generic 500 with no indication of the missing field.
      section_name:       z.string().min(1).max(255),
      sub_section:        z.string().max(100).nullable().optional(),
      display_name:       z.string().min(1).max(255),
      description:        z.string().optional().nullable(),
      parent_group:       z.enum(TAX_COMPONENT_PARENT_GROUPS),
      regime_eligibility: z.enum(['old', 'new', 'both']).default('both'),
      declaration_type:   z.enum(TAX_COMPONENT_DECLARATION_TYPES).default('amount'),
      max_limit:          z.number().nonnegative().nullable().optional(),
      proof_required:     z.boolean().default(false),
      display_order:      z.number().int().nonnegative().optional().default(999),
      is_active:          z.boolean().default(true),
    })

    const parsed = schema.safeParse(req.body)
    if (!parsed.success) {
      return reply.code(400).send({ error: 'VALIDATION_ERROR', message: parsed.error.issues[0]?.message })
    }

    const { data, error } = await fastify.supabase
      .from('tax_declaration_components')
      .insert({
        ...parsed.data,
        tenant_id: req.tenantId,
      })
      .select()
      .single()

    if (error) {
      return serverError(req, reply, error, ErrorCode.INSERT_FAILED, 'Failed to create component')
    }

    await logAction(fastify.supabase, {
      tenantId:    req.tenantId,
      tableName:   'tax_declaration_components',
      recordId:    (data as any)?.id,
      action:      'INSERT',
      performedBy: req.userId,
      newData:     parsed.data as Record<string, unknown>,
    })

    return reply.code(201).send({ data })
  })

  // ===========================================================================
  // PUT /components/:id — admin updates a component
  // Only tenant-owned components can be mutated; system (tenant_id=null) are read-only
  // ===========================================================================
  fastify.put('/components/:id', adminAuth, async (req: any, reply) => {
    const { id } = req.params as { id: string }

    // Verify it exists and belongs to this tenant
    const { data: existing } = await fastify.supabase
      .from('tax_declaration_components')
      .select('id, tenant_id')
      .eq('id', id)
      .maybeSingle()

    if (!existing) {
      return reply.code(404).send({ error: 'NOT_FOUND', message: 'Component not found' })
    }
    if ((existing as any).tenant_id !== null && (existing as any).tenant_id !== req.tenantId) {
      return reply.code(403).send({ error: 'FORBIDDEN', message: 'You cannot modify components belonging to another tenant' })
    }
    if ((existing as any).tenant_id === null) {
      return reply.code(403).send({ error: 'FORBIDDEN', message: 'System components cannot be modified. Use the override endpoint instead.' })
    }

    const schema = z.object({
      display_name:       z.string().min(1).max(255).optional(),
      description:        z.string().nullable().optional(),
      regime_eligibility: z.enum(['old', 'new', 'both']).optional(),
      declaration_type:   z.enum(TAX_COMPONENT_DECLARATION_TYPES).optional(),
      max_limit:          z.number().nonnegative().nullable().optional(),
      proof_required:     z.boolean().optional(),
      display_order:      z.number().int().nonnegative().optional(),
      is_active:          z.boolean().optional(),
    })

    const parsed = schema.safeParse(req.body)
    if (!parsed.success) {
      return reply.code(400).send({ error: 'VALIDATION_ERROR', message: parsed.error.issues[0]?.message })
    }

    const { data, error } = await fastify.supabase
      .from('tax_declaration_components')
      .update({ ...parsed.data, updated_at: new Date().toISOString() })
      .eq('id', id)
      .eq('tenant_id', req.tenantId)
      .select()
      .single()

    if (error) {
      return serverError(req, reply, error, ErrorCode.UPDATE_FAILED, 'Failed to update component')
    }

    return reply.send({ data })
  })
}
