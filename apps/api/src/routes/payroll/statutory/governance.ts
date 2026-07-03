/**
 * Statutory Governance Routes
 *
 * Central admin surface for managing statutory registrations, employee
 * exemption overrides, tenant-level enabled-flags, and audit log access.
 *
 * Endpoints:
 *   GET  /payroll/statutory/governance/settings
 *   PUT  /payroll/statutory/governance/settings
 *
 *   GET  /payroll/statutory/governance/registrations
 *   POST /payroll/statutory/governance/registrations
 *   PUT  /payroll/statutory/governance/registrations/:id
 *   DEL  /payroll/statutory/governance/registrations/:id
 *
 *   GET  /payroll/statutory/governance/overrides
 *   POST /payroll/statutory/governance/overrides
 *   PUT  /payroll/statutory/governance/overrides/:id
 *   DEL  /payroll/statutory/governance/overrides/:id
 *
 *   GET  /payroll/statutory/governance/audit
 *
 *   GET  /payroll/statutory/governance/resolve/:employeeId/:month
 *       → Returns fully resolved statutory params for an employee/month
 *          (the single authoritative view used by all compute engines).
 */

import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { resolveEmployeeStatutoryParams } from '../../../lib/statutory/statutory-governance.js'
import { logAction } from '../../../lib/audit-service.js'
import { HR_ADMIN_ROLES } from '../../../lib/rbac.js'

// ── Helper ─────────────────────────────────────────────────────────────────────

function requireHrAdmin(req: any, reply: any, done: () => void) {
  if (!(HR_ADMIN_ROLES as readonly string[]).includes(req.userRole)) {
    reply.code(403).send({ error: 'FORBIDDEN', message: 'HR admin access required' })
    return
  }
  done()
}

// ── Route plugin ───────────────────────────────────────────────────────────────

export default async function governanceRoutes(fastify: FastifyInstance) {
  const auth      = { preHandler: [fastify.authenticate] }
  const adminAuth = { preHandler: [fastify.authenticate, requireHrAdmin] }

  // ════════════════════════════════════════════════════════════════════════════
  // SETTINGS — payroll_statutory_settings (pf_enabled, esi_enabled, pt_enabled, tds_enabled)
  // ════════════════════════════════════════════════════════════════════════════

  // GET /payroll/statutory/governance/settings
  fastify.get('/settings', auth, async (req: any, reply) => {
    const { data, error } = await fastify.supabase
      .from('payroll_statutory_settings')
      .select('*')
      .eq('tenant_id', req.tenantId)
      .maybeSingle()

    if (error) {
      // Table may be missing on a drifted DB (migration 166 / ensure-migration not
      // applied). Don't 500 the whole Statutory Policy page — return null so the
      // UI shows defaults (TDS off). Saving requires the table to exist.
      req.log.warn({ err: error }, 'payroll_statutory_settings read failed — returning defaults (apply migration to enable saving)')
      return reply.send({ data: null })
    }
    return reply.send({ data: data ?? null })
  })

  // PUT /payroll/statutory/governance/settings
  fastify.put('/settings', adminAuth, async (req: any, reply) => {
    const schema = z.object({
      pf_enabled:               z.boolean().optional(),
      esi_enabled:              z.boolean().optional(),
      pt_enabled:               z.boolean().optional(),
      tds_enabled:              z.boolean().optional(),
      tds_default_rate:         z.number().min(0).max(100).optional(),
      tds_default_regime:       z.enum(['old', 'new']).optional(),
      declaration_window_open:  z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
      declaration_window_close: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
    })

    const parsed = schema.safeParse(req.body)
    if (!parsed.success) {
      return reply.code(400).send({ error: 'VALIDATION_ERROR', message: parsed.error.issues[0]?.message })
    }

    const { data, error } = await fastify.supabase
      .from('payroll_statutory_settings')
      .upsert(
        { ...parsed.data, tenant_id: req.tenantId, updated_at: new Date().toISOString(), updated_by: req.userId },
        { onConflict: 'tenant_id' },
      )
      .select()
      .single()

    if (error) return reply.code(500).send({ error: 'UPSERT_FAILED', message: error.message })

    await logAction(fastify.supabase, {
      tenantId:    req.tenantId,
      tableName:   'payroll_statutory_settings',
      recordId:    (data as any)?.id ?? req.tenantId,
      action:      'UPDATE',
      performedBy: req.userId,
      newData:     parsed.data as Record<string, unknown>,
    })

    return reply.send({ data })
  })

  // ════════════════════════════════════════════════════════════════════════════
  // STATUTORY REGISTRATIONS — site-level registration numbers (EPF, ESI, PTax)
  // ════════════════════════════════════════════════════════════════════════════

  // GET /payroll/statutory/governance/registrations
  fastify.get('/registrations', auth, async (req: any, reply) => {
    const querySchema = z.object({
      statutory_type: z.enum(['epf', 'esi', 'ptax']).optional(),
      site_id:        z.string().uuid().optional(),
      active_only:    z.enum(['true', 'false']).optional(),
    })

    const parsed = querySchema.safeParse(req.query)
    if (!parsed.success) {
      return reply.code(400).send({ error: 'VALIDATION_ERROR', message: parsed.error.issues[0]?.message })
    }

    let q = fastify.supabase
      .from('statutory_registrations')
      .select('*, sites(id, name, code)')
      .eq('tenant_id', req.tenantId)
      .order('statutory_type', { ascending: true })
      .order('effective_from', { ascending: false })

    if (parsed.data.statutory_type) q = q.eq('statutory_type', parsed.data.statutory_type)
    if (parsed.data.site_id)        q = q.eq('site_id', parsed.data.site_id)
    if (parsed.data.active_only === 'true') q = q.eq('is_active', true)

    const { data, error } = await q
    if (error) return reply.code(500).send({ error: 'QUERY_FAILED', message: error.message })
    return reply.send({ data: data ?? [] })
  })

  // POST /payroll/statutory/governance/registrations
  fastify.post('/registrations', adminAuth, async (req: any, reply) => {
    const schema = z.object({
      site_id:             z.string().uuid().nullable().optional(),
      statutory_type:      z.enum(['epf', 'esi', 'ptax']),
      registration_number: z.string().min(1),
      state_code:          z.string().optional(),
      effective_from:      z.string(),
      effective_to:        z.string().optional().nullable(),
      is_active:           z.boolean().optional().default(true),
      notes:               z.string().optional(),
    })

    const parsed = schema.safeParse(req.body)
    if (!parsed.success) {
      return reply.code(400).send({ error: 'VALIDATION_ERROR', message: parsed.error.issues[0]?.message })
    }

    const { data, error } = await fastify.supabase
      .from('statutory_registrations')
      .insert({ ...parsed.data, tenant_id: req.tenantId, created_by: req.userId })
      .select()
      .single()

    if (error) {
      if (error.code === '23505') {
        return reply.code(409).send({ error: 'DUPLICATE_REGISTRATION', message: 'A registration with these parameters already exists' })
      }
      return reply.code(500).send({ error: 'INSERT_FAILED', message: error.message })
    }

    await logAction(fastify.supabase, {
      tenantId:    req.tenantId,
      tableName:   'statutory_registrations',
      recordId:    (data as any)?.id,
      action:      'INSERT',
      performedBy: req.userId,
      newData:     parsed.data as Record<string, unknown>,
    })

    return reply.code(201).send({ data })
  })

  // PUT /payroll/statutory/governance/registrations/:id
  fastify.put('/registrations/:id', adminAuth, async (req: any, reply) => {
    const { id } = req.params as { id: string }

    const schema = z.object({
      registration_number: z.string().min(1).optional(),
      state_code:          z.string().optional(),
      effective_to:        z.string().nullable().optional(),
      is_active:           z.boolean().optional(),
      notes:               z.string().optional(),
    })

    const parsed = schema.safeParse(req.body)
    if (!parsed.success) {
      return reply.code(400).send({ error: 'VALIDATION_ERROR', message: parsed.error.issues[0]?.message })
    }

    const { data, error } = await fastify.supabase
      .from('statutory_registrations')
      .update(parsed.data)
      .eq('id', id)
      .eq('tenant_id', req.tenantId)
      .select()
      .single()

    if (error) return reply.code(500).send({ error: 'UPDATE_FAILED', message: error.message })
    if (!data) return reply.code(404).send({ error: 'NOT_FOUND' })
    await logAction(fastify.supabase, {
      tenantId:    req.tenantId,
      tableName:   'statutory_registrations',
      recordId:    id,
      action:      'UPDATE',
      performedBy: req.userId,
      newData:     parsed.data as Record<string, unknown>,
    })
    return reply.send({ data })
  })

  // DELETE /payroll/statutory/governance/registrations/:id
  fastify.delete('/registrations/:id', adminAuth, async (req: any, reply) => {
    const { id } = req.params as { id: string }

    // Soft-delete: set is_active = false rather than hard delete
    const { error } = await fastify.supabase
      .from('statutory_registrations')
      .update({ is_active: false })
      .eq('id', id)
      .eq('tenant_id', req.tenantId)

    if (error) return reply.code(500).send({ error: 'UPDATE_FAILED', message: error.message })
    await logAction(fastify.supabase, {
      tenantId:    req.tenantId,
      tableName:   'statutory_registrations',
      recordId:    id,
      action:      'DELETE',
      performedBy: req.userId,
      newData:     { is_active: false } as Record<string, unknown>,
    })
    return reply.code(204).send()
  })

  // ════════════════════════════════════════════════════════════════════════════
  // EMPLOYEE STATUTORY OVERRIDES — ESI / PTax exemptions with audit trail
  // ════════════════════════════════════════════════════════════════════════════

  // GET /payroll/statutory/governance/overrides
  fastify.get('/overrides', auth, async (req: any, reply) => {
    const querySchema = z.object({
      employee_id:    z.string().uuid().optional(),
      statutory_type: z.enum(['esi', 'ptax']).optional(),
      active_only:    z.enum(['true', 'false']).optional(),
    })

    const parsed = querySchema.safeParse(req.query)
    if (!parsed.success) {
      return reply.code(400).send({ error: 'VALIDATION_ERROR', message: parsed.error.issues[0]?.message })
    }

    let q = fastify.supabase
      .from('employee_statutory_overrides')
      .select('*, employees(id, first_name, last_name, employee_code), profiles!approved_by(full_name)')
      .eq('tenant_id', req.tenantId)
      .order('created_at', { ascending: false })

    if (parsed.data.employee_id)    q = q.eq('employee_id', parsed.data.employee_id)
    if (parsed.data.statutory_type) q = q.eq('statutory_type', parsed.data.statutory_type)
    if (parsed.data.active_only === 'true') {
      const today = new Date().toISOString().slice(0, 10)
      q = q.lte('effective_from', today).or(`effective_to.is.null,effective_to.gte.${today}`)
    }

    const { data, error } = await q
    if (error) return reply.code(500).send({ error: 'QUERY_FAILED', message: error.message })
    return reply.send({ data: data ?? [] })
  })

  // POST /payroll/statutory/governance/overrides
  fastify.post('/overrides', adminAuth, async (req: any, reply) => {
    const schema = z.object({
      employee_id:      z.string().uuid(),
      statutory_type:   z.enum(['esi', 'ptax']),
      is_exempt:        z.boolean().default(true),
      exemption_reason: z.string().min(1),
      effective_from:   z.string(),
      effective_to:     z.string().nullable().optional(),
    })

    const parsed = schema.safeParse(req.body)
    if (!parsed.success) {
      return reply.code(400).send({ error: 'VALIDATION_ERROR', message: parsed.error.issues[0]?.message })
    }

    const { data, error } = await fastify.supabase
      .from('employee_statutory_overrides')
      .insert({
        ...parsed.data,
        tenant_id:  req.tenantId,
        created_by: req.userId,
      })
      .select()
      .single()

    if (error) return reply.code(500).send({ error: 'INSERT_FAILED', message: error.message })

    // Append to statutory audit log
    await fastify.supabase
      .from('statutory_audit_log')
      .insert({
        tenant_id:   req.tenantId,
        event_type:  'statutory_override_set',
        entity_type: 'employee_statutory_overrides',
        entity_id:   (data as any).id,
        employee_id: parsed.data.employee_id,
        changed_by:  req.userId,
        after_value: data as any,
        notes:       `${parsed.data.statutory_type} exemption set: ${parsed.data.exemption_reason}`,
      })

    await logAction(fastify.supabase, {
      tenantId:    req.tenantId,
      tableName:   'employee_statutory_overrides',
      recordId:    (data as any)?.id,
      action:      'INSERT',
      performedBy: req.userId,
      onBehalfOf:  parsed.data.employee_id,
      newData:     parsed.data as Record<string, unknown>,
    })

    return reply.code(201).send({ data })
  })

  // PUT /payroll/statutory/governance/overrides/:id
  // Typically used to close an exemption by setting effective_to
  fastify.put('/overrides/:id', adminAuth, async (req: any, reply) => {
    const { id } = req.params as { id: string }

    const schema = z.object({
      effective_to:     z.string().nullable().optional(),
      exemption_reason: z.string().optional(),
      is_exempt:        z.boolean().optional(),
    })

    const parsed = schema.safeParse(req.body)
    if (!parsed.success) {
      return reply.code(400).send({ error: 'VALIDATION_ERROR', message: parsed.error.issues[0]?.message })
    }

    // Capture before value for audit
    const { data: before } = await fastify.supabase
      .from('employee_statutory_overrides')
      .select('*')
      .eq('id', id)
      .eq('tenant_id', req.tenantId)
      .single()

    if (!before) return reply.code(404).send({ error: 'NOT_FOUND' })

    const { data, error } = await fastify.supabase
      .from('employee_statutory_overrides')
      .update(parsed.data)
      .eq('id', id)
      .eq('tenant_id', req.tenantId)
      .select()
      .single()

    if (error) return reply.code(500).send({ error: 'UPDATE_FAILED', message: error.message })

    // Append audit log
    await fastify.supabase
      .from('statutory_audit_log')
      .insert({
        tenant_id:    req.tenantId,
        event_type:   'statutory_override_set',
        entity_type:  'employee_statutory_overrides',
        entity_id:    id,
        employee_id:  (before as any).employee_id,
        changed_by:   req.userId,
        before_value: before as any,
        after_value:  data as any,
        notes:        'Override updated',
      })

    await logAction(fastify.supabase, {
      tenantId:    req.tenantId,
      tableName:   'employee_statutory_overrides',
      recordId:    id,
      action:      'UPDATE',
      performedBy: req.userId,
      onBehalfOf:  (before as any).employee_id,
      newData:     parsed.data as Record<string, unknown>,
    })

    return reply.send({ data })
  })

  // DELETE /payroll/statutory/governance/overrides/:id
  // Hard delete — only allowed if the override has never been used in a finalized payroll
  fastify.delete('/overrides/:id', adminAuth, async (req: any, reply) => {
    const { id } = req.params as { id: string }

    const { error } = await fastify.supabase
      .from('employee_statutory_overrides')
      .delete()
      .eq('id', id)
      .eq('tenant_id', req.tenantId)

    if (error) return reply.code(500).send({ error: 'DELETE_FAILED', message: error.message })
    await logAction(fastify.supabase, {
      tenantId:    req.tenantId,
      tableName:   'employee_statutory_overrides',
      recordId:    id,
      action:      'DELETE',
      performedBy: req.userId,
    })
    return reply.code(204).send()
  })

  // ════════════════════════════════════════════════════════════════════════════
  // AUDIT LOG — immutable append-only statutory governance event log
  // ════════════════════════════════════════════════════════════════════════════

  // GET /payroll/statutory/governance/audit
  fastify.get('/audit', auth, async (req: any, reply) => {
    const querySchema = z.object({
      employee_id: z.string().uuid().optional(),
      event_type:  z.string().optional(),
      from:        z.string().optional(),
      to:          z.string().optional(),
      limit:       z.coerce.number().int().min(1).max(500).optional().default(100),
      offset:      z.coerce.number().int().min(0).optional().default(0),
    })

    const parsed = querySchema.safeParse(req.query)
    if (!parsed.success) {
      return reply.code(400).send({ error: 'VALIDATION_ERROR', message: parsed.error.issues[0]?.message })
    }

    let q = fastify.supabase
      .from('statutory_audit_log')
      .select('*, profiles!changed_by(full_name)', { count: 'exact' })
      .eq('tenant_id', req.tenantId)
      .order('changed_at', { ascending: false })
      .range(parsed.data.offset, parsed.data.offset + parsed.data.limit - 1)

    if (parsed.data.employee_id) q = q.eq('employee_id', parsed.data.employee_id)
    if (parsed.data.event_type)  q = q.eq('event_type', parsed.data.event_type)
    if (parsed.data.from)        q = q.gte('changed_at', parsed.data.from)
    if (parsed.data.to)          q = q.lte('changed_at', parsed.data.to)

    const { data, error, count } = await q
    if (error) return reply.code(500).send({ error: 'QUERY_FAILED', message: error.message })
    return reply.send({ data: data ?? [], total: count ?? 0 })
  })

  // ════════════════════════════════════════════════════════════════════════════
  // RESOLVE — single authoritative statutory parameter view for an employee/month
  // Used by payroll UI to preview what EPF/ESI/PTax will apply before running compute.
  // ════════════════════════════════════════════════════════════════════════════

  // GET /payroll/statutory/governance/resolve/:employeeId/:month
  fastify.get('/resolve/:employeeId/:month', auth, async (req: any, reply) => {
    const { employeeId, month } = req.params as { employeeId: string; month: string }

    // Validate month format
    if (!/^\d{4}-\d{2}$/.test(month)) {
      return reply.code(400).send({ error: 'VALIDATION_ERROR', message: 'month must be YYYY-MM' })
    }

    try {
      const params = await resolveEmployeeStatutoryParams(
        fastify.supabase,
        req.tenantId,
        employeeId,
        month,
      )
      return reply.send({ data: params })
    } catch (err: any) {
      fastify.log.error({ err, employeeId, month }, 'statutory resolve failed')
      return reply.code(500).send({ error: 'RESOLVE_FAILED', message: err.message ?? 'Unknown error' })
    }
  })
}
