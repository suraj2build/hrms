/**
 * Previous Employment Tax Details Routes
 * ESS + admin routes for Form 12B / previous employer TDS data.
 *
 * Route groups (all under prefix '/payroll/statutory/tds'):
 *   ESS  (/my)        — employee reads/writes for their own records
 *   Admin (/verify)   — HR admin verification workflow
 */

import type { FastifyInstance } from 'fastify'
import { z } from 'zod'

// ── Zod schemas ───────────────────────────────────────────────────────────────

const previousEmploymentBodySchema = z.object({
  financial_year:  z.string().regex(/^\d{4}-\d{2}$/, 'financial_year must be YYYY-YY'),
  employer_name:   z.string().min(1, 'employer_name is required'),
  employer_tan:    z.string().optional(),
  gross_income:    z.number().nonnegative(),
  tds_deducted:    z.number().nonnegative().default(0),
  pf_deducted:     z.number().nonnegative().default(0),
  ptax_deducted:   z.number().nonnegative().default(0),
  from_date:       z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  to_date:         z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  remarks:         z.string().optional(),
})

const verifyBodySchema = z.object({
  verification_status: z.enum(['verified', 'rejected']),
  rejection_reason:    z.string().optional(),
})

// ── Helper ────────────────────────────────────────────────────────────────────

async function resolveCallerEmployeeId(fastify: FastifyInstance, req: any): Promise<string | null> {
  const { data } = await fastify.supabase
    .from('profiles')
    .select('employee_id')
    .eq('id', req.userId)
    .eq('tenant_id', req.tenantId)
    .single()
  return (data as any)?.employee_id ?? null
}

// =============================================================================
export default async function previousEmploymentTdsRoutes(fastify: FastifyInstance) {
  const auth = { preHandler: [fastify.authenticate] }

  function requireHrAdmin(req: any, reply: any, done: () => void) {
    if (!['super_admin', 'hr_admin'].includes(req.userRole)) {
      reply.code(403).send({ error: 'FORBIDDEN', message: 'HR admin access required' })
      return
    }
    done()
  }

  // ── GET /previous-employment/my ─────────────────────────────────────────────
  fastify.get('/previous-employment/my', auth, async (req: any, reply) => {
    const querySchema = z.object({
      financial_year: z.string().optional(),
    })

    const parsed = querySchema.safeParse(req.query)
    if (!parsed.success) {
      return reply.code(400).send({ error: 'VALIDATION_ERROR', message: parsed.error.issues[0]?.message })
    }

    const employeeId = await resolveCallerEmployeeId(fastify, req)
    if (!employeeId) {
      return reply.code(404).send({ error: 'EMPLOYEE_NOT_FOUND', message: 'No employee record linked to this account' })
    }

    let q = fastify.supabase
      .from('previous_employment_tax_details')
      .select('*')
      .eq('tenant_id', req.tenantId)
      .eq('employee_id', employeeId)
      .order('created_at', { ascending: false })

    if (parsed.data.financial_year) {
      q = q.eq('financial_year', parsed.data.financial_year)
    }

    const { data, error } = await q
    if (error) return reply.code(500).send({ error: 'QUERY_FAILED', message: error.message })
    return reply.send({ data: data ?? [] })
  })

  // ── POST /previous-employment/my ────────────────────────────────────────────
  fastify.post('/previous-employment/my', auth, async (req: any, reply) => {
    const parsed = previousEmploymentBodySchema.safeParse(req.body)
    if (!parsed.success) {
      return reply.code(400).send({ error: 'VALIDATION_ERROR', message: parsed.error.issues[0]?.message })
    }

    const employeeId = await resolveCallerEmployeeId(fastify, req)
    if (!employeeId) {
      return reply.code(404).send({ error: 'EMPLOYEE_NOT_FOUND', message: 'No employee record linked to this account' })
    }

    const { data, error } = await fastify.supabase
      .from('previous_employment_tax_details')
      .insert({
        ...parsed.data,
        tenant_id:           req.tenantId,
        employee_id:         employeeId,
        status:              'pending',
        verification_status: 'pending',
        created_by:          req.userId,
        created_at:          new Date().toISOString(),
        updated_at:          new Date().toISOString(),
      })
      .select()
      .single()

    if (error) return reply.code(500).send({ error: 'INSERT_FAILED', message: error.message })
    return reply.code(201).send({ data })
  })

  // ── PUT /previous-employment/my/:id ─────────────────────────────────────────
  fastify.put('/previous-employment/my/:id', auth, async (req: any, reply) => {
    const { id } = req.params as { id: string }

    const parsed = previousEmploymentBodySchema.partial().safeParse(req.body)
    if (!parsed.success) {
      return reply.code(400).send({ error: 'VALIDATION_ERROR', message: parsed.error.issues[0]?.message })
    }

    const employeeId = await resolveCallerEmployeeId(fastify, req)
    if (!employeeId) {
      return reply.code(404).send({ error: 'EMPLOYEE_NOT_FOUND', message: 'No employee record linked to this account' })
    }

    // Fetch the record first to verify ownership and status
    const { data: existing, error: fetchErr } = await fastify.supabase
      .from('previous_employment_tax_details')
      .select('id, employee_id, status, verification_status')
      .eq('id', id)
      .eq('tenant_id', req.tenantId)
      .maybeSingle()

    if (fetchErr) return reply.code(500).send({ error: 'QUERY_FAILED', message: fetchErr.message })
    if (!existing) return reply.code(404).send({ error: 'NOT_FOUND', message: 'Record not found' })

    const rec = existing as any
    if (rec.employee_id !== employeeId) {
      return reply.code(403).send({ error: 'FORBIDDEN', message: 'You can only edit your own records' })
    }
    if (!['pending', 'under_review'].includes(rec.verification_status ?? rec.status)) {
      return reply.code(409).send({ error: 'NOT_EDITABLE', message: 'Only pending or under_review records can be edited' })
    }

    const { data, error } = await fastify.supabase
      .from('previous_employment_tax_details')
      .update({
        ...parsed.data,
        updated_at: new Date().toISOString(),
      })
      .eq('id', id)
      .eq('tenant_id', req.tenantId)
      .select()
      .single()

    if (error) return reply.code(500).send({ error: 'UPDATE_FAILED', message: error.message })
    return reply.send({ data })
  })

  // ── DELETE /previous-employment/my/:id ──────────────────────────────────────
  fastify.delete('/previous-employment/my/:id', auth, async (req: any, reply) => {
    const { id } = req.params as { id: string }

    const isAdmin = ['super_admin', 'hr_admin'].includes(req.userRole)

    // Fetch record
    const { data: existing, error: fetchErr } = await fastify.supabase
      .from('previous_employment_tax_details')
      .select('id, employee_id, verification_status')
      .eq('id', id)
      .eq('tenant_id', req.tenantId)
      .maybeSingle()

    if (fetchErr) return reply.code(500).send({ error: 'QUERY_FAILED', message: fetchErr.message })
    if (!existing) return reply.code(404).send({ error: 'NOT_FOUND', message: 'Record not found' })

    const rec = existing as any

    if (!isAdmin) {
      // Employee path: must own the record and it must still be pending
      const employeeId = await resolveCallerEmployeeId(fastify, req)
      if (!employeeId) {
        return reply.code(404).send({ error: 'EMPLOYEE_NOT_FOUND', message: 'No employee record linked to this account' })
      }
      if (rec.employee_id !== employeeId) {
        return reply.code(403).send({ error: 'FORBIDDEN', message: 'You can only delete your own records' })
      }
      if (rec.verification_status !== 'pending') {
        return reply.code(409).send({ error: 'NOT_DELETABLE', message: 'Only pending records can be deleted' })
      }
    }

    const { error } = await fastify.supabase
      .from('previous_employment_tax_details')
      .delete()
      .eq('id', id)
      .eq('tenant_id', req.tenantId)

    if (error) return reply.code(500).send({ error: 'DELETE_FAILED', message: error.message })
    return reply.code(204).send()
  })

  // ── GET /previous-employment/admin (admin only) — all-tenant list ──────────
  // Must be registered BEFORE /previous-employment/:employeeId so that the
  // literal segment 'admin' is not captured as an employeeId param.
  fastify.get(
    '/previous-employment/admin',
    { preHandler: [fastify.authenticate, requireHrAdmin] },
    async (req: any, reply) => {
      const querySchema = z.object({
        financial_year: z.string().optional(),
        status:         z.string().optional(),
      })
      const parsed = querySchema.safeParse(req.query)
      if (!parsed.success) {
        return reply.code(400).send({ error: 'VALIDATION_ERROR', message: parsed.error.issues[0]?.message })
      }

      let q = fastify.supabase
        .from('previous_employment_tax_details')
        .select('*, employees(id, first_name, last_name)')
        .eq('tenant_id', req.tenantId)
        .order('created_at', { ascending: false })

      if (parsed.data.financial_year) q = q.eq('financial_year', parsed.data.financial_year)
      if (parsed.data.status)         q = q.eq('verification_status', parsed.data.status)

      const { data, error } = await q

      if (error) return reply.code(500).send({ error: 'QUERY_FAILED', message: error.message })

      // Map DB shape → frontend PrevEmployerAdmin shape
      const result = (data ?? []).map((r: any) => ({
        id:               r.id,
        financial_year:   r.financial_year,
        employee_id:      r.employee_id,
        employee_name:    r.employees
          ? `${r.employees.first_name ?? ''} ${r.employees.last_name ?? ''}`.trim()
          : r.employee_id,
        employer_name:    r.employer_name,
        employer_tan:     r.employer_tan ?? null,
        gross_income:     Number(r.gross_income ?? 0),
        tds_deducted:     Number(r.tds_deducted ?? 0),
        pf_deducted:      Number(r.pf_deducted ?? 0),
        professional_tax: Number(r.ptax_deducted ?? 0),
        status:           r.verification_status as string,
        rejection_reason: r.rejection_reason ?? null,
        created_at:       r.created_at,
      }))

      return reply.send(result)
    },
  )

  // ── GET /previous-employment/:employeeId (admin only) ───────────────────────
  fastify.get(
    '/previous-employment/:employeeId',
    { preHandler: [fastify.authenticate, requireHrAdmin] },
    async (req: any, reply) => {
      const { employeeId } = req.params as { employeeId: string }

      const querySchema = z.object({
        financial_year: z.string().optional(),
      })
      const parsed = querySchema.safeParse(req.query)
      if (!parsed.success) {
        return reply.code(400).send({ error: 'VALIDATION_ERROR', message: parsed.error.issues[0]?.message })
      }

      let q = fastify.supabase
        .from('previous_employment_tax_details')
        .select('*')
        .eq('tenant_id', req.tenantId)
        .eq('employee_id', employeeId)
        .order('created_at', { ascending: false })

      if (parsed.data.financial_year) {
        q = q.eq('financial_year', parsed.data.financial_year)
      }

      const { data, error } = await q
      if (error) return reply.code(500).send({ error: 'QUERY_FAILED', message: error.message })
      return reply.send({ data: data ?? [] })
    },
  )

  // ── PUT /previous-employment/:id/verify (admin only) ────────────────────────
  fastify.put(
    '/previous-employment/:id/verify',
    { preHandler: [fastify.authenticate, requireHrAdmin] },
    async (req: any, reply) => {
      const { id } = req.params as { id: string }

      const parsed = verifyBodySchema.safeParse(req.body)
      if (!parsed.success) {
        return reply.code(400).send({ error: 'VALIDATION_ERROR', message: parsed.error.issues[0]?.message })
      }

      if (parsed.data.verification_status === 'rejected' && !parsed.data.rejection_reason) {
        return reply.code(400).send({ error: 'REJECTION_REASON_REQUIRED', message: 'rejection_reason is required when rejecting a record' })
      }

      const now = new Date().toISOString()

      const { data, error } = await fastify.supabase
        .from('previous_employment_tax_details')
        .update({
          verification_status: parsed.data.verification_status,
          rejection_reason:    parsed.data.rejection_reason ?? null,
          verified_by:         req.userId,
          verified_at:         now,
          updated_at:          now,
        })
        .eq('id', id)
        .eq('tenant_id', req.tenantId)
        .select()
        .single()

      if (error) return reply.code(500).send({ error: 'UPDATE_FAILED', message: error.message })
      if (!data) return reply.code(404).send({ error: 'NOT_FOUND', message: 'Record not found' })

      return reply.send({ data })
    },
  )
}
