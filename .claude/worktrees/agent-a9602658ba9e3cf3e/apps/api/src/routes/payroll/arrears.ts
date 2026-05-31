/**
 * Arrears Routes
 * Arrear batch management with bulk record insertion.
 */

import type { FastifyInstance } from 'fastify'
import { z } from 'zod'

const ARREAR_TYPES = ['salary_revision', 'bonus_revision', 'component_change', 'correction', 'other'] as const

export default async function arrearsRoutes(fastify: FastifyInstance) {
  const auth = { preHandler: [fastify.authenticate] }

  function requireHrAdmin(req: any, reply: any, done: () => void) {
    if (!['super_admin', 'hr_admin'].includes(req.userRole)) {
      reply.code(403).send({ error: 'FORBIDDEN', message: 'HR admin access required' })
      return
    }
    done()
  }

  // ── GET /payroll/arrears/batches ──────────────────────────────────────────────
  fastify.get('/batches', auth, async (req: any, reply) => {
    const querySchema = z.object({
      status: z.string().optional(),
      from_period: z.string().optional(),
    })

    const parsed = querySchema.safeParse(req.query)
    if (!parsed.success) {
      return reply.code(400).send({ error: 'VALIDATION_ERROR', message: parsed.error.issues[0]?.message })
    }

    let q = fastify.supabase
      .from('arrear_batches')
      .select('*')
      .eq('tenant_id', req.tenantId)
      .order('created_at', { ascending: false })

    if (parsed.data.status) q = q.eq('status', parsed.data.status)
    if (parsed.data.from_period) q = q.gte('from_period', parsed.data.from_period)

    const { data, error } = await q
    if (error) return reply.code(500).send({ error: 'QUERY_FAILED', message: error.message })
    return reply.send({ data: data ?? [] })
  })

  // ── POST /payroll/arrears/batches ─────────────────────────────────────────────
  fastify.post('/batches', { preHandler: [fastify.authenticate, requireHrAdmin] }, async (req: any, reply) => {
    const schema = z.object({
      batch_name: z.string().min(1),
      arrear_type: z.enum(ARREAR_TYPES),
      from_period: z.string().regex(/^\d{4}-\d{2}$/),
      to_period: z.string().regex(/^\d{4}-\d{2}$/),
      payout_month: z.string().regex(/^\d{4}-\d{2}$/).optional(),
      notes: z.string().optional(),
    })

    const parsed = schema.safeParse(req.body)
    if (!parsed.success) {
      return reply.code(400).send({ error: 'VALIDATION_ERROR', message: parsed.error.issues[0]?.message })
    }

    const { data, error } = await fastify.supabase
      .from('arrear_batches')
      .insert({
        ...parsed.data,
        tenant_id: req.tenantId,
        status: 'draft',
        total_arrear_amount: 0,
        employee_count: 0,
        created_by: req.userId,
      })
      .select()
      .single()

    if (error) return reply.code(500).send({ error: 'INSERT_FAILED', message: error.message })
    return reply.code(201).send({ data })
  })

  // ── GET /payroll/arrears/batches/:id ─────────────────────────────────────────
  fastify.get('/batches/:id', auth, async (req: any, reply) => {
    const { id } = req.params as { id: string }

    const { data, error } = await fastify.supabase
      .from('arrear_batches')
      .select('*, arrear_records(*, employees(id, first_name, last_name, employee_code))')
      .eq('id', id)
      .eq('tenant_id', req.tenantId)
      .single()

    if (error || !data) return reply.code(404).send({ error: 'NOT_FOUND', message: 'Arrear batch not found' })
    return reply.send({ data })
  })

  // ── POST /payroll/arrears/batches/:id/records ─────────────────────────────────
  fastify.post('/batches/:id/records', { preHandler: [fastify.authenticate, requireHrAdmin] }, async (req: any, reply) => {
    const { id } = req.params as { id: string }

    const recordSchema = z.object({
      employee_id: z.string().uuid(),
      period_month: z.string(),
      component_code: z.string().min(1),
      component_name: z.string().min(1),
      old_amount: z.number(),
      new_amount: z.number(),
      is_taxable: z.boolean(),
      calculation_notes: z.string().optional(),
    })

    const schema = z.object({
      records: z.array(recordSchema).min(1),
    })

    const parsed = schema.safeParse(req.body)
    if (!parsed.success) {
      return reply.code(400).send({ error: 'VALIDATION_ERROR', message: parsed.error.issues[0]?.message })
    }

    const recordRows = parsed.data.records.map(r => ({
      ...r,
      batch_id: id,
      tenant_id: req.tenantId,
      arrear_amount: Math.round((r.new_amount - r.old_amount) * 100) / 100,
    }))

    const { data: insertedRecords, error: insertErr } = await fastify.supabase
      .from('arrear_records')
      .insert(recordRows)
      .select()

    if (insertErr) return reply.code(500).send({ error: 'INSERT_FAILED', message: insertErr.message })

    // Update batch totals
    const totalArrear = recordRows.reduce((sum, r) => sum + Math.abs(r.arrear_amount), 0)
    const distinctEmployeeIds = new Set(parsed.data.records.map(r => r.employee_id))

    await fastify.supabase
      .from('arrear_batches')
      .update({
        total_arrear_amount: Math.round(totalArrear * 100) / 100,
        employee_count: distinctEmployeeIds.size,
        status: 'calculated',
        updated_at: new Date().toISOString(),
      })
      .eq('id', id)
      .eq('tenant_id', req.tenantId)

    return reply.code(201).send({ data: insertedRecords, records_inserted: recordRows.length })
  })

  // ── POST /payroll/arrears/batches/:id/approve ─────────────────────────────────
  fastify.post('/batches/:id/approve', { preHandler: [fastify.authenticate, requireHrAdmin] }, async (req: any, reply) => {
    const { id } = req.params as { id: string }
    const now = new Date().toISOString()

    const { error } = await fastify.supabase
      .from('arrear_batches')
      .update({
        status: 'approved',
        approved_by: req.userId,
        approved_at: now,
        updated_at: now,
      })
      .eq('id', id)
      .eq('tenant_id', req.tenantId)

    if (error) return reply.code(500).send({ error: 'UPDATE_FAILED', message: error.message })
    return reply.send({ message: 'Arrear batch approved' })
  })

  // ── POST /payroll/arrears/batches/:id/cancel ──────────────────────────────────
  fastify.post('/batches/:id/cancel', { preHandler: [fastify.authenticate, requireHrAdmin] }, async (req: any, reply) => {
    const { id } = req.params as { id: string }

    const { error } = await fastify.supabase
      .from('arrear_batches')
      .update({ status: 'cancelled', updated_at: new Date().toISOString() })
      .eq('id', id)
      .eq('tenant_id', req.tenantId)

    if (error) return reply.code(500).send({ error: 'UPDATE_FAILED', message: error.message })
    return reply.send({ message: 'Arrear batch cancelled' })
  })

  // ── GET /payroll/arrears/employee/:employeeId ─────────────────────────────────
  fastify.get('/employee/:employeeId', auth, async (req: any, reply) => {
    const { employeeId } = req.params as { employeeId: string }

    const { data, error } = await fastify.supabase
      .from('arrear_records')
      .select('*, arrear_batches(id, batch_name, arrear_type, status, from_period, to_period, payout_month)')
      .eq('employee_id', employeeId)
      .eq('tenant_id', req.tenantId)
      .order('period_month', { ascending: false })

    if (error) return reply.code(500).send({ error: 'QUERY_FAILED', message: error.message })
    return reply.send({ data: data ?? [] })
  })
}
