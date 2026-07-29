/**
 * Salary Advance Routes
 * Advance requests, approvals, disbursement, and recovery schedules.
 */

import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { logAction } from '../../lib/audit-service.js'
import { gateApprove, gateReject } from '../../lib/approval-orchestrator.js'
import { HR_ADMIN_ROLES } from '../../lib/rbac.js'
import { checkIdempotency, storeIdempotency } from '../../lib/idempotency.js'
import { serverError, notFound, conflictError, ErrorCode } from '../../lib/api-errors.js'
import { fetchAllRows } from '../../lib/supabase-paginate.js'
import { fetchTenantTz } from '../../lib/attendance-engine.js'
import { getLocalDate } from '../../lib/org-context.js'

const RECOVERY_TYPES = ['payroll_deduction', 'manual_payment', 'adjustment'] as const

export default async function advancesRoutes(fastify: FastifyInstance) {
  const auth = { preHandler: [fastify.authenticate] }
  const isHr = (role: string) => (HR_ADMIN_ROLES as readonly string[]).includes(role)

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

    const isHrAdmin = (HR_ADMIN_ROLES as readonly string[]).includes(req.userRole)

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

    const data = await fetchAllRows((from, to) => {
      let q = fastify.supabase
        .from('advance_salary_requests')
        .select('*, employees(id, first_name, last_name, employee_code)')
        .eq('tenant_id', req.tenantId)
        .order('created_at', { ascending: false })

      if (parsed.data.employee_id) q = q.eq('employee_id', parsed.data.employee_id)
      if (parsed.data.status) q = q.eq('status', parsed.data.status)

      return q.range(from, to)
    })
    return reply.send({ data })
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
    if (!(HR_ADMIN_ROLES as readonly string[]).includes(req.userRole)) {
      const { data: profile } = await fastify.supabase
        .from('profiles')
        .select('employee_id')
        .eq('id', req.userId)
        .eq('tenant_id', req.tenantId)
        .single()
      if (profile?.employee_id !== parsed.data.employee_id) {
        return reply.code(403).send({ error: 'FORBIDDEN', message: 'You can only request an advance for yourself' })
      }
    } else {
      // HR-admin path skips the self-scoping check above, so employee_id is
      // otherwise never verified to belong to this tenant — fastify.supabase
      // is a service-role client that bypasses RLS, so without this an HR
      // admin could raise (and later see) an advance against another
      // tenant's employee.
      const { data: empRow, error: empErr } = await fastify.supabase
        .from('employees')
        .select('id')
        .eq('id', parsed.data.employee_id)
        .eq('tenant_id', req.tenantId)
        .maybeSingle()
      if (empErr) return serverError(req, reply, empErr, ErrorCode.QUERY_FAILED, 'Failed to verify employee')
      if (!empRow) return notFound(reply, 'EMPLOYEE_NOT_FOUND', 'Employee not found')
    }

    const tz = await fetchTenantTz(fastify.supabase, req.tenantId)

    const { data, error } = await fastify.supabase
      .from('advance_salary_requests')
      .insert({
        ...parsed.data,
        tenant_id: req.tenantId,
        status: 'pending',
        created_by: req.userId,
        requested_date: getLocalDate(new Date().toISOString(), tz),
      })
      .select()
      .single()

    if (error) return serverError(req, reply, error, ErrorCode.INSERT_FAILED, 'Failed to create advance request')

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

    if (updateErr) return serverError(req, reply, updateErr, ErrorCode.UPDATE_FAILED, 'Failed to approve advance')

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

    const { data: adv, error: advFetchErr } = await fastify.supabase
      .from('advance_salary_requests')
      .select('id, status, employee_id, requested_amount')
      .eq('id', id).eq('tenant_id', req.tenantId).maybeSingle()
    if (advFetchErr) return serverError(req, reply, advFetchErr, ErrorCode.QUERY_FAILED, 'Failed to fetch advance request')
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

    if (error) return serverError(req, reply, error, ErrorCode.UPDATE_FAILED, 'Failed to reject advance')
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

    // Idempotency: the .eq('status','approved') guard below already blocks a
    // genuine double-disburse (real money), but a network-retried request
    // would see the first call's success as a confusing "already disbursed"
    // 409 — replay the original response instead.
    const iKey = (req.headers['idempotency-key'] as string | undefined)?.trim()
    if (iKey) {
      const cached = await checkIdempotency(fastify.supabase, req.tenantId, iKey, 'advance-disburse')
      if (cached) {
        reply.header('Idempotency-Replayed', 'true')
        return reply.code(cached.status_code).send(cached.response)
      }
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

    if (error) return serverError(req, reply, error, ErrorCode.UPDATE_FAILED, 'Failed to disburse advance')
    if (!disbursed) return reply.code(409).send({ error: 'INVALID_STATE', message: 'Advance not found or not in an approved state' })

    // Generate the recovery schedule now, on disbursement — never at approval —
    // so deductions only ever exist for money that has actually been paid out.
    // Idempotent: the .eq('status','approved') guard above prevents re-disburse.
    const d0 = disbursed as any
    const recoveryMonths  = d0.recovery_months ?? 1
    const scheduledAmount = Math.round((parsed.data.disbursed_amount / recoveryMonths) * 100) / 100
    const schedules: any[] = []
    // Tenant-local "today" — a bare server clock can be a day (and near a
    // month boundary, a whole month) behind the tenant's own calendar,
    // silently starting the recovery schedule a month early/late.
    const tz = await fetchTenantTz(fastify.supabase, req.tenantId)
    const [ty, tmo] = getLocalDate(new Date().toISOString(), tz).slice(0, 7).split('-').map(Number)
    // True-up: recoveryMonths equal installments of the rounded per-month
    // amount don't necessarily sum back to disbursed_amount (e.g. 10,000 / 3
    // = 3,333.33 x 3 = 9,999.99, one paisa short) — the last installment
    // absorbs the residual so the schedule recovers the full amount.
    let recoveredSoFar = 0
    for (let i = 0; i < recoveryMonths; i++) {
      // Recovery starts next month (delta of 1) plus i additional months —
      // pure UTC arithmetic to avoid the local/UTC mixing bug this same
      // computation had before.
      const dt = new Date(Date.UTC(ty, tmo - 1 + 1 + i, 1))
      const isLast = i === recoveryMonths - 1
      const amount = isLast
        ? Math.round((parsed.data.disbursed_amount - recoveredSoFar) * 100) / 100
        : scheduledAmount
      recoveredSoFar += amount
      schedules.push({
        tenant_id:       req.tenantId,
        advance_id:      id,
        employee_id:     d0.employee_id,
        recovery_month:  `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, '0')}`,
        scheduled_amount: amount,
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

    const responseBody = { message: 'Advance disbursed', schedules_created: schedules.length }
    if (iKey) await storeIdempotency(fastify.supabase, req.tenantId, iKey, 'advance-disburse', 200, responseBody)
    return reply.send(responseBody)
  })

  // ── GET /payroll/advances/:id/schedule ───────────────────────────────────────
  fastify.get('/:id/schedule', { preHandler: [fastify.authenticate, requireHrAdmin] }, async (req: any, reply) => {
    const { id } = req.params as { id: string }

    const { data, error } = await fastify.supabase
      .from('advance_recovery_schedules')
      .select('*')
      .eq('advance_id', id)
      .eq('tenant_id', req.tenantId)
      .order('recovery_month', { ascending: true }).limit(100)

    if (error) return serverError(req, reply, error, ErrorCode.QUERY_FAILED, 'Failed to fetch advance recovery schedule')
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

    if (error) return serverError(req, reply, error, ErrorCode.UPDATE_FAILED, 'Failed to pause advance recovery')
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

    if (error) return serverError(req, reply, error, ErrorCode.UPDATE_FAILED, 'Failed to resume advance recovery')
    return reply.send({ message: 'Recovery resumed' })
  })

  // ── GET /payroll/advances/pending-recoveries/:month ──────────────────────────
  fastify.get('/pending-recoveries/:month', { preHandler: [fastify.authenticate, requireHrAdmin] }, async (req: any, reply) => {
    const { month } = req.params as { month: string }

    const [advances, schedules] = await Promise.all([
      fetchAllRows((from, to) =>
        fastify.supabase
          .from('advance_salary_requests')
          .select('*, employees(id, first_name, last_name, employee_code)')
          .eq('tenant_id', req.tenantId)
          .in('status', ['disbursed', 'recovering'])
          .eq('is_recovery_paused', false)
          .range(from, to),
      ),
      fetchAllRows((from, to) =>
        fastify.supabase
          .from('advance_recovery_schedules')
          .select('*')
          .eq('tenant_id', req.tenantId)
          .eq('recovery_month', month)
          .eq('status', 'pending')
          .range(from, to),
      ),
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

    // advance_id is caller-supplied — verify it belongs to this tenant
    // before it's referenced by the recovery insert below, otherwise a
    // recovery row could be created against a foreign tenant's advance.
    const { data: advance, error: advErr } = await fastify.supabase
      .from('advance_salary_requests')
      .select('id')
      .eq('id', parsed.data.advance_id)
      .eq('tenant_id', req.tenantId)
      .maybeSingle()
    if (advErr) return serverError(req, reply, advErr, ErrorCode.QUERY_FAILED, 'Failed to verify advance')
    if (!advance) return notFound(reply, 'ADVANCE_NOT_FOUND', 'Advance not found')

    // Fold the pending-status guard into the schedule update's own WHERE
    // clause (was a separate unchecked update with no precondition at all),
    // so recovering the same schedule twice can't insert a duplicate
    // advance_recoveries row for the same recovery.
    if (parsed.data.schedule_id) {
      const { data: updatedSched, error: schedErr } = await fastify.supabase
        .from('advance_recovery_schedules')
        .update({ status: 'recovered' })
        .eq('id', parsed.data.schedule_id)
        .eq('tenant_id', req.tenantId)
        .eq('status', 'pending')
        .select('id')
        .maybeSingle()
      if (schedErr) return serverError(req, reply, schedErr, ErrorCode.UPDATE_FAILED, 'Failed to update recovery schedule')
      if (!updatedSched) return conflictError(reply, 'ALREADY_RECOVERED', 'This recovery schedule has already been recovered')
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

    if (recoveryErr) return serverError(req, reply, recoveryErr, ErrorCode.INSERT_FAILED, 'Failed to record advance recovery')

    // Check if all schedules recovered for this advance
    const { count: pendingCount, error: pendingErr } = await fastify.supabase
      .from('advance_recovery_schedules')
      .select('id', { count: 'exact', head: true })
      .eq('advance_id', parsed.data.advance_id)
      .eq('tenant_id', req.tenantId)
      .eq('status', 'pending')

    if (pendingErr) return serverError(req, reply, pendingErr, ErrorCode.QUERY_FAILED, 'Failed to check remaining recovery schedules')

    if ((pendingCount ?? 0) === 0) {
      const { error: doneErr } = await fastify.supabase
        .from('advance_salary_requests')
        .update({ status: 'fully_recovered', updated_at: new Date().toISOString() })
        .eq('id', parsed.data.advance_id)
        .eq('tenant_id', req.tenantId)
      if (doneErr) return serverError(req, reply, doneErr, ErrorCode.UPDATE_FAILED, 'Recovery recorded but failed to update advance status')
    } else {
      const { error: recoveringErr } = await fastify.supabase
        .from('advance_salary_requests')
        .update({ status: 'recovering', updated_at: new Date().toISOString() })
        .eq('id', parsed.data.advance_id)
        .eq('tenant_id', req.tenantId)
        .in('status', ['disbursed'])
      if (recoveringErr) return serverError(req, reply, recoveringErr, ErrorCode.UPDATE_FAILED, 'Recovery recorded but failed to update advance status')
    }

    return reply.code(201).send({ data: recovery })
  })
}
