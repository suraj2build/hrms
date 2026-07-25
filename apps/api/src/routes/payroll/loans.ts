/**
 * Employee Loans Routes
 * Loan lifecycle, amortization schedules, and payment recording.
 */

import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { gateApprove, gateReject } from '../../lib/approval-orchestrator.js'
import { HR_ADMIN_ROLES } from '../../lib/rbac.js'

const LOAN_TYPES = ['personal', 'housing', 'vehicle', 'education', 'emergency', 'other'] as const
const PAYMENT_TYPES = ['emi', 'prepayment', 'foreclosure', 'adjustment'] as const

function computeEMI(principal: number, annualRatePct: number, tenureMonths: number): number {
  if (annualRatePct === 0) return Math.round((principal / tenureMonths) * 100) / 100
  const r = annualRatePct / 100 / 12
  return Math.round((principal * r * Math.pow(1 + r, tenureMonths)) / (Math.pow(1 + r, tenureMonths) - 1) * 100) / 100
}

export default async function loansRoutes(fastify: FastifyInstance) {
  const auth = { preHandler: [fastify.authenticate] }
  const isHr = (role: string) => (HR_ADMIN_ROLES as readonly string[]).includes(role)

  function requireHrAdmin(req: any, reply: any, done: () => void) {
    if (!isHr(req.userRole)) {
      reply.code(403).send({ error: 'FORBIDDEN', message: 'HR admin access required' })
      return
    }
    done()
  }

  // ── GET /payroll/loans ────────────────────────────────────────────────────────
  fastify.get('/', auth, async (req: any, reply) => {
    const querySchema = z.object({
      employee_id: z.string().uuid().optional(),
      status: z.string().optional(),
    })

    const parsed = querySchema.safeParse(req.query)
    if (!parsed.success) {
      return reply.code(400).send({ error: 'VALIDATION_ERROR', message: parsed.error.issues[0]?.message })
    }

    let q = fastify.supabase
      .from('employee_loans')
      .select('*, employees(id, first_name, last_name, employee_code)')
      .eq('tenant_id', req.tenantId)
      .order('created_at', { ascending: false }).limit(500)

    if (parsed.data.employee_id) q = q.eq('employee_id', parsed.data.employee_id)
    if (parsed.data.status) q = q.eq('status', parsed.data.status)

    const { data, error } = await q
    if (error) return reply.code(500).send({ error: 'QUERY_FAILED', message: error.message })
    return reply.send({ data: data ?? [] })
  })

  // ── POST /payroll/loans ───────────────────────────────────────────────────────
  fastify.post('/', auth, async (req: any, reply) => {
    const schema = z.object({
      employee_id: z.string().uuid(),
      loan_type: z.enum(LOAN_TYPES),
      principal_amount: z.number().positive(),
      interest_rate_pct: z.number().min(0),
      tenure_months: z.number().int().positive(),
      purpose: z.string().optional(),
    })

    const parsed = schema.safeParse(req.body)
    if (!parsed.success) {
      return reply.code(400).send({ error: 'VALIDATION_ERROR', message: parsed.error.issues[0]?.message })
    }

    // Self-scoping: non-admins may only raise a loan request for themselves.
    if (!(HR_ADMIN_ROLES as readonly string[]).includes(req.userRole)) {
      const { data: profile } = await fastify.supabase
        .from('profiles')
        .select('employee_id')
        .eq('id', req.userId)
        .eq('tenant_id', req.tenantId)
        .single()
      if (profile?.employee_id !== parsed.data.employee_id) {
        return reply.code(403).send({ error: 'FORBIDDEN', message: 'You can only request a loan for yourself' })
      }
    }

    const emiAmount = computeEMI(parsed.data.principal_amount, parsed.data.interest_rate_pct, parsed.data.tenure_months)

    const { data, error } = await fastify.supabase
      .from('employee_loans')
      .insert({
        ...parsed.data,
        tenant_id: req.tenantId,
        status: 'pending',
        emi_amount: emiAmount,
        outstanding_balance: parsed.data.principal_amount,
        created_by: req.userId,
      })
      .select()
      .single()

    if (error) return reply.code(500).send({ error: 'INSERT_FAILED', message: error.message })
    return reply.code(201).send({ data })
  })

  // ── POST /payroll/loans/:id/approve ──────────────────────────────────────────
  // Auth is gate-driven: with NO loan chain configured this stays HR-only (legacy);
  // with a chain, the per-level gate authorises each approver (e.g. L1 manager →
  // L2 HR → L3 finance above a ₹ threshold via min_amount).
  fastify.post('/:id/approve', auth, async (req: any, reply) => {
    const { id } = req.params as { id: string }
    const now = new Date().toISOString()

    const { data: loan } = await fastify.supabase
      .from('employee_loans')
      .select('id, status, employee_id, principal_amount')
      .eq('id', id).eq('tenant_id', req.tenantId).maybeSingle()
    if (!loan) return reply.code(404).send({ error: 'NOT_FOUND', message: 'Loan not found' })
    if (!['pending', 'pending_hr'].includes((loan as any).status)) {
      return reply.code(409).send({ error: 'INVALID_STATE', message: 'Loan not found or not in a pending/pending_hr state' })
    }

    // Multi-level gate (threshold routing by principal amount).
    const gate = await gateApprove(fastify.supabase, {
      tenantId: req.tenantId, entityType: 'employee_loan', entityId: id,
      actorId: req.userId, actorRole: req.userRole,
      targetEmployeeId: (loan as any).employee_id,
      amount: Number((loan as any).principal_amount),
    })
    if (gate.kind === 'error') {
      const code = gate.error.type === 'FORBIDDEN' ? 403 : gate.error.type === 'CONFLICT' ? 409 : 400
      return reply.code(code).send({ error: gate.error.type, message: gate.error.message })
    }
    if (gate.kind === 'advanced') {
      return reply.send({ data: { id, status: (loan as any).status, advanced_to_level: gate.nextLevel, total_levels: gate.totalLevels } })
    }
    if (!gate.authorized && !isHr(req.userRole)) {
      return reply.code(403).send({ error: 'FORBIDDEN', message: 'HR admin access required' })
    }

    const { data, error } = await fastify.supabase
      .from('employee_loans')
      .update({
        status: 'approved',
        approved_by: req.userId,
        approved_at: now,
        updated_at: now,
      })
      .eq('id', id)
      .eq('tenant_id', req.tenantId)
      // Approvable from a direct pending request OR an ESS request a manager has
      // already approved (pending_hr). Loan schedule is still created on DISBURSE.
      .in('status', ['pending', 'pending_hr'])
      .select()
      .maybeSingle()

    if (error) return reply.code(500).send({ error: 'UPDATE_FAILED', message: error.message })
    if (!data) return reply.code(409).send({ error: 'INVALID_STATE', message: 'Loan not found or not in a pending/pending_hr state' })

    return reply.send({ data })
  })

  // ── POST /payroll/loans/:id/reject ────────────────────────────────────────────
  fastify.post('/:id/reject', auth, async (req: any, reply) => {
    const { id } = req.params as { id: string }

    const schema = z.object({
      rejection_reason: z.string().min(1),
    })

    const parsed = schema.safeParse(req.body)
    if (!parsed.success) {
      return reply.code(400).send({ error: 'VALIDATION_ERROR', message: parsed.error.issues[0]?.message })
    }

    const { data: loan } = await fastify.supabase
      .from('employee_loans')
      .select('id, status, employee_id, principal_amount')
      .eq('id', id).eq('tenant_id', req.tenantId).maybeSingle()
    if (!loan) return reply.code(404).send({ error: 'NOT_FOUND', message: 'Loan not found' })
    if ((loan as any).status !== 'pending') {
      return reply.code(409).send({ error: 'INVALID_STATE', message: 'Loan not found or not in a pending state' })
    }

    // Gate-driven auth; no chain => HR-only (legacy).
    const gate = await gateReject(fastify.supabase, {
      tenantId: req.tenantId, entityType: 'employee_loan', entityId: id,
      actorId: req.userId, actorRole: req.userRole,
      targetEmployeeId: (loan as any).employee_id,
      amount: Number((loan as any).principal_amount ?? 0),
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
      .from('employee_loans')
      .update({
        status: 'rejected',
        rejection_reason: parsed.data.rejection_reason,
        updated_at: new Date().toISOString(),
      })
      .eq('id', id)
      .eq('tenant_id', req.tenantId)
      .eq('status', 'pending')   // F7 — only a pending loan may be rejected
      .select('id')
      .maybeSingle()

    if (error) return reply.code(500).send({ error: 'UPDATE_FAILED', message: error.message })
    if (!rejected) return reply.code(409).send({ error: 'INVALID_STATE', message: 'Loan not found or not in a pending state' })
    return reply.send({ message: 'Loan rejected' })
  })

  // ── POST /payroll/loans/:id/disburse ─────────────────────────────────────────
  fastify.post('/:id/disburse', { preHandler: [fastify.authenticate, requireHrAdmin] }, async (req: any, reply) => {
    const { id } = req.params as { id: string }

    const schema = z.object({
      disbursed_date: z.string(),
      disbursed_amount: z.number().positive(),
      first_emi_month: z.string().regex(/^\d{4}-\d{2}$/, 'first_emi_month must be YYYY-MM'),
    })

    const parsed = schema.safeParse(req.body)
    if (!parsed.success) {
      return reply.code(400).send({ error: 'VALIDATION_ERROR', message: parsed.error.issues[0]?.message })
    }

    // Fetch loan details
    const { data: loan, error: fetchErr } = await fastify.supabase
      .from('employee_loans')
      .select('*')
      .eq('id', id)
      .eq('tenant_id', req.tenantId)
      .single()

    if (fetchErr || !loan) return reply.code(404).send({ error: 'NOT_FOUND', message: 'Loan not found' })

    // F7 — only an approved loan may be disbursed (no skipping the approval stage,
    // no double-disbursing an already-active/closed loan).
    if ((loan as any).status !== 'approved') {
      return reply.code(409).send({ error: 'INVALID_STATE', message: `Loan must be approved before disbursal (current: ${(loan as any).status})` })
    }

    const loanData = loan as any
    const now = new Date().toISOString()

    // Update loan to active — .eq('status','approved') + row-count check
    // (fresh audit finding): without this, two concurrent disburse calls on
    // the same loan both pass the precheck above, both flip to active, and
    // both generate+insert a full amortization schedule below — duplicate EMI
    // schedules recovered from the employee's future payslips.
    const { data: updatedLoan, error: updateErr } = await fastify.supabase
      .from('employee_loans')
      .update({
        status: 'active',
        disbursed_date: parsed.data.disbursed_date,
        disbursed_amount: parsed.data.disbursed_amount,
        disbursed_by: req.userId,
        first_emi_month: parsed.data.first_emi_month,
        updated_at: now,
      })
      .eq('id', id)
      .eq('tenant_id', req.tenantId)
      .eq('status', 'approved')
      .select('id')

    if (updateErr) return reply.code(500).send({ error: 'UPDATE_FAILED', message: updateErr.message })
    if (!updatedLoan?.length) return reply.code(409).send({ error: 'ALREADY_DISBURSED', message: 'This loan was already disbursed by another request' })

    // Generate amortization schedule
    const principal = loanData.principal_amount as number
    const annualRate = loanData.interest_rate_pct as number
    const tenure = loanData.tenure_months as number
    const emi = loanData.emi_amount as number
    const monthlyRate = annualRate / 100 / 12

    const [fyStart, fyMonStr] = parsed.data.first_emi_month.split('-').map(Number)
    let outstanding = principal
    const schedules: any[] = []

    for (let i = 1; i <= tenure; i++) {
      const dueDate = new Date(fyStart, fyMonStr - 1 + (i - 1), 1)
      const dueMonth = `${dueDate.getFullYear()}-${String(dueDate.getMonth() + 1).padStart(2, '0')}`

      const interestPaid = Math.round(outstanding * monthlyRate * 100) / 100
      const principalPaid = Math.min(Math.round((emi - interestPaid) * 100) / 100, outstanding)
      outstanding = Math.max(0, Math.round((outstanding - principalPaid) * 100) / 100)

      schedules.push({
        tenant_id: req.tenantId,
        loan_id: id,
        employee_id: loanData.employee_id,
        installment_number: i,
        due_month: dueMonth,
        emi_amount: emi,
        principal_component: principalPaid,
        interest_component: interestPaid,
        outstanding_balance: outstanding,
        status: 'pending',
      })
    }

    if (schedules.length > 0) {
      const { error: schedErr } = await fastify.supabase
        .from('loan_schedules')
        .insert(schedules)

      if (schedErr) {
        req.log.warn({ err: schedErr }, 'Failed to create loan schedules')
      }
    }

    return reply.send({ message: 'Loan disbursed', loan_id: id, schedules_created: schedules.length })
  })

  // ── GET /payroll/loans/:id/schedule ──────────────────────────────────────────
  fastify.get('/:id/schedule', auth, async (req: any, reply) => {
    const { id } = req.params as { id: string }

    const { data, error } = await fastify.supabase
      .from('loan_schedules')
      .select('*')
      .eq('loan_id', id)
      .eq('tenant_id', req.tenantId)
      .order('installment_number', { ascending: true }).limit(200)

    if (error) return reply.code(500).send({ error: 'QUERY_FAILED', message: error.message })
    return reply.send({ data: data ?? [] })
  })

  // ── POST /payroll/loans/:id/pause-emi ────────────────────────────────────────
  fastify.post('/:id/pause-emi', { preHandler: [fastify.authenticate, requireHrAdmin] }, async (req: any, reply) => {
    const { id } = req.params as { id: string }

    const schema = z.object({ pause_reason: z.string().min(1) })
    const parsed = schema.safeParse(req.body)
    if (!parsed.success) {
      return reply.code(400).send({ error: 'VALIDATION_ERROR', message: parsed.error.issues[0]?.message })
    }

    const { error } = await fastify.supabase
      .from('employee_loans')
      .update({ is_emi_paused: true, pause_reason: parsed.data.pause_reason, updated_at: new Date().toISOString() })
      .eq('id', id)
      .eq('tenant_id', req.tenantId)

    if (error) return reply.code(500).send({ error: 'UPDATE_FAILED', message: error.message })
    return reply.send({ message: 'EMI paused' })
  })

  // ── POST /payroll/loans/:id/resume-emi ────────────────────────────────────────
  fastify.post('/:id/resume-emi', { preHandler: [fastify.authenticate, requireHrAdmin] }, async (req: any, reply) => {
    const { id } = req.params as { id: string }

    const { error } = await fastify.supabase
      .from('employee_loans')
      .update({ is_emi_paused: false, pause_reason: null, updated_at: new Date().toISOString() })
      .eq('id', id)
      .eq('tenant_id', req.tenantId)

    if (error) return reply.code(500).send({ error: 'UPDATE_FAILED', message: error.message })
    return reply.send({ message: 'EMI resumed' })
  })

  // ── POST /payroll/loans/:id/foreclose ────────────────────────────────────────
  fastify.post('/:id/foreclose', { preHandler: [fastify.authenticate, requireHrAdmin] }, async (req: any, reply) => {
    const { id } = req.params as { id: string }

    const schema = z.object({
      foreclosure_amount: z.number().positive(),
      notes: z.string().optional(),
    })

    const parsed = schema.safeParse(req.body)
    if (!parsed.success) {
      return reply.code(400).send({ error: 'VALIDATION_ERROR', message: parsed.error.issues[0]?.message })
    }

    const now = new Date().toISOString()

    const [{ error: loanErr }, { error: schedErr }] = await Promise.all([
      fastify.supabase
        .from('employee_loans')
        .update({
          status: 'foreclosed',
          foreclosed_at: now,
          foreclosure_amount: parsed.data.foreclosure_amount,
          foreclosure_notes: parsed.data.notes ?? null,
          outstanding_balance: 0,
          updated_at: now,
        })
        .eq('id', id)
        .eq('tenant_id', req.tenantId),
      fastify.supabase
        .from('loan_schedules')
        .update({ status: 'adjusted' })
        .eq('loan_id', id)
        .eq('tenant_id', req.tenantId)
        .eq('status', 'pending'),
    ])

    if (loanErr) return reply.code(500).send({ error: 'UPDATE_FAILED', message: loanErr.message })
    if (schedErr) req.log.warn({ err: schedErr }, 'Failed to adjust loan schedules')

    return reply.send({ message: 'Loan foreclosed' })
  })

  // ── GET /payroll/loans/active-emis/:month ─────────────────────────────────────
  fastify.get('/active-emis/:month', { preHandler: [fastify.authenticate, requireHrAdmin] }, async (req: any, reply) => {
    const { month } = req.params as { month: string }

    const [{ data: loans }, { data: schedules }] = await Promise.all([
      fastify.supabase
        .from('employee_loans')
        .select('*, employees(id, first_name, last_name, employee_code)')
        .eq('tenant_id', req.tenantId)
        .eq('status', 'active')
        .eq('is_emi_paused', false),
      fastify.supabase
        .from('loan_schedules')
        .select('*')
        .eq('tenant_id', req.tenantId)
        .eq('due_month', month)
        .eq('status', 'pending'),
    ])

    const scheduleMap = new Map<string, any[]>()
    for (const sched of (schedules ?? []) as any[]) {
      const existing = scheduleMap.get(sched.loan_id) ?? []
      existing.push(sched)
      scheduleMap.set(sched.loan_id, existing)
    }

    const result = (loans ?? []).map((loan: any) => ({
      ...loan,
      pending_emis: scheduleMap.get(loan.id) ?? [],
    }))

    return reply.send({ data: result, month })
  })

  // ── POST /payroll/loans/record-payment ───────────────────────────────────────
  fastify.post('/record-payment', { preHandler: [fastify.authenticate, requireHrAdmin] }, async (req: any, reply) => {
    const schema = z.object({
      loan_id: z.string().uuid(),
      schedule_id: z.string().uuid().optional(),
      payroll_run_id: z.string().uuid().optional(),
      amount: z.number().positive(),
      principal_paid: z.number().positive(),
      interest_paid: z.number().min(0),
      payment_type: z.enum(PAYMENT_TYPES),
      notes: z.string().optional(),
    })

    const parsed = schema.safeParse(req.body)
    if (!parsed.success) {
      return reply.code(400).send({ error: 'VALIDATION_ERROR', message: parsed.error.issues[0]?.message })
    }

    const now = new Date().toISOString()

    // Insert payment record
    const { data: payment, error: payErr } = await fastify.supabase
      .from('loan_payments')
      .insert({
        ...parsed.data,
        tenant_id: req.tenantId,
        created_by: req.userId,
      })
      .select()
      .single()

    if (payErr) return reply.code(500).send({ error: 'INSERT_FAILED', message: payErr.message })

    // Update schedule if provided — guarded to 'pending' so a duplicate/racing
    // record-payment call for the same installment can't re-stamp an
    // already-paid schedule row.
    if (parsed.data.schedule_id) {
      await fastify.supabase
        .from('loan_schedules')
        .update({
          status: 'paid',
          paid_amount: parsed.data.amount,
          paid_at: now,
        })
        .eq('id', parsed.data.schedule_id)
        .eq('tenant_id', req.tenantId)
        .eq('status', 'pending')
    }

    // Update loan outstanding balance atomically (fresh audit finding): this
    // was previously a plain read-then-write — SELECT outstanding_balance,
    // compute the new value in application code, UPDATE — a classic
    // lost-update race. Two concurrent (or accidentally duplicate)
    // record-payment calls for the same loan both read the same
    // outstanding_balance and the second write silently overwrote the
    // first's deduction, even though two loan_payments audit rows exist.
    // record_loan_payment_atomic() (migration 396) does the read-modify-write
    // in one UPDATE statement instead.
    const { error: balErr } = await fastify.supabase.rpc('record_loan_payment_atomic', {
      p_tenant_id:      req.tenantId,
      p_loan_id:        parsed.data.loan_id,
      p_principal_paid: parsed.data.principal_paid,
    })
    if (balErr) {
      req.log.error({ err: balErr, loan_id: parsed.data.loan_id }, 'record-payment: failed to update loan outstanding_balance — payment row was inserted but balance was NOT updated')
    }

    return reply.code(201).send({ data: payment })
  })
}
