/**
 * ESS Loan & Advance Routes — /payroll/ess
 *
 * Employee self-service endpoints for:
 *   - Submitting their own advance/loan requests
 *   - Viewing their own requests and deduction schedules
 *
 * Manager endpoints (same file):
 *   - Listing team pending approvals
 *   - Approving / rejecting as manager (Stage 1)
 *
 * Existing HR endpoints in advances.ts / loans.ts handle Stage 2 (HR approval).
 */

import type { FastifyInstance } from 'fastify'
import { z } from 'zod'

const LOAN_TYPES = ['personal', 'housing', 'vehicle', 'education', 'emergency', 'other'] as const

function computeEMI(principal: number, annualRatePct: number, tenureMonths: number): number {
  if (annualRatePct === 0) return Math.round((principal / tenureMonths) * 100) / 100
  const r = annualRatePct / 100 / 12
  return Math.round((principal * r * Math.pow(1 + r, tenureMonths)) / (Math.pow(1 + r, tenureMonths) - 1) * 100) / 100
}

/** Resolve employee_id for the authenticated user from profiles.employee_id */
async function getMyEmployeeId(fastify: FastifyInstance, userId: string, tenantId: string): Promise<string | null> {
  const { data } = await fastify.supabase
    .from('profiles')
    .select('employee_id')
    .eq('id', userId)
    .eq('tenant_id', tenantId)
    .maybeSingle()
  return (data as any)?.employee_id ?? null
}

export default async function essLoansRoutes(fastify: FastifyInstance) {
  const auth = { preHandler: [fastify.authenticate] }

  // ── GET /payroll/ess/my-advances ─────────────────────────────────────────────
  fastify.get('/my-advances', auth, async (req: any, reply) => {
    const empId = await getMyEmployeeId(fastify, req.userId, req.tenantId)
    if (!empId) return reply.send({ data: [] })

    const { data, error } = await fastify.supabase
      .from('advance_salary_requests')
      .select('*')
      .eq('tenant_id', req.tenantId)
      .eq('employee_id', empId)
      .order('created_at', { ascending: false })

    if (error) return reply.code(500).send({ error: 'QUERY_FAILED', message: error.message })
    return reply.send({ data: data ?? [] })
  })

  // ── POST /payroll/ess/advances ───────────────────────────────────────────────
  // Employee submits a salary advance request → status = 'pending_manager'
  fastify.post('/advances', auth, async (req: any, reply) => {
    const empId = await getMyEmployeeId(fastify, req.userId, req.tenantId)
    if (!empId) return reply.code(403).send({ error: 'NO_EMPLOYEE_RECORD', message: 'No employee record linked to your profile' })

    const schema = z.object({
      requested_amount: z.number().positive(),
      purpose:          z.string().min(1),
      recovery_months:  z.number().int().min(1).max(12),
    })

    const parsed = schema.safeParse(req.body)
    if (!parsed.success) {
      return reply.code(400).send({ error: 'VALIDATION_ERROR', message: parsed.error.issues[0]?.message })
    }

    const { data, error } = await fastify.supabase
      .from('advance_salary_requests')
      .insert({
        ...parsed.data,
        tenant_id:        req.tenantId,
        employee_id:      empId,
        status:           'pending_manager',
        submitted_via_ess: true,
        created_by:       req.userId,
        requested_date:   new Date().toISOString().slice(0, 10),
      })
      .select()
      .single()

    if (error) return reply.code(500).send({ error: 'INSERT_FAILED', message: error.message })
    return reply.code(201).send({ data })
  })

  // ── GET /payroll/ess/my-loans ────────────────────────────────────────────────
  fastify.get('/my-loans', auth, async (req: any, reply) => {
    const empId = await getMyEmployeeId(fastify, req.userId, req.tenantId)
    if (!empId) return reply.send({ data: [] })

    const { data, error } = await fastify.supabase
      .from('employee_loans')
      .select('*')
      .eq('tenant_id', req.tenantId)
      .eq('employee_id', empId)
      .order('created_at', { ascending: false })

    if (error) return reply.code(500).send({ error: 'QUERY_FAILED', message: error.message })
    return reply.send({ data: data ?? [] })
  })

  // ── GET /payroll/ess/my-loans/:id/schedule ───────────────────────────────────
  fastify.get('/my-loans/:id/schedule', auth, async (req: any, reply) => {
    const { id } = req.params as { id: string }
    const empId = await getMyEmployeeId(fastify, req.userId, req.tenantId)
    if (!empId) return reply.send({ data: [] })

    const { data, error } = await fastify.supabase
      .from('loan_schedules')
      .select('*')
      .eq('loan_id', id)
      .eq('employee_id', empId)
      .eq('tenant_id', req.tenantId)
      .order('installment_number', { ascending: true })

    if (error) return reply.code(500).send({ error: 'QUERY_FAILED', message: error.message })
    return reply.send({ data: data ?? [] })
  })

  // ── GET /payroll/ess/my-advances/:id/schedule ────────────────────────────────
  fastify.get('/my-advances/:id/schedule', auth, async (req: any, reply) => {
    const { id } = req.params as { id: string }
    const empId = await getMyEmployeeId(fastify, req.userId, req.tenantId)
    if (!empId) return reply.send({ data: [] })

    const { data, error } = await fastify.supabase
      .from('advance_recovery_schedules')
      .select('*')
      .eq('advance_id', id)
      .eq('employee_id', empId)
      .eq('tenant_id', req.tenantId)
      .order('recovery_month', { ascending: true })

    if (error) return reply.code(500).send({ error: 'QUERY_FAILED', message: error.message })
    return reply.send({ data: data ?? [] })
  })

  // ── POST /payroll/ess/loans ──────────────────────────────────────────────────
  // Employee submits a loan request → status = 'pending_manager'
  fastify.post('/loans', auth, async (req: any, reply) => {
    const empId = await getMyEmployeeId(fastify, req.userId, req.tenantId)
    if (!empId) return reply.code(403).send({ error: 'NO_EMPLOYEE_RECORD', message: 'No employee record linked to your profile' })

    const schema = z.object({
      loan_type:         z.enum(LOAN_TYPES),
      principal_amount:  z.number().positive(),
      interest_rate_pct: z.number().min(0),
      tenure_months:     z.number().int().positive(),
      purpose:           z.string().optional(),
    })

    const parsed = schema.safeParse(req.body)
    if (!parsed.success) {
      return reply.code(400).send({ error: 'VALIDATION_ERROR', message: parsed.error.issues[0]?.message })
    }

    const emiAmount = computeEMI(parsed.data.principal_amount, parsed.data.interest_rate_pct, parsed.data.tenure_months)

    const { data, error } = await fastify.supabase
      .from('employee_loans')
      .insert({
        ...parsed.data,
        tenant_id:         req.tenantId,
        employee_id:       empId,
        status:            'pending_manager',
        submitted_via_ess: true,
        emi_amount:        emiAmount,
        outstanding_balance: parsed.data.principal_amount,
        created_by:        req.userId,
      })
      .select()
      .single()

    if (error) return reply.code(500).send({ error: 'INSERT_FAILED', message: error.message })
    return reply.code(201).send({ data })
  })

  // ── GET /payroll/ess/manager/pending ─────────────────────────────────────────
  // Manager: list all pending_manager requests from direct reports
  fastify.get('/manager/pending', auth, async (req: any, reply) => {
    const managerEmpId = await getMyEmployeeId(fastify, req.userId, req.tenantId)
    if (!managerEmpId) return reply.send({ advances: [], loans: [] })

    // Get direct reports
    const { data: reports } = await fastify.supabase
      .from('employees')
      .select('id')
      .eq('tenant_id', req.tenantId)
      .eq('manager_id', managerEmpId)
      .eq('status', 'active')

    const reportIds = (reports ?? []).map((e: any) => e.id as string)
    if (reportIds.length === 0) return reply.send({ advances: [], loans: [] })

    const [{ data: advances }, { data: loans }] = await Promise.all([
      fastify.supabase
        .from('advance_salary_requests')
        .select('*, employees(id, first_name, last_name, employee_code)')
        .eq('tenant_id', req.tenantId)
        .eq('status', 'pending_manager')
        .in('employee_id', reportIds)
        .order('created_at', { ascending: false }),
      fastify.supabase
        .from('employee_loans')
        .select('*, employees(id, first_name, last_name, employee_code)')
        .eq('tenant_id', req.tenantId)
        .eq('status', 'pending_manager')
        .in('employee_id', reportIds)
        .order('created_at', { ascending: false }),
    ])

    return reply.send({ advances: advances ?? [], loans: loans ?? [] })
  })

  // ── POST /payroll/ess/manager/advances/:id/approve ────────────────────────────
  fastify.post('/manager/advances/:id/approve', auth, async (req: any, reply) => {
    const { id } = req.params as { id: string }
    const managerEmpId = await getMyEmployeeId(fastify, req.userId, req.tenantId)
    if (!managerEmpId) return reply.code(403).send({ error: 'FORBIDDEN', message: 'No employee record' })

    // Verify ownership: request must belong to a direct report
    const { data: advance } = await fastify.supabase
      .from('advance_salary_requests')
      .select('id, employee_id, status')
      .eq('id', id)
      .eq('tenant_id', req.tenantId)
      .single()

    if (!advance) return reply.code(404).send({ error: 'NOT_FOUND' })
    if ((advance as any).status !== 'pending_manager') {
      return reply.code(409).send({ error: 'INVALID_STATUS', message: 'Request is not pending manager approval' })
    }

    const { data: emp } = await fastify.supabase
      .from('employees')
      .select('manager_id')
      .eq('id', (advance as any).employee_id)
      .eq('tenant_id', req.tenantId)
      .single()

    if ((emp as any)?.manager_id !== managerEmpId) {
      return reply.code(403).send({ error: 'FORBIDDEN', message: 'You are not the manager of this employee' })
    }

    const now = new Date().toISOString()
    const { error } = await fastify.supabase
      .from('advance_salary_requests')
      .update({ status: 'pending_hr', manager_approved_by: req.userId, manager_approved_at: now, updated_at: now })
      .eq('id', id)
      .eq('tenant_id', req.tenantId)

    if (error) return reply.code(500).send({ error: 'UPDATE_FAILED', message: error.message })
    return reply.send({ message: 'Approved — forwarded to HR for final approval' })
  })

  // ── POST /payroll/ess/manager/advances/:id/reject ─────────────────────────────
  fastify.post('/manager/advances/:id/reject', auth, async (req: any, reply) => {
    const { id } = req.params as { id: string }
    const schema = z.object({ reason: z.string().min(1) })
    const parsed = schema.safeParse(req.body)
    if (!parsed.success) return reply.code(400).send({ error: 'VALIDATION_ERROR', message: parsed.error.issues[0]?.message })

    const managerEmpId = await getMyEmployeeId(fastify, req.userId, req.tenantId)
    if (!managerEmpId) return reply.code(403).send({ error: 'FORBIDDEN' })

    const { data: advance } = await fastify.supabase
      .from('advance_salary_requests')
      .select('employee_id, status')
      .eq('id', id).eq('tenant_id', req.tenantId).single()

    if (!advance || (advance as any).status !== 'pending_manager') {
      return reply.code(409).send({ error: 'INVALID_STATUS' })
    }

    const { data: emp } = await fastify.supabase
      .from('employees').select('manager_id').eq('id', (advance as any).employee_id).eq('tenant_id', req.tenantId).single()

    if ((emp as any)?.manager_id !== managerEmpId) return reply.code(403).send({ error: 'FORBIDDEN' })

    const now = new Date().toISOString()
    await fastify.supabase
      .from('advance_salary_requests')
      .update({ status: 'rejected', rejection_reason: parsed.data.reason, manager_rejected_at: now, updated_at: now })
      .eq('id', id).eq('tenant_id', req.tenantId)

    return reply.send({ message: 'Advance request rejected' })
  })

  // ── POST /payroll/ess/manager/loans/:id/approve ───────────────────────────────
  fastify.post('/manager/loans/:id/approve', auth, async (req: any, reply) => {
    const { id } = req.params as { id: string }
    const managerEmpId = await getMyEmployeeId(fastify, req.userId, req.tenantId)
    if (!managerEmpId) return reply.code(403).send({ error: 'FORBIDDEN' })

    const { data: loan } = await fastify.supabase
      .from('employee_loans')
      .select('employee_id, status')
      .eq('id', id).eq('tenant_id', req.tenantId).single()

    if (!loan) return reply.code(404).send({ error: 'NOT_FOUND' })
    if ((loan as any).status !== 'pending_manager') {
      return reply.code(409).send({ error: 'INVALID_STATUS', message: 'Loan is not pending manager approval' })
    }

    const { data: emp } = await fastify.supabase
      .from('employees').select('manager_id').eq('id', (loan as any).employee_id).eq('tenant_id', req.tenantId).single()

    if ((emp as any)?.manager_id !== managerEmpId) return reply.code(403).send({ error: 'FORBIDDEN' })

    const now = new Date().toISOString()
    await fastify.supabase
      .from('employee_loans')
      .update({ status: 'pending_hr', manager_approved_by: req.userId, manager_approved_at: now, updated_at: now })
      .eq('id', id).eq('tenant_id', req.tenantId)

    return reply.send({ message: 'Approved — forwarded to HR for final approval' })
  })

  // ── POST /payroll/ess/manager/loans/:id/reject ────────────────────────────────
  fastify.post('/manager/loans/:id/reject', auth, async (req: any, reply) => {
    const { id } = req.params as { id: string }
    const schema = z.object({ reason: z.string().min(1) })
    const parsed = schema.safeParse(req.body)
    if (!parsed.success) return reply.code(400).send({ error: 'VALIDATION_ERROR', message: parsed.error.issues[0]?.message })

    const managerEmpId = await getMyEmployeeId(fastify, req.userId, req.tenantId)
    if (!managerEmpId) return reply.code(403).send({ error: 'FORBIDDEN' })

    const { data: loan } = await fastify.supabase
      .from('employee_loans')
      .select('employee_id, status')
      .eq('id', id).eq('tenant_id', req.tenantId).single()

    if (!loan || (loan as any).status !== 'pending_manager') return reply.code(409).send({ error: 'INVALID_STATUS' })

    const { data: emp } = await fastify.supabase
      .from('employees').select('manager_id').eq('id', (loan as any).employee_id).eq('tenant_id', req.tenantId).single()

    if ((emp as any)?.manager_id !== managerEmpId) return reply.code(403).send({ error: 'FORBIDDEN' })

    const now = new Date().toISOString()
    await fastify.supabase
      .from('employee_loans')
      .update({ status: 'rejected', rejection_reason: parsed.data.reason, manager_rejected_at: now, updated_at: now })
      .eq('id', id).eq('tenant_id', req.tenantId)

    return reply.send({ message: 'Loan request rejected' })
  })
}
