/**
 * Employee Loans Routes
 * Loan lifecycle, amortization schedules, and payment recording.
 */

import type { FastifyInstance } from 'fastify'
import { z } from 'zod'

const LOAN_TYPES = ['personal', 'housing', 'vehicle', 'education', 'emergency', 'other'] as const
const PAYMENT_TYPES = ['emi', 'prepayment', 'foreclosure', 'adjustment'] as const

function computeEMI(principal: number, annualRatePct: number, tenureMonths: number): number {
  if (annualRatePct === 0) return Math.round((principal / tenureMonths) * 100) / 100
  const r = annualRatePct / 100 / 12
  return Math.round((principal * r * Math.pow(1 + r, tenureMonths)) / (Math.pow(1 + r, tenureMonths) - 1) * 100) / 100
}

export default async function loansRoutes(fastify: FastifyInstance) {
  const auth = { preHandler: [fastify.authenticate] }

  function requireHrAdmin(req: any, reply: any, done: () => void) {
    if (!['super_admin', 'hr_admin'].includes(req.userRole)) {
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
      .order('created_at', { ascending: false })

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
    if (!['super_admin', 'hr_admin'].includes(req.userRole)) {
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
  fastify.post('/:id/approve', { preHandler: [fastify.authenticate, requireHrAdmin] }, async (req: any, reply) => {
    const { id } = req.params as { id: string }
    const now = new Date().toISOString()

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
      .select()
      .single()

    if (error) return reply.code(500).send({ error: 'UPDATE_FAILED', message: error.message })
    if (!data) return reply.code(404).send({ error: 'NOT_FOUND', message: 'Loan not found' })

    return reply.send({ data })
  })

  // ── POST /payroll/loans/:id/reject ────────────────────────────────────────────
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
      .from('employee_loans')
      .update({
        status: 'rejected',
        rejection_reason: parsed.data.rejection_reason,
        updated_at: new Date().toISOString(),
      })
      .eq('id', id)
      .eq('tenant_id', req.tenantId)

    if (error) return reply.code(500).send({ error: 'UPDATE_FAILED', message: error.message })
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

    const loanData = loan as any
    const now = new Date().toISOString()

    // Update loan to active
    const { error: updateErr } = await fastify.supabase
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

    if (updateErr) return reply.code(500).send({ error: 'UPDATE_FAILED', message: updateErr.message })

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
      .order('installment_number', { ascending: true })

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
        .update({ status: 'adjusted', updated_at: now })
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
        paid_at: now,
        recorded_by: req.userId,
      })
      .select()
      .single()

    if (payErr) return reply.code(500).send({ error: 'INSERT_FAILED', message: payErr.message })

    // Update schedule if provided
    if (parsed.data.schedule_id) {
      await fastify.supabase
        .from('loan_schedules')
        .update({
          status: 'paid',
          paid_amount: parsed.data.amount,
          paid_at: now,
          updated_at: now,
        })
        .eq('id', parsed.data.schedule_id)
        .eq('tenant_id', req.tenantId)
    }

    // Update loan outstanding balance
    const { data: loanRow } = await fastify.supabase
      .from('employee_loans')
      .select('outstanding_balance')
      .eq('id', parsed.data.loan_id)
      .eq('tenant_id', req.tenantId)
      .single()

    if (loanRow) {
      const currentOutstanding = (loanRow as any).outstanding_balance ?? 0
      const newOutstanding = Math.max(0, Math.round((currentOutstanding - parsed.data.principal_paid) * 100) / 100)
      const newStatus = newOutstanding <= 0 ? 'completed' : 'active'

      await fastify.supabase
        .from('employee_loans')
        .update({
          outstanding_balance: newOutstanding,
          status: newStatus,
          updated_at: now,
        })
        .eq('id', parsed.data.loan_id)
        .eq('tenant_id', req.tenantId)
    }

    return reply.code(201).send({ data: payment })
  })
}
