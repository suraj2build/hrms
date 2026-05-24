/**
 * TDS (Tax Deducted at Source) Routes
 * Tax regime elections, declarations, projections, and monthly TDS computation.
 */

import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { computeTDS } from '../../../lib/statutory/tds-engine.js'

const DECLARATION_CATEGORIES = [
  'section_80c',
  'section_80d',
  'section_80e',
  'section_80g',
  'section_80tta',
  'hra',
  'lta',
  'standard_deduction',
  'home_loan_interest',
  'nps',
  'other',
] as const

export default async function tdsRoutes(fastify: FastifyInstance) {
  const auth = { preHandler: [fastify.authenticate] }

  function requireHrAdmin(req: any, reply: any, done: () => void) {
    if (!['super_admin', 'hr_admin'].includes(req.userRole)) {
      reply.code(403).send({ error: 'FORBIDDEN', message: 'HR admin access required' })
      return
    }
    done()
  }

  // ── GET /payroll/statutory/tds/regime/:employeeId ─────────────────────────────
  fastify.get('/regime/:employeeId', auth, async (req: any, reply) => {
    const { employeeId } = req.params as { employeeId: string }

    // Get current financial year
    const now = new Date()
    const fyYear = now.getMonth() >= 3 ? now.getFullYear() : now.getFullYear() - 1
    const currentFY = `${fyYear}-${String(fyYear + 1).slice(2)}`

    const { data, error } = await fastify.supabase
      .from('tax_regime_elections')
      .select('*')
      .eq('employee_id', employeeId)
      .eq('tenant_id', req.tenantId)
      .eq('financial_year', currentFY)
      .order('effective_from', { ascending: false })
      .limit(1)
      .maybeSingle()

    if (error) return reply.code(500).send({ error: 'QUERY_FAILED', message: error.message })
    return reply.send({ data: data ?? null })
  })

  // ── PUT /payroll/statutory/tds/regime/:employeeId ─────────────────────────────
  fastify.put('/regime/:employeeId', auth, async (req: any, reply) => {
    const { employeeId } = req.params as { employeeId: string }

    const schema = z.object({
      regime: z.enum(['old', 'new']),
      financial_year: z.string().min(1),
    })

    const parsed = schema.safeParse(req.body)
    if (!parsed.success) {
      return reply.code(400).send({ error: 'VALIDATION_ERROR', message: parsed.error.issues[0]?.message })
    }

    const { data, error } = await fastify.supabase
      .from('tax_regime_elections')
      .upsert({
        ...parsed.data,
        employee_id: employeeId,
        tenant_id: req.tenantId,
        effective_from: new Date().toISOString().slice(0, 10),
        elected_by: req.userId,
        updated_at: new Date().toISOString(),
      }, { onConflict: 'tenant_id,employee_id,financial_year' })
      .select()
      .single()

    if (error) return reply.code(500).send({ error: 'UPSERT_FAILED', message: error.message })
    return reply.send({ data })
  })

  // ── GET /payroll/statutory/tds/declarations/:employeeId ──────────────────────
  fastify.get('/declarations/:employeeId', auth, async (req: any, reply) => {
    const { employeeId } = req.params as { employeeId: string }

    const querySchema = z.object({
      financial_year: z.string().optional(),
    })

    const parsed = querySchema.safeParse(req.query)
    if (!parsed.success) {
      return reply.code(400).send({ error: 'VALIDATION_ERROR', message: parsed.error.issues[0]?.message })
    }

    let q = fastify.supabase
      .from('tax_declarations')
      .select('*')
      .eq('employee_id', employeeId)
      .eq('tenant_id', req.tenantId)
      .order('created_at', { ascending: false })

    if (parsed.data.financial_year) q = q.eq('financial_year', parsed.data.financial_year)

    const { data, error } = await q
    if (error) return reply.code(500).send({ error: 'QUERY_FAILED', message: error.message })
    return reply.send({ data: data ?? [] })
  })

  // ── POST /payroll/statutory/tds/declarations ──────────────────────────────────
  fastify.post('/declarations', auth, async (req: any, reply) => {
    const schema = z.object({
      employee_id: z.string().uuid(),
      financial_year: z.string().min(1),
      declaration_category: z.enum(DECLARATION_CATEGORIES),
      section: z.string().min(1),
      description: z.string().min(1),
      declared_amount: z.number().positive(),
    })

    const parsed = schema.safeParse(req.body)
    if (!parsed.success) {
      return reply.code(400).send({ error: 'VALIDATION_ERROR', message: parsed.error.issues[0]?.message })
    }

    const { data, error } = await fastify.supabase
      .from('tax_declarations')
      .insert({
        ...parsed.data,
        tenant_id: req.tenantId,
        status: 'declared',
        created_by: req.userId,
      })
      .select()
      .single()

    if (error) return reply.code(500).send({ error: 'INSERT_FAILED', message: error.message })
    return reply.code(201).send({ data })
  })

  // ── PUT /payroll/statutory/tds/declarations/:id ───────────────────────────────
  fastify.put('/declarations/:id', auth, async (req: any, reply) => {
    const { id } = req.params as { id: string }

    // Verify declaration status is 'declared'
    const { data: existing } = await fastify.supabase
      .from('tax_declarations')
      .select('status')
      .eq('id', id)
      .eq('tenant_id', req.tenantId)
      .single()

    if (!existing) return reply.code(404).send({ error: 'NOT_FOUND', message: 'Declaration not found' })
    if ((existing as any).status !== 'declared') {
      return reply.code(409).send({ error: 'INVALID_STATUS', message: 'Only declarations with status "declared" can be updated' })
    }

    const schema = z.object({
      declared_amount: z.number().positive().optional(),
      description: z.string().optional(),
    })

    const parsed = schema.safeParse(req.body)
    if (!parsed.success) {
      return reply.code(400).send({ error: 'VALIDATION_ERROR', message: parsed.error.issues[0]?.message })
    }

    const { data, error } = await fastify.supabase
      .from('tax_declarations')
      .update({ ...parsed.data, updated_at: new Date().toISOString() })
      .eq('id', id)
      .eq('tenant_id', req.tenantId)
      .select()
      .single()

    if (error) return reply.code(500).send({ error: 'UPDATE_FAILED', message: error.message })
    return reply.send({ data })
  })

  // ── POST /payroll/statutory/tds/declarations/:id/approve ─────────────────────
  fastify.post('/declarations/:id/approve', { preHandler: [fastify.authenticate, requireHrAdmin] }, async (req: any, reply) => {
    const { id } = req.params as { id: string }

    const schema = z.object({
      approved_amount: z.number(),
    })

    const parsed = schema.safeParse(req.body)
    if (!parsed.success) {
      return reply.code(400).send({ error: 'VALIDATION_ERROR', message: parsed.error.issues[0]?.message })
    }

    const now = new Date().toISOString()

    const { data, error } = await fastify.supabase
      .from('tax_declarations')
      .update({
        status: 'approved',
        approved_amount: parsed.data.approved_amount,
        reviewed_by: req.userId,
        reviewed_at: now,
        updated_at: now,
      })
      .eq('id', id)
      .eq('tenant_id', req.tenantId)
      .select()
      .single()

    if (error) return reply.code(500).send({ error: 'UPDATE_FAILED', message: error.message })
    if (!data) return reply.code(404).send({ error: 'NOT_FOUND', message: 'Declaration not found' })

    return reply.send({ data })
  })

  // ── POST /payroll/statutory/tds/declarations/:id/reject ──────────────────────
  fastify.post('/declarations/:id/reject', { preHandler: [fastify.authenticate, requireHrAdmin] }, async (req: any, reply) => {
    const { id } = req.params as { id: string }

    const schema = z.object({
      rejection_reason: z.string().min(1),
    })

    const parsed = schema.safeParse(req.body)
    if (!parsed.success) {
      return reply.code(400).send({ error: 'VALIDATION_ERROR', message: parsed.error.issues[0]?.message })
    }

    const now = new Date().toISOString()

    const { data, error } = await fastify.supabase
      .from('tax_declarations')
      .update({
        status: 'rejected',
        rejection_reason: parsed.data.rejection_reason,
        reviewed_by: req.userId,
        reviewed_at: now,
        updated_at: now,
      })
      .eq('id', id)
      .eq('tenant_id', req.tenantId)
      .select()
      .single()

    if (error) return reply.code(500).send({ error: 'UPDATE_FAILED', message: error.message })
    if (!data) return reply.code(404).send({ error: 'NOT_FOUND', message: 'Declaration not found' })

    return reply.send({ data })
  })

  // ── GET /payroll/statutory/tds/projections/:employeeId ───────────────────────
  fastify.get('/projections/:employeeId', auth, async (req: any, reply) => {
    const { employeeId } = req.params as { employeeId: string }

    const querySchema = z.object({
      financial_year: z.string().optional(),
    })

    const parsed = querySchema.safeParse(req.query)
    if (!parsed.success) {
      return reply.code(400).send({ error: 'VALIDATION_ERROR', message: parsed.error.issues[0]?.message })
    }

    let q = fastify.supabase
      .from('tds_monthly_projections')
      .select('*')
      .eq('employee_id', employeeId)
      .eq('tenant_id', req.tenantId)

    if (parsed.data.financial_year) q = q.eq('financial_year', parsed.data.financial_year)

    const { data, error } = await q
    if (error) return reply.code(500).send({ error: 'QUERY_FAILED', message: error.message })
    return reply.send({ data: data ?? [] })
  })

  // ── POST /payroll/statutory/tds/projections/compute/:employeeId ──────────────
  fastify.post('/projections/compute/:employeeId', { preHandler: [fastify.authenticate, requireHrAdmin] }, async (req: any, reply) => {
    const { employeeId } = req.params as { employeeId: string }

    const schema = z.object({
      financial_year: z.string().min(1),
      gross_monthly: z.number().positive(),
      regime: z.enum(['old', 'new']).default('new'),
    })

    const parsed = schema.safeParse(req.body)
    if (!parsed.success) {
      return reply.code(400).send({ error: 'VALIDATION_ERROR', message: parsed.error.issues[0]?.message })
    }

    const { financial_year, gross_monthly, regime } = parsed.data

    // Fetch approved declarations sum (only meaningful for old regime)
    const { data: declarations } = await fastify.supabase
      .from('tax_declarations')
      .select('approved_amount')
      .eq('employee_id', employeeId)
      .eq('tenant_id', req.tenantId)
      .eq('financial_year', financial_year)
      .eq('status', 'approved')

    const totalDeductions = ((declarations ?? []) as any[]).reduce((sum: number, d: any) => sum + (d.approved_amount ?? 0), 0)

    // Fetch already deducted TDS this FY (sum of past months' tds_this_month)
    const currentMonth = new Date().toISOString().slice(0, 7)
    const { data: existingProjections } = await fastify.supabase
      .from('tds_monthly_projections')
      .select('tds_this_month, projection_month')
      .eq('employee_id', employeeId)
      .eq('tenant_id', req.tenantId)
      .eq('financial_year', financial_year)
      .lt('projection_month', currentMonth)

    const alreadyDeducted = ((existingProjections ?? []) as any[]).reduce(
      (sum: number, p: any) => sum + (p.tds_this_month ?? 0), 0
    )

    // Build full FY month list: Apr → Mar
    const fyStartYear = parseInt(financial_year.split('-')[0], 10)
    const months: string[] = []
    for (let m = 4; m <= 12; m++) {
      months.push(`${fyStartYear}-${String(m).padStart(2, '0')}`)
    }
    for (let m = 1; m <= 3; m++) {
      months.push(`${fyStartYear + 1}-${String(m).padStart(2, '0')}`)
    }

    const futureMonths = months.filter(m => m >= currentMonth)
    const totalRemainingMonths = futureMonths.length || 1

    // ── Run TDS engine ──────────────────────────────────────────────────────────
    const grossAnnualIncome = gross_monthly * 12
    const tdsResult = computeTDS(
      {
        grossAnnualIncome,
        regime,
        totalDeductions,
        alreadyDeducted,
        remainingMonths: totalRemainingMonths,
      },
      { financialYear: financial_year }
    )

    // Build projection rows for every month in the FY
    const projections = months.map(projectionMonth => ({
      tenant_id: req.tenantId,
      employee_id: employeeId,
      financial_year,
      projection_month: projectionMonth,
      gross_monthly,
      projected_annual_income: grossAnnualIncome,
      total_deductions: tdsResult.applicableDeductions,
      taxable_income: tdsResult.taxableIncome,
      tax_liability: tdsResult.annualTaxLiability,
      tds_already_deducted: alreadyDeducted,
      tds_this_month: projectionMonth >= currentMonth ? tdsResult.monthlyTDS : 0,
      remaining_months: totalRemainingMonths,
    }))

    const { error: upsertErr } = await fastify.supabase
      .from('tds_monthly_projections')
      .upsert(projections, { onConflict: 'tenant_id,employee_id,financial_year,projection_month' })

    if (upsertErr) return reply.code(500).send({ error: 'UPSERT_FAILED', message: upsertErr.message })

    return reply.send({
      months_computed: projections.length,
      regime,
      gross_annual_income: grossAnnualIncome,
      standard_deduction: tdsResult.standardDeduction,
      applicable_deductions: tdsResult.applicableDeductions,
      taxable_income: tdsResult.taxableIncome,
      annual_tax_liability: tdsResult.annualTaxLiability,
      rebate_87a: tdsResult.rebate87A,
      surcharge: tdsResult.surcharge,
      cess: tdsResult.cess,
      already_deducted: alreadyDeducted,
      remaining_tax: tdsResult.remainingTax,
      monthly_tds: tdsResult.monthlyTDS,
      trace: tdsResult.traceSteps,
    })
  })
}
