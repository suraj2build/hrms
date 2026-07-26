/**
 * tds-plans.ts — Tax Declaration Plan (Investment Planning) Routes
 *
 * Employees can create multiple draft "plans" for a financial year, build them
 * with declaration items, compute the resulting tax, compare plans, and finally
 * submit the best plan as their active declaration.
 *
 * Routes (prefix: /payroll/statutory/tds):
 *   GET    /plans/my                         — list all my plans for a FY
 *   POST   /plans/my                         — create a plan
 *   PUT    /plans/my/:planId                 — rename / change regime (draft only)
 *   DELETE /plans/my/:planId                 — archive a draft plan
 *   GET    /plans/my/:planId/items           — get plan items with component details
 *   POST   /plans/my/:planId/items           — bulk upsert items
 *   GET    /plans/my/:planId/compute         — compute tax for this plan
 *   POST   /plans/my/:planId/submit          — submit as active declaration
 *   GET    /plans/my/compare                 — side-by-side comparison of up to 3 plans
 */

import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { computeTaxWithDB } from '../../../lib/statutory/tax-computation-engine.js'
import { logAction } from '../../../lib/audit-service.js'
import { checkDeclarationWindow } from './tds.js'
import { serverError, ErrorCode } from '../../../lib/api-errors.js'

// ── Helpers ───────────────────────────────────────────────────────────────────

function currentFinancialYear(): string {
  const now = new Date()
  const fyYear = now.getMonth() >= 3 ? now.getFullYear() : now.getFullYear() - 1
  return `${fyYear}-${String(fyYear + 1).slice(2)}`
}

function remainingMonthsInFY(financialYear: string): number {
  const fyStart = parseInt(financialYear.split('-')[0], 10)
  const now = new Date()
  const currentMonthStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`

  const fyMonths: string[] = []
  for (let m = 4; m <= 12; m++) fyMonths.push(`${fyStart}-${String(m).padStart(2, '0')}`)
  for (let m = 1; m <= 3;  m++) fyMonths.push(`${fyStart + 1}-${String(m).padStart(2, '0')}`)

  return fyMonths.filter(m => m >= currentMonthStr).length || 1
}

async function resolveCallerEmployeeId(fastify: FastifyInstance, req: any): Promise<string | null> {
  const { data } = await fastify.supabase
    .from('profiles')
    .select('employee_id')
    .eq('id', req.userId)
    .eq('tenant_id', req.tenantId)
    .single()
  return (data as any)?.employee_id ?? null
}

async function writeAuditLog(
  fastify: FastifyInstance,
  tenantId: string,
  declarationId: string,
  changedBy: string,
  fromStatus: string | null,
  toStatus: string,
  notes?: string,
  metadata?: Record<string, unknown>,
): Promise<void> {
  await fastify.supabase
    .from('tds_declaration_audit_log')
    .insert({
      tenant_id:      tenantId,
      declaration_id: declarationId,
      changed_by:     changedBy,
      changed_at:     new Date().toISOString(),
      from_status:    fromStatus ?? null,
      to_status:      toStatus,
      notes:          notes ?? null,
      metadata:       metadata ?? {},
    })
}

/**
 * Build TaxComputationInput from plan items + component catalogue + regime.
 * Items are keyed by component section_code for easy mapping.
 */
function buildComputationInput(
  grossAnnualIncome: number,
  regime: 'old' | 'new',
  financialYear: string,
  items: any[],
  components: any[],
  alreadyDeducted: number,
  remainingMonths: number,
): import('../../../lib/statutory/tax-computation-engine.js').TaxComputationInput {
  // Build a map of section_code → declared_amount from plan items + component metadata
  const compMap: Record<string, any> = {}
  for (const c of components) compMap[c.id] = c

  const amountBySectionCode: Record<string, number> = {}
  for (const item of items) {
    const comp = compMap[item.component_id]
    if (!comp) continue
    const key = comp.section_code
    amountBySectionCode[key] = (amountBySectionCode[key] ?? 0) + (Number(item.declared_amount) || 0)
  }

  const get = (key: string) => amountBySectionCode[key] ?? 0

  return {
    grossAnnualIncome,
    regime,
    financialYear,
    deductions: {
      section80C:              get('80C'),
      section80CCD1B:          get('80CCD1B'),
      section80D:              get('80D'),
      section80E:              get('80E'),
      section80G:              get('80G'),
      section80TTA:            get('80TTA'),
      hraExemption:            get('HRA'),
      homeLoanInterest:        get('home_loan_interest'),
      otherDeductions:         get('other_deductions'),
      professionalTax:         get('professional_tax'),
      previousEmployerTDS:     get('previous_employer_tds'),
      tdsOthers:               get('tds_others'),
      otherIncome:             get('other_income'),
      previousEmployerSalary:  get('previous_employer_salary'),
    },
    alreadyDeducted,
    remainingMonths,
  }
}

// =============================================================================
export default async function tdsPlansRoute(fastify: FastifyInstance) {
  const auth = { preHandler: [fastify.authenticate] }

  // ===========================================================================
  // GET /plans/my/compare?plan_ids=id1,id2,id3
  // IMPORTANT: this MUST be registered before /plans/my/:planId to avoid
  // Fastify treating "compare" as a planId param value.
  // ===========================================================================
  fastify.get('/plans/my/compare', auth, async (req: any, reply) => {
    const employeeId = await resolveCallerEmployeeId(fastify, req)
    if (!employeeId) {
      return reply.code(403).send({ error: 'PROFILE_NOT_LINKED', message: 'Your profile is not linked to an employee record' })
    }

    const qsSchema = z.object({
      plan_ids: z.string().min(1),
    })
    const qs = qsSchema.safeParse(req.query)
    if (!qs.success) {
      return reply.code(400).send({ error: 'VALIDATION_ERROR', message: 'plan_ids query param required (comma-separated, up to 3)' })
    }

    const planIds = qs.data.plan_ids.split(',').map(s => s.trim()).filter(Boolean).slice(0, 3)
    if (planIds.length < 2) {
      return reply.code(400).send({ error: 'VALIDATION_ERROR', message: 'Provide at least 2 plan IDs to compare' })
    }

    // Verify all plans belong to this employee
    const { data: plans, error: plansErr } = await fastify.supabase
      .from('tax_declaration_plans')
      .select('*')
      .in('id', planIds)
      .eq('employee_id', employeeId)
      .eq('tenant_id', req.tenantId)

    if (plansErr) return serverError(req, reply, plansErr, ErrorCode.QUERY_FAILED, 'Failed to fetch plans for comparison')
    if (!plans || (plans as any[]).length === 0) {
      return reply.code(404).send({ error: 'NOT_FOUND', message: 'No matching plans found' })
    }

    // Load employee's latest payroll slip for gross salary
    const { data: latestSlip } = await fastify.supabase
      .from('payroll_slips')
      .select('gross_pay')
      .eq('employee_id', employeeId)
      .eq('tenant_id', req.tenantId)
      .order('month', { ascending: false })
      .limit(1)
      .maybeSingle()

    const grossMonthly = (latestSlip as any)?.gross_pay ?? 0
    const grossAnnual  = grossMonthly * 12

    // Compute tax for each plan
    const comparisons = await Promise.all(
      (plans as any[]).map(async (plan: any) => {
        const fy = plan.financial_year
        const remaining = remainingMonthsInFY(fy)

        // Load items for this plan with component data
        const { data: items } = await fastify.supabase
          .from('tax_declaration_plan_items')
          .select('*, tax_declaration_components(id, section_code, display_name, parent_group)')
          .eq('plan_id', plan.id)

        const planItems     = (items as any[]) ?? []
        const components    = planItems.map((i: any) => i.tax_declaration_components).filter(Boolean)

        // Load already deducted TDS for FY
        const { data: slips } = await fastify.supabase
          .from('payroll_slips')
          .select('tds_deducted')
          .eq('employee_id', employeeId)
          .eq('tenant_id', req.tenantId)
          .gte('month', `${fy.split('-')[0]}-04`)
          .lte('month', `${parseInt(fy.split('-')[0]) + 1}-03`)

        const alreadyDeducted = ((slips as any[]) ?? []).reduce((s: number, r: any) => s + (r.tds_deducted ?? 0), 0)

        const inputData = buildComputationInput(
          grossAnnual,
          plan.tax_regime as 'old' | 'new',
          fy,
          planItems,
          components,
          alreadyDeducted,
          remaining,
        )

        const result = await computeTaxWithDB(fastify.supabase, inputData)

        return {
          plan: {
            id:        plan.id,
            plan_name: plan.plan_name,
            tax_regime: plan.tax_regime,
            status:    plan.status,
            is_primary: plan.is_primary,
            financial_year: plan.financial_year,
          },
          computation: {
            taxableIncome:      result.taxableIncome,
            annualTaxLiability: result.annualTaxLiability,
            monthlyTDS:         result.monthlyTDS,
            netTaxPayable:      result.netTaxPayable,
            totalDeductions:    result.totalChapterVIADeductions,
            oldRegimeTax:       result.oldRegimeTax,
            newRegimeTax:       result.newRegimeTax,
            recommendedRegime:  result.recommendedRegime,
          },
          item_count: planItems.length,
        }
      })
    )

    return reply.send({ data: comparisons })
  })

  // ===========================================================================
  // GET /plans/my?financial_year=2025-26
  // ===========================================================================
  fastify.get('/plans/my', auth, async (req: any, reply) => {
    const employeeId = await resolveCallerEmployeeId(fastify, req)
    if (!employeeId) {
      return reply.code(403).send({ error: 'PROFILE_NOT_LINKED', message: 'Your profile is not linked to an employee record' })
    }

    const qs = z.object({ financial_year: z.string().optional() }).safeParse(req.query)
    const fy = qs.data?.financial_year ?? currentFinancialYear()

    const { data, error } = await fastify.supabase
      .from('tax_declaration_plans')
      .select('*')
      .eq('employee_id', employeeId)
      .eq('tenant_id', req.tenantId)
      .eq('financial_year', fy)
      .order('created_at', { ascending: false })

    if (error) return serverError(req, reply, error, ErrorCode.QUERY_FAILED, 'Failed to fetch tax declaration plans')
    return reply.send({ data: data ?? [] })
  })

  // ===========================================================================
  // POST /plans/my — create a new plan
  // ===========================================================================
  fastify.post('/plans/my', auth, async (req: any, reply) => {
    const employeeId = await resolveCallerEmployeeId(fastify, req)
    if (!employeeId) {
      return reply.code(403).send({ error: 'PROFILE_NOT_LINKED', message: 'Your profile is not linked to an employee record' })
    }

    const schema = z.object({
      plan_name:      z.string().min(1).max(255),
      financial_year: z.string().min(1),
      tax_regime:     z.enum(['old', 'new']),
    })
    const parsed = schema.safeParse(req.body)
    if (!parsed.success) {
      return reply.code(400).send({ error: 'VALIDATION_ERROR', message: parsed.error.issues[0]?.message })
    }

    const { data, error } = await fastify.supabase
      .from('tax_declaration_plans')
      .insert({
        tenant_id:      req.tenantId,
        employee_id:    employeeId,
        plan_name:      parsed.data.plan_name,
        financial_year: parsed.data.financial_year,
        tax_regime:     parsed.data.tax_regime,
        status:         'draft',
        is_primary:     false,
      })
      .select()
      .single()

    if (error) return serverError(req, reply, error, ErrorCode.INSERT_FAILED, 'Failed to create tax declaration plan')
    await logAction(fastify.supabase, {
      tenantId:    req.tenantId,
      tableName:   'tax_declaration_plans',
      recordId:    (data as any)?.id,
      action:      'INSERT',
      performedBy: req.userId,
      onBehalfOf:  employeeId,
      newData:     parsed.data as Record<string, unknown>,
    })
    return reply.code(201).send({ data })
  })

  // ===========================================================================
  // PUT /plans/my/:planId — rename or change regime (draft only)
  // ===========================================================================
  fastify.put('/plans/my/:planId', auth, async (req: any, reply) => {
    const employeeId = await resolveCallerEmployeeId(fastify, req)
    if (!employeeId) {
      return reply.code(403).send({ error: 'PROFILE_NOT_LINKED', message: 'Your profile is not linked to an employee record' })
    }

    const { planId } = req.params as { planId: string }

    const { data: existing } = await fastify.supabase
      .from('tax_declaration_plans')
      .select('id, employee_id, status')
      .eq('id', planId)
      .eq('tenant_id', req.tenantId)
      .maybeSingle()

    if (!existing) return reply.code(404).send({ error: 'NOT_FOUND', message: 'Plan not found' })
    if ((existing as any).employee_id !== employeeId) {
      return reply.code(403).send({ error: 'FORBIDDEN', message: 'You can only modify your own plans' })
    }
    if ((existing as any).status !== 'draft') {
      return reply.code(409).send({ error: 'INVALID_STATUS', message: `Only draft plans can be modified. Current status: '${(existing as any).status}'` })
    }

    const schema = z.object({
      plan_name:  z.string().min(1).max(255).optional(),
      tax_regime: z.enum(['old', 'new']).optional(),
    })
    const parsed = schema.safeParse(req.body)
    if (!parsed.success) {
      return reply.code(400).send({ error: 'VALIDATION_ERROR', message: parsed.error.issues[0]?.message })
    }

    const { data, error } = await fastify.supabase
      .from('tax_declaration_plans')
      .update({ ...parsed.data, updated_at: new Date().toISOString() })
      .eq('id', planId)
      .eq('tenant_id', req.tenantId)
      .select()
      .single()

    if (error) return serverError(req, reply, error, ErrorCode.UPDATE_FAILED, 'Failed to update tax declaration plan')
    await logAction(fastify.supabase, {
      tenantId:    req.tenantId,
      tableName:   'tax_declaration_plans',
      recordId:    planId,
      action:      'UPDATE',
      performedBy: req.userId,
      onBehalfOf:  employeeId,
      newData:     parsed.data as Record<string, unknown>,
    })
    return reply.send({ data })
  })

  // ===========================================================================
  // DELETE /plans/my/:planId — archive a draft plan
  // ===========================================================================
  fastify.delete('/plans/my/:planId', auth, async (req: any, reply) => {
    const employeeId = await resolveCallerEmployeeId(fastify, req)
    if (!employeeId) {
      return reply.code(403).send({ error: 'PROFILE_NOT_LINKED', message: 'Your profile is not linked to an employee record' })
    }

    const { planId } = req.params as { planId: string }

    const { data: existing } = await fastify.supabase
      .from('tax_declaration_plans')
      .select('id, employee_id, status')
      .eq('id', planId)
      .eq('tenant_id', req.tenantId)
      .maybeSingle()

    if (!existing) return reply.code(404).send({ error: 'NOT_FOUND', message: 'Plan not found' })
    if ((existing as any).employee_id !== employeeId) {
      return reply.code(403).send({ error: 'FORBIDDEN', message: 'You can only delete your own plans' })
    }
    if ((existing as any).status !== 'draft') {
      return reply.code(409).send({ error: 'INVALID_STATUS', message: 'Only draft plans can be deleted' })
    }

    const { error } = await fastify.supabase
      .from('tax_declaration_plans')
      .update({ status: 'archived', updated_at: new Date().toISOString() })
      .eq('id', planId)
      .eq('tenant_id', req.tenantId)

    if (error) return serverError(req, reply, error, ErrorCode.UPDATE_FAILED, 'Failed to archive tax declaration plan')
    await logAction(fastify.supabase, {
      tenantId:    req.tenantId,
      tableName:   'tax_declaration_plans',
      recordId:    planId,
      action:      'DELETE',
      performedBy: req.userId,
      onBehalfOf:  employeeId,
      newData:     { status: 'archived' } as Record<string, unknown>,
    })
    return reply.send({ success: true, message: 'Plan archived' })
  })

  // ===========================================================================
  // GET /plans/my/:planId/items — plan items with component details
  // ===========================================================================
  fastify.get('/plans/my/:planId/items', auth, async (req: any, reply) => {
    const employeeId = await resolveCallerEmployeeId(fastify, req)
    if (!employeeId) {
      return reply.code(403).send({ error: 'PROFILE_NOT_LINKED', message: 'Your profile is not linked to an employee record' })
    }

    const { planId } = req.params as { planId: string }

    // Verify plan belongs to caller
    const { data: plan } = await fastify.supabase
      .from('tax_declaration_plans')
      .select('id, employee_id')
      .eq('id', planId)
      .eq('tenant_id', req.tenantId)
      .maybeSingle()

    if (!plan) return reply.code(404).send({ error: 'NOT_FOUND', message: 'Plan not found' })
    if ((plan as any).employee_id !== employeeId) {
      return reply.code(403).send({ error: 'FORBIDDEN', message: 'You can only view your own plan items' })
    }

    const { data, error } = await fastify.supabase
      .from('tax_declaration_plan_items')
      .select(`
        id, plan_id, declared_amount, remarks, metadata,
        tax_declaration_components (
          id, section_code, sub_section, display_name, description,
          parent_group, regime_eligibility, declaration_type, max_limit,
          proof_required
        )
      `)
      .eq('plan_id', planId)
      .order('created_at', { ascending: true })

    if (error) return serverError(req, reply, error, ErrorCode.QUERY_FAILED, 'Failed to fetch plan items')
    return reply.send({ data: data ?? [] })
  })

  // ===========================================================================
  // POST /plans/my/:planId/items — bulk upsert items
  // ===========================================================================
  fastify.post('/plans/my/:planId/items', auth, async (req: any, reply) => {
    const employeeId = await resolveCallerEmployeeId(fastify, req)
    if (!employeeId) {
      return reply.code(403).send({ error: 'PROFILE_NOT_LINKED', message: 'Your profile is not linked to an employee record' })
    }

    const windowErr = await checkDeclarationWindow(fastify, req.tenantId)
    if (windowErr) return reply.code(windowErr.code).send(windowErr.body)

    const { planId } = req.params as { planId: string }

    const { data: plan } = await fastify.supabase
      .from('tax_declaration_plans')
      .select('id, employee_id, status')
      .eq('id', planId)
      .eq('tenant_id', req.tenantId)
      .maybeSingle()

    if (!plan) return reply.code(404).send({ error: 'NOT_FOUND', message: 'Plan not found' })
    if ((plan as any).employee_id !== employeeId) {
      return reply.code(403).send({ error: 'FORBIDDEN', message: 'You can only edit your own plan items' })
    }
    if (!['draft', 'revision_requested'].includes((plan as any).status)) {
      return reply.code(409).send({ error: 'INVALID_STATUS', message: `Plan with status '${(plan as any).status}' cannot be edited` })
    }

    const schema = z.array(
      z.object({
        component_id:    z.string().uuid(),
        declared_amount: z.number().nonnegative(),
        remarks:         z.string().optional().nullable(),
        metadata:        z.record(z.unknown()).optional().nullable(),
      })
    ).min(1)

    const parsed = schema.safeParse(req.body)
    if (!parsed.success) {
      return reply.code(400).send({ error: 'VALIDATION_ERROR', message: parsed.error.issues[0]?.message })
    }

    const records = parsed.data.map(item => ({
      plan_id:         planId,
      component_id:    item.component_id,
      declared_amount: item.declared_amount,
      remarks:         item.remarks ?? null,
      metadata:        item.metadata ?? {},
    }))

    const { data, error } = await fastify.supabase
      .from('tax_declaration_plan_items')
      .upsert(records, { onConflict: 'plan_id,component_id' })
      .select()

    if (error) return serverError(req, reply, error, ErrorCode.UPDATE_FAILED, 'Failed to save plan items')
    return reply.send({ data: data ?? [], upserted: records.length })
  })

  // ===========================================================================
  // GET /plans/my/:planId/compute — compute tax for this plan
  // ===========================================================================
  fastify.get('/plans/my/:planId/compute', auth, async (req: any, reply) => {
    const employeeId = await resolveCallerEmployeeId(fastify, req)
    if (!employeeId) {
      return reply.code(403).send({ error: 'PROFILE_NOT_LINKED', message: 'Your profile is not linked to an employee record' })
    }

    const { planId } = req.params as { planId: string }

    const { data: plan } = await fastify.supabase
      .from('tax_declaration_plans')
      .select('*')
      .eq('id', planId)
      .eq('tenant_id', req.tenantId)
      .maybeSingle()

    if (!plan) return reply.code(404).send({ error: 'NOT_FOUND', message: 'Plan not found' })
    if ((plan as any).employee_id !== employeeId) {
      return reply.code(403).send({ error: 'FORBIDDEN', message: 'Access denied' })
    }

    const fy = (plan as any).financial_year

    // Load items with components
    const { data: items, error: itemErr } = await fastify.supabase
      .from('tax_declaration_plan_items')
      .select(`
        id, component_id, declared_amount, remarks,
        tax_declaration_components (id, section_code, display_name)
      `)
      .eq('plan_id', planId)

    if (itemErr) return serverError(req, reply, itemErr, ErrorCode.QUERY_FAILED, 'Failed to fetch plan items')

    const planItems  = (items as any[]) ?? []
    const components = planItems.map((i: any) => i.tax_declaration_components).filter(Boolean)

    // Latest payroll slip for gross salary
    const { data: latestSlip } = await fastify.supabase
      .from('payroll_slips')
      .select('gross_pay')
      .eq('employee_id', employeeId)
      .eq('tenant_id', req.tenantId)
      .order('month', { ascending: false })
      .limit(1)
      .maybeSingle()

    const grossAnnual = ((latestSlip as any)?.gross_pay ?? 0) * 12

    // TDS already deducted
    const { data: slips } = await fastify.supabase
      .from('payroll_slips')
      .select('tds_deducted')
      .eq('employee_id', employeeId)
      .eq('tenant_id', req.tenantId)
      .gte('month', `${fy.split('-')[0]}-04`)
      .lte('month', `${parseInt(fy.split('-')[0]) + 1}-03`)

    const alreadyDeducted = ((slips as any[]) ?? []).reduce((s: number, r: any) => s + (r.tds_deducted ?? 0), 0)

    const inputData = buildComputationInput(
      grossAnnual,
      (plan as any).tax_regime as 'old' | 'new',
      fy,
      planItems,
      components,
      alreadyDeducted,
      remainingMonthsInFY(fy),
    )

    const r = await computeTaxWithDB(fastify.supabase, inputData)

    // Build deductions breakdown (only non-zero entries)
    const deductions: Record<string, number> = {}
    if (r.standardDeduction  > 0) deductions['Standard Deduction']  = r.standardDeduction
    if (r.hraExemption        > 0) deductions['HRA Exemption']        = r.hraExemption
    if (r.homeLoanInterest    > 0) deductions['Home Loan Interest']   = r.homeLoanInterest
    if (r.deduction80C        > 0) deductions['80C']                  = r.deduction80C
    if (r.deduction80CCD1B    > 0) deductions['80CCD(1B)']            = r.deduction80CCD1B
    if (r.deduction80D        > 0) deductions['80D']                  = r.deduction80D
    if (r.deduction80E        > 0) deductions['80E']                  = r.deduction80E
    if (r.deduction80G        > 0) deductions['80G']                  = r.deduction80G
    if (r.deduction80TTA      > 0) deductions['80TTA/TTB']            = r.deduction80TTA

    return reply.send({
      data: {
        plan_id:                planId,
        taxable_income:         r.taxableIncome,
        annual_tax:             r.annualTaxLiability,
        monthly_tds:            r.monthlyTDS,
        regime:                 r.regime,
        deductions_breakdown:   deductions,
        slab_details:           [],  // detailed slab breakdown available in traceSteps
        old_regime_tax:         r.oldRegimeTax         ?? 0,
        new_regime_tax:         r.newRegimeTax         ?? 0,
        recommended_regime:     r.recommendedRegime    ?? r.regime,
        tax_saving_with_optimal: r.taxSavingWithOptimal ?? 0,
      },
    })
  })

  // ===========================================================================
  // POST /plans/my/:planId/submit — submit as active declaration
  // ===========================================================================
  fastify.post('/plans/my/:planId/submit', auth, async (req: any, reply) => {
    const employeeId = await resolveCallerEmployeeId(fastify, req)
    if (!employeeId) {
      return reply.code(403).send({ error: 'PROFILE_NOT_LINKED', message: 'Your profile is not linked to an employee record' })
    }

    // Enforce the declaration window — submitting a plan IS the active declaration,
    // so it must respect the same open/close dates as direct declarations.
    const windowErr = await checkDeclarationWindow(fastify, req.tenantId)
    if (windowErr) return reply.code(windowErr.code).send(windowErr.body)

    const { planId } = req.params as { planId: string }

    // Load plan
    const { data: plan } = await fastify.supabase
      .from('tax_declaration_plans')
      .select('*')
      .eq('id', planId)
      .eq('tenant_id', req.tenantId)
      .maybeSingle()

    if (!plan) return reply.code(404).send({ error: 'NOT_FOUND', message: 'Plan not found' })
    if ((plan as any).employee_id !== employeeId) {
      return reply.code(403).send({ error: 'FORBIDDEN', message: 'You can only submit your own plans' })
    }
    if ((plan as any).status !== 'draft') {
      return reply.code(409).send({ error: 'INVALID_STATUS', message: `Only draft plans can be submitted. Current status: '${(plan as any).status}'` })
    }

    const fy = (plan as any).financial_year

    // Load plan items with component details
    const { data: items, error: itemErr } = await fastify.supabase
      .from('tax_declaration_plan_items')
      .select(`
        id, component_id, declared_amount, remarks,
        tax_declaration_components (id, section_code, display_name, parent_group)
      `)
      .eq('plan_id', planId)

    if (itemErr) return serverError(req, reply, itemErr, ErrorCode.QUERY_FAILED, 'Failed to fetch plan items')

    const planItems  = (items as any[]) ?? []
    const components = planItems.map((i: any) => i.tax_declaration_components).filter(Boolean)

    // Compute tax to store projection values
    const { data: latestSlip } = await fastify.supabase
      .from('payroll_slips')
      .select('gross_pay')
      .eq('employee_id', employeeId)
      .eq('tenant_id', req.tenantId)
      .order('month', { ascending: false })
      .limit(1)
      .maybeSingle()

    const grossAnnual = ((latestSlip as any)?.gross_pay ?? 0) * 12

    const { data: slips } = await fastify.supabase
      .from('payroll_slips')
      .select('tds_deducted')
      .eq('employee_id', employeeId)
      .eq('tenant_id', req.tenantId)
      .gte('month', `${fy.split('-')[0]}-04`)
      .lte('month', `${parseInt(fy.split('-')[0]) + 1}-03`)

    const alreadyDeducted = ((slips as any[]) ?? []).reduce((s: number, r: any) => s + (r.tds_deducted ?? 0), 0)

    const inputData = buildComputationInput(
      grossAnnual,
      (plan as any).tax_regime as 'old' | 'new',
      fy,
      planItems,
      components,
      alreadyDeducted,
      remainingMonthsInFY(fy),
    )

    const taxResult = await computeTaxWithDB(fastify.supabase, inputData)

    // Upsert each plan item into tax_declarations
    const now = new Date().toISOString()
    const declCategory = (comp: any): string => {
      const code: string = comp?.section_code ?? 'other'
      const knownCats = ['80C','80D','80E','80G','80TTA','HRA','LTA','home_loan_principal','home_loan_interest','NPS','standard_deduction','professional_tax']
      return knownCats.includes(code) ? code : 'other'
    }

    if (planItems.length > 0) {
      const declRecords = planItems.map((item: any) => {
        const comp = item.tax_declaration_components
        return {
          tenant_id:            req.tenantId,
          employee_id:          employeeId,
          financial_year:       fy,
          declaration_category: declCategory(comp),
          section:              comp?.section_code ?? 'other',
          description:          comp?.display_name ?? 'Plan declaration',
          declared_amount:      item.declared_amount,
          // 'submitted' (not 'declared') so HR can approve it and payroll — which
          // reads status='approved' — can ever pick it up.
          status:               'submitted',
          submitted_at:         now,
          created_at:           now,
          updated_at:           now,
        }
      })

      // onConflict MUST match the real unique constraint on tax_declarations:
      // (tenant_id, employee_id, financial_year, declaration_category, section).
      // Omitting declaration_category made Postgres reject the upsert outright.
      const { error: declErr } = await fastify.supabase
        .from('tax_declarations')
        .upsert(declRecords, { onConflict: 'tenant_id,employee_id,financial_year,declaration_category,section' })

      if (declErr) return serverError(req, reply, declErr, ErrorCode.UPDATE_FAILED, 'Failed to save tax declarations')
    }

    // Mark all other plans for this FY as non-primary
    await fastify.supabase
      .from('tax_declaration_plans')
      .update({ is_primary: false, updated_at: now })
      .eq('employee_id', employeeId)
      .eq('tenant_id', req.tenantId)
      .eq('financial_year', fy)
      .neq('id', planId)

    // Update this plan to submitted + is_primary + store projections
    const { data: updatedPlan, error: updateErr } = await fastify.supabase
      .from('tax_declaration_plans')
      .update({
        status:                    'submitted',
        is_primary:                true,
        submitted_at:              now,
        projected_tax:             taxResult.annualTaxLiability,
        projected_monthly_tds:     taxResult.monthlyTDS,
        projected_taxable_income:  taxResult.taxableIncome,
        updated_at:                now,
      })
      .eq('id', planId)
      .eq('tenant_id', req.tenantId)
      .select()
      .single()

    if (updateErr) return serverError(req, reply, updateErr, ErrorCode.UPDATE_FAILED, 'Failed to update tax declaration plan')

    // Sync regime election — plan submission is the source of truth for regime
    await fastify.supabase
      .from('tax_regime_elections')
      .upsert({
        tenant_id:      req.tenantId,
        employee_id:    employeeId,
        financial_year: fy,
        regime:         (plan as any).tax_regime,
        effective_from: now.slice(0, 10),
        elected_by:     req.userId,
      }, { onConflict: 'tenant_id,employee_id,financial_year' })
    // Non-fatal — don't block the submit response if this fails

    // Write audit log
    await writeAuditLog(
      fastify, req.tenantId, planId, req.userId, 'draft', 'submitted',
      'Plan submitted as active declaration by employee',
      { item_count: planItems.length, projected_tax: taxResult.annualTaxLiability },
    )

    await logAction(fastify.supabase, {
      tenantId:    req.tenantId,
      tableName:   'tax_declaration_plans',
      recordId:    planId,
      action:      'UPDATE',
      performedBy: req.userId,
      onBehalfOf:  employeeId,
      newData:     { status: 'submitted', is_primary: true, projected_tax: taxResult.annualTaxLiability } as Record<string, unknown>,
    })

    return reply.send({
      data: updatedPlan,
      projected_tax:            taxResult.annualTaxLiability,
      projected_monthly_tds:    taxResult.monthlyTDS,
      projected_taxable_income: taxResult.taxableIncome,
    })
  })
}
