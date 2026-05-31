/**
 * TDS (Tax Deducted at Source) Routes
 * Tax regime elections, declarations, proofs, projections, and monthly TDS computation.
 *
 * Route groups:
 *   ESS (/my) — employee reads/writes for their own data; no employeeId in path
 *   Admin     — HR admin reads across all employees; uses /:employeeId or /all queries
 */

import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { computeTDS } from '../../../lib/statutory/tds-engine.js'

// DB enum values — must match migration 098_tds_foundation.sql CHECK constraint
const DECLARATION_CATEGORIES = [
  '80C',
  '80D',
  '80E',
  '80G',
  '80TTA',
  'HRA',
  'LTA',
  'home_loan_principal',
  'home_loan_interest',
  'NPS',
  'standard_deduction',
  'professional_tax',
  'other',
] as const

// Statuses that allow an employee to still modify a declaration
const EMPLOYEE_MUTABLE_STATUSES = ['draft', 'declared', 'revision_requested']

// Statuses that HR admin can approve/reject
const REVIEWABLE_STATUSES = ['submitted', 'under_review']

// ── Helpers ───────────────────────────────────────────────────────────────────

function currentFinancialYear(): string {
  const now = new Date()
  const fyYear = now.getMonth() >= 3 ? now.getFullYear() : now.getFullYear() - 1
  return `${fyYear}-${String(fyYear + 1).slice(2)}`
}

async function resolveCallerEmployeeId(fastify: FastifyInstance, req: any): Promise<string | null> {
  const { data } = await fastify.supabase
    .from('profiles')
    .select('employee_id')
    .eq('id', req.userId)
    .eq('tenant_id', req.tenantId)
    .single()
  return (data as any)?.employee_id ?? null
}

async function writeAuditLog(
  fastify: FastifyInstance,
  tenantId: string,
  declarationId: string,
  changedBy: string,
  fromStatus: string | null,
  toStatus: string,
  notes?: string,
  metadata?: Record<string, unknown>,
): Promise<void> {
  await fastify.supabase
    .from('tds_declaration_audit_log')
    .insert({
      tenant_id:      tenantId,
      declaration_id: declarationId,
      changed_by:     changedBy,
      changed_at:     new Date().toISOString(),
      from_status:    fromStatus ?? null,
      to_status:      toStatus,
      notes:          notes ?? null,
      metadata:       metadata ?? {},
    })
}

// =============================================================================
export default async function tdsRoutes(fastify: FastifyInstance) {
  const auth = { preHandler: [fastify.authenticate] }

  function requireHrAdmin(req: any, reply: any, done: () => void) {
    if (!['super_admin', 'hr_admin'].includes(req.userRole)) {
      reply.code(403).send({ error: 'FORBIDDEN', message: 'HR admin access required' })
      return
    }
    done()
  }

  // ===========================================================================
  // ESS — Tax Regime (current employee)
  // ===========================================================================

  // GET /payroll/statutory/tds/regime/my?financial_year=2025-26
  fastify.get('/regime/my', auth, async (req: any, reply) => {
    const employeeId = await resolveCallerEmployeeId(fastify, req)
    if (!employeeId) return reply.code(403).send({ error: 'PROFILE_NOT_LINKED', message: 'Your profile is not linked to an employee record' })

    const qs = z.object({ financial_year: z.string().optional() }).safeParse(req.query)
    const fy = qs.data?.financial_year ?? currentFinancialYear()

    const { data, error } = await fastify.supabase
      .from('tax_regime_elections')
      .select('*')
      .eq('employee_id', employeeId)
      .eq('tenant_id', req.tenantId)
      .eq('financial_year', fy)
      .order('effective_from', { ascending: false })
      .limit(1)
      .maybeSingle()

    if (error) return reply.code(500).send({ error: 'QUERY_FAILED', message: error.message })
    return reply.send({ data: data ?? null })
  })

  // PUT /payroll/statutory/tds/regime/my
  fastify.put('/regime/my', auth, async (req: any, reply) => {
    const employeeId = await resolveCallerEmployeeId(fastify, req)
    if (!employeeId) return reply.code(403).send({ error: 'PROFILE_NOT_LINKED', message: 'Your profile is not linked to an employee record' })

    const schema = z.object({
      regime:         z.enum(['old', 'new']),
      financial_year: z.string().min(1),
    })
    const parsed = schema.safeParse(req.body)
    if (!parsed.success) return reply.code(400).send({ error: 'VALIDATION_ERROR', message: parsed.error.issues[0]?.message })

    const { data, error } = await fastify.supabase
      .from('tax_regime_elections')
      .upsert({
        ...parsed.data,
        employee_id:    employeeId,
        tenant_id:      req.tenantId,
        effective_from: new Date().toISOString().slice(0, 10),
        elected_by:     req.userId,
      }, { onConflict: 'tenant_id,employee_id,financial_year' })
      .select()
      .single()

    if (error) return reply.code(500).send({ error: 'UPSERT_FAILED', message: error.message })
    return reply.send({ data })
  })

  // ===========================================================================
  // ESS — Declarations (current employee)
  // ===========================================================================

  // GET /payroll/statutory/tds/declarations/my?financial_year=2025-26
  fastify.get('/declarations/my', auth, async (req: any, reply) => {
    const employeeId = await resolveCallerEmployeeId(fastify, req)
    if (!employeeId) return reply.code(403).send({ error: 'PROFILE_NOT_LINKED', message: 'Your profile is not linked to an employee record' })

    const qs = z.object({ financial_year: z.string().optional() }).safeParse(req.query)
    let q = fastify.supabase
      .from('tax_declarations')
      .select('*, declaration_proofs(id, file_name, document_state, uploaded_at)')
      .eq('employee_id', employeeId)
      .eq('tenant_id', req.tenantId)
      .order('created_at', { ascending: false })

    if (qs.data?.financial_year) q = q.eq('financial_year', qs.data.financial_year)

    const { data, error } = await q
    if (error) return reply.code(500).send({ error: 'QUERY_FAILED', message: error.message })
    return reply.send({ data: data ?? [] })
  })

  // POST /payroll/statutory/tds/declarations/my — ESS creates declaration for self
  fastify.post('/declarations/my', auth, async (req: any, reply) => {
    const employeeId = await resolveCallerEmployeeId(fastify, req)
    if (!employeeId) return reply.code(403).send({ error: 'PROFILE_NOT_LINKED', message: 'Your profile is not linked to an employee record' })

    const schema = z.object({
      financial_year:       z.string().min(1),
      declaration_category: z.enum(DECLARATION_CATEGORIES),
      section:              z.string().min(1),
      description:          z.string().min(1),
      declared_amount:      z.number().positive(),
    })
    const parsed = schema.safeParse(req.body)
    if (!parsed.success) return reply.code(400).send({ error: 'VALIDATION_ERROR', message: parsed.error.issues[0]?.message })

    const { data, error } = await fastify.supabase
      .from('tax_declarations')
      .insert({
        ...parsed.data,
        employee_id: employeeId,
        tenant_id:   req.tenantId,
        status:      'declared',
      })
      .select()
      .single()

    if (error) return reply.code(500).send({ error: 'INSERT_FAILED', message: error.message })

    await writeAuditLog(fastify, req.tenantId, (data as any).id, req.userId, null, 'declared', 'Declaration created by employee')

    return reply.code(201).send({ data })
  })

  // PUT /payroll/statutory/tds/declarations/my/:id — ESS updates own declaration
  fastify.put('/declarations/my/:id', auth, async (req: any, reply) => {
    const employeeId = await resolveCallerEmployeeId(fastify, req)
    if (!employeeId) return reply.code(403).send({ error: 'PROFILE_NOT_LINKED', message: 'Your profile is not linked to an employee record' })

    const { id } = req.params as { id: string }

    const { data: existing } = await fastify.supabase
      .from('tax_declarations')
      .select('status, employee_id')
      .eq('id', id)
      .eq('tenant_id', req.tenantId)
      .single()

    if (!existing) return reply.code(404).send({ error: 'NOT_FOUND', message: 'Declaration not found' })
    if ((existing as any).employee_id !== employeeId) return reply.code(403).send({ error: 'FORBIDDEN', message: 'You can only modify your own declarations' })

    // Payroll lock guard
    if ((existing as any).status === 'locked' || (existing as any).status === 'payroll_applied') {
      return reply.code(423).send({
        error:   'PAYROLL_LOCKED',
        message: 'This declaration is locked by payroll and cannot be modified',
      })
    }

    if (!EMPLOYEE_MUTABLE_STATUSES.includes((existing as any).status)) {
      return reply.code(409).send({ error: 'INVALID_STATUS', message: `Declarations with status '${(existing as any).status}' cannot be modified. Only draft, declared, or revision_requested declarations can be updated.` })
    }

    const schema = z.object({
      declared_amount: z.number().positive().optional(),
      description:     z.string().optional(),
    })
    const parsed = schema.safeParse(req.body)
    if (!parsed.success) return reply.code(400).send({ error: 'VALIDATION_ERROR', message: parsed.error.issues[0]?.message })

    const { data, error } = await fastify.supabase
      .from('tax_declarations')
      .update({ ...parsed.data, updated_at: new Date().toISOString() })
      .eq('id', id)
      .eq('tenant_id', req.tenantId)
      .select()
      .single()

    if (error) return reply.code(500).send({ error: 'UPDATE_FAILED', message: error.message })
    return reply.send({ data })
  })

  // POST /payroll/statutory/tds/declarations/:id/submit — employee submits for review
  fastify.post('/declarations/:id/submit', auth, async (req: any, reply) => {
    const employeeId = await resolveCallerEmployeeId(fastify, req)
    if (!employeeId) return reply.code(403).send({ error: 'PROFILE_NOT_LINKED', message: 'Your profile is not linked to an employee record' })

    const { id } = req.params as { id: string }

    const { data: existing } = await fastify.supabase
      .from('tax_declarations')
      .select('status, employee_id')
      .eq('id', id)
      .eq('tenant_id', req.tenantId)
      .single()

    if (!existing) return reply.code(404).send({ error: 'NOT_FOUND', message: 'Declaration not found' })
    if ((existing as any).employee_id !== employeeId) return reply.code(403).send({ error: 'FORBIDDEN', message: 'You can only submit your own declarations' })

    const allowedFromStatuses = ['declared', 'revision_requested']
    if (!allowedFromStatuses.includes((existing as any).status)) {
      return reply.code(409).send({
        error:   'INVALID_STATUS',
        message: `Only declarations with status 'declared' or 'revision_requested' can be submitted. Current status: '${(existing as any).status}'.`,
      })
    }

    const now = new Date().toISOString()
    const fromStatus = (existing as any).status

    const { data, error } = await fastify.supabase
      .from('tax_declarations')
      .update({ status: 'submitted', submitted_at: now, updated_at: now })
      .eq('id', id)
      .eq('tenant_id', req.tenantId)
      .select()
      .single()

    if (error) return reply.code(500).send({ error: 'UPDATE_FAILED', message: error.message })

    await writeAuditLog(fastify, req.tenantId, id, req.userId, fromStatus, 'submitted', 'Submitted for review by employee')

    return reply.send({ data })
  })

  // ===========================================================================
  // ESS — Projections (current employee)
  // ===========================================================================

  // GET /payroll/statutory/tds/projections/my?financial_year=2025-26
  fastify.get('/projections/my', auth, async (req: any, reply) => {
    const employeeId = await resolveCallerEmployeeId(fastify, req)
    if (!employeeId) return reply.code(403).send({ error: 'PROFILE_NOT_LINKED', message: 'Your profile is not linked to an employee record' })

    const qs = z.object({ financial_year: z.string().optional() }).safeParse(req.query)
    let q = fastify.supabase
      .from('tds_monthly_projections')
      .select('*')
      .eq('employee_id', employeeId)
      .eq('tenant_id', req.tenantId)
      .order('projection_month', { ascending: true })

    if (qs.data?.financial_year) q = q.eq('financial_year', qs.data.financial_year)

    const { data, error } = await q
    if (error) return reply.code(500).send({ error: 'QUERY_FAILED', message: error.message })
    return reply.send({ data: data ?? [] })
  })

  // ===========================================================================
  // Admin — Regime (by employeeId)
  // ===========================================================================

  // GET /payroll/statutory/tds/regime/:employeeId
  fastify.get('/regime/:employeeId', auth, async (req: any, reply) => {
    const { employeeId } = req.params as { employeeId: string }
    const qs = z.object({ financial_year: z.string().optional() }).safeParse(req.query)
    const fy = qs.data?.financial_year ?? currentFinancialYear()

    const { data, error } = await fastify.supabase
      .from('tax_regime_elections')
      .select('*')
      .eq('employee_id', employeeId)
      .eq('tenant_id', req.tenantId)
      .eq('financial_year', fy)
      .order('effective_from', { ascending: false })
      .limit(1)
      .maybeSingle()

    if (error) return reply.code(500).send({ error: 'QUERY_FAILED', message: error.message })
    return reply.send({ data: data ?? null })
  })

  // PUT /payroll/statutory/tds/regime/:employeeId — HR admin can set regime for any employee
  fastify.put('/regime/:employeeId', { preHandler: [fastify.authenticate, requireHrAdmin] }, async (req: any, reply) => {
    const { employeeId } = req.params as { employeeId: string }

    const schema = z.object({
      regime:         z.enum(['old', 'new']),
      financial_year: z.string().min(1),
    })
    const parsed = schema.safeParse(req.body)
    if (!parsed.success) return reply.code(400).send({ error: 'VALIDATION_ERROR', message: parsed.error.issues[0]?.message })

    const { data, error } = await fastify.supabase
      .from('tax_regime_elections')
      .upsert({
        ...parsed.data,
        employee_id:    employeeId,
        tenant_id:      req.tenantId,
        effective_from: new Date().toISOString().slice(0, 10),
        elected_by:     req.userId,
      }, { onConflict: 'tenant_id,employee_id,financial_year' })
      .select()
      .single()

    if (error) return reply.code(500).send({ error: 'UPSERT_FAILED', message: error.message })
    return reply.send({ data })
  })

  // ===========================================================================
  // Admin — Declarations (all employees)
  // ===========================================================================

  // GET /payroll/statutory/tds/declarations?financial_year=2025-26&status=submitted
  // HR admin: list all declarations for the tenant
  fastify.get('/declarations', { preHandler: [fastify.authenticate, requireHrAdmin] }, async (req: any, reply) => {
    const qs = z.object({
      financial_year: z.string().optional(),
      status:         z.string().optional(),
    }).safeParse(req.query)

    let q = fastify.supabase
      .from('tax_declarations')
      .select(`
        *,
        employees!inner (
          id,
          employee_code,
          profiles (id, full_name)
        ),
        declaration_proofs (id, file_name, document_state, uploaded_at)
      `)
      .eq('tenant_id', req.tenantId)
      .order('created_at', { ascending: false })

    if (qs.data?.financial_year) q = q.eq('financial_year', qs.data.financial_year)
    if (qs.data?.status)         q = q.eq('status', qs.data.status)

    const { data, error } = await q
    if (error) return reply.code(500).send({ error: 'QUERY_FAILED', message: error.message })
    return reply.send({ data: data ?? [] })
  })

  // GET /payroll/statutory/tds/declarations/:employeeId — by specific employee
  fastify.get('/declarations/:employeeId', auth, async (req: any, reply) => {
    const { employeeId } = req.params as { employeeId: string }
    const isHrAdmin = ['super_admin', 'hr_admin'].includes(req.userRole)

    // Non-admin: verify they're requesting their own data
    if (!isHrAdmin) {
      const callerEmpId = await resolveCallerEmployeeId(fastify, req)
      if (callerEmpId !== employeeId) return reply.code(403).send({ error: 'FORBIDDEN', message: 'Access denied' })
    }

    const qs = z.object({ financial_year: z.string().optional() }).safeParse(req.query)

    let q = fastify.supabase
      .from('tax_declarations')
      .select('*, declaration_proofs(id, file_name, document_state, uploaded_at)')
      .eq('employee_id', employeeId)
      .eq('tenant_id', req.tenantId)
      .order('created_at', { ascending: false })

    if (qs.data?.financial_year) q = q.eq('financial_year', qs.data.financial_year)

    const { data, error } = await q
    if (error) return reply.code(500).send({ error: 'QUERY_FAILED', message: error.message })
    return reply.send({ data: data ?? [] })
  })

  // POST /payroll/statutory/tds/declarations — HR admin creates declaration for any employee
  fastify.post('/declarations', { preHandler: [fastify.authenticate, requireHrAdmin] }, async (req: any, reply) => {
    const schema = z.object({
      employee_id:          z.string().uuid(),
      financial_year:       z.string().min(1),
      declaration_category: z.enum(DECLARATION_CATEGORIES),
      section:              z.string().min(1),
      description:          z.string().min(1),
      declared_amount:      z.number().positive(),
    })
    const parsed = schema.safeParse(req.body)
    if (!parsed.success) return reply.code(400).send({ error: 'VALIDATION_ERROR', message: parsed.error.issues[0]?.message })

    const { data, error } = await fastify.supabase
      .from('tax_declarations')
      .insert({
        ...parsed.data,
        tenant_id: req.tenantId,
        status:    'declared',
      })
      .select()
      .single()

    if (error) return reply.code(500).send({ error: 'INSERT_FAILED', message: error.message })

    await writeAuditLog(fastify, req.tenantId, (data as any).id, req.userId, null, 'declared', 'Declaration created by HR admin')

    return reply.code(201).send({ data })
  })

  // PUT /payroll/statutory/tds/declarations/:id — HR admin updates a declaration
  fastify.put('/declarations/:id', { preHandler: [fastify.authenticate, requireHrAdmin] }, async (req: any, reply) => {
    const { id } = req.params as { id: string }

    const { data: existing } = await fastify.supabase
      .from('tax_declarations')
      .select('status')
      .eq('id', id)
      .eq('tenant_id', req.tenantId)
      .single()

    if (!existing) return reply.code(404).send({ error: 'NOT_FOUND', message: 'Declaration not found' })
    if (!EMPLOYEE_MUTABLE_STATUSES.includes((existing as any).status)) {
      return reply.code(409).send({ error: 'INVALID_STATUS', message: `Declarations with status '${(existing as any).status}' cannot be modified.` })
    }

    const schema = z.object({
      declared_amount: z.number().positive().optional(),
      description:     z.string().optional(),
    })
    const parsed = schema.safeParse(req.body)
    if (!parsed.success) return reply.code(400).send({ error: 'VALIDATION_ERROR', message: parsed.error.issues[0]?.message })

    const { data, error } = await fastify.supabase
      .from('tax_declarations')
      .update({ ...parsed.data, updated_at: new Date().toISOString() })
      .eq('id', id)
      .eq('tenant_id', req.tenantId)
      .select()
      .single()

    if (error) return reply.code(500).send({ error: 'UPDATE_FAILED', message: error.message })
    return reply.send({ data })
  })

  // POST /payroll/statutory/tds/declarations/:id/approve — HR admin approves
  fastify.post('/declarations/:id/approve', { preHandler: [fastify.authenticate, requireHrAdmin] }, async (req: any, reply) => {
    const { id } = req.params as { id: string }

    const schema = z.object({
      approved_amount: z.number().nonnegative(),
      notes:           z.string().optional(),
    })
    const parsed = schema.safeParse(req.body)
    if (!parsed.success) return reply.code(400).send({ error: 'VALIDATION_ERROR', message: parsed.error.issues[0]?.message })

    // Guard: only reviewable statuses can be approved
    const { data: existing } = await fastify.supabase
      .from('tax_declarations')
      .select('status')
      .eq('id', id)
      .eq('tenant_id', req.tenantId)
      .single()

    if (!existing) return reply.code(404).send({ error: 'NOT_FOUND', message: 'Declaration not found' })
    if (!REVIEWABLE_STATUSES.includes((existing as any).status)) {
      return reply.code(409).send({
        error:   'INVALID_STATUS',
        message: `Only declarations with status 'submitted' or 'under_review' can be approved. Current status: '${(existing as any).status}'.`,
      })
    }

    const now = new Date().toISOString()
    const fromStatus = (existing as any).status

    const { data, error } = await fastify.supabase
      .from('tax_declarations')
      .update({
        status:          'approved',
        approved_amount: parsed.data.approved_amount,
        reviewed_by:     req.userId,
        reviewed_at:     now,
        updated_at:      now,
      })
      .eq('id', id)
      .eq('tenant_id', req.tenantId)
      .select()
      .single()

    if (error) return reply.code(500).send({ error: 'UPDATE_FAILED', message: error.message })

    await writeAuditLog(fastify, req.tenantId, id, req.userId, fromStatus, 'approved', parsed.data.notes, {
      approved_amount: parsed.data.approved_amount,
    })

    return reply.send({ data })
  })

  // POST /payroll/statutory/tds/declarations/:id/reject — HR admin rejects
  fastify.post('/declarations/:id/reject', { preHandler: [fastify.authenticate, requireHrAdmin] }, async (req: any, reply) => {
    const { id } = req.params as { id: string }

    const schema = z.object({
      rejection_reason: z.string().min(1),
    })
    const parsed = schema.safeParse(req.body)
    if (!parsed.success) return reply.code(400).send({ error: 'VALIDATION_ERROR', message: parsed.error.issues[0]?.message })

    // Guard: only reviewable statuses can be rejected
    const { data: existing } = await fastify.supabase
      .from('tax_declarations')
      .select('status')
      .eq('id', id)
      .eq('tenant_id', req.tenantId)
      .single()

    if (!existing) return reply.code(404).send({ error: 'NOT_FOUND', message: 'Declaration not found' })
    if (!REVIEWABLE_STATUSES.includes((existing as any).status)) {
      return reply.code(409).send({
        error:   'INVALID_STATUS',
        message: `Only declarations with status 'submitted' or 'under_review' can be rejected. Current status: '${(existing as any).status}'.`,
      })
    }

    const now = new Date().toISOString()
    const fromStatus = (existing as any).status

    const { data, error } = await fastify.supabase
      .from('tax_declarations')
      .update({
        status:           'rejected',
        rejection_reason: parsed.data.rejection_reason,
        reviewed_by:      req.userId,
        reviewed_at:      now,
        updated_at:       now,
      })
      .eq('id', id)
      .eq('tenant_id', req.tenantId)
      .select()
      .single()

    if (error) return reply.code(500).send({ error: 'UPDATE_FAILED', message: error.message })

    await writeAuditLog(fastify, req.tenantId, id, req.userId, fromStatus, 'rejected', parsed.data.rejection_reason)

    return reply.send({ data })
  })

  // POST /payroll/statutory/tds/declarations/:id/request-revision — HR admin sends back for revision
  fastify.post('/declarations/:id/request-revision', { preHandler: [fastify.authenticate, requireHrAdmin] }, async (req: any, reply) => {
    const { id } = req.params as { id: string }

    const schema = z.object({
      notes: z.string().min(1),
    })
    const parsed = schema.safeParse(req.body)
    if (!parsed.success) return reply.code(400).send({ error: 'VALIDATION_ERROR', message: parsed.error.issues[0]?.message })

    const { data: existing } = await fastify.supabase
      .from('tax_declarations')
      .select('status')
      .eq('id', id)
      .eq('tenant_id', req.tenantId)
      .single()

    if (!existing) return reply.code(404).send({ error: 'NOT_FOUND', message: 'Declaration not found' })
    const reviewableOrApproved = [...REVIEWABLE_STATUSES, 'approved']
    if (!reviewableOrApproved.includes((existing as any).status)) {
      return reply.code(409).send({
        error:   'INVALID_STATUS',
        message: `Cannot request revision for declaration with status '${(existing as any).status}'.`,
      })
    }

    const now = new Date().toISOString()
    const fromStatus = (existing as any).status

    const { data, error } = await fastify.supabase
      .from('tax_declarations')
      .update({ status: 'revision_requested', rejection_reason: parsed.data.notes, updated_at: now })
      .eq('id', id)
      .eq('tenant_id', req.tenantId)
      .select()
      .single()

    if (error) return reply.code(500).send({ error: 'UPDATE_FAILED', message: error.message })

    await writeAuditLog(fastify, req.tenantId, id, req.userId, fromStatus, 'revision_requested', parsed.data.notes)

    return reply.send({ data })
  })

  // ===========================================================================
  // Proofs — ESS upload (declaration-scoped)
  // ===========================================================================

  // GET /payroll/statutory/tds/declarations/:id/proofs
  fastify.get('/declarations/:id/proofs', auth, async (req: any, reply) => {
    const { id } = req.params as { id: string }

    const { data: decl } = await fastify.supabase
      .from('tax_declarations')
      .select('id, employee_id')
      .eq('id', id)
      .eq('tenant_id', req.tenantId)
      .maybeSingle()

    if (!decl) return reply.code(404).send({ error: 'NOT_FOUND', message: 'Declaration not found' })

    const isHrAdmin = ['super_admin', 'hr_admin'].includes(req.userRole)
    if (!isHrAdmin) {
      const callerEmpId = await resolveCallerEmployeeId(fastify, req)
      if (callerEmpId !== (decl as any).employee_id) return reply.code(403).send({ error: 'FORBIDDEN', message: 'You can only view proofs for your own declarations' })
    }

    const { data, error } = await fastify.supabase
      .from('declaration_proofs')
      .select('id, file_name, storage_path, mime_type, file_size_bytes, uploaded_at, document_state, verification_notes, rejection_reason, verified_at')
      .eq('declaration_id', id)
      .eq('tenant_id', req.tenantId)
      .eq('is_superseded', false)
      .order('uploaded_at', { ascending: false })

    if (error) return reply.code(500).send({ error: 'QUERY_FAILED', message: error.message })
    return reply.send({ data: data ?? [] })
  })

  // POST /payroll/statutory/tds/declarations/:id/proof — ESS/admin uploads proof
  fastify.post('/declarations/:id/proof', auth, async (req: any, reply) => {
    const { id } = req.params as { id: string }

    const schema = z.object({
      file_name:       z.string().min(1).max(255),
      storage_path:    z.string().min(1),
      mime_type:       z.string().optional(),
      file_size_bytes: z.number().int().positive().optional(),
    })
    const parsed = schema.safeParse(req.body)
    if (!parsed.success) return reply.code(400).send({ error: 'VALIDATION_ERROR', message: parsed.error.issues[0]?.message })

    const isHrAdmin = ['super_admin', 'hr_admin'].includes(req.userRole)

    const { data: decl } = await fastify.supabase
      .from('tax_declarations')
      .select('id, employee_id, status, payroll_locked_at')
      .eq('id', id)
      .eq('tenant_id', req.tenantId)
      .maybeSingle()

    if (!decl) return reply.code(404).send({ error: 'NOT_FOUND', message: 'Declaration not found' })

    // Payroll lock guard on proof upload
    if ((decl as any)?.payroll_locked_at) {
      return reply.code(423).send({
        error:   'PAYROLL_LOCKED',
        message: 'Cannot upload proof — declaration is locked by a finalized payroll period',
      })
    }

    if (!isHrAdmin) {
      const callerEmpId = await resolveCallerEmployeeId(fastify, req)
      if (callerEmpId !== (decl as any).employee_id) return reply.code(403).send({ error: 'FORBIDDEN', message: 'You can only attach proof to your own declarations' })
      if (!EMPLOYEE_MUTABLE_STATUSES.includes((decl as any).status) && (decl as any).status !== 'submitted') {
        return reply.code(409).send({
          error:   'INVALID_STATUS',
          message: `Proofs cannot be submitted for declarations with status '${(decl as any).status}'.`,
        })
      }
    }

    const { data, error } = await fastify.supabase
      .from('declaration_proofs')
      .insert({
        tenant_id:       req.tenantId,
        declaration_id:  id,
        file_name:       parsed.data.file_name,
        storage_path:    parsed.data.storage_path,
        mime_type:       parsed.data.mime_type ?? null,
        file_size_bytes: parsed.data.file_size_bytes ?? null,
        uploaded_by:     req.userId,
        uploaded_at:     new Date().toISOString(),
        is_verified:     false,
        document_state:  'uploaded',
      })
      .select('id, file_name, storage_path, mime_type, file_size_bytes, uploaded_at, document_state')
      .single()

    if (error) return reply.code(500).send({ error: 'INSERT_FAILED', message: error.message })
    return reply.code(201).send({ data })
  })

  // ===========================================================================
  // Admin — Proofs management
  // ===========================================================================

  // GET /payroll/statutory/tds/proofs?financial_year=2025-26&document_state=uploaded
  fastify.get('/proofs', { preHandler: [fastify.authenticate, requireHrAdmin] }, async (req: any, reply) => {
    const qs = z.object({
      financial_year: z.string().optional(),
      document_state: z.string().optional(),
    }).safeParse(req.query)

    let q = fastify.supabase
      .from('declaration_proofs')
      .select(`
        id, file_name, storage_path, mime_type, file_size_bytes, uploaded_at,
        document_state, verification_notes, rejection_reason, verified_at,
        tax_declarations!inner (
          id, declaration_category, section, declared_amount, approved_amount,
          financial_year, employee_id,
          employees!inner (employee_code, profiles(full_name))
        )
      `)
      .eq('tenant_id', req.tenantId)
      .eq('is_superseded', false)
      .order('uploaded_at', { ascending: false })

    if (qs.data?.document_state) q = q.eq('document_state', qs.data.document_state)
    if (qs.data?.financial_year) {
      q = q.eq('tax_declarations.financial_year', qs.data.financial_year)
    }

    const { data, error } = await q
    if (error) return reply.code(500).send({ error: 'QUERY_FAILED', message: error.message })
    return reply.send({ data: data ?? [] })
  })

  // POST /payroll/statutory/tds/proofs/:proofId/verify — HR admin verifies a proof
  fastify.post('/proofs/:proofId/verify', { preHandler: [fastify.authenticate, requireHrAdmin] }, async (req: any, reply) => {
    const { proofId } = req.params as { proofId: string }

    const schema = z.object({
      verification_notes: z.string().optional(),
    })
    const parsed = schema.safeParse(req.body)
    if (!parsed.success) return reply.code(400).send({ error: 'VALIDATION_ERROR', message: parsed.error.issues[0]?.message })

    const { data: existing } = await fastify.supabase
      .from('declaration_proofs')
      .select('document_state')
      .eq('id', proofId)
      .eq('tenant_id', req.tenantId)
      .single()

    if (!existing) return reply.code(404).send({ error: 'NOT_FOUND', message: 'Proof not found' })
    if ((existing as any).document_state === 'verified') {
      return reply.code(409).send({ error: 'ALREADY_VERIFIED', message: 'Proof is already verified' })
    }

    const now = new Date().toISOString()
    const { data, error } = await fastify.supabase
      .from('declaration_proofs')
      .update({
        document_state:     'verified',
        is_verified:        true,
        verified_by:        req.userId,
        verified_at:        now,
        verification_notes: parsed.data.verification_notes ?? null,
        updated_at:         now,
      })
      .eq('id', proofId)
      .eq('tenant_id', req.tenantId)
      .select()
      .single()

    if (error) return reply.code(500).send({ error: 'UPDATE_FAILED', message: error.message })
    return reply.send({ data })
  })

  // POST /payroll/statutory/tds/proofs/:proofId/reject — HR admin rejects a proof
  fastify.post('/proofs/:proofId/reject', { preHandler: [fastify.authenticate, requireHrAdmin] }, async (req: any, reply) => {
    const { proofId } = req.params as { proofId: string }

    const schema = z.object({
      rejection_reason: z.string().min(1),
    })
    const parsed = schema.safeParse(req.body)
    if (!parsed.success) return reply.code(400).send({ error: 'VALIDATION_ERROR', message: parsed.error.issues[0]?.message })

    const { data: existing } = await fastify.supabase
      .from('declaration_proofs')
      .select('document_state')
      .eq('id', proofId)
      .eq('tenant_id', req.tenantId)
      .single()

    if (!existing) return reply.code(404).send({ error: 'NOT_FOUND', message: 'Proof not found' })

    const now = new Date().toISOString()
    const { data, error } = await fastify.supabase
      .from('declaration_proofs')
      .update({
        document_state:   'rejected',
        is_verified:      false,
        rejection_reason: parsed.data.rejection_reason,
        updated_at:       now,
      })
      .eq('id', proofId)
      .eq('tenant_id', req.tenantId)
      .select()
      .single()

    if (error) return reply.code(500).send({ error: 'UPDATE_FAILED', message: error.message })
    return reply.send({ data })
  })

  // ===========================================================================
  // Admin — Projections
  // ===========================================================================

  // GET /payroll/statutory/tds/projections?month=2025-06 — all employees for a given month
  fastify.get('/projections', { preHandler: [fastify.authenticate, requireHrAdmin] }, async (req: any, reply) => {
    const qs = z.object({
      month:          z.string().optional(),
      financial_year: z.string().optional(),
    }).safeParse(req.query)

    let q = fastify.supabase
      .from('tds_monthly_projections')
      .select(`
        *,
        employees!inner (
          employee_code,
          profiles (full_name)
        )
      `)
      .eq('tenant_id', req.tenantId)
      .order('projection_month', { ascending: false })

    if (qs.data?.month)          q = q.eq('projection_month', qs.data.month)
    if (qs.data?.financial_year) q = q.eq('financial_year', qs.data.financial_year)

    const { data, error } = await q
    if (error) return reply.code(500).send({ error: 'QUERY_FAILED', message: error.message })
    return reply.send({ data: data ?? [] })
  })

  // GET /payroll/statutory/tds/projections/:employeeId
  fastify.get('/projections/:employeeId', auth, async (req: any, reply) => {
    const { employeeId } = req.params as { employeeId: string }

    const isHrAdmin = ['super_admin', 'hr_admin'].includes(req.userRole)
    if (!isHrAdmin) {
      const callerEmpId = await resolveCallerEmployeeId(fastify, req)
      if (callerEmpId !== employeeId) return reply.code(403).send({ error: 'FORBIDDEN', message: 'Access denied' })
    }

    const qs = z.object({ financial_year: z.string().optional() }).safeParse(req.query)

    let q = fastify.supabase
      .from('tds_monthly_projections')
      .select('*')
      .eq('employee_id', employeeId)
      .eq('tenant_id', req.tenantId)

    if (qs.data?.financial_year) q = q.eq('financial_year', qs.data.financial_year)

    const { data, error } = await q
    if (error) return reply.code(500).send({ error: 'QUERY_FAILED', message: error.message })
    return reply.send({ data: data ?? [] })
  })

  // POST /payroll/statutory/tds/projections/compute/:employeeId — HR admin recomputes
  fastify.post('/projections/compute/:employeeId', { preHandler: [fastify.authenticate, requireHrAdmin] }, async (req: any, reply) => {
    const { employeeId } = req.params as { employeeId: string }

    const schema = z.object({
      financial_year: z.string().min(1),
      gross_monthly:  z.number().positive(),
      regime:         z.enum(['old', 'new']).default('new'),
    })
    const parsed = schema.safeParse(req.body)
    if (!parsed.success) return reply.code(400).send({ error: 'VALIDATION_ERROR', message: parsed.error.issues[0]?.message })

    const { financial_year, gross_monthly, regime } = parsed.data

    // Fetch approved declarations sum (only meaningful for old regime)
    const { data: declarations } = await fastify.supabase
      .from('tax_declarations')
      .select('approved_amount')
      .eq('employee_id', employeeId)
      .eq('tenant_id', req.tenantId)
      .eq('financial_year', financial_year)
      .eq('status', 'approved')

    const totalDeductions = ((declarations ?? []) as any[]).reduce((sum: number, d: any) => sum + (d.approved_amount ?? 0), 0)

    const currentMonth = new Date().toISOString().slice(0, 7)
    const { data: existingProjections } = await fastify.supabase
      .from('tds_monthly_projections')
      .select('tds_this_month, projection_month')
      .eq('employee_id', employeeId)
      .eq('tenant_id', req.tenantId)
      .eq('financial_year', financial_year)
      .lt('projection_month', currentMonth)

    const alreadyDeducted = ((existingProjections ?? []) as any[]).reduce(
      (sum: number, p: any) => sum + (p.tds_this_month ?? 0), 0
    )

    // Build full FY month list: Apr → Mar
    const fyStartYear = parseInt(financial_year.split('-')[0], 10)
    const months: string[] = []
    for (let m = 4; m <= 12; m++) months.push(`${fyStartYear}-${String(m).padStart(2, '0')}`)
    for (let m = 1; m <= 3; m++) months.push(`${fyStartYear + 1}-${String(m).padStart(2, '0')}`)

    const futureMonths = months.filter(m => m >= currentMonth)
    const totalRemainingMonths = futureMonths.length || 1

    const grossAnnualIncome = gross_monthly * 12
    const tdsResult = computeTDS(
      { grossAnnualIncome, regime, totalDeductions, alreadyDeducted, remainingMonths: totalRemainingMonths },
      { financialYear: financial_year }
    )

    const projections = months.map(projectionMonth => ({
      tenant_id:               req.tenantId,
      employee_id:             employeeId,
      financial_year,
      projection_month:        projectionMonth,
      gross_income_projected:  grossAnnualIncome,
      total_deductions_projected: tdsResult.applicableDeductions,
      taxable_income_projected:   tdsResult.taxableIncome,
      tax_liability:           tdsResult.annualTaxLiability,
      tds_already_deducted:    alreadyDeducted,
      tds_this_month:          projectionMonth >= currentMonth ? tdsResult.monthlyTDS : 0,
      regime,
    }))

    const { error: upsertErr } = await fastify.supabase
      .from('tds_monthly_projections')
      .upsert(projections, { onConflict: 'tenant_id,employee_id,financial_year,projection_month' })

    if (upsertErr) return reply.code(500).send({ error: 'UPSERT_FAILED', message: upsertErr.message })

    return reply.send({
      months_computed:        projections.length,
      regime,
      gross_annual_income:    grossAnnualIncome,
      standard_deduction:     tdsResult.standardDeduction,
      applicable_deductions:  tdsResult.applicableDeductions,
      taxable_income:         tdsResult.taxableIncome,
      annual_tax_liability:   tdsResult.annualTaxLiability,
      rebate_87a:             tdsResult.rebate87A,
      surcharge:              tdsResult.surcharge,
      cess:                   tdsResult.cess,
      already_deducted:       alreadyDeducted,
      remaining_tax:          tdsResult.remainingTax,
      monthly_tds:            tdsResult.monthlyTDS,
      trace:                  tdsResult.traceSteps,
    })
  })

  // ===========================================================================
  // Snapshots — payroll-safe read of approved declarations
  // ===========================================================================

  // POST /payroll/statutory/tds/snapshots — create immutable snapshot for payroll
  fastify.post('/snapshots', { preHandler: [fastify.authenticate, requireHrAdmin] }, async (req: any, reply) => {
    const schema = z.object({
      employee_id:    z.string().uuid(),
      financial_year: z.string().min(1),
      payroll_run_id: z.string().uuid().optional(),
    })
    const parsed = schema.safeParse(req.body)
    if (!parsed.success) return reply.code(400).send({ error: 'VALIDATION_ERROR', message: parsed.error.issues[0]?.message })

    // Fetch regime election
    const { data: regime } = await fastify.supabase
      .from('tax_regime_elections')
      .select('regime')
      .eq('employee_id', parsed.data.employee_id)
      .eq('tenant_id', req.tenantId)
      .eq('financial_year', parsed.data.financial_year)
      .order('effective_from', { ascending: false })
      .limit(1)
      .maybeSingle()

    // Fetch all approved declarations
    const { data: approvedDecls, error: declErr } = await fastify.supabase
      .from('tax_declarations')
      .select('id, declaration_category, section, description, declared_amount, approved_amount')
      .eq('employee_id', parsed.data.employee_id)
      .eq('tenant_id', req.tenantId)
      .eq('financial_year', parsed.data.financial_year)
      .eq('status', 'approved')

    if (declErr) return reply.code(500).send({ error: 'QUERY_FAILED', message: declErr.message })

    const items = (approvedDecls ?? []) as any[]
    const totalDeclared = items.reduce((sum: number, d: any) => sum + (d.declared_amount ?? 0), 0)
    const totalApproved = items.reduce((sum: number, d: any) => sum + (d.approved_amount ?? 0), 0)

    const { data: snapshot, error: snapErr } = await fastify.supabase
      .from('tds_declaration_snapshots')
      .insert({
        tenant_id:         req.tenantId,
        employee_id:       parsed.data.employee_id,
        financial_year:    parsed.data.financial_year,
        payroll_run_id:    parsed.data.payroll_run_id ?? null,
        regime:            (regime as any)?.regime ?? 'new',
        total_declared:    totalDeclared,
        total_approved:    totalApproved,
        declaration_items: items,
        created_by:        req.userId,
      })
      .select()
      .single()

    if (snapErr) return reply.code(500).send({ error: 'INSERT_FAILED', message: snapErr.message })

    // Mark approved declarations as payroll_applied
    if (items.length > 0) {
      await fastify.supabase
        .from('tax_declarations')
        .update({ status: 'payroll_applied', updated_at: new Date().toISOString() })
        .in('id', items.map((d: any) => d.id))
        .eq('tenant_id', req.tenantId)
    }

    return reply.code(201).send({ data: snapshot })
  })

  // GET /payroll/statutory/tds/snapshots/:employeeId — latest snapshot for an employee
  fastify.get('/snapshots/:employeeId', auth, async (req: any, reply) => {
    const { employeeId } = req.params as { employeeId: string }
    const qs = z.object({ financial_year: z.string().optional() }).safeParse(req.query)

    let q = fastify.supabase
      .from('tds_declaration_snapshots')
      .select('*')
      .eq('employee_id', employeeId)
      .eq('tenant_id', req.tenantId)
      .order('snapshot_at', { ascending: false })

    if (qs.data?.financial_year) q = q.eq('financial_year', qs.data.financial_year)

    const { data, error } = await q
    if (error) return reply.code(500).send({ error: 'QUERY_FAILED', message: error.message })
    return reply.send({ data: data ?? [] })
  })

  // GET /payroll/statutory/tds/declarations/:id/audit — audit trail
  fastify.get('/declarations/:id/audit', { preHandler: [fastify.authenticate, requireHrAdmin] }, async (req: any, reply) => {
    const { id } = req.params as { id: string }

    const { data, error } = await fastify.supabase
      .from('tds_declaration_audit_log')
      .select('*, profiles(full_name)')
      .eq('declaration_id', id)
      .eq('tenant_id', req.tenantId)
      .order('changed_at', { ascending: false })

    if (error) return reply.code(500).send({ error: 'QUERY_FAILED', message: error.message })
    return reply.send({ data: data ?? [] })
  })
}
