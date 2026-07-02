/**
 * Reimbursements Routes
 * Category management, claim lifecycle, approvals, and attachment handling.
 */

import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { logAction } from '../../lib/audit-service.js'
import { gateApprove, gateReject } from '../../lib/approval-orchestrator.js'

const CATEGORY_TYPES = ['medical', 'travel', 'food', 'telephone', 'internet', 'books', 'uniform', 'other'] as const

export default async function reimbursementsRoutes(fastify: FastifyInstance) {
  const auth = { preHandler: [fastify.authenticate] }

  const isHr = (role: string) => ['super_admin', 'hr_admin'].includes(role)

  function requireHrAdmin(req: any, reply: any, done: () => void) {
    if (!isHr(req.userRole)) {
      reply.code(403).send({ error: 'FORBIDDEN', message: 'HR admin access required' })
      return
    }
    done()
  }

  // ── ESS SELF-SERVICE ROUTES (/my) ────────────────────────────────────────────
  // These are registered first to avoid being shadowed by /:id wildcard routes.

  /**
   * GET /payroll/reimbursements/my
   * Employee views their own claims, sorted newest first.
   * Supports optional ?status= and ?month= filters.
   */
  fastify.get('/my', auth, async (req: any, reply) => {
    const querySchema = z.object({
      status: z.string().optional(),
      month:  z.string().optional(),
    })
    const parsed = querySchema.safeParse(req.query)
    if (!parsed.success) {
      return reply.code(400).send({ error: 'VALIDATION_ERROR', message: parsed.error.issues[0]?.message })
    }

    // Resolve employee_id from the authenticated user's profile
    const { data: profile } = await fastify.supabase
      .from('profiles')
      .select('employee_id')
      .eq('id', req.userId)
      .eq('tenant_id', req.tenantId)
      .single()

    if (!profile?.employee_id) {
      return reply.code(400).send({ error: 'NO_EMPLOYEE_LINK', message: 'Profile not linked to an employee record' })
    }

    let q = fastify.supabase
      .from('reimbursement_claims')
      .select('*, reimbursement_categories(id, name, code, category_type)', { count: 'exact' })
      .eq('tenant_id', req.tenantId)
      .eq('employee_id', profile.employee_id)
      .order('created_at', { ascending: false })

    if (parsed.data.status) q = q.eq('status', parsed.data.status)
    if (parsed.data.month) {
      const [year, mon] = parsed.data.month.split('-').map(Number)
      const firstDay = `${parsed.data.month}-01`
      const lastDay  = new Date(year, mon, 0).toISOString().slice(0, 10)
      q = q.gte('expense_date', firstDay).lte('expense_date', lastDay)
    }

    const { data, count, error } = await q
    if (error) return reply.code(500).send({ error: 'QUERY_FAILED', message: error.message })
    return reply.send({ data: data ?? [], total: count ?? 0 })
  })

  /**
   * POST /payroll/reimbursements/my
   * Employee creates a new draft claim. employee_id is resolved from the
   * authenticated session — never taken from the request body.
   */
  fastify.post('/my', auth, async (req: any, reply) => {
    const schema = z.object({
      category_id:     z.string().uuid(),
      expense_date:    z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'expense_date must be YYYY-MM-DD'),
      claimed_amount:  z.number().positive(),
      description:     z.string().min(1).max(500),
    })

    const parsed = schema.safeParse(req.body)
    if (!parsed.success) {
      return reply.code(400).send({ error: 'VALIDATION_ERROR', message: parsed.error.issues[0]?.message })
    }

    const { data: profile } = await fastify.supabase
      .from('profiles')
      .select('employee_id')
      .eq('id', req.userId)
      .eq('tenant_id', req.tenantId)
      .single()

    if (!profile?.employee_id) {
      return reply.code(400).send({ error: 'NO_EMPLOYEE_LINK', message: 'Profile not linked to an employee record' })
    }

    // Verify the category exists and is active for this tenant
    const { data: category } = await fastify.supabase
      .from('reimbursement_categories')
      .select('id, is_active, monthly_limit')
      .eq('id', parsed.data.category_id)
      .eq('tenant_id', req.tenantId)
      .single()

    if (!category) {
      return reply.code(404).send({ error: 'CATEGORY_NOT_FOUND', message: 'Reimbursement category not found' })
    }
    if (!(category as any).is_active) {
      return reply.code(422).send({ error: 'CATEGORY_INACTIVE', message: 'This reimbursement category is no longer active' })
    }

    const { data, error } = await fastify.supabase
      .from('reimbursement_claims')
      .insert({
        tenant_id:      req.tenantId,
        employee_id:    profile.employee_id,
        category_id:    parsed.data.category_id,
        expense_date:   parsed.data.expense_date,
        claimed_amount: parsed.data.claimed_amount,
        description:    parsed.data.description,
        status:         'draft',
        claim_date:     new Date().toISOString().slice(0, 10),
      })
      .select('*, reimbursement_categories(id, name, code, category_type)')
      .single()

    if (error) return reply.code(500).send({ error: 'INSERT_FAILED', message: error.message })
    return reply.code(201).send({ data })
  })

  /**
   * PUT /payroll/reimbursements/my/:id
   * Employee updates their own draft claim (only while status = 'draft').
   */
  fastify.put('/my/:id', auth, async (req: any, reply) => {
    const { id } = req.params as { id: string }

    const { data: profile } = await fastify.supabase
      .from('profiles')
      .select('employee_id')
      .eq('id', req.userId)
      .eq('tenant_id', req.tenantId)
      .single()

    if (!profile?.employee_id) {
      return reply.code(400).send({ error: 'NO_EMPLOYEE_LINK', message: 'Profile not linked to an employee record' })
    }

    // Fetch claim and verify ownership + status
    const { data: existing } = await fastify.supabase
      .from('reimbursement_claims')
      .select('id, status, employee_id')
      .eq('id', id)
      .eq('tenant_id', req.tenantId)
      .single()

    if (!existing) return reply.code(404).send({ error: 'NOT_FOUND', message: 'Claim not found' })
    if ((existing as any).employee_id !== profile.employee_id) {
      return reply.code(403).send({ error: 'FORBIDDEN', message: 'You can only edit your own claims' })
    }
    if ((existing as any).status !== 'draft') {
      return reply.code(409).send({ error: 'INVALID_STATUS', message: 'Only draft claims can be updated' })
    }

    const schema = z.object({
      expense_date:   z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
      claimed_amount: z.number().positive().optional(),
      description:    z.string().min(1).max(500).optional(),
      category_id:    z.string().uuid().optional(),
    })

    const parsed = schema.safeParse(req.body)
    if (!parsed.success) {
      return reply.code(400).send({ error: 'VALIDATION_ERROR', message: parsed.error.issues[0]?.message })
    }

    const { data, error } = await fastify.supabase
      .from('reimbursement_claims')
      .update({ ...parsed.data, updated_at: new Date().toISOString() })
      .eq('id', id)
      .eq('tenant_id', req.tenantId)
      .select('*, reimbursement_categories(id, name, code, category_type)')
      .single()

    if (error) return reply.code(500).send({ error: 'UPDATE_FAILED', message: error.message })
    return reply.send({ data })
  })

  /**
   * POST /payroll/reimbursements/my/:id/submit
   * Employee submits their own draft claim for approval.
   * Only allowed while status = 'draft'.
   */
  fastify.post('/my/:id/submit', auth, async (req: any, reply) => {
    const { id } = req.params as { id: string }

    const { data: profile } = await fastify.supabase
      .from('profiles')
      .select('employee_id')
      .eq('id', req.userId)
      .eq('tenant_id', req.tenantId)
      .single()

    if (!profile?.employee_id) {
      return reply.code(400).send({ error: 'NO_EMPLOYEE_LINK', message: 'Profile not linked to an employee record' })
    }

    const { data: existing } = await fastify.supabase
      .from('reimbursement_claims')
      .select('id, status, employee_id')
      .eq('id', id)
      .eq('tenant_id', req.tenantId)
      .single()

    if (!existing) return reply.code(404).send({ error: 'NOT_FOUND', message: 'Claim not found' })
    if ((existing as any).employee_id !== profile.employee_id) {
      return reply.code(403).send({ error: 'FORBIDDEN', message: 'You can only submit your own claims' })
    }
    if ((existing as any).status !== 'draft') {
      return reply.code(409).send({ error: 'INVALID_STATUS', message: `Cannot submit a claim with status '${(existing as any).status}'` })
    }

    const now = new Date().toISOString()
    const { data, error } = await fastify.supabase
      .from('reimbursement_claims')
      .update({ status: 'submitted', submitted_at: now, updated_at: now })
      .eq('id', id)
      .eq('tenant_id', req.tenantId)
      .select('id, status, submitted_at')
      .single()

    if (error) return reply.code(500).send({ error: 'UPDATE_FAILED', message: error.message })
    return reply.send({ message: 'Claim submitted for approval', data })
  })

  /**
   * DELETE /payroll/reimbursements/my/:id
   * Employee deletes their own draft claim (only while status = 'draft').
   * Submitted / approved claims cannot be deleted.
   */
  fastify.delete('/my/:id', auth, async (req: any, reply) => {
    const { id } = req.params as { id: string }

    const { data: profile } = await fastify.supabase
      .from('profiles')
      .select('employee_id')
      .eq('id', req.userId)
      .eq('tenant_id', req.tenantId)
      .single()

    if (!profile?.employee_id) {
      return reply.code(400).send({ error: 'NO_EMPLOYEE_LINK', message: 'Profile not linked to an employee record' })
    }

    const { data: existing } = await fastify.supabase
      .from('reimbursement_claims')
      .select('id, status, employee_id')
      .eq('id', id)
      .eq('tenant_id', req.tenantId)
      .single()

    if (!existing) return reply.code(404).send({ error: 'NOT_FOUND', message: 'Claim not found' })
    if ((existing as any).employee_id !== profile.employee_id) {
      return reply.code(403).send({ error: 'FORBIDDEN', message: 'You can only delete your own claims' })
    }
    if ((existing as any).status !== 'draft') {
      return reply.code(409).send({ error: 'INVALID_STATUS', message: 'Only draft claims can be deleted' })
    }

    const { error } = await fastify.supabase
      .from('reimbursement_claims')
      .delete()
      .eq('id', id)
      .eq('tenant_id', req.tenantId)

    if (error) return reply.code(500).send({ error: 'DELETE_FAILED', message: error.message })
    return reply.code(204).send()
  })

  // ── GET /payroll/reimbursements/categories ────────────────────────────────────
  fastify.get('/categories', auth, async (req: any, reply) => {
    const querySchema = z.object({
      is_active: z.enum(['true', 'false']).optional(),
    })

    const parsed = querySchema.safeParse(req.query)
    if (!parsed.success) {
      return reply.code(400).send({ error: 'VALIDATION_ERROR', message: parsed.error.issues[0]?.message })
    }

    let q = fastify.supabase
      .from('reimbursement_categories')
      .select('*')
      .eq('tenant_id', req.tenantId)

    if (parsed.data.is_active !== undefined) {
      q = q.eq('is_active', parsed.data.is_active === 'true')
    }

    const { data, error } = await q
    if (error) return reply.code(500).send({ error: 'QUERY_FAILED', message: error.message })
    return reply.send({ data: data ?? [] })
  })

  // ── POST /payroll/reimbursements/categories ───────────────────────────────────
  fastify.post('/categories', { preHandler: [fastify.authenticate, requireHrAdmin] }, async (req: any, reply) => {
    const schema = z.object({
      name: z.string().min(1).max(200),
      code: z.string().min(1).max(50),
      category_type: z.enum(CATEGORY_TYPES),
      is_taxable: z.boolean(),
      monthly_limit: z.number().optional(),
      annual_limit: z.number().optional(),
      requires_receipt: z.boolean(),
      description: z.string().optional(),
    })

    const parsed = schema.safeParse(req.body)
    if (!parsed.success) {
      return reply.code(400).send({ error: 'VALIDATION_ERROR', message: parsed.error.issues[0]?.message })
    }

    const { data, error } = await fastify.supabase
      .from('reimbursement_categories')
      .insert({ ...parsed.data, tenant_id: req.tenantId, is_active: true })
      .select()
      .single()

    if (error) {
      if (error.code === '23505') {
        return reply.code(409).send({ error: 'DUPLICATE_CODE', message: 'A category with this code already exists' })
      }
      return reply.code(500).send({ error: 'INSERT_FAILED', message: error.message })
    }

    return reply.code(201).send({ data })
  })

  // ── PUT /payroll/reimbursements/categories/:id ────────────────────────────────
  fastify.put('/categories/:id', { preHandler: [fastify.authenticate, requireHrAdmin] }, async (req: any, reply) => {
    const { id } = req.params as { id: string }

    const schema = z.object({
      name: z.string().min(1).max(200).optional(),
      code: z.string().min(1).max(50).optional(),
      category_type: z.enum(CATEGORY_TYPES).optional(),
      is_taxable: z.boolean().optional(),
      monthly_limit: z.number().optional(),
      annual_limit: z.number().optional(),
      requires_receipt: z.boolean().optional(),
      description: z.string().optional(),
      is_active: z.boolean().optional(),
    })

    const parsed = schema.safeParse(req.body)
    if (!parsed.success) {
      return reply.code(400).send({ error: 'VALIDATION_ERROR', message: parsed.error.issues[0]?.message })
    }

    const { data, error } = await fastify.supabase
      .from('reimbursement_categories')
      .update({ ...parsed.data, updated_at: new Date().toISOString() })
      .eq('id', id)
      .eq('tenant_id', req.tenantId)
      .select()
      .single()

    if (error) return reply.code(500).send({ error: 'UPDATE_FAILED', message: error.message })
    if (!data) return reply.code(404).send({ error: 'NOT_FOUND', message: 'Category not found' })

    return reply.send({ data })
  })

  // ── GET /payroll/reimbursements/claims ────────────────────────────────────────
  // HR admin: sees all tenant claims, optionally filtered by employee_id.
  // Manager: may only view direct reports' claims (employee_id validated server-side).
  // Employee: blocked — must use GET /my instead.
  fastify.get('/claims', auth, async (req: any, reply) => {
    const querySchema = z.object({
      employee_id: z.string().uuid().optional(),
      status: z.string().optional(),
      month: z.string().optional(),
    })

    const parsed = querySchema.safeParse(req.query)
    if (!parsed.success) {
      return reply.code(400).send({ error: 'VALIDATION_ERROR', message: parsed.error.issues[0]?.message })
    }

    const isHrAdmin = ['super_admin', 'hr_admin'].includes(req.userRole)

    // Employees have no business calling the admin claims list
    if (!isHrAdmin && req.userRole !== 'manager') {
      return reply.code(403).send({ error: 'FORBIDDEN', message: 'Use /my to view your own claims' })
    }

    // Managers: resolve their own employee_id to scope the query to direct reports
    let managerEmployeeId: string | null = null
    if (!isHrAdmin) {
      const { data: mgProfile } = await fastify.supabase
        .from('profiles')
        .select('employee_id')
        .eq('id', req.userId)
        .eq('tenant_id', req.tenantId)
        .maybeSingle()
      managerEmployeeId = mgProfile?.employee_id ?? null
      if (!managerEmployeeId) {
        return reply.code(403).send({ error: 'FORBIDDEN', message: 'Manager profile not linked to an employee record' })
      }
    }

    let q = fastify.supabase
      .from('reimbursement_claims')
      .select('*, employees(id, first_name, last_name, employee_code), reimbursement_categories(id, name, code, category_type)')
      .eq('tenant_id', req.tenantId)

    if (isHrAdmin) {
      // HR admin can filter by any supplied employee_id
      if (parsed.data.employee_id) q = q.eq('employee_id', parsed.data.employee_id)
    } else {
      // Manager: scope to direct reports only
      if (parsed.data.employee_id) {
        // Validate the requested employee_id is a direct report
        const { data: reportCheck } = await fastify.supabase
          .from('employees')
          .select('id')
          .eq('id', parsed.data.employee_id)
          .eq('manager_id', managerEmployeeId!)
          .eq('tenant_id', req.tenantId)
          .maybeSingle()
        if (!reportCheck) {
          return reply.code(403).send({ error: 'FORBIDDEN', message: 'You can only view claims for your direct reports' })
        }
        q = q.eq('employee_id', parsed.data.employee_id)
      } else {
        // No specific employee requested — scope to all direct reports
        const { data: reports } = await fastify.supabase
          .from('employees')
          .select('id')
          .eq('manager_id', managerEmployeeId!)
          .eq('tenant_id', req.tenantId)
        const reportIds = (reports ?? []).map((r: any) => r.id)
        if (reportIds.length === 0) return reply.send({ data: [] })
        q = q.in('employee_id', reportIds)
      }
    }

    if (parsed.data.status) q = q.eq('status', parsed.data.status)
    if (parsed.data.month) {
      const [year, mon] = parsed.data.month.split('-').map(Number)
      const firstDay = `${parsed.data.month}-01`
      const lastDay = new Date(year, mon, 0).toISOString().slice(0, 10)
      q = q.gte('expense_date', firstDay).lte('expense_date', lastDay)
    }

    const { data, error } = await q
    if (error) return reply.code(500).send({ error: 'QUERY_FAILED', message: error.message })
    return reply.send({ data: data ?? [] })
  })

  // ── POST /payroll/reimbursements/claims ───────────────────────────────────────
  // HR admin only — creates a claim on behalf of any employee.
  // Employees must use POST /my instead.
  fastify.post('/claims', { preHandler: [fastify.authenticate, requireHrAdmin] }, async (req: any, reply) => {
    const schema = z.object({
      employee_id: z.string().uuid(),
      category_id: z.string().uuid(),
      expense_date: z.string(),
      claimed_amount: z.number().positive(),
      description: z.string().min(1),
    })

    const parsed = schema.safeParse(req.body)
    if (!parsed.success) {
      return reply.code(400).send({ error: 'VALIDATION_ERROR', message: parsed.error.issues[0]?.message })
    }

    const { data, error } = await fastify.supabase
      .from('reimbursement_claims')
      .insert({
        ...parsed.data,
        tenant_id: req.tenantId,
        status: 'draft',
        claim_date: new Date().toISOString().slice(0, 10),
      })
      .select()
      .single()

    if (error) return reply.code(500).send({ error: 'INSERT_FAILED', message: error.message })
    return reply.code(201).send({ data })
  })

  // ── PUT /payroll/reimbursements/claims/:id ────────────────────────────────────
  // HR admin only — edits any tenant claim. Employees use PUT /my/:id.
  fastify.put('/claims/:id', { preHandler: [fastify.authenticate, requireHrAdmin] }, async (req: any, reply) => {
    const { id } = req.params as { id: string }

    // Verify draft status
    const { data: existing } = await fastify.supabase
      .from('reimbursement_claims')
      .select('status')
      .eq('id', id)
      .eq('tenant_id', req.tenantId)
      .single()

    if (!existing) return reply.code(404).send({ error: 'NOT_FOUND', message: 'Claim not found' })
    if ((existing as any).status !== 'draft') {
      return reply.code(409).send({ error: 'INVALID_STATUS', message: 'Only draft claims can be updated' })
    }

    const schema = z.object({
      expense_date: z.string().optional(),
      claimed_amount: z.number().positive().optional(),
      description: z.string().optional(),
      category_id: z.string().uuid().optional(),
    })

    const parsed = schema.safeParse(req.body)
    if (!parsed.success) {
      return reply.code(400).send({ error: 'VALIDATION_ERROR', message: parsed.error.issues[0]?.message })
    }

    const { data, error } = await fastify.supabase
      .from('reimbursement_claims')
      .update({ ...parsed.data, updated_at: new Date().toISOString() })
      .eq('id', id)
      .eq('tenant_id', req.tenantId)
      .select()
      .single()

    if (error) return reply.code(500).send({ error: 'UPDATE_FAILED', message: error.message })
    return reply.send({ data })
  })

  // ── POST /payroll/reimbursements/claims/:id/submit ────────────────────────────
  // HR admin only — submits any tenant claim. Employees use POST /my/:id/submit.
  fastify.post('/claims/:id/submit', { preHandler: [fastify.authenticate, requireHrAdmin] }, async (req: any, reply) => {
    const { id } = req.params as { id: string }
    const now = new Date().toISOString()

    const { error } = await fastify.supabase
      .from('reimbursement_claims')
      .update({ status: 'submitted', submitted_at: now, updated_at: now })
      .eq('id', id)
      .eq('tenant_id', req.tenantId)

    if (error) return reply.code(500).send({ error: 'UPDATE_FAILED', message: error.message })
    return reply.send({ message: 'Claim submitted' })
  })

  // ── POST /payroll/reimbursements/claims/:id/approve ───────────────────────────
  // Auth is gate-driven: with NO reimbursement chain configured this stays HR-only
  // (legacy). With a chain, the per-level gate authorises each approver (e.g. L1
  // manager → L2 finance above a ₹ threshold via min_amount).
  fastify.post('/claims/:id/approve', auth, async (req: any, reply) => {
    const { id } = req.params as { id: string }

    const schema = z.object({
      approved_amount: z.number().positive(),
    })

    const parsed = schema.safeParse(req.body)
    if (!parsed.success) {
      return reply.code(400).send({ error: 'VALIDATION_ERROR', message: parsed.error.issues[0]?.message })
    }

    // Fetch current claim to enforce status guard — prevents double-approve overwriting reviewer metadata
    const { data: existing, error: fetchErr } = await fastify.supabase
      .from('reimbursement_claims')
      .select('id, status, employee_id, claimed_amount')
      .eq('id', id)
      .eq('tenant_id', req.tenantId)
      .single()

    if (fetchErr || !existing) {
      return reply.code(404).send({ error: 'NOT_FOUND', message: 'Claim not found' })
    }
    if ((existing as any).status !== 'submitted') {
      return reply.code(409).send({
        error:   'INVALID_STATUS',
        message: `Only submitted claims can be approved (current status: '${(existing as any).status}')`,
      })
    }

    // Multi-level gate (threshold routing by claimed amount).
    const gate = await gateApprove(fastify.supabase, {
      tenantId: req.tenantId, entityType: 'reimbursement_claim', entityId: id,
      actorId: req.userId, actorRole: req.userRole,
      targetEmployeeId: (existing as any).employee_id,
      amount: Number((existing as any).claimed_amount),
    })
    if (gate.kind === 'error') {
      const code = gate.error.type === 'FORBIDDEN' ? 403 : gate.error.type === 'CONFLICT' ? 409 : 400
      return reply.code(code).send({ error: gate.error.type, message: gate.error.message })
    }
    if (gate.kind === 'advanced') {
      await logAction(fastify.supabase, {
        tenantId: req.tenantId, tableName: 'reimbursement_claims', recordId: id,
        action: 'UPDATE', performedBy: req.userId,
        newData: { status: 'submitted', approval_level: gate.nextLevel, total_levels: gate.totalLevels },
      })
      return reply.send({ data: { id, status: 'submitted', advanced_to_level: gate.nextLevel, total_levels: gate.totalLevels } })
    }
    // gate.kind === 'finalize' — when no chain authorised the actor, preserve the
    // legacy HR-only contract.
    if (!gate.authorized && !isHr(req.userRole)) {
      return reply.code(403).send({ error: 'FORBIDDEN', message: 'HR admin access required' })
    }

    const now = new Date().toISOString()

    const { data, error } = await fastify.supabase
      .from('reimbursement_claims')
      .update({
        status: 'approved',
        approved_amount: parsed.data.approved_amount,
        reviewed_by: req.userId,
        reviewed_at: now,
        updated_at: now,
      })
      .eq('id', id)
      .eq('tenant_id', req.tenantId)
      .select()
      .single()

    if (error) return reply.code(500).send({ error: 'UPDATE_FAILED', message: error.message })
    if (!data) return reply.code(404).send({ error: 'NOT_FOUND', message: 'Claim not found' })

    await logAction(fastify.supabase, {
      tenantId:    req.tenantId,
      tableName:   'reimbursement_claims',
      recordId:    id,
      action:      'UPDATE',
      performedBy: req.userId,
      onBehalfOf:  (existing as any).employee_id ?? null,
      newData:     { status: 'approved', approved_amount: parsed.data.approved_amount },
    })

    return reply.send({ data })
  })

  // ── POST /payroll/reimbursements/claims/:id/reject ────────────────────────────
  // Gate-driven auth (see approve). No chain => HR-only (legacy).
  fastify.post('/claims/:id/reject', auth, async (req: any, reply) => {
    const { id } = req.params as { id: string }

    const schema = z.object({
      rejection_reason: z.string().min(1),
    })

    const parsed = schema.safeParse(req.body)
    if (!parsed.success) {
      return reply.code(400).send({ error: 'VALIDATION_ERROR', message: parsed.error.issues[0]?.message })
    }

    // Fetch current claim to enforce status guard — prevents double-reject / rejecting already-approved claims
    const { data: existing, error: fetchErr } = await fastify.supabase
      .from('reimbursement_claims')
      .select('id, status, employee_id, claimed_amount')
      .eq('id', id)
      .eq('tenant_id', req.tenantId)
      .single()

    if (fetchErr || !existing) {
      return reply.code(404).send({ error: 'NOT_FOUND', message: 'Claim not found' })
    }
    if ((existing as any).status !== 'submitted') {
      return reply.code(409).send({
        error:   'INVALID_STATUS',
        message: `Only submitted claims can be rejected (current status: '${(existing as any).status}')`,
      })
    }

    // Multi-level gate — reject always finalizes; records + closes the instance when
    // a chain exists. No chain => preserve HR-only.
    const gate = await gateReject(fastify.supabase, {
      tenantId: req.tenantId, entityType: 'reimbursement_claim', entityId: id,
      actorId: req.userId, actorRole: req.userRole,
      targetEmployeeId: (existing as any).employee_id,
      amount: Number((existing as any).claimed_amount),
      comments: parsed.data.rejection_reason,
    })
    if (gate.kind === 'error') {
      const code = gate.error.type === 'FORBIDDEN' ? 403 : gate.error.type === 'CONFLICT' ? 409 : 400
      return reply.code(code).send({ error: gate.error.type, message: gate.error.message })
    }
    if (gate.kind === 'finalize' && !gate.authorized && !isHr(req.userRole)) {
      return reply.code(403).send({ error: 'FORBIDDEN', message: 'HR admin access required' })
    }

    const now = new Date().toISOString()

    const { data, error } = await fastify.supabase
      .from('reimbursement_claims')
      .update({
        status: 'rejected',
        rejection_reason: parsed.data.rejection_reason,
        reviewed_by: req.userId,
        reviewed_at: now,
        updated_at: now,
      })
      .eq('id', id)
      .eq('tenant_id', req.tenantId)
      .select()
      .single()

    if (error) return reply.code(500).send({ error: 'UPDATE_FAILED', message: error.message })
    if (!data) return reply.code(404).send({ error: 'NOT_FOUND', message: 'Claim not found' })

    await logAction(fastify.supabase, {
      tenantId:    req.tenantId,
      tableName:   'reimbursement_claims',
      recordId:    id,
      action:      'UPDATE',
      performedBy: req.userId,
      onBehalfOf:  (existing as any).employee_id ?? null,
      newData:     { status: 'rejected', rejection_reason: parsed.data.rejection_reason },
    })

    return reply.send({ data })
  })

  // ── GET /payroll/reimbursements/claims/:id/attachments ───────────────────────
  fastify.get('/claims/:id/attachments', auth, async (req: any, reply) => {
    const { id } = req.params as { id: string }

    const { data, error } = await fastify.supabase
      .from('reimbursement_attachments')
      .select('*')
      .eq('claim_id', id)
      .eq('tenant_id', req.tenantId)

    if (error) return reply.code(500).send({ error: 'QUERY_FAILED', message: error.message })
    return reply.send({ data: data ?? [] })
  })

  // ── POST /payroll/reimbursements/claims/:id/attachments ──────────────────────
  fastify.post('/claims/:id/attachments', auth, async (req: any, reply) => {
    const { id } = req.params as { id: string }

    const schema = z.object({
      file_name: z.string().min(1),
      storage_path: z.string().min(1),
      mime_type: z.string().optional(),
      file_size_bytes: z.number().int().optional(),
    })

    const parsed = schema.safeParse(req.body)
    if (!parsed.success) {
      return reply.code(400).send({ error: 'VALIDATION_ERROR', message: parsed.error.issues[0]?.message })
    }

    // Ownership: the claim must exist in this tenant, and non-admins can only
    // attach files to their own claims.
    const { data: claim } = await fastify.supabase
      .from('reimbursement_claims')
      .select('id, employee_id')
      .eq('id', id)
      .eq('tenant_id', req.tenantId)
      .maybeSingle()
    if (!claim) return reply.code(404).send({ error: 'NOT_FOUND', message: 'Claim not found' })

    if (!['super_admin', 'hr_admin'].includes(req.userRole)) {
      const { data: profile } = await fastify.supabase
        .from('profiles')
        .select('employee_id')
        .eq('id', req.userId)
        .eq('tenant_id', req.tenantId)
        .single()
      if (profile?.employee_id !== claim.employee_id) {
        return reply.code(403).send({ error: 'FORBIDDEN', message: 'You can only attach files to your own claims' })
      }
    }

    const { data, error } = await fastify.supabase
      .from('reimbursement_attachments')
      .insert({
        ...parsed.data,
        claim_id: id,
        tenant_id: req.tenantId,
        uploaded_by: req.userId,
        uploaded_at: new Date().toISOString(),
      })
      .select()
      .single()

    if (error) return reply.code(500).send({ error: 'INSERT_FAILED', message: error.message })
    return reply.code(201).send({ data })
  })

  // ── GET /payroll/reimbursements/pending-payments/:month ──────────────────────
  // ── Root-level aliases (frontend uses /:id/action directly, not /claims/:id/action) ──

  /**
   * GET /payroll/reimbursements
   * Admin list of all claims — alias for GET /claims.
   */
  fastify.get('/', { preHandler: [fastify.authenticate, requireHrAdmin] }, async (req: any, reply) => {
    const querySchema = z.object({
      employee_id: z.string().uuid().optional(),
      status: z.string().optional(),
      month:  z.string().optional(),
    })
    const parsed = querySchema.safeParse(req.query)
    if (!parsed.success) return reply.code(400).send({ error: 'VALIDATION_ERROR', message: parsed.error.issues[0]?.message })

    let q = fastify.supabase
      .from('reimbursement_claims')
      .select('*, employees(id, first_name, last_name, employee_code), reimbursement_categories(id, name, code, category_type)', { count: 'exact' })
      .eq('tenant_id', req.tenantId)
      .order('created_at', { ascending: false })

    if (parsed.data.employee_id) q = q.eq('employee_id', parsed.data.employee_id)
    if (parsed.data.status)      q = q.eq('status', parsed.data.status)
    if (parsed.data.month) {
      const [year, mon] = parsed.data.month.split('-').map(Number)
      q = q.gte('expense_date', `${parsed.data.month}-01`).lte('expense_date', new Date(year, mon, 0).toISOString().slice(0, 10))
    }

    const { data, count, error } = await q
    if (error) return reply.code(500).send({ error: 'QUERY_FAILED', message: error.message })

    // Flatten the embedded employee/category relations into the flat field names
    // the admin table renders (employee_name, category_name, claim_month).
    const rows = (data ?? []).map((c: any) => {
      const emp = Array.isArray(c.employees) ? c.employees[0] : c.employees
      const cat = Array.isArray(c.reimbursement_categories) ? c.reimbursement_categories[0] : c.reimbursement_categories
      const name = emp ? `${emp.first_name ?? ''} ${emp.last_name ?? ''}`.trim() : ''
      return {
        ...c,
        employee_name: name || emp?.employee_code || null,
        category_name: cat?.name ?? null,
        claim_month:   (c.expense_date ?? c.claim_date ?? c.created_at ?? '').slice(0, 7) || null,
      }
    })
    return reply.send({ data: rows, total: count ?? 0 })
  })

  /**
   * POST /payroll/reimbursements/:id/review
   * HR reviews and approves a claim with an approved_amount (may differ from claimed).
   */
  fastify.post('/:id/review', { preHandler: [fastify.authenticate, requireHrAdmin] }, async (req: any, reply) => {
    const { id } = req.params as { id: string }
    const schema = z.object({
      approved_amount: z.number().positive(),
      review_notes:    z.string().optional(),
    })
    const parsed = schema.safeParse(req.body)
    if (!parsed.success) return reply.code(400).send({ error: 'VALIDATION_ERROR', message: parsed.error.issues[0]?.message })

    const { data: existing } = await fastify.supabase
      .from('reimbursement_claims')
      .select('id, status, employee_id, claimed_amount')
      .eq('id', id).eq('tenant_id', req.tenantId).single()

    if (!existing) return reply.code(404).send({ error: 'NOT_FOUND', message: 'Claim not found' })
    if (!['submitted', 'under_review'].includes((existing as any).status)) {
      return reply.code(409).send({ error: 'INVALID_STATUS', message: `Claim is not in a reviewable state (status: ${(existing as any).status})` })
    }

    const now = new Date().toISOString()
    const { data, error } = await fastify.supabase
      .from('reimbursement_claims')
      .update({ status: 'approved', approved_amount: parsed.data.approved_amount, reviewed_by: req.userId, reviewed_at: now, updated_at: now })
      .eq('id', id).eq('tenant_id', req.tenantId).select().single()

    if (error) return reply.code(500).send({ error: 'UPDATE_FAILED', message: error.message })
    await logAction(fastify.supabase, { tenantId: req.tenantId, tableName: 'reimbursement_claims', recordId: id, action: 'UPDATE', performedBy: req.userId, onBehalfOf: (existing as any).employee_id ?? null, newData: { status: 'approved', approved_amount: parsed.data.approved_amount } })
    return reply.send({ data })
  })

  /**
   * POST /payroll/reimbursements/:id/approve
   * Quick-approve at full claimed amount.
   */
  fastify.post('/:id/approve', { preHandler: [fastify.authenticate, requireHrAdmin] }, async (req: any, reply) => {
    const { id } = req.params as { id: string }
    const approveBodySchema = z.object({ approved_amount: z.number().optional().nullable() }).passthrough()
    const approveBodyParsed = approveBodySchema.safeParse(req.body)
    if (!approveBodyParsed.success) return reply.code(400).send({ error: 'VALIDATION_ERROR', message: approveBodyParsed.error.issues[0]?.message ?? 'Invalid request body' })
    const { data: existing } = await fastify.supabase
      .from('reimbursement_claims')
      .select('id, status, employee_id, claimed_amount')
      .eq('id', id).eq('tenant_id', req.tenantId).single()

    if (!existing) return reply.code(404).send({ error: 'NOT_FOUND', message: 'Claim not found' })
    if (!['submitted', 'under_review'].includes((existing as any).status)) {
      return reply.code(409).send({ error: 'INVALID_STATUS', message: `Claim is not in a reviewable state (status: ${(existing as any).status})` })
    }

    // Multi-level gate (same as /claims/:id/approve) so the admin screen honours a
    // configured chain instead of single-step finalizing. No chain => HR-only legacy
    // (already enforced by requireHrAdmin), so the gate is transparent.
    const gate = await gateApprove(fastify.supabase, {
      tenantId: req.tenantId, entityType: 'reimbursement_claim', entityId: id,
      actorId: req.userId, actorRole: req.userRole,
      targetEmployeeId: (existing as any).employee_id,
      amount: Number((existing as any).claimed_amount),
    })
    if (gate.kind === 'error') {
      const code = gate.error.type === 'FORBIDDEN' ? 403 : gate.error.type === 'CONFLICT' ? 409 : 400
      return reply.code(code).send({ error: gate.error.type, message: gate.error.message })
    }
    if (gate.kind === 'advanced') {
      await logAction(fastify.supabase, { tenantId: req.tenantId, tableName: 'reimbursement_claims', recordId: id, action: 'UPDATE', performedBy: req.userId, newData: { status: (existing as any).status, approval_level: gate.nextLevel, total_levels: gate.totalLevels } })
      return reply.send({ data: { id, status: (existing as any).status, advanced_to_level: gate.nextLevel, total_levels: gate.totalLevels } })
    }

    const now = new Date().toISOString()
    const approvedAmt = approveBodyParsed.data.approved_amount ?? (existing as any).claimed_amount
    const { data, error } = await fastify.supabase
      .from('reimbursement_claims')
      .update({ status: 'approved', approved_amount: approvedAmt, reviewed_by: req.userId, reviewed_at: now, updated_at: now })
      .eq('id', id).eq('tenant_id', req.tenantId).select().single()

    if (error) return reply.code(500).send({ error: 'UPDATE_FAILED', message: error.message })
    await logAction(fastify.supabase, { tenantId: req.tenantId, tableName: 'reimbursement_claims', recordId: id, action: 'UPDATE', performedBy: req.userId, onBehalfOf: (existing as any).employee_id ?? null, newData: { status: 'approved', approved_amount: approvedAmt } })
    return reply.send({ data })
  })

  /**
   * POST /payroll/reimbursements/:id/reject
   * Alias for /claims/:id/reject.
   */
  fastify.post('/:id/reject', { preHandler: [fastify.authenticate, requireHrAdmin] }, async (req: any, reply) => {
    const { id } = req.params as { id: string }
    const schema = z.object({ rejection_reason: z.string().min(1) })
    const parsed = schema.safeParse(req.body)
    if (!parsed.success) return reply.code(400).send({ error: 'VALIDATION_ERROR', message: parsed.error.issues[0]?.message })

    const { data: existing } = await fastify.supabase
      .from('reimbursement_claims')
      .select('id, status, employee_id, claimed_amount')
      .eq('id', id).eq('tenant_id', req.tenantId).single()

    if (!existing) return reply.code(404).send({ error: 'NOT_FOUND', message: 'Claim not found' })
    if (!['submitted', 'under_review', 'approved'].includes((existing as any).status)) {
      return reply.code(409).send({ error: 'INVALID_STATUS', message: `Cannot reject claim with status: ${(existing as any).status}` })
    }

    // Gate the reject too so a configured chain records the rejection + closes the
    // instance (no chain => transparent; HR-only already enforced by requireHrAdmin).
    {
      const gate = await gateReject(fastify.supabase, {
        tenantId: req.tenantId, entityType: 'reimbursement_claim', entityId: id,
        actorId: req.userId, actorRole: req.userRole,
        targetEmployeeId: (existing as any).employee_id,
        amount: Number((existing as any).claimed_amount ?? 0),
        comments: parsed.data.rejection_reason,
      })
      if (gate.kind === 'error') {
        const code = gate.error.type === 'FORBIDDEN' ? 403 : gate.error.type === 'CONFLICT' ? 409 : 400
        return reply.code(code).send({ error: gate.error.type, message: gate.error.message })
      }
    }

    const now = new Date().toISOString()
    const { data, error } = await fastify.supabase
      .from('reimbursement_claims')
      .update({ status: 'rejected', rejection_reason: parsed.data.rejection_reason, reviewed_by: req.userId, reviewed_at: now, updated_at: now })
      .eq('id', id).eq('tenant_id', req.tenantId).select().single()

    if (error) return reply.code(500).send({ error: 'UPDATE_FAILED', message: error.message })
    await logAction(fastify.supabase, { tenantId: req.tenantId, tableName: 'reimbursement_claims', recordId: id, action: 'UPDATE', performedBy: req.userId, onBehalfOf: (existing as any).employee_id ?? null, newData: { status: 'rejected', rejection_reason: parsed.data.rejection_reason } })
    return reply.send({ data })
  })

  /**
   * POST /payroll/reimbursements/:id/pay
   * Marks an approved claim as paid.
   */
  fastify.post('/:id/pay', { preHandler: [fastify.authenticate, requireHrAdmin] }, async (req: any, reply) => {
    const { id } = req.params as { id: string }
    const { data: existing } = await fastify.supabase
      .from('reimbursement_claims')
      .select('id, status, employee_id, approved_amount')
      .eq('id', id).eq('tenant_id', req.tenantId).single()

    if (!existing) return reply.code(404).send({ error: 'NOT_FOUND', message: 'Claim not found' })
    if ((existing as any).status !== 'approved') {
      return reply.code(409).send({ error: 'INVALID_STATUS', message: 'Only approved claims can be marked as paid' })
    }

    const now = new Date().toISOString()
    const { data, error } = await fastify.supabase
      .from('reimbursement_claims')
      .update({ status: 'paid', paid_at: now, updated_at: now })
      .eq('id', id).eq('tenant_id', req.tenantId).select().single()

    if (error) return reply.code(500).send({ error: 'UPDATE_FAILED', message: error.message })
    await logAction(fastify.supabase, { tenantId: req.tenantId, tableName: 'reimbursement_claims', recordId: id, action: 'UPDATE', performedBy: req.userId, onBehalfOf: (existing as any).employee_id ?? null, newData: { status: 'paid' } })
    return reply.send({ data })
  })

  // ── Pending payments by month ─────────────────────────────────────────────────
  fastify.get('/pending-payments/:month', { preHandler: [fastify.authenticate, requireHrAdmin] }, async (req: any, reply) => {
    const { month } = req.params as { month: string }
    const [year, mon] = month.split('-').map(Number)
    const firstDay = `${month}-01`
    const lastDay = new Date(year, mon, 0).toISOString().slice(0, 10)

    const { data, error } = await fastify.supabase
      .from('reimbursement_claims')
      .select('*, employees(id, first_name, last_name, employee_code), reimbursement_categories(id, name, code, category_type)')
      .eq('tenant_id', req.tenantId)
      .eq('status', 'approved')
      .or(`claim_date.gte.${firstDay},expense_date.gte.${firstDay}`)
      .or(`claim_date.lte.${lastDay},expense_date.lte.${lastDay}`)

    if (error) return reply.code(500).send({ error: 'QUERY_FAILED', message: error.message })
    return reply.send({ data: data ?? [], month })
  })
}
