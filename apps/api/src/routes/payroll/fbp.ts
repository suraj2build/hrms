/**
 * FBP (Flexible Benefit Plan) Routes — /payroll/fbp
 *
 * Quarterly reconciliation of monthly-paid allowances against submitted bills.
 * ESS: employees submit bills per reimbursement component / FY-quarter.
 * HR:  approve/reject submissions; compute + lock the quarterly reconciliation.
 */

import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { logAction } from '../../lib/audit-service.js'
import {
  computeQuarterReconciliation, lockQuarterReconciliation,
} from '../../lib/fbp-service.js'

const FY_RE = /^\d{4}-\d{2}$/   // e.g. 2026-27

export default async function fbpRoutes(fastify: FastifyInstance) {
  const auth = { preHandler: [fastify.authenticate] }

  function requireHrAdmin(req: any, reply: any, done: () => void) {
    if (!['super_admin', 'hr_admin'].includes(req.userRole)) {
      reply.code(403).send({ error: 'FORBIDDEN', message: 'HR admin access required' })
      return
    }
    done()
  }
  const hrAuth = { preHandler: [fastify.authenticate, requireHrAdmin] }

  async function resolveEmployeeId(req: any): Promise<string | null> {
    const { data } = await fastify.supabase
      .from('profiles').select('employee_id')
      .eq('id', req.userId).eq('tenant_id', req.tenantId).single()
    return data?.employee_id ?? null
  }

  // ── ESS: list own submissions ────────────────────────────────────────────────
  fastify.get('/my', auth, async (req: any, reply) => {
    const empId = await resolveEmployeeId(req)
    if (!empId) return reply.code(400).send({ error: 'NO_EMPLOYEE_LINK', message: 'Profile not linked to an employee record' })

    const qs = z.object({ financial_year: z.string().optional(), quarter: z.coerce.number().optional() }).safeParse(req.query)
    let q = fastify.supabase
      .from('fbp_bill_submissions')
      .select('*, salary_components(id, name, code)')
      .eq('tenant_id', req.tenantId)
      .eq('employee_id', empId)
      .order('created_at', { ascending: false }).limit(100)
    if (qs.success && qs.data.financial_year) q = q.eq('financial_year', qs.data.financial_year)
    if (qs.success && qs.data.quarter) q = q.eq('quarter', qs.data.quarter)

    const { data, error } = await q
    if (error) return reply.code(500).send({ error: 'QUERY_FAILED', message: error.message })
    return reply.send({ data: data ?? [] })
  })

  // ── ESS: own quarterly reconciliation outcome (paid vs proof → taxable) ───────
  // Surfaces the persisted reconciliation HR has computed/locked, so the
  // employee can see how much of their FBP became taxable (it flows to TDS).
  fastify.get('/my/reconciliation', auth, async (req: any, reply) => {
    const empId = await resolveEmployeeId(req)
    if (!empId) return reply.code(400).send({ error: 'NO_EMPLOYEE_LINK', message: 'Profile not linked to an employee record' })

    const qs = z.object({ financial_year: z.string().optional(), quarter: z.coerce.number().optional() }).safeParse(req.query)
    let q = fastify.supabase
      .from('fbp_reconciliations')
      .select('id, financial_year, quarter, paid_amount, proof_amount, exemption_limit, taxable_amount, status, reconciled_at, salary_components(id, name, code)')
      .eq('tenant_id', req.tenantId)
      .eq('employee_id', empId)
      .order('financial_year', { ascending: false })
      .order('quarter', { ascending: false }).limit(100)
    if (qs.success && qs.data.financial_year) q = q.eq('financial_year', qs.data.financial_year)
    if (qs.success && qs.data.quarter) q = q.eq('quarter', qs.data.quarter)

    const { data, error } = await q
    if (error) return reply.code(500).send({ error: 'QUERY_FAILED', message: error.message })
    const rows = data ?? []
    const total_taxable = Math.round(rows.reduce((s: number, r: any) => s + Number(r.taxable_amount ?? 0), 0) * 100) / 100
    return reply.send({ data: { rows, total_taxable } })
  })

  // ── ESS: create draft submission ─────────────────────────────────────────────
  fastify.post('/my', auth, async (req: any, reply) => {
    const empId = await resolveEmployeeId(req)
    if (!empId) return reply.code(400).send({ error: 'NO_EMPLOYEE_LINK', message: 'Profile not linked to an employee record' })

    const schema = z.object({
      salary_component_id: z.string().uuid(),
      financial_year:      z.string().regex(FY_RE, 'financial_year must be YYYY-YY'),
      quarter:             z.number().int().min(1).max(4),
      amount:              z.number().positive(),
      description:         z.string().max(500).optional(),
    })
    const parsed = schema.safeParse(req.body)
    if (!parsed.success) return reply.code(400).send({ error: 'VALIDATION_ERROR', message: parsed.error.issues[0]?.message })

    // The component must be a reimbursement component for this tenant.
    const { data: comp } = await fastify.supabase
      .from('salary_components').select('id, is_reimbursement')
      .eq('id', parsed.data.salary_component_id).eq('tenant_id', req.tenantId).single()
    if (!comp) return reply.code(404).send({ error: 'COMPONENT_NOT_FOUND', message: 'Component not found' })
    if (!(comp as any).is_reimbursement)
      return reply.code(422).send({ error: 'NOT_REIMBURSEMENT', message: 'This component is not a reimbursement component' })

    const { data, error } = await fastify.supabase
      .from('fbp_bill_submissions')
      .insert({ tenant_id: req.tenantId, employee_id: empId, ...parsed.data, status: 'draft' })
      .select('*, salary_components(id, name, code)')
      .single()
    if (error) return reply.code(500).send({ error: 'INSERT_FAILED', message: error.message })
    return reply.code(201).send({ data })
  })

  // ── ESS: update own draft ────────────────────────────────────────────────────
  fastify.put('/my/:id', auth, async (req: any, reply) => {
    const empId = await resolveEmployeeId(req)
    if (!empId) return reply.code(400).send({ error: 'NO_EMPLOYEE_LINK', message: 'Profile not linked' })
    const { id } = req.params as { id: string }

    const schema = z.object({
      amount:      z.number().positive().optional(),
      description: z.string().max(500).optional(),
    })
    const parsed = schema.safeParse(req.body)
    if (!parsed.success) return reply.code(400).send({ error: 'VALIDATION_ERROR', message: parsed.error.issues[0]?.message })

    const { data: existing } = await fastify.supabase
      .from('fbp_bill_submissions').select('id, status')
      .eq('id', id).eq('tenant_id', req.tenantId).eq('employee_id', empId).single()
    if (!existing) return reply.code(404).send({ error: 'NOT_FOUND', message: 'Submission not found' })
    if ((existing as any).status !== 'draft')
      return reply.code(409).send({ error: 'INVALID_STATUS', message: 'Only draft submissions can be edited' })

    const { data, error } = await fastify.supabase
      .from('fbp_bill_submissions')
      .update({ ...parsed.data, updated_at: new Date().toISOString() })
      .eq('id', id).eq('tenant_id', req.tenantId)
      .select('*, salary_components(id, name, code)').single()
    if (error) return reply.code(500).send({ error: 'UPDATE_FAILED', message: error.message })
    return reply.send({ data })
  })

  // ── ESS: submit for approval ─────────────────────────────────────────────────
  fastify.post('/my/:id/submit', auth, async (req: any, reply) => {
    const empId = await resolveEmployeeId(req)
    if (!empId) return reply.code(400).send({ error: 'NO_EMPLOYEE_LINK', message: 'Profile not linked' })
    const { id } = req.params as { id: string }

    const { data: existing } = await fastify.supabase
      .from('fbp_bill_submissions').select('id, status')
      .eq('id', id).eq('tenant_id', req.tenantId).eq('employee_id', empId).single()
    if (!existing) return reply.code(404).send({ error: 'NOT_FOUND', message: 'Submission not found' })
    if ((existing as any).status !== 'draft')
      return reply.code(409).send({ error: 'INVALID_STATUS', message: `Cannot submit (status: ${(existing as any).status})` })

    const { error } = await fastify.supabase
      .from('fbp_bill_submissions')
      .update({ status: 'submitted', submitted_at: new Date().toISOString(), updated_at: new Date().toISOString() })
      .eq('id', id).eq('tenant_id', req.tenantId)
    if (error) return reply.code(500).send({ error: 'UPDATE_FAILED', message: error.message })
    return reply.send({ message: 'Submitted for approval' })
  })

  // ── ESS: attach a bill file (metadata; file already uploaded to storage) ──────
  fastify.post('/my/:id/attachments', auth, async (req: any, reply) => {
    const empId = await resolveEmployeeId(req)
    if (!empId) return reply.code(400).send({ error: 'NO_EMPLOYEE_LINK', message: 'Profile not linked' })
    const { id } = req.params as { id: string }

    const schema = z.object({
      file_name:       z.string().min(1),
      storage_path:    z.string().min(1),
      mime_type:       z.string().optional(),
      file_size_bytes: z.number().int().optional(),
    })
    const parsed = schema.safeParse(req.body)
    if (!parsed.success) return reply.code(400).send({ error: 'VALIDATION_ERROR', message: parsed.error.issues[0]?.message })

    const { data: sub } = await fastify.supabase
      .from('fbp_bill_submissions').select('id')
      .eq('id', id).eq('tenant_id', req.tenantId).eq('employee_id', empId).single()
    if (!sub) return reply.code(404).send({ error: 'NOT_FOUND', message: 'Submission not found' })

    const { data, error } = await fastify.supabase
      .from('fbp_bill_attachments')
      .insert({ tenant_id: req.tenantId, submission_id: id, ...parsed.data, uploaded_by: req.userId })
      .select().single()
    if (error) return reply.code(500).send({ error: 'INSERT_FAILED', message: error.message })
    return reply.code(201).send({ data })
  })

  // ── List attachments for a submission (ESS sees own; HR sees all via RLS) ─────
  fastify.get('/submissions/:id/attachments', auth, async (req: any, reply) => {
    const { id } = req.params as { id: string }
    const { data, error } = await fastify.supabase
      .from('fbp_bill_attachments')
      .select('id, file_name, storage_path, mime_type, file_size_bytes, uploaded_at')
      .eq('tenant_id', req.tenantId)
      .eq('submission_id', id)
      .order('uploaded_at', { ascending: false }).limit(50)
    if (error) return reply.code(500).send({ error: 'QUERY_FAILED', message: error.message })
    return reply.send({ data: data ?? [] })
  })

  // ── HR: list submissions ─────────────────────────────────────────────────────
  fastify.get('/submissions', hrAuth, async (req: any, reply) => {
    const qs = z.object({
      status:         z.string().optional(),
      financial_year: z.string().optional(),
      quarter:        z.coerce.number().optional(),
    }).safeParse(req.query)

    let q = fastify.supabase
      .from('fbp_bill_submissions')
      .select('*, salary_components(id, name, code), employees!inner(id, first_name, last_name, employee_code)')
      .eq('tenant_id', req.tenantId)
      .order('created_at', { ascending: false }).limit(500)
    if (qs.success && qs.data.status)         q = q.eq('status', qs.data.status)
    if (qs.success && qs.data.financial_year) q = q.eq('financial_year', qs.data.financial_year)
    if (qs.success && qs.data.quarter)        q = q.eq('quarter', qs.data.quarter)

    const { data, error } = await q
    if (error) return reply.code(500).send({ error: 'QUERY_FAILED', message: error.message })
    return reply.send({ data: data ?? [] })
  })

  // ── HR: approve submission (approved_amount may differ from claimed) ──────────
  fastify.post('/submissions/:id/approve', hrAuth, async (req: any, reply) => {
    const { id } = req.params as { id: string }
    const schema = z.object({ approved_amount: z.number().min(0) })
    const parsed = schema.safeParse(req.body)
    if (!parsed.success) return reply.code(400).send({ error: 'VALIDATION_ERROR', message: parsed.error.issues[0]?.message })

    const { data: existing } = await fastify.supabase
      .from('fbp_bill_submissions').select('id, status, employee_id')
      .eq('id', id).eq('tenant_id', req.tenantId).single()
    if (!existing) return reply.code(404).send({ error: 'NOT_FOUND', message: 'Submission not found' })
    if ((existing as any).status !== 'submitted')
      return reply.code(409).send({ error: 'INVALID_STATUS', message: `Only submitted bills can be approved (status: ${(existing as any).status})` })

    const now = new Date().toISOString()
    const { data, error } = await fastify.supabase
      .from('fbp_bill_submissions')
      .update({ status: 'approved', approved_amount: parsed.data.approved_amount, reviewed_by: req.userId, reviewed_at: now, updated_at: now })
      .eq('id', id).eq('tenant_id', req.tenantId).select().single()
    if (error) return reply.code(500).send({ error: 'UPDATE_FAILED', message: error.message })

    await logAction(fastify.supabase, {
      tenantId: req.tenantId, tableName: 'fbp_bill_submissions', recordId: id,
      action: 'UPDATE', performedBy: req.userId, onBehalfOf: (existing as any).employee_id ?? null,
      newData: { status: 'approved', approved_amount: parsed.data.approved_amount },
    })
    return reply.send({ data })
  })

  // ── HR: reject submission ────────────────────────────────────────────────────
  fastify.post('/submissions/:id/reject', hrAuth, async (req: any, reply) => {
    const { id } = req.params as { id: string }
    const schema = z.object({ rejection_reason: z.string().min(1) })
    const parsed = schema.safeParse(req.body)
    if (!parsed.success) return reply.code(400).send({ error: 'VALIDATION_ERROR', message: parsed.error.issues[0]?.message })

    const { data: existing } = await fastify.supabase
      .from('fbp_bill_submissions').select('id, status')
      .eq('id', id).eq('tenant_id', req.tenantId).single()
    if (!existing) return reply.code(404).send({ error: 'NOT_FOUND', message: 'Submission not found' })
    if ((existing as any).status !== 'submitted')
      return reply.code(409).send({ error: 'INVALID_STATUS', message: `Only submitted bills can be rejected (status: ${(existing as any).status})` })

    const now = new Date().toISOString()
    const { data, error } = await fastify.supabase
      .from('fbp_bill_submissions')
      .update({ status: 'rejected', rejection_reason: parsed.data.rejection_reason, reviewed_by: req.userId, reviewed_at: now, updated_at: now })
      .eq('id', id).eq('tenant_id', req.tenantId).select().single()
    if (error) return reply.code(500).send({ error: 'UPDATE_FAILED', message: error.message })
    return reply.send({ data })
  })

  // ── HR: compute the quarter reconciliation (paid vs bills → taxable) ──────────
  fastify.get('/reconciliation', hrAuth, async (req: any, reply) => {
    const qs = z.object({
      financial_year: z.string().regex(FY_RE),
      quarter:        z.coerce.number().int().min(1).max(4),
    }).safeParse(req.query)
    if (!qs.success) return reply.code(400).send({ error: 'VALIDATION_ERROR', message: qs.error.issues[0]?.message })

    try {
      const rows = await computeQuarterReconciliation(fastify.supabase, req.tenantId, qs.data.financial_year, qs.data.quarter)
      const total_taxable = rows.reduce((s, r) => s + r.taxable_amount, 0)
      return reply.send({ data: { rows, total_taxable: Math.round(total_taxable * 100) / 100 } })
    } catch (e: any) {
      return reply.code(500).send({ error: 'RECONCILE_FAILED', message: e?.message ?? 'Reconciliation failed' })
    }
  })

  // ── HR: lock the quarter (freezes taxable for TDS) ───────────────────────────
  fastify.post('/reconciliation/lock', hrAuth, async (req: any, reply) => {
    const schema = z.object({
      financial_year: z.string().regex(FY_RE),
      quarter:        z.number().int().min(1).max(4),
    })
    const parsed = schema.safeParse(req.body)
    if (!parsed.success) return reply.code(400).send({ error: 'VALIDATION_ERROR', message: parsed.error.issues[0]?.message })

    try {
      // Ensure rows exist + are current before locking.
      await computeQuarterReconciliation(fastify.supabase, req.tenantId, parsed.data.financial_year, parsed.data.quarter)
      const locked = await lockQuarterReconciliation(fastify.supabase, req.tenantId, parsed.data.financial_year, parsed.data.quarter, req.userId)
      await logAction(fastify.supabase, {
        tenantId: req.tenantId, tableName: 'fbp_reconciliations', recordId: req.tenantId,
        action: 'UPDATE', performedBy: req.userId,
        newData: { locked, financial_year: parsed.data.financial_year, quarter: parsed.data.quarter },
      })
      return reply.send({ data: { locked } })
    } catch (e: any) {
      return reply.code(500).send({ error: 'LOCK_FAILED', message: e?.message ?? 'Lock failed' })
    }
  })
}
