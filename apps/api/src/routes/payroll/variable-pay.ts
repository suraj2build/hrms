/**
 * Variable Pay Routes
 * Incentive templates, payout batches, and individual payout management.
 */

import type { FastifyInstance } from 'fastify'
import { z } from 'zod'

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
    if (!['super_admin', 'hr_admin'].includes(req.userRole)) {
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
      .eq('tenant_id', req.tenantId)

    if (parsed.data.is_active !== undefined) {
      q = q.eq('is_active', parsed.data.is_active === 'true')
    }

    const { data, error } = await q
    if (error) return reply.code(500).send({ error: 'QUERY_FAILED', message: error.message })
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
      return reply.code(500).send({ error: 'INSERT_FAILED', message: error.message })
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

    if (error) return reply.code(500).send({ error: 'UPDATE_FAILED', message: error.message })
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
      .eq('tenant_id', req.tenantId)

    if (parsed.data.payout_month) q = q.eq('payout_month', parsed.data.payout_month)
    if (parsed.data.status) q = q.eq('status', parsed.data.status)

    const { data, error } = await q
    if (error) return reply.code(500).send({ error: 'QUERY_FAILED', message: error.message })
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

    if (error) return reply.code(500).send({ error: 'INSERT_FAILED', message: error.message })
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

    if (payErr) return reply.code(500).send({ error: 'INSERT_FAILED', message: payErr.message })

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
  fastify.get('/batches/:id/payouts', auth, async (req: any, reply) => {
    const { id } = req.params as { id: string }

    const { data, error } = await fastify.supabase
      .from('variable_payouts')
      .select('*, employees(id, first_name, last_name, employee_code)')
      .eq('batch_id', id)
      .eq('tenant_id', req.tenantId)

    if (error) return reply.code(500).send({ error: 'QUERY_FAILED', message: error.message })
    return reply.send({ data: data ?? [] })
  })

  // ── POST /payroll/variable-pay/batches/:id/submit ────────────────────────────
  fastify.post('/batches/:id/submit', { preHandler: [fastify.authenticate, requireHrAdmin] }, async (req: any, reply) => {
    const { id } = req.params as { id: string }

    const { error } = await fastify.supabase
      .from('variable_payout_batches')
      .update({ status: 'in_review', updated_at: new Date().toISOString() })
      .eq('id', id)
      .eq('tenant_id', req.tenantId)

    if (error) return reply.code(500).send({ error: 'UPDATE_FAILED', message: error.message })
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
        .update({ status: 'approved', updated_at: now })
        .eq('batch_id', id)
        .eq('tenant_id', req.tenantId),
    ])

    if (batchErr) return reply.code(500).send({ error: 'UPDATE_FAILED', message: batchErr.message })
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
        .update({ status: 'cancelled', updated_at: now })
        .eq('batch_id', id)
        .eq('tenant_id', req.tenantId),
    ])

    if (batchErr) return reply.code(500).send({ error: 'UPDATE_FAILED', message: batchErr.message })
    if (payoutsErr) req.log.warn({ err: payoutsErr }, 'Failed to cancel payouts')

    return reply.send({ message: 'Batch cancelled' })
  })

  // ── GET /payroll/variable-pay/employee/:employeeId ────────────────────────────
  fastify.get('/employee/:employeeId', auth, async (req: any, reply) => {
    const { employeeId } = req.params as { employeeId: string }

    const { data, error } = await fastify.supabase
      .from('variable_payouts')
      .select(`
        *,
        variable_payout_batches(id, batch_name, payout_month, status, incentive_templates(id, name, code, template_type))
      `)
      .eq('employee_id', employeeId)
      .eq('tenant_id', req.tenantId)

    if (error) return reply.code(500).send({ error: 'QUERY_FAILED', message: error.message })
    return reply.send({ data: data ?? [] })
  })
}
