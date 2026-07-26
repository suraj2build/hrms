/**
 * Variable Pay Routes
 * Incentive templates, payout batches, and individual payout management.
 */

import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { HR_ADMIN_ROLES } from '../../lib/rbac.js'
import { fetchAllRows } from '../../lib/supabase-paginate.js'
import { serverError, ErrorCode } from '../../lib/api-errors.js'

const TEMPLATE_TYPES = [
  'performance_bonus',
  'sales_incentive',
  'referral_bonus',
  'spot_award',
  'retention_bonus',
  'project_completion',
  'other',
] as const

export default async function variablePayRoutes(fastify: FastifyInstance) {
  const auth = { preHandler: [fastify.authenticate] }

  function requireHrAdmin(req: any, reply: any, done: () => void) {
    if (!(HR_ADMIN_ROLES as readonly string[]).includes(req.userRole)) {
      reply.code(403).send({ error: 'FORBIDDEN', message: 'HR admin access required' })
      return
    }
    done()
  }

  // ── GET /payroll/variable-pay/templates ───────────────────────────────────────
  fastify.get('/templates', auth, async (req: any, reply) => {
    const querySchema = z.object({
      is_active: z.enum(['true', 'false']).optional(),
    })

    const parsed = querySchema.safeParse(req.query)
    if (!parsed.success) {
      return reply.code(400).send({ error: 'VALIDATION_ERROR', message: parsed.error.issues[0]?.message })
    }

    let q = fastify.supabase
      .from('incentive_templates')
      .select('*')
      .eq('tenant_id', req.tenantId).limit(200)

    if (parsed.data.is_active !== undefined) {
      q = q.eq('is_active', parsed.data.is_active === 'true')
    }

    const { data, error } = await q
    if (error) return serverError(req, reply, error, ErrorCode.QUERY_FAILED, 'Failed to fetch incentive templates')
    return reply.send({ data: data ?? [] })
  })

  // ── POST /payroll/variable-pay/templates ──────────────────────────────────────
  fastify.post('/templates', { preHandler: [fastify.authenticate, requireHrAdmin] }, async (req: any, reply) => {
    const schema = z.object({
      name: z.string().min(1).max(200),
      code: z.string().min(1).max(50),
      template_type: z.enum(TEMPLATE_TYPES),
      is_taxable: z.boolean(),
      requires_approval: z.boolean(),
      description: z.string().optional(),
    })

    const parsed = schema.safeParse(req.body)
    if (!parsed.success) {
      return reply.code(400).send({ error: 'VALIDATION_ERROR', message: parsed.error.issues[0]?.message })
    }

    const { data, error } = await fastify.supabase
      .from('incentive_templates')
      .insert({ ...parsed.data, tenant_id: req.tenantId, is_active: true })
      .select()
      .single()

    if (error) {
      if (error.code === '23505') {
        return reply.code(409).send({ error: 'DUPLICATE_CODE', message: 'A template with this code already exists' })
      }
      return serverError(req, reply, error, ErrorCode.INSERT_FAILED, 'Failed to create incentive template')
    }

    return reply.code(201).send({ data })
  })

  // ── PUT /payroll/variable-pay/templates/:id ───────────────────────────────────
  fastify.put('/templates/:id', { preHandler: [fastify.authenticate, requireHrAdmin] }, async (req: any, reply) => {
    const { id } = req.params as { id: string }

    const schema = z.object({
      name: z.string().min(1).max(200).optional(),
      code: z.string().min(1).max(50).optional(),
      template_type: z.enum(TEMPLATE_TYPES).optional(),
      is_taxable: z.boolean().optional(),
      requires_approval: z.boolean().optional(),
      description: z.string().optional(),
      is_active: z.boolean().optional(),
    })

    const parsed = schema.safeParse(req.body)
    if (!parsed.success) {
      return reply.code(400).send({ error: 'VALIDATION_ERROR', message: parsed.error.issues[0]?.message })
    }

    const { data, error } = await fastify.supabase
      .from('incentive_templates')
      .update({ ...parsed.data, updated_at: new Date().toISOString() })
      .eq('id', id)
      .eq('tenant_id', req.tenantId)
      .select()
      .single()

    if (error) return serverError(req, reply, error, ErrorCode.UPDATE_FAILED, 'Failed to update incentive template')
    if (!data) return reply.code(404).send({ error: 'NOT_FOUND', message: 'Template not found' })

    return reply.send({ data })
  })

  // ── GET /payroll/variable-pay/batches ─────────────────────────────────────────
  fastify.get('/batches', auth, async (req: any, reply) => {
    const querySchema = z.object({
      payout_month: z.string().optional(),
      status: z.string().optional(),
    })

    const parsed = querySchema.safeParse(req.query)
    if (!parsed.success) {
      return reply.code(400).send({ error: 'VALIDATION_ERROR', message: parsed.error.issues[0]?.message })
    }

    let q = fastify.supabase
      .from('variable_payout_batches')
      .select('*, incentive_templates(id, name, code, template_type)')
      .eq('tenant_id', req.tenantId).limit(200)

    if (parsed.data.payout_month) q = q.eq('payout_month', parsed.data.payout_month)
    if (parsed.data.status) q = q.eq('status', parsed.data.status)

    const { data, error } = await q
    if (error) return serverError(req, reply, error, ErrorCode.QUERY_FAILED, 'Failed to fetch payout batches')
    return reply.send({ data: data ?? [] })
  })

  // ── POST /payroll/variable-pay/batches ────────────────────────────────────────
  fastify.post('/batches', { preHandler: [fastify.authenticate, requireHrAdmin] }, async (req: any, reply) => {
    const schema = z.object({
      template_id: z.string().uuid(),
      batch_name: z.string().min(1),
      payout_month: z.string().regex(/^\d{4}-\d{2}$/),
      notes: z.string().optional(),
    })

    const parsed = schema.safeParse(req.body)
    if (!parsed.success) {
      return reply.code(400).send({ error: 'VALIDATION_ERROR', message: parsed.error.issues[0]?.message })
    }

    const { data, error } = await fastify.supabase
      .from('variable_payout_batches')
      .insert({
        ...parsed.data,
        tenant_id: req.tenantId,
        status: 'draft',
        total_amount: 0,
        employee_count: 0,
        created_by: req.userId,
      })
      .select()
      .single()

    if (error) return serverError(req, reply, error, ErrorCode.INSERT_FAILED, 'Failed to create payout batch')
    return reply.code(201).send({ data })
  })

  // ── POST /payroll/variable-pay/batches/:id/payouts ───────────────────────────
  fastify.post('/batches/:id/payouts', { preHandler: [fastify.authenticate, requireHrAdmin] }, async (req: any, reply) => {
    const { id } = req.params as { id: string }

    const payoutSchema = z.object({
      employee_id: z.string().uuid(),
      amount: z.number().positive(),
      performance_period: z.string().optional(),
      performance_notes: z.string().optional(),
    })

    const schema = z.object({
      payouts: z.array(payoutSchema).min(1),
    })

    const parsed = schema.safeParse(req.body)
    if (!parsed.success) {
      return reply.code(400).send({ error: 'VALIDATION_ERROR', message: parsed.error.issues[0]?.message })
    }

    const payoutRows = parsed.data.payouts.map(p => ({
      ...p,
      batch_id: id,
      tenant_id: req.tenantId,
      status: 'pending',
      created_by: req.userId,
    }))

    const { data: insertedPayouts, error: payErr } = await fastify.supabase
      .from('variable_payouts')
      .insert(payoutRows)
      .select()

    if (payErr) return serverError(req, reply, payErr, ErrorCode.INSERT_FAILED, 'Failed to create variable payouts')

    // Update batch total_amount and employee_count
    const totalAmount = parsed.data.payouts.reduce((sum, p) => sum + p.amount, 0)
    const employeeCount = new Set(parsed.data.payouts.map(p => p.employee_id)).size

    const { data: batchRow } = await fastify.supabase
      .from('variable_payout_batches')
      .select('total_amount, employee_count')
      .eq('id', id)
      .eq('tenant_id', req.tenantId)
      .single()

    if (batchRow) {
      const currentTotal = (batchRow as any).total_amount ?? 0
      const currentCount = (batchRow as any).employee_count ?? 0

      await fastify.supabase
        .from('variable_payout_batches')
        .update({
          total_amount: Math.round((currentTotal + totalAmount) * 100) / 100,
          employee_count: currentCount + employeeCount,
          updated_at: new Date().toISOString(),
        })
        .eq('id', id)
        .eq('tenant_id', req.tenantId)
    }

    return reply.code(201).send({ data: insertedPayouts })
  })

  // ── GET /payroll/variable-pay/batches/:id/payouts ────────────────────────────
  fastify.get('/batches/:id/payouts', { preHandler: [fastify.authenticate, requireHrAdmin] }, async (req: any, reply) => {
    const { id } = req.params as { id: string }

    let data: any[]
    try {
      data = await fetchAllRows((from, to) =>
        fastify.supabase
          .from('variable_payouts')
          .select('*, employees(id, first_name, last_name, employee_code)')
          .eq('batch_id', id)
          .eq('tenant_id', req.tenantId)
          .range(from, to),
      )
    } catch (err: any) {
      return serverError(req, reply, err, ErrorCode.QUERY_FAILED, 'Failed to fetch batch payouts')
    }
    return reply.send({ data })
  })

  // ── POST /payroll/variable-pay/batches/:id/submit ────────────────────────────
  fastify.post('/batches/:id/submit', { preHandler: [fastify.authenticate, requireHrAdmin] }, async (req: any, reply) => {
    const { id } = req.params as { id: string }

    const { error } = await fastify.supabase
      .from('variable_payout_batches')
      .update({ status: 'in_review', updated_at: new Date().toISOString() })
      .eq('id', id)
      .eq('tenant_id', req.tenantId)

    if (error) return serverError(req, reply, error, ErrorCode.UPDATE_FAILED, 'Failed to submit payout batch')
    return reply.send({ message: 'Batch submitted for review' })
  })

  // ── POST /payroll/variable-pay/batches/:id/approve ───────────────────────────
  fastify.post('/batches/:id/approve', { preHandler: [fastify.authenticate, requireHrAdmin] }, async (req: any, reply) => {
    const { id } = req.params as { id: string }
    const now = new Date().toISOString()

    const [{ error: batchErr }, { error: payoutsErr }] = await Promise.all([
      fastify.supabase
        .from('variable_payout_batches')
        .update({
          status: 'approved',
          approved_by: req.userId,
          approved_at: now,
          updated_at: now,
        })
        .eq('id', id)
        .eq('tenant_id', req.tenantId),
      fastify.supabase
        .from('variable_payouts')
        .update({ status: 'approved' })
        .eq('batch_id', id)
        .eq('tenant_id', req.tenantId),
    ])

    if (batchErr) return serverError(req, reply, batchErr, ErrorCode.UPDATE_FAILED, 'Failed to approve payout batch')
    if (payoutsErr) req.log.warn({ err: payoutsErr }, 'Failed to update payout statuses')

    return reply.send({ message: 'Batch approved' })
  })

  // ── POST /payroll/variable-pay/batches/:id/cancel ────────────────────────────
  fastify.post('/batches/:id/cancel', { preHandler: [fastify.authenticate, requireHrAdmin] }, async (req: any, reply) => {
    const { id } = req.params as { id: string }
    const now = new Date().toISOString()

    const [{ error: batchErr }, { error: payoutsErr }] = await Promise.all([
      fastify.supabase
        .from('variable_payout_batches')
        .update({ status: 'cancelled', updated_at: now })
        .eq('id', id)
        .eq('tenant_id', req.tenantId),
      fastify.supabase
        .from('variable_payouts')
        .update({ status: 'cancelled' })
        .eq('batch_id', id)
        .eq('tenant_id', req.tenantId),
    ])

    if (batchErr) return serverError(req, reply, batchErr, ErrorCode.UPDATE_FAILED, 'Failed to cancel payout batch')
    if (payoutsErr) req.log.warn({ err: payoutsErr }, 'Failed to cancel payouts')

    return reply.send({ message: 'Batch cancelled' })
  })

  // ── GET /payroll/variable-pay/my ──────────────────────────────────────────────
  // ESS (Program 5 · P5.1): the caller's OWN variable pay awards. employee_id is
  // resolved server-side from the profile — never trusted from the client — so an
  // employee can only ever read their own incentives. Only payouts belonging to an
  // APPROVED batch are exposed (draft / in_review / cancelled payouts stay invisible
  // to the employee). Read-only — reuses the existing variable pay engine.
  fastify.get('/my', auth, async (req: any, reply) => {
    const { data: profile } = await fastify.supabase
      .from('profiles')
      .select('employee_id')
      .eq('id', req.userId)
      .eq('tenant_id', req.tenantId)
      .maybeSingle()

    const employeeId = (profile as { employee_id: string | null } | null)?.employee_id ?? null
    if (!employeeId) {
      return reply.send({ data: [], total_awarded: 0 })
    }

    const { data, error } = await fastify.supabase
      .from('variable_payouts')
      .select(`
        id, amount, status, performance_period, performance_notes, created_at,
        variable_payout_batches!inner(id, batch_name, payout_month, status, approved_at,
          incentive_templates(id, name, code, template_type, is_taxable))
      `)
      .eq('employee_id', employeeId)
      .eq('tenant_id', req.tenantId)
      .eq('variable_payout_batches.status', 'approved').limit(100)

    if (error) return serverError(req, reply, error, ErrorCode.QUERY_FAILED, 'Failed to fetch variable pay awards')

    const rows = (data ?? []).map((p: any) => {
      const batch = p.variable_payout_batches
      const tmpl  = batch?.incentive_templates
      return {
        id:                p.id,
        amount:            Number(p.amount ?? 0),
        status:            p.status,
        performance_period: p.performance_period ?? null,
        performance_notes:  p.performance_notes ?? null,
        award_name:        tmpl?.name ?? batch?.batch_name ?? 'Variable Pay',
        award_type:        tmpl?.template_type ?? 'other',
        is_taxable:        tmpl?.is_taxable ?? true,
        batch_name:        batch?.batch_name ?? null,
        payout_month:      batch?.payout_month ?? null,
        approved_at:       batch?.approved_at ?? null,
      }
    })
    // Newest payout month first
    rows.sort((a, b) => (b.payout_month ?? '').localeCompare(a.payout_month ?? ''))

    const total_awarded = rows.reduce((s, r) => s + r.amount, 0)
    return reply.send({ data: rows, total_awarded })
  })

  // ── GET /payroll/variable-pay/employee/:employeeId ────────────────────────────
  fastify.get('/employee/:employeeId', { preHandler: [fastify.authenticate, requireHrAdmin] }, async (req: any, reply) => {
    const { employeeId } = req.params as { employeeId: string }

    const { data, error } = await fastify.supabase
      .from('variable_payouts')
      .select(`
        *,
        variable_payout_batches(id, batch_name, payout_month, status, incentive_templates(id, name, code, template_type))
      `)
      .eq('employee_id', employeeId)
      .eq('tenant_id', req.tenantId).limit(200)

    if (error) return serverError(req, reply, error, ErrorCode.QUERY_FAILED, 'Failed to fetch employee variable pay')
    return reply.send({ data: data ?? [] })
  })
}
