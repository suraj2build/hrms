/**
 * Arrears Routes
 * Arrear batch management with bulk record insertion.
 */

import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { HR_ADMIN_ROLES } from '../../lib/rbac.js'
import { fetchAllRows } from '../../lib/supabase-paginate.js'
import { serverError, ErrorCode } from '../../lib/api-errors.js'

const ARREAR_TYPES = ['salary_revision', 'bonus_revision', 'component_change', 'correction', 'other'] as const

export default async function arrearsRoutes(fastify: FastifyInstance) {
  const auth = { preHandler: [fastify.authenticate] }

  function requireHrAdmin(req: any, reply: any, done: () => void) {
    if (!(HR_ADMIN_ROLES as readonly string[]).includes(req.userRole)) {
      reply.code(403).send({ error: 'FORBIDDEN', message: 'HR admin access required' })
      return
    }
    done()
  }

  // ── GET /payroll/arrears/batches ──────────────────────────────────────────────
  fastify.get('/batches', { preHandler: [fastify.authenticate, requireHrAdmin] }, async (req: any, reply) => {
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
      .order('created_at', { ascending: false }).limit(200)

    if (parsed.data.status) q = q.eq('status', parsed.data.status)
    if (parsed.data.from_period) q = q.gte('from_period', parsed.data.from_period)

    const { data, error } = await q
    if (error) return serverError(req, reply, error, ErrorCode.QUERY_FAILED, 'Failed to fetch arrear batches')
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

    if (error) return serverError(req, reply, error, ErrorCode.INSERT_FAILED, 'Failed to create arrear batch')
    return reply.code(201).send({ data })
  })

  // ── GET /payroll/arrears/batches/:id ─────────────────────────────────────────
  fastify.get('/batches/:id', { preHandler: [fastify.authenticate, requireHrAdmin] }, async (req: any, reply) => {
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

    // batch_id comes from the URL param and is written onto every inserted
    // record with no prior ownership check — verify it belongs to this
    // tenant (and isn't already approved/processed) before writing, matching
    // the guard the sibling /calculate endpoint already has.
    const { data: batch, error: batchErr } = await fastify.supabase
      .from('arrear_batches')
      .select('id, status')
      .eq('id', id).eq('tenant_id', req.tenantId).maybeSingle()
    if (batchErr) return serverError(req, reply, batchErr, ErrorCode.QUERY_FAILED, 'Failed to verify arrear batch')
    if (!batch) return reply.code(404).send({ error: 'NOT_FOUND', message: 'Batch not found' })
    if ((batch as any).status === 'approved' || (batch as any).status === 'processed') {
      return reply.code(409).send({ error: 'LOCKED', message: 'Batch already approved/processed' })
    }

    // Each record's employee_id is caller-supplied — fastify.supabase is a
    // service-role client that bypasses RLS, and employees(id) has no
    // tenant-compound FK, so verify every id belongs to this tenant before
    // writing (mirrors the batch_id check above).
    const recordEmployeeIds = [...new Set(parsed.data.records.map(r => r.employee_id))]
    const { data: empRows, error: empErr } = await fastify.supabase
      .from('employees')
      .select('id')
      .eq('tenant_id', req.tenantId)
      .in('id', recordEmployeeIds)
    if (empErr) return serverError(req, reply, empErr, ErrorCode.QUERY_FAILED, 'Failed to verify employees')
    const validEmployeeIds = new Set((empRows ?? []).map((e: any) => e.id))
    const invalidEmployeeId = recordEmployeeIds.find(eid => !validEmployeeIds.has(eid))
    if (invalidEmployeeId) {
      return reply.code(400).send({ error: 'VALIDATION_ERROR', message: `employee_id ${invalidEmployeeId} not found in your organisation` })
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

    if (insertErr) return serverError(req, reply, insertErr, ErrorCode.INSERT_FAILED, 'Failed to create arrear records')

    // Recompute batch totals from the full record set — this endpoint only
    // inserts (doesn't clear-and-replace), so a second call for the same
    // batch must accumulate, not overwrite with just this call's subset.
    let allRecords: Array<{ employee_id: string; arrear_amount: number }>
    try {
      allRecords = await fetchAllRows((from, to) =>
        fastify.supabase
          .from('arrear_records')
          .select('employee_id, arrear_amount')
          .eq('batch_id', id)
          .eq('tenant_id', req.tenantId)
          .range(from, to),
      )
    } catch (err) {
      return serverError(req, reply, err, ErrorCode.QUERY_FAILED, 'Failed to recompute batch totals')
    }
    const totalArrear = allRecords.reduce((sum, r) => sum + Math.abs(r.arrear_amount), 0)
    const distinctEmployeeIds = new Set(allRecords.map(r => r.employee_id))

    const { error: updateErr } = await fastify.supabase
      .from('arrear_batches')
      .update({
        total_arrear_amount: Math.round(totalArrear * 100) / 100,
        employee_count: distinctEmployeeIds.size,
        status: 'calculated',
        updated_at: new Date().toISOString(),
      })
      .eq('id', id)
      .eq('tenant_id', req.tenantId)
    if (updateErr) return serverError(req, reply, updateErr, ErrorCode.UPDATE_FAILED, 'Records saved, but failed to update batch totals')

    return reply.code(201).send({ data: insertedRecords, records_inserted: recordRows.length })
  })

  // ── GET /payroll/arrears/batches/:id/records ──────────────────────────────────
  // Fetch the calculated arrear records for a batch (+ employee name/code).
  fastify.get('/batches/:id/records', { preHandler: [fastify.authenticate, requireHrAdmin] }, async (req: any, reply) => {
    const { id } = req.params as { id: string }

    const { data: batch } = await fastify.supabase
      .from('arrear_batches')
      .select('payout_month, status')
      .eq('id', id).eq('tenant_id', req.tenantId).maybeSingle()

    let records: any[]
    try {
      records = await fetchAllRows((from, to) =>
        fastify.supabase
          .from('arrear_records')
          .select('*')
          .eq('tenant_id', req.tenantId)
          .eq('batch_id', id)
          .order('period_month', { ascending: true })
          .range(from, to),
      )
    } catch (err: any) {
      return serverError(req, reply, err, ErrorCode.QUERY_FAILED, 'Failed to fetch arrear records')
    }

    const empIds = [...new Set(records.map((r: any) => r.employee_id))]
    const { data: emps } = empIds.length
      ? await fastify.supabase.from('employees').select('id, first_name, last_name, employee_code')
          .eq('tenant_id', req.tenantId).in('id', empIds)
      : { data: [] as any[] }
    const em = new Map((emps ?? []).map((e: any) => [e.id, e]))

    const data = records.map((r: any) => {
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

    // Fresh audit finding: `${to_period}-31` produces an invalid date literal
    // (e.g. "2026-02-31") for any month with fewer than 31 days — Feb, Apr,
    // Jun, Sep, Nov — causing this query to fail outright for 5 of 12
    // possible to_period months. Compute the month's real last day instead.
    const from = `${(batch as any).from_period}-01`
    const [toYear, toMonth] = (batch as any).to_period.split('-').map(Number)
    const toLastDay = new Date(toYear, toMonth, 0).getDate()
    const to = `${(batch as any).to_period}-${String(toLastDay).padStart(2, '0')}`
    const { data: revs, error: revErr } = await fastify.supabase
      .from('compensation_revisions')
      .select('employee_id, before_ctc_monthly, new_ctc_annual, effective_date, retro_months')
      .eq('tenant_id', req.tenantId)
      .gte('effective_date', from)
      .lte('effective_date', to)
    if (revErr) return serverError(req, reply, revErr, ErrorCode.QUERY_FAILED, 'Failed to fetch compensation revisions')

    // compensation_revisions stores the new CTC annually (new_ctc_annual); the
    // monthly figure is derived as /12. before_ctc_monthly is stored directly.
    const records = (revs ?? [])
      .map((r: any) => {
        const beforeMonthly = r.before_ctc_monthly ?? 0
        const newMonthly    = Math.round(((r.new_ctc_annual ?? 0) / 12) * 100) / 100
        const months        = Math.max(1, r.retro_months ?? 1)
        const monthlyDelta  = newMonthly - beforeMonthly
        return {
          batch_id:          id,
          tenant_id:         req.tenantId,
          employee_id:       r.employee_id,
          period_month:      (batch as any).from_period,
          component_code:    'CTC',
          component_name:    'Monthly CTC',
          old_amount:        beforeMonthly,
          new_amount:        newMonthly,
          arrear_amount:     Math.round(monthlyDelta * months * 100) / 100,
          is_taxable:        true,
          calculation_notes: `Auto: retroactive comp revision × ${months} month(s)`,
        }
      })
      .filter((rec: any) => rec.new_amount !== rec.old_amount)

    // Recompute: clear prior records for the batch, insert fresh
    const { error: delErr } = await fastify.supabase.from('arrear_records').delete().eq('tenant_id', req.tenantId).eq('batch_id', id)
    if (delErr) return serverError(req, reply, delErr, ErrorCode.DELETE_FAILED, 'Failed to clear prior arrear records before recompute')
    if (records.length) {
      const { error: insErr } = await fastify.supabase.from('arrear_records').insert(records)
      if (insErr) return serverError(req, reply, insErr, ErrorCode.INSERT_FAILED, 'Failed to create arrear records')
    }

    const total = records.reduce((s, r) => s + Math.abs(r.arrear_amount), 0)
    const { error: statusErr } = await fastify.supabase.from('arrear_batches').update({
      status:              'calculated',
      employee_count:      new Set(records.map(r => r.employee_id)).size,
      total_arrear_amount: Math.round(total * 100) / 100,
      updated_at:          new Date().toISOString(),
    }).eq('id', id).eq('tenant_id', req.tenantId)
    if (statusErr) return serverError(req, reply, statusErr, ErrorCode.UPDATE_FAILED, 'Arrear records were recalculated, but failed to update batch status')

    return reply.send({ data: { batch_id: id, records_created: records.length, total_arrear_amount: Math.round(total * 100) / 100 } })
  })

  // ── POST /payroll/arrears/batches/:id/approve ─────────────────────────────────
  // Fresh audit finding: this endpoint had no status precondition at all —
  // unlike the rest of this codebase's universal TOCTOU-guard pattern — and
  // unconditionally set status='approved' regardless of current state.
  fastify.post('/batches/:id/approve', { preHandler: [fastify.authenticate, requireHrAdmin] }, async (req: any, reply) => {
    const { id } = req.params as { id: string }
    const now = new Date().toISOString()

    const { data, error } = await fastify.supabase
      .from('arrear_batches')
      .update({
        status: 'approved',
        approved_by: req.userId,
        approved_at: now,
        updated_at: now,
      })
      .eq('id', id)
      .eq('tenant_id', req.tenantId)
      .eq('status', 'calculated')
      .select('id')
      .maybeSingle()

    if (error) return serverError(req, reply, error, ErrorCode.UPDATE_FAILED, 'Failed to approve arrear batch')
    if (!data) return reply.code(409).send({ error: 'INVALID_STATUS', message: 'Only calculated batches can be approved' })
    return reply.send({ message: 'Arrear batch approved' })
  })

  // ── POST /payroll/arrears/batches/:id/cancel ──────────────────────────────────
  // Fresh audit finding: same missing-precondition issue — this let an
  // already-processed batch be reset to 'cancelled' after arrears were paid.
  fastify.post('/batches/:id/cancel', { preHandler: [fastify.authenticate, requireHrAdmin] }, async (req: any, reply) => {
    const { id } = req.params as { id: string }

    const { data, error } = await fastify.supabase
      .from('arrear_batches')
      .update({ status: 'cancelled', updated_at: new Date().toISOString() })
      .eq('id', id)
      .eq('tenant_id', req.tenantId)
      .in('status', ['draft', 'calculated', 'approved'])
      .select('id')
      .maybeSingle()

    if (error) return serverError(req, reply, error, ErrorCode.UPDATE_FAILED, 'Failed to cancel arrear batch')
    if (!data) return reply.code(409).send({ error: 'INVALID_STATUS', message: 'Processed or already-cancelled batches cannot be cancelled' })
    return reply.send({ message: 'Arrear batch cancelled' })
  })

  // ── GET /payroll/arrears/employee/:employeeId ─────────────────────────────────
  fastify.get('/employee/:employeeId', { preHandler: [fastify.authenticate, requireHrAdmin] }, async (req: any, reply) => {
    const { employeeId } = req.params as { employeeId: string }

    const { data, error } = await fastify.supabase
      .from('arrear_records')
      .select('*, arrear_batches(id, batch_name, arrear_type, status, from_period, to_period, payout_month)')
      .eq('employee_id', employeeId)
      .eq('tenant_id', req.tenantId)
      .order('period_month', { ascending: false }).limit(200)

    if (error) return serverError(req, reply, error, ErrorCode.QUERY_FAILED, 'Failed to fetch employee arrears')
    return reply.send({ data: data ?? [] })
  })
}
