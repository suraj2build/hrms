/**
 * Payroll Governance Routes
 * Freeze/unfreeze, maker-checker workflow, variance approvals.
 */

import type { FastifyInstance } from 'fastify'
import { z } from 'zod'

export default async function governanceRoutes(fastify: FastifyInstance) {
  const auth = { preHandler: [fastify.authenticate] }

  function requireHrAdmin(req: any, reply: any, done: () => void) {
    if (!['super_admin', 'hr_admin'].includes(req.userRole)) {
      reply.code(403).send({ error: 'FORBIDDEN', message: 'HR admin access required' })
      return
    }
    done()
  }

  // ── GET /payroll/governance/freeze ────────────────────────────────────────────
  fastify.get('/freeze', auth, async (req: any, reply) => {
    const querySchema = z.object({
      month: z.string().optional(),
    })

    const parsed = querySchema.safeParse(req.query)
    if (!parsed.success) {
      return reply.code(400).send({ error: 'VALIDATION_ERROR', message: parsed.error.issues[0]?.message })
    }

    let q = fastify.supabase
      .from('payroll_freeze_log')
      .select('*, profiles!frozen_by(id, full_name, email)')
      .eq('tenant_id', req.tenantId)
      .order('frozen_at', { ascending: false })

    if (parsed.data.month) q = q.eq('freeze_month', parsed.data.month)

    const { data, error } = await q
    if (error) return reply.code(500).send({ error: 'QUERY_FAILED', message: error.message })
    return reply.send({ data: data ?? [] })
  })

  // ── POST /payroll/governance/freeze ──────────────────────────────────────────
  fastify.post('/freeze', { preHandler: [fastify.authenticate, requireHrAdmin] }, async (req: any, reply) => {
    const schema = z.object({
      freeze_month: z.string().regex(/^\d{4}-\d{2}$/),
      reason: z.string().min(1),
      department_ids: z.array(z.string().uuid()).optional(),
    })

    const parsed = schema.safeParse(req.body)
    if (!parsed.success) {
      return reply.code(400).send({ error: 'VALIDATION_ERROR', message: parsed.error.issues[0]?.message })
    }

    const { data, error } = await fastify.supabase
      .from('payroll_freeze_log')
      .insert({
        ...parsed.data,
        tenant_id: req.tenantId,
        action: 'freeze',
        frozen_by: req.userId,
        frozen_at: new Date().toISOString(),
      })
      .select()
      .single()

    if (error) return reply.code(500).send({ error: 'INSERT_FAILED', message: error.message })
    return reply.code(201).send({ data })
  })

  // ── POST /payroll/governance/unfreeze ─────────────────────────────────────────
  fastify.post('/unfreeze', { preHandler: [fastify.authenticate, requireHrAdmin] }, async (req: any, reply) => {
    const schema = z.object({
      freeze_month: z.string().regex(/^\d{4}-\d{2}$/),
      reason: z.string().min(1),
    })

    const parsed = schema.safeParse(req.body)
    if (!parsed.success) {
      return reply.code(400).send({ error: 'VALIDATION_ERROR', message: parsed.error.issues[0]?.message })
    }

    const now = new Date().toISOString()

    // Find the latest freeze record for this month
    const { data: latestFreeze } = await fastify.supabase
      .from('payroll_freeze_log')
      .select('id')
      .eq('tenant_id', req.tenantId)
      .eq('freeze_month', parsed.data.freeze_month)
      .eq('action', 'freeze')
      .is('unfrozen_at', null)
      .order('frozen_at', { ascending: false })
      .limit(1)
      .maybeSingle()

    // Insert unfreeze record
    const { data, error } = await fastify.supabase
      .from('payroll_freeze_log')
      .insert({
        tenant_id: req.tenantId,
        freeze_month: parsed.data.freeze_month,
        action: 'unfreeze',
        reason: parsed.data.reason,
        frozen_by: req.userId,
        frozen_at: now,
        unfrozen_by: req.userId,
        unfrozen_at: now,
      })
      .select()
      .single()

    if (error) return reply.code(500).send({ error: 'INSERT_FAILED', message: error.message })

    // Update previous freeze record with unfrozen_by and unfrozen_at
    if (latestFreeze) {
      await fastify.supabase
        .from('payroll_freeze_log')
        .update({
          unfrozen_by: req.userId,
          unfrozen_at: now,
          updated_at: now,
        })
        .eq('id', (latestFreeze as any).id)
        .eq('tenant_id', req.tenantId)
    }

    return reply.send({ data })
  })

  // ── GET /payroll/governance/maker-checker ─────────────────────────────────────
  fastify.get('/maker-checker', auth, async (req: any, reply) => {
    const querySchema = z.object({
      entity_type: z.string().optional(),
      status: z.string().optional(),
    })

    const parsed = querySchema.safeParse(req.query)
    if (!parsed.success) {
      return reply.code(400).send({ error: 'VALIDATION_ERROR', message: parsed.error.issues[0]?.message })
    }

    let q = fastify.supabase
      .from('maker_checker_log')
      .select('*, profiles!maker_id(id, full_name, email)')
      .eq('tenant_id', req.tenantId)
      .order('submitted_at', { ascending: false })

    if (parsed.data.entity_type) q = q.eq('entity_type', parsed.data.entity_type)
    if (parsed.data.status) q = q.eq('status', parsed.data.status)

    const { data, error } = await q
    if (error) return reply.code(500).send({ error: 'QUERY_FAILED', message: error.message })
    return reply.send({ data: data ?? [] })
  })

  // ── POST /payroll/governance/maker-checker/:id/approve ───────────────────────
  fastify.post('/maker-checker/:id/approve', { preHandler: [fastify.authenticate, requireHrAdmin] }, async (req: any, reply) => {
    const { id } = req.params as { id: string }

    const schema = z.object({
      checker_notes: z.string().optional(),
    })

    const parsed = schema.safeParse(req.body)
    if (!parsed.success) {
      return reply.code(400).send({ error: 'VALIDATION_ERROR', message: parsed.error.issues[0]?.message })
    }

    const now = new Date().toISOString()

    const { data, error } = await fastify.supabase
      .from('maker_checker_log')
      .update({
        status: 'approved',
        checker_id: req.userId,
        reviewed_at: now,
        checker_notes: parsed.data.checker_notes ?? null,
        updated_at: now,
      })
      .eq('id', id)
      .eq('tenant_id', req.tenantId)
      .select()
      .single()

    if (error) return reply.code(500).send({ error: 'UPDATE_FAILED', message: error.message })
    if (!data) return reply.code(404).send({ error: 'NOT_FOUND', message: 'Record not found' })

    return reply.send({ data })
  })

  // ── POST /payroll/governance/maker-checker/:id/reject ────────────────────────
  fastify.post('/maker-checker/:id/reject', { preHandler: [fastify.authenticate, requireHrAdmin] }, async (req: any, reply) => {
    const { id } = req.params as { id: string }

    const schema = z.object({
      checker_notes: z.string().min(1),
    })

    const parsed = schema.safeParse(req.body)
    if (!parsed.success) {
      return reply.code(400).send({ error: 'VALIDATION_ERROR', message: parsed.error.issues[0]?.message })
    }

    const now = new Date().toISOString()

    const { data, error } = await fastify.supabase
      .from('maker_checker_log')
      .update({
        status: 'rejected',
        checker_id: req.userId,
        reviewed_at: now,
        checker_notes: parsed.data.checker_notes,
        updated_at: now,
      })
      .eq('id', id)
      .eq('tenant_id', req.tenantId)
      .select()
      .single()

    if (error) return reply.code(500).send({ error: 'UPDATE_FAILED', message: error.message })
    if (!data) return reply.code(404).send({ error: 'NOT_FOUND', message: 'Record not found' })

    return reply.send({ data })
  })

  // ── GET /payroll/governance/variance-approvals ────────────────────────────────
  fastify.get('/variance-approvals', auth, async (req: any, reply) => {
    const querySchema = z.object({
      payroll_run_id: z.string().uuid().optional(),
      status: z.string().optional(),
    })

    const parsed = querySchema.safeParse(req.query)
    if (!parsed.success) {
      return reply.code(400).send({ error: 'VALIDATION_ERROR', message: parsed.error.issues[0]?.message })
    }

    let q = fastify.supabase
      .from('payroll_variance_approvals')
      .select('*, employees(id, first_name, last_name, employee_code)')
      .eq('tenant_id', req.tenantId)

    if (parsed.data.payroll_run_id) q = q.eq('payroll_run_id', parsed.data.payroll_run_id)
    if (parsed.data.status) q = q.eq('status', parsed.data.status)

    const { data, error } = await q
    if (error) return reply.code(500).send({ error: 'QUERY_FAILED', message: error.message })
    return reply.send({ data: data ?? [] })
  })

  // ── POST /payroll/governance/variance-approvals/:id/approve ──────────────────
  fastify.post('/variance-approvals/:id/approve', { preHandler: [fastify.authenticate, requireHrAdmin] }, async (req: any, reply) => {
    const { id } = req.params as { id: string }
    const now = new Date().toISOString()

    const { data, error } = await fastify.supabase
      .from('payroll_variance_approvals')
      .update({
        status: 'approved',
        reviewed_by: req.userId,
        reviewed_at: now,
        updated_at: now,
      })
      .eq('id', id)
      .eq('tenant_id', req.tenantId)
      .select()
      .single()

    if (error) return reply.code(500).send({ error: 'UPDATE_FAILED', message: error.message })
    if (!data) return reply.code(404).send({ error: 'NOT_FOUND', message: 'Variance approval not found' })

    return reply.send({ data })
  })

  // ── POST /payroll/governance/variance-approvals/:id/reject ───────────────────
  fastify.post('/variance-approvals/:id/reject', { preHandler: [fastify.authenticate, requireHrAdmin] }, async (req: any, reply) => {
    const { id } = req.params as { id: string }

    const schema = z.object({
      notes: z.string().optional(),
    })

    const parsed = schema.safeParse(req.body)
    if (!parsed.success) {
      return reply.code(400).send({ error: 'VALIDATION_ERROR', message: parsed.error.issues[0]?.message })
    }

    const now = new Date().toISOString()

    const { data, error } = await fastify.supabase
      .from('payroll_variance_approvals')
      .update({
        status: 'rejected',
        notes: parsed.data.notes ?? null,
        reviewed_by: req.userId,
        reviewed_at: now,
        updated_at: now,
      })
      .eq('id', id)
      .eq('tenant_id', req.tenantId)
      .select()
      .single()

    if (error) return reply.code(500).send({ error: 'UPDATE_FAILED', message: error.message })
    if (!data) return reply.code(404).send({ error: 'NOT_FOUND', message: 'Variance approval not found' })

    return reply.send({ data })
  })

  // ── GET /payroll/governance/is-frozen/:month ──────────────────────────────────
  fastify.get('/is-frozen/:month', auth, async (req: any, reply) => {
    const { month } = req.params as { month: string }

    const { data, error } = await fastify.supabase
      .from('payroll_freeze_log')
      .select('*')
      .eq('tenant_id', req.tenantId)
      .eq('freeze_month', month)
      .eq('action', 'freeze')
      .is('unfrozen_at', null)
      .order('frozen_at', { ascending: false })
      .limit(1)
      .maybeSingle()

    if (error) return reply.code(500).send({ error: 'QUERY_FAILED', message: error.message })

    return reply.send({
      is_frozen: !!data,
      freeze_record: data ?? null,
      month,
    })
  })
}
