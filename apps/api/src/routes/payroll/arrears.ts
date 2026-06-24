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

  // ── GET /payroll/arrears/batches/:id/records ──────────────────────────────────
  // Fetch the calculated arrear records for a batch (+ employee name/code).
  fastify.get('/batches/:id/records', auth, async (req: any, reply) => {
    const { id } = req.params as { id: string }

    const { data: batch } = await fastify.supabase
      .from('arrear_batches')
      .select('payout_month, status')
      .eq('id', id).eq('tenant_id', req.tenantId).maybeSingle()

    const { data: records, error } = await fastify.supabase
      .from('arrear_records')
      .select('*')
      .eq('tenant_id', req.tenantId)
      .eq('batch_id', id)
      .order('period_month', { ascending: true })
    if (error) return reply.code(500).send({ error: 'QUERY_FAILED', message: error.message })

    const empIds = [...new Set((records ?? []).map((r: any) => r.employee_id))]
    const { data: emps } = empIds.length
      ? await fastify.supabase.from('employees').select('id, first_name, last_name, employee_code')
          .eq('tenant_id', req.tenantId).in('id', empIds)
      : { data: [] as any[] }
    const em = new Map((emps ?? []).map((e: any) => [e.id, e]))

    const data = (records ?? []).map((r: any) => {
      const e = em.get(r.employee_id)
      return {
        ...r,
        period_months: 1,
        payout_month:  (batch as any)?.payout_month ?? null,
        status:        (batch as any)?.status ?? 'draft',
        employee_name: e ? `${e.first_name ?? ''} ${e.last_name ?? ''}`.trim() : undefined,
        employee_code: e?.employee_code,
      }
    })
    return reply.send({ data })
  })

  // ── POST /payroll/arrears/batches/:id/calculate ───────────────────────────────
  // Auto-generate arrear records from retroactive compensation revisions whose
  // effective_date falls in the batch's [from_period, to_period] window.
  // NOTE: covers comp-revision-driven arrears (the common case). Confirm this
  // matches your arrears policy before relying on it for disbursed payroll.
  fastify.post('/batches/:id/calculate', { preHandler: [fastify.authenticate, requireHrAdmin] }, async (req: any, reply) => {
    const { id } = req.params as { id: string }

    const { data: batch } = await fastify.supabase
      .from('arrear_batches')
      .select('id, from_period, to_period, status')
      .eq('id', id).eq('tenant_id', req.tenantId).maybeSingle()
    if (!batch) return reply.code(404).send({ error: 'NOT_FOUND', message: 'Batch not found' })
    if ((batch as any).status === 'approved' || (batch as any).status === 'processed') {
      return reply.code(409).send({ error: 'LOCKED', message: 'Batch already approved/processed' })
    }

    const from = `${(batch as any).from_period}-01`
    const to   = `${(batch as any).to_period}-31`
    const { data: revs, error: revErr } = await fastify.supabase
      .from('compensation_revisions')
      .select('employee_id, before_ctc_monthly, new_ctc_monthly, effective_date, retro_months')
      .eq('tenant_id', req.tenantId)
      .gte('effective_date', from)
      .lte('effective_date', to)
    if (revErr) return reply.code(500).send({ error: 'QUERY_FAILED', message: revErr.message })

    const records = (revs ?? [])
      .filter((r: any) => (r.new_ctc_monthly ?? 0) !== (r.before_ctc_monthly ?? 0))
      .map((r: any) => {
        const months = Math.max(1, r.retro_months ?? 1)
        const monthlyDelta = (r.new_ctc_monthly ?? 0) - (r.before_ctc_monthly ?? 0)
        return {
          batch_id:          id,
          tenant_id:         req.tenantId,
          employee_id:       r.employee_id,
          period_month:      (batch as any).from_period,
          component_code:    'CTC',
          component_name:    'Monthly CTC',
          old_amount:        r.before_ctc_monthly ?? 0,
          new_amount:        r.new_ctc_monthly ?? 0,
          arrear_amount:     Math.round(monthlyDelta * months * 100) / 100,
          is_taxable:        true,
          calculation_notes: `Auto: retroactive comp revision × ${months} month(s)`,
        }
      })

    // Recompute: clear prior records for the batch, insert fresh
    await fastify.supabase.from('arrear_records').delete().eq('tenant_id', req.tenantId).eq('batch_id', id)
    if (records.length) {
      const { error: insErr } = await fastify.supabase.from('arrear_records').insert(records)
      if (insErr) return reply.code(500).send({ error: 'INSERT_FAILED', message: insErr.message })
    }

    const total = records.reduce((s, r) => s + Math.abs(r.arrear_amount), 0)
    await fastify.supabase.from('arrear_batches').update({
      status:              'calculated',
      employee_count:      new Set(records.map(r => r.employee_id)).size,
      total_arrear_amount: Math.round(total * 100) / 100,
      updated_at:          new Date().toISOString(),
    }).eq('id', id).eq('tenant_id', req.tenantId)

    return reply.send({ data: { batch_id: id, records_created: records.length, total_arrear_amount: Math.round(total * 100) / 100 } })
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
