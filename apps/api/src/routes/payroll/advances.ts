/**
 * Salary Advance Routes
 * Advance requests, approvals, disbursement, and recovery schedules.
 */

import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { logAction } from '../../lib/audit-service.js'
import { gateApprove, gateReject } from '../../lib/approval-orchestrator.js'

const RECOVERY_TYPES = ['payroll_deduction', 'manual_payment', 'adjustment'] as const

export default async function advancesRoutes(fastify: FastifyInstance) {
  const auth = { preHandler: [fastify.authenticate] }
  const isHr = (role: string) => ['super_admin', 'hr_admin'].includes(role)

  function requireHrAdmin(req: any, reply: any, done: () => void) {
    if (!isHr(req.userRole)) {
      reply.code(403).send({ error: 'FORBIDDEN', message: 'HR admin access required' })
      return
    }
    done()
  }

  // ── GET /payroll/advances ─────────────────────────────────────────────────────
  fastify.get('/', auth, async (req: any, reply) => {
    const querySchema = z.object({
      employee_id: z.string().uuid().optional(),
      status: z.string().optional(),
    })

    const parsed = querySchema.safeParse(req.query)
    if (!parsed.success) {
      return reply.code(400).send({ error: 'VALIDATION_ERROR', message: parsed.error.issues[0]?.message })
    }

    const isHrAdmin = ['super_admin', 'hr_admin'].includes(req.userRole)

    // Non-admins (employees, managers) may only see their own advances.
    // Any supplied employee_id is ignored and replaced with the caller's own.
    if (!isHrAdmin) {
      const { data: profile } = await fastify.supabase
        .from('profiles')
        .select('employee_id')
        .eq('id', req.userId)
        .eq('tenant_id', req.tenantId)
        .maybeSingle()

      const callerEmpId = (profile as any)?.employee_id
      if (!callerEmpId) {
        return reply.code(403).send({ error: 'FORBIDDEN', message: 'Profile not linked to an employee record' })
      }
      parsed.data.employee_id = callerEmpId
    }

    let q = fastify.supabase
      .from('advance_salary_requests')
      .select('*, employees(id, first_name, last_name, employee_code)')
      .eq('tenant_id', req.tenantId)
      .order('created_at', { ascending: false })

    if (parsed.data.employee_id) q = q.eq('employee_id', parsed.data.employee_id)
    if (parsed.data.status) q = q.eq('status', parsed.data.status)

    const { data, error } = await q
    if (error) return reply.code(500).send({ error: 'QUERY_FAILED', message: error.message })
    return reply.send({ data: data ?? [] })
  })

  // ── POST /payroll/advances ────────────────────────────────────────────────────
  fastify.post('/', auth, async (req: any, reply) => {
    const schema = z.object({
      employee_id: z.string().uuid(),
      requested_amount: z.number().positive(),
      purpose: z.string().min(1),
      recovery_months: z.number().int().min(1).max(12),
    })

    const parsed = schema.safeParse(req.body)
    if (!parsed.success) {
      return reply.code(400).send({ error: 'VALIDATION_ERROR', message: parsed.error.issues[0]?.message })
    }

    // Self-scoping: non-admins may only raise an advance for themselves.
    if (!['super_admin', 'hr_admin'].includes(req.userRole)) {
      const { data: profile } = await fastify.supabase
        .from('profiles')
        .select('employee_id')
        .eq('id', req.userId)
        .eq('tenant_id', req.tenantId)
        .single()
      if (profile?.employee_id !== parsed.data.employee_id) {
        return reply.code(403).send({ error: 'FORBIDDEN', message: 'You can only request an advance for yourself' })
      }
    }

    const { data, error } = await fastify.supabase
      .from('advance_salary_requests')
      .insert({
        ...parsed.data,
        tenant_id: req.tenantId,
        status: 'pending',
        created_by: req.userId,
        requested_date: new Date().toISOString().slice(0, 10),
      })
      .select()
      .single()

    if (error) return reply.code(500).send({ error: 'INSERT_FAILED', message: error.message })

    await logAction(fastify.supabase, {
      tenantId:    req.tenantId,
      tableName:   'advance_salary_requests',
      recordId:    (data as any).id,
      action:      'INSERT',
      performedBy: req.userId,
      onBehalfOf:  parsed.data.employee_id,
      newData:     { ...parsed.data, status: 'pending' },
    })

    return reply.code(201).send({ data })
  })

  // ── POST /payroll/advances/:id/approve ───────────────────────────────────────
  // Gate-driven auth: no advance chain => HR-only (legacy); with a chain, per-level.
  fastify.post('/:id/approve', auth, async (req: any, reply) => {
    const { id } = req.params as { id: string }

    const schema = z.object({
      approved_amount: z.number().positive(),
    })

    const parsed = schema.safeParse(req.body)
    if (!parsed.success) {
      return reply.code(400).send({ error: 'VALIDATION_ERROR', message: parsed.error.issues[0]?.message })
    }

    // Fetch advance
    const { data: advance, error: fetchErr } = await fastify.supabase
      .from('advance_salary_requests')
      .select('*')
      .eq('id', id)
      .eq('tenant_id', req.tenantId)
      .single()

    if (fetchErr || !advance) return reply.code(404).send({ error: 'NOT_FOUND', message: 'Advance not found' })

    const adv = advance as any
    // Approvable from a direct pending request OR an ESS request a manager has
    // already approved (pending_hr). The recovery schedule is created on
    // DISBURSE — never here — so an approved-but-undisbursed advance never
    // surfaces as a deduction.
    if (adv.status !== 'pending' && adv.status !== 'pending_hr') {
      return reply.code(409).send({ error: 'INVALID_STATE', message: `Advance is already ${adv.status}` })
    }

    // Multi-level gate (threshold routing by requested amount).
    const gate = await gateApprove(fastify.supabase, {
      tenantId: req.tenantId, entityType: 'advance_salary', entityId: id,
      actorId: req.userId, actorRole: req.userRole,
      targetEmployeeId: adv.employee_id,
      amount: Number(adv.requested_amount),
    })
    if (gate.kind === 'error') {
      const code = gate.error.type === 'FORBIDDEN' ? 403 : gate.error.type === 'CONFLICT' ? 409 : 400
      return reply.code(code).send({ error: gate.error.type, message: gate.error.message })
    }
    if (gate.kind === 'advanced') {
      return reply.send({ message: 'Approval recorded', advance_id: id, advanced_to_level: gate.nextLevel, total_levels: gate.totalLevels })
    }
    if (!gate.authorized && !isHr(req.userRole)) {
      return reply.code(403).send({ error: 'FORBIDDEN', message: 'HR admin access required' })
    }

    const now = new Date().toISOString()

    const { error: updateErr } = await fastify.supabase
      .from('advance_salary_requests')
      .update({
        status: 'approved',
        approved_amount: parsed.data.approved_amount,
        approved_by: req.userId,
        approved_at: now,
        updated_at: now,
      })
      .eq('id', id)
      .eq('tenant_id', req.tenantId)
      .in('status', ['pending', 'pending_hr'])

    if (updateErr) return reply.code(500).send({ error: 'UPDATE_FAILED', message: updateErr.message })

    await logAction(fastify.supabase, {
      tenantId:    req.tenantId,
      tableName:   'advance_salary_requests',
      recordId:    id,
      action:      'UPDATE',
      performedBy: req.userId,
      onBehalfOf:  adv.employee_id ?? null,
      newData:     { status: 'approved', approved_amount: parsed.data.approved_amount },
    })

    return reply.send({ message: 'Advance approved', advance_id: id })
  })

  // ── POST /payroll/advances/:id/reject ────────────────────────────────────────
  fastify.post('/:id/reject', auth, async (req: any, reply) => {
    const { id } = req.params as { id: string }

    const schema = z.object({
      rejection_reason: z.string().min(1),
    })

    const parsed = schema.safeParse(req.body)
    if (!parsed.success) {
      return reply.code(400).send({ error: 'VALIDATION_ERROR', message: parsed.error.issues[0]?.message })
    }

    const { data: adv } = await fastify.supabase
      .from('advance_salary_requests')
      .select('id, status, employee_id, requested_amount')
      .eq('id', id).eq('tenant_id', req.tenantId).maybeSingle()
    if (!adv) return reply.code(404).send({ error: 'NOT_FOUND', message: 'Advance not found' })
    if ((adv as any).status !== 'pending') {
      return reply.code(409).send({ error: 'INVALID_STATE', message: 'Advance not found or not in a pending state' })
    }

    // Gate-driven auth; no chain => HR-only (legacy).
    const gate = await gateReject(fastify.supabase, {
      tenantId: req.tenantId, entityType: 'advance_salary', entityId: id,
      actorId: req.userId, actorRole: req.userRole,
      targetEmployeeId: (adv as any).employee_id,
      amount: Number((adv as any).requested_amount ?? 0),
      comments: parsed.data.rejection_reason,
    })
    if (gate.kind === 'error') {
      const code = gate.error.type === 'FORBIDDEN' ? 403 : gate.error.type === 'CONFLICT' ? 409 : 400
      return reply.code(code).send({ error: gate.error.type, message: gate.error.message })
    }
    if (gate.kind === 'finalize' && !gate.authorized && !isHr(req.userRole)) {
      return reply.code(403).send({ error: 'FORBIDDEN', message: 'HR admin access required' })
    }

    const { data: rejected, error } = await fastify.supabase
      .from('advance_salary_requests')
      .update({
        status: 'rejected',
        rejection_reason: parsed.data.rejection_reason,
        updated_at: new Date().toISOString(),
      })
      .eq('id', id)
      .eq('tenant_id', req.tenantId)
      .eq('status', 'pending')   // F7 — only a pending advance may be rejected
      .select('id')
      .maybeSingle()

    if (error) return reply.code(500).send({ error: 'UPDATE_FAILED', message: error.message })
    if (!rejected) return reply.code(409).send({ error: 'INVALID_STATE', message: 'Advance not found or not in a pending state' })

    await logAction(fastify.supabase, {
      tenantId:    req.tenantId,
      tableName:   'advance_salary_requests',
      recordId:    id,
      action:      'UPDATE',
      performedBy: req.userId,
      newData:     { status: 'rejected', rejection_reason: parsed.data.rejection_reason },
    })

    return reply.send({ message: 'Advance rejected' })
  })

  // ── POST /payroll/advances/:id/disburse ──────────────────────────────────────
  fastify.post('/:id/disburse', { preHandler: [fastify.authenticate, requireHrAdmin] }, async (req: any, reply) => {
    const { id } = req.params as { id: string }

    const schema = z.object({
      disbursed_date: z.string(),
      disbursed_amount: z.number().positive(),
    })

    const parsed = schema.safeParse(req.body)
    if (!parsed.success) {
      return reply.code(400).send({ error: 'VALIDATION_ERROR', message: parsed.error.issues[0]?.message })
    }

    const { data: disbursed, error } = await fastify.supabase
      .from('advance_salary_requests')
      .update({
        status: 'disbursed',
        disbursed_date: parsed.data.disbursed_date,
        disbursed_amount: parsed.data.disbursed_amount,
        updated_at: new Date().toISOString(),
      })
      .eq('id', id)
      .eq('tenant_id', req.tenantId)
      .eq('status', 'approved')   // F7 — only an approved advance may be disbursed
      .select('id, employee_id, recovery_months')
      .maybeSingle()

    if (error) return reply.code(500).send({ error: 'UPDATE_FAILED', message: error.message })
    if (!disbursed) return reply.code(409).send({ error: 'INVALID_STATE', message: 'Advance not found or not in an approved state' })

    // Generate the recovery schedule now, on disbursement — never at approval —
    // so deductions only ever exist for money that has actually been paid out.
    // Idempotent: the .eq('status','approved') guard above prevents re-disburse.
    const d0 = disbursed as any
    const recoveryMonths  = d0.recovery_months ?? 1
    const scheduledAmount = Math.round((parsed.data.disbursed_amount / recoveryMonths) * 100) / 100
    const schedules: any[] = []
    const startDate = new Date()
    startDate.setDate(1)                          // first of month
    startDate.setMonth(startDate.getMonth() + 1)  // recovery starts next month
    for (let i = 0; i < recoveryMonths; i++) {
      const dt = new Date(startDate)
      dt.setMonth(dt.getMonth() + i)
      schedules.push({
        tenant_id:       req.tenantId,
        advance_id:      id,
        employee_id:     d0.employee_id,
        recovery_month:  `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}`,
        scheduled_amount: scheduledAmount,
        status:          'pending',
      })
    }
    if (schedules.length > 0) {
      const { error: schedErr } = await fastify.supabase
        .from('advance_recovery_schedules')
        .insert(schedules)
      if (schedErr) req.log.warn({ err: schedErr }, 'Failed to create recovery schedules')
    }

    await logAction(fastify.supabase, {
      tenantId:    req.tenantId,
      tableName:   'advance_salary_requests',
      recordId:    id,
      action:      'UPDATE',
      performedBy: req.userId,
      newData:     { status: 'disbursed', disbursed_amount: parsed.data.disbursed_amount, disbursed_date: parsed.data.disbursed_date },
    })

    return reply.send({ message: 'Advance disbursed', schedules_created: schedules.length })
  })

  // ── GET /payroll/advances/:id/schedule ───────────────────────────────────────
  fastify.get('/:id/schedule', auth, async (req: any, reply) => {
    const { id } = req.params as { id: string }

    const { data, error } = await fastify.supabase
      .from('advance_recovery_schedules')
      .select('*')
      .eq('advance_id', id)
      .eq('tenant_id', req.tenantId)
      .order('recovery_month', { ascending: true })

    if (error) return reply.code(500).send({ error: 'QUERY_FAILED', message: error.message })
    return reply.send({ data: data ?? [] })
  })

  // ── POST /payroll/advances/:id/pause ─────────────────────────────────────────
  fastify.post('/:id/pause', { preHandler: [fastify.authenticate, requireHrAdmin] }, async (req: any, reply) => {
    const { id } = req.params as { id: string }

    const schema = z.object({
      pause_reason: z.string().min(1),
    })

    const parsed = schema.safeParse(req.body)
    if (!parsed.success) {
      return reply.code(400).send({ error: 'VALIDATION_ERROR', message: parsed.error.issues[0]?.message })
    }

    const { error } = await fastify.supabase
      .from('advance_salary_requests')
      .update({
        is_recovery_paused: true,
        pause_reason: parsed.data.pause_reason,
        updated_at: new Date().toISOString(),
      })
      .eq('id', id)
      .eq('tenant_id', req.tenantId)

    if (error) return reply.code(500).send({ error: 'UPDATE_FAILED', message: error.message })
    return reply.send({ message: 'Recovery paused' })
  })

  // ── POST /payroll/advances/:id/resume ────────────────────────────────────────
  fastify.post('/:id/resume', { preHandler: [fastify.authenticate, requireHrAdmin] }, async (req: any, reply) => {
    const { id } = req.params as { id: string }

    const { error } = await fastify.supabase
      .from('advance_salary_requests')
      .update({
        is_recovery_paused: false,
        pause_reason: null,
        updated_at: new Date().toISOString(),
      })
      .eq('id', id)
      .eq('tenant_id', req.tenantId)

    if (error) return reply.code(500).send({ error: 'UPDATE_FAILED', message: error.message })
    return reply.send({ message: 'Recovery resumed' })
  })

  // ── GET /payroll/advances/pending-recoveries/:month ──────────────────────────
  fastify.get('/pending-recoveries/:month', { preHandler: [fastify.authenticate, requireHrAdmin] }, async (req: any, reply) => {
    const { month } = req.params as { month: string }

    const [{ data: advances }, { data: schedules }] = await Promise.all([
      fastify.supabase
        .from('advance_salary_requests')
        .select('*, employees(id, first_name, last_name, employee_code)')
        .eq('tenant_id', req.tenantId)
        .in('status', ['disbursed', 'recovering'])
        .eq('is_recovery_paused', false),
      fastify.supabase
        .from('advance_recovery_schedules')
        .select('*')
        .eq('tenant_id', req.tenantId)
        .eq('recovery_month', month)
        .eq('status', 'pending'),
    ])

    const scheduleMap = new Map<string, any[]>()
    for (const sched of (schedules ?? []) as any[]) {
      const existing = scheduleMap.get(sched.advance_id) ?? []
      existing.push(sched)
      scheduleMap.set(sched.advance_id, existing)
    }

    const result = (advances ?? []).map((adv: any) => ({
      ...adv,
      pending_schedules: scheduleMap.get(adv.id) ?? [],
    }))

    return reply.send({ data: result, month })
  })

  // ── POST /payroll/advances/recover ───────────────────────────────────────────
  fastify.post('/recover', { preHandler: [fastify.authenticate, requireHrAdmin] }, async (req: any, reply) => {
    const schema = z.object({
      advance_id: z.string().uuid(),
      schedule_id: z.string().uuid().optional(),
      payroll_run_id: z.string().uuid().optional(),
      amount: z.number().positive(),
      notes: z.string().optional(),
      recovery_type: z.enum(RECOVERY_TYPES),
    })

    const parsed = schema.safeParse(req.body)
    if (!parsed.success) {
      return reply.code(400).send({ error: 'VALIDATION_ERROR', message: parsed.error.issues[0]?.message })
    }

    // Insert recovery record
    const { data: recovery, error: recoveryErr } = await fastify.supabase
      .from('advance_recoveries')
      .insert({
        ...parsed.data,
        tenant_id: req.tenantId,
        created_by: req.userId,
      })
      .select()
      .single()

    if (recoveryErr) return reply.code(500).send({ error: 'INSERT_FAILED', message: recoveryErr.message })

    // Update schedule status if provided
    if (parsed.data.schedule_id) {
      await fastify.supabase
        .from('advance_recovery_schedules')
        .update({ status: 'recovered' })
        .eq('id', parsed.data.schedule_id)
        .eq('tenant_id', req.tenantId)
    }

    // Check if all schedules recovered for this advance
    const { count: pendingCount } = await fastify.supabase
      .from('advance_recovery_schedules')
      .select('id', { count: 'exact', head: true })
      .eq('advance_id', parsed.data.advance_id)
      .eq('tenant_id', req.tenantId)
      .eq('status', 'pending')

    if ((pendingCount ?? 0) === 0) {
      await fastify.supabase
        .from('advance_salary_requests')
        .update({ status: 'fully_recovered', updated_at: new Date().toISOString() })
        .eq('id', parsed.data.advance_id)
        .eq('tenant_id', req.tenantId)
    } else {
      await fastify.supabase
        .from('advance_salary_requests')
        .update({ status: 'recovering', updated_at: new Date().toISOString() })
        .eq('id', parsed.data.advance_id)
        .eq('tenant_id', req.tenantId)
        .in('status', ['disbursed'])
    }

    return reply.code(201).send({ data: recovery })
  })
}
