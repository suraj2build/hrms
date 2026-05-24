/**
 * Reimbursements Routes
 * Category management, claim lifecycle, approvals, and attachment handling.
 */

import type { FastifyInstance } from 'fastify'
import { z } from 'zod'

const CATEGORY_TYPES = ['medical', 'travel', 'food', 'telephone', 'internet', 'books', 'uniform', 'other'] as const

export default async function reimbursementsRoutes(fastify: FastifyInstance) {
  const auth = { preHandler: [fastify.authenticate] }

  function requireHrAdmin(req: any, reply: any, done: () => void) {
    if (!['super_admin', 'hr_admin'].includes(req.userRole)) {
      reply.code(403).send({ error: 'FORBIDDEN', message: 'HR admin access required' })
      return
    }
    done()
  }

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

    let q = fastify.supabase
      .from('reimbursement_claims')
      .select('*, employees(id, first_name, last_name, employee_code), reimbursement_categories(id, name, code, category_type)')
      .eq('tenant_id', req.tenantId)

    if (parsed.data.employee_id) q = q.eq('employee_id', parsed.data.employee_id)
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
  fastify.post('/claims', auth, async (req: any, reply) => {
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
        created_by: req.userId,
      })
      .select()
      .single()

    if (error) return reply.code(500).send({ error: 'INSERT_FAILED', message: error.message })
    return reply.code(201).send({ data })
  })

  // ── PUT /payroll/reimbursements/claims/:id ────────────────────────────────────
  fastify.put('/claims/:id', auth, async (req: any, reply) => {
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
  fastify.post('/claims/:id/submit', auth, async (req: any, reply) => {
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
  fastify.post('/claims/:id/approve', { preHandler: [fastify.authenticate, requireHrAdmin] }, async (req: any, reply) => {
    const { id } = req.params as { id: string }

    const schema = z.object({
      approved_amount: z.number().positive(),
    })

    const parsed = schema.safeParse(req.body)
    if (!parsed.success) {
      return reply.code(400).send({ error: 'VALIDATION_ERROR', message: parsed.error.issues[0]?.message })
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

    return reply.send({ data })
  })

  // ── POST /payroll/reimbursements/claims/:id/reject ────────────────────────────
  fastify.post('/claims/:id/reject', { preHandler: [fastify.authenticate, requireHrAdmin] }, async (req: any, reply) => {
    const { id } = req.params as { id: string }

    const schema = z.object({
      rejection_reason: z.string().min(1),
    })

    const parsed = schema.safeParse(req.body)
    if (!parsed.success) {
      return reply.code(400).send({ error: 'VALIDATION_ERROR', message: parsed.error.issues[0]?.message })
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
