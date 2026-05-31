/**
 * Compensation Revisions Routes
 * Salary revision lifecycle with approval and snapshots.
 */

import type { FastifyInstance } from 'fastify'
import { z } from 'zod'

export default async function compensationRevisionsRoutes(fastify: FastifyInstance) {
  const auth = { preHandler: [fastify.authenticate] }

  function requireHrAdmin(req: any, reply: any, done: () => void) {
    if (!['super_admin', 'hr_admin'].includes(req.userRole)) {
      reply.code(403).send({ error: 'FORBIDDEN', message: 'HR admin access required' })
      return
    }
    done()
  }

  // ── GET /payroll/revisions ────────────────────────────────────────────────────
  fastify.get('/', auth, async (req: any, reply) => {
    const querySchema = z.object({
      employee_id: z.string().uuid().optional(),
      status: z.string().optional(),
      from_date: z.string().optional(),
      to_date: z.string().optional(),
    })

    const parsed = querySchema.safeParse(req.query)
    if (!parsed.success) {
      return reply.code(400).send({ error: 'VALIDATION_ERROR', message: parsed.error.issues[0]?.message })
    }

    let q = fastify.supabase
      .from('compensation_revisions')
      .select('*, employees(id, first_name, last_name, employee_code)')
      .eq('tenant_id', req.tenantId)
      .order('effective_from', { ascending: false })

    if (parsed.data.employee_id) q = q.eq('employee_id', parsed.data.employee_id)
    if (parsed.data.status) q = q.eq('status', parsed.data.status)
    if (parsed.data.from_date) q = q.gte('effective_from', parsed.data.from_date)
    if (parsed.data.to_date) q = q.lte('effective_from', parsed.data.to_date)

    const { data, error } = await q
    if (error) return reply.code(500).send({ error: 'QUERY_FAILED', message: error.message })
    return reply.send({ data: data ?? [] })
  })

  // ── GET /payroll/revisions/:id ────────────────────────────────────────────────
  fastify.get('/:id', auth, async (req: any, reply) => {
    const { id } = req.params as { id: string }

    const { data, error } = await fastify.supabase
      .from('compensation_revisions')
      .select('*, employees(id, first_name, last_name, employee_code)')
      .eq('id', id)
      .eq('tenant_id', req.tenantId)
      .single()

    if (error || !data) return reply.code(404).send({ error: 'NOT_FOUND', message: 'Revision not found' })
    return reply.send({ data })
  })

  // ── POST /payroll/revisions ───────────────────────────────────────────────────
  fastify.post('/', { preHandler: [fastify.authenticate, requireHrAdmin] }, async (req: any, reply) => {
    const schema = z.object({
      employee_id: z.string().uuid(),
      revision_type: z.string(),
      revision_reason: z.string().min(1),
      effective_from: z.string(),
      revised_ctc_annual: z.number().positive(),
      previous_ctc_annual: z.number().optional(),
      is_retro: z.boolean().default(false),
      payroll_impact_month: z.string().optional(),
      metadata: z.record(z.unknown()).optional(),
    })

    const parsed = schema.safeParse(req.body)
    if (!parsed.success) {
      return reply.code(400).send({ error: 'VALIDATION_ERROR', message: parsed.error.issues[0]?.message })
    }

    const { data, error } = await fastify.supabase
      .from('compensation_revisions')
      .insert({
        ...parsed.data,
        tenant_id: req.tenantId,
        status: 'draft',
        created_by: req.userId,
      })
      .select()
      .single()

    if (error) return reply.code(500).send({ error: 'INSERT_FAILED', message: error.message })
    return reply.code(201).send({ data })
  })

  // ── POST /payroll/revisions/:id/approve ──────────────────────────────────────
  fastify.post('/:id/approve', { preHandler: [fastify.authenticate, requireHrAdmin] }, async (req: any, reply) => {
    const { id } = req.params as { id: string }

    const { data: revision, error: fetchErr } = await fastify.supabase
      .from('compensation_revisions')
      .select('*')
      .eq('id', id)
      .eq('tenant_id', req.tenantId)
      .single()

    if (fetchErr || !revision) {
      return reply.code(404).send({ error: 'NOT_FOUND', message: 'Revision not found' })
    }

    const rev = revision as any
    if (!['draft', 'pending_approval'].includes(rev.status)) {
      return reply.code(409).send({ error: 'INVALID_STATUS', message: `Cannot approve revision with status '${rev.status}'` })
    }

    const now = new Date().toISOString()

    // Update status to approved
    const { error: updateErr } = await fastify.supabase
      .from('compensation_revisions')
      .update({
        status: 'approved',
        approved_by: req.userId,
        approved_at: now,
        updated_at: now,
      })
      .eq('id', id)
      .eq('tenant_id', req.tenantId)

    if (updateErr) return reply.code(500).send({ error: 'UPDATE_FAILED', message: updateErr.message })

    // Create compensation snapshots
    const grossMonthly = rev.revised_ctc_annual / 12
    const netMonthly = grossMonthly * 0.85

    const previousCtcAnnual = rev.previous_ctc_annual ?? 0
    const prevGrossMonthly = previousCtcAnnual / 12
    const prevNetMonthly = prevGrossMonthly * 0.85

    const snapshots = [
      {
        tenant_id: req.tenantId,
        employee_id: rev.employee_id,
        revision_id: id,
        snapshot_type: 'revision_before',
        snapshot_date: now,
        gross_salary: Math.round(prevGrossMonthly * 100) / 100,
        net_salary: Math.round(prevNetMonthly * 100) / 100,
        ctc_annual: previousCtcAnnual,
        created_by: req.userId,
      },
      {
        tenant_id: req.tenantId,
        employee_id: rev.employee_id,
        revision_id: id,
        snapshot_type: 'revision_after',
        snapshot_date: now,
        gross_salary: Math.round(grossMonthly * 100) / 100,
        net_salary: Math.round(netMonthly * 100) / 100,
        ctc_annual: rev.revised_ctc_annual,
        created_by: req.userId,
      },
    ]

    const { error: snapErr } = await fastify.supabase
      .from('compensation_snapshots')
      .insert(snapshots)

    if (snapErr) {
      req.log.warn({ err: snapErr }, 'Failed to create compensation snapshots')
    }

    return reply.send({ message: 'Revision approved', revision_id: id })
  })

  // ── POST /payroll/revisions/:id/reject ───────────────────────────────────────
  fastify.post('/:id/reject', { preHandler: [fastify.authenticate, requireHrAdmin] }, async (req: any, reply) => {
    const { id } = req.params as { id: string }

    const schema = z.object({
      rejection_reason: z.string().min(1),
    })

    const parsed = schema.safeParse(req.body)
    if (!parsed.success) {
      return reply.code(400).send({ error: 'VALIDATION_ERROR', message: parsed.error.issues[0]?.message })
    }

    const { error } = await fastify.supabase
      .from('compensation_revisions')
      .update({
        status: 'rejected',
        rejected_reason: parsed.data.rejection_reason,
        updated_at: new Date().toISOString(),
      })
      .eq('id', id)
      .eq('tenant_id', req.tenantId)

    if (error) return reply.code(500).send({ error: 'UPDATE_FAILED', message: error.message })
    return reply.send({ message: 'Revision rejected' })
  })

  // ── GET /payroll/revisions/employee/:employeeId ───────────────────────────────
  fastify.get('/employee/:employeeId', auth, async (req: any, reply) => {
    const { employeeId } = req.params as { employeeId: string }

    const { data, error } = await fastify.supabase
      .from('compensation_revisions')
      .select('*, employees(id, first_name, last_name, employee_code)')
      .eq('employee_id', employeeId)
      .eq('tenant_id', req.tenantId)
      .order('effective_from', { ascending: false })

    if (error) return reply.code(500).send({ error: 'QUERY_FAILED', message: error.message })
    return reply.send({ data: data ?? [] })
  })

  // ── GET /payroll/revisions/snapshots/:employeeId ──────────────────────────────
  fastify.get('/snapshots/:employeeId', auth, async (req: any, reply) => {
    const { employeeId } = req.params as { employeeId: string }

    const { data, error } = await fastify.supabase
      .from('compensation_snapshots')
      .select('*')
      .eq('employee_id', employeeId)
      .eq('tenant_id', req.tenantId)
      .order('snapshot_date', { ascending: false })

    if (error) return reply.code(500).send({ error: 'QUERY_FAILED', message: error.message })
    return reply.send({ data: data ?? [] })
  })
}
