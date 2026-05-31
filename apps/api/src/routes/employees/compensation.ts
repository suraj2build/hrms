/**
 * Compensation routes — /employees/:id/compensation
 *
 * POST uses the CompensationEngine for correct, NLC-compliant computation.
 * PF components (if applicable) are auto-created in salary_components and
 * injected into the stored component list.
 */
import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import {
  computeCompensation,
  DEFAULT_COMPENSATION_POLICY,
  PF_EMPLOYEE_SENTINEL,
  PF_EMPLOYER_SENTINEL,
  PF_EMPLOYEE_CODE,
  PF_EMPLOYER_CODE,
  type CompensationPolicy,
  type ComponentInput,
} from '../../lib/compensation-engine.js'

// ── Zod schemas ───────────────────────────────────────────────────────────────

const componentSchema = z.object({
  salary_component_id: z.string().uuid('Invalid component ID'),
  calculation_type:    z.enum(['fixed', 'pct_of_basic', 'pct_of_ctc', 'pct_of_gross']),
  value:               z.number().positive('Value must be positive'),
  sequence:            z.number().int().optional().default(0),
})

const createCompensationSchema = z.object({
  /** Optional — can set up compensation without assigning a named structure */
  salary_structure_id: z.string().uuid('Invalid structure ID').optional(),
  effective_from:      z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Date must be YYYY-MM-DD'),
  ctc_annual:          z.number().positive('CTC must be positive'),
  is_active:           z.boolean().optional().default(true),
  notes:               z.string().optional(),
  approved_by:         z.string().uuid().optional(),
  components:          z.array(componentSchema).min(1, 'At least one component required'),
})

// ── Helpers ───────────────────────────────────────────────────────────────────

async function verifyEmployee(fastify: any, employeeId: string, tenantId: string) {
  const { data } = await fastify.supabase
    .from('employees')
    .select('id')
    .eq('id', employeeId)
    .eq('tenant_id', tenantId)
    .single()
  return !!data
}

/**
 * Fetch the tenant's compensation policy.
 * Falls back to DEFAULT_COMPENSATION_POLICY when no row exists.
 */
async function fetchCompensationPolicy(
  fastify: any,
  tenantId: string,
): Promise<CompensationPolicy> {
  const { data } = await fastify.supabase
    .from('compensation_policies')
    .select('nlc_enabled, pf_enabled, pf_employee_rate, pf_employer_rate, pf_cap_amount')
    .eq('tenant_id', tenantId)
    .maybeSingle()

  if (!data) return { ...DEFAULT_COMPENSATION_POLICY }

  return {
    nlc_enabled:      data.nlc_enabled,
    pf_enabled:       data.pf_enabled,
    pf_employee_rate: Number(data.pf_employee_rate),
    pf_employer_rate: Number(data.pf_employer_rate),
    pf_cap_amount:    Number(data.pf_cap_amount),
  }
}

/**
 * Find-or-create the reserved PF salary_component rows for the tenant.
 * Returns a map from code ('PF_EMPLOYEE' | 'PF_EMPLOYER') → salary_component.id.
 */
async function resolvePfSalaryComponents(
  fastify: any,
  tenantId: string,
): Promise<Map<string, string>> {
  const codes = [PF_EMPLOYEE_CODE, PF_EMPLOYER_CODE]

  // Attempt to find existing rows
  const { data: existing } = await fastify.supabase
    .from('salary_components')
    .select('id, code')
    .eq('tenant_id', tenantId)
    .in('code', codes)

  const map = new Map<string, string>()
  for (const row of existing ?? []) {
    map.set(row.code as string, row.id as string)
  }

  // Create any that are missing
  const missing: Array<{ code: string; name: string; component_type: string; sequence: number }> = []
  if (!map.has(PF_EMPLOYEE_CODE)) {
    missing.push({
      code:           PF_EMPLOYEE_CODE,
      name:           'PF Employee Contribution',
      component_type: 'deduction',
      sequence:       9000,
    })
  }
  if (!map.has(PF_EMPLOYER_CODE)) {
    missing.push({
      code:           PF_EMPLOYER_CODE,
      name:           'PF Employer Contribution',
      component_type: 'employer_contribution',
      sequence:       9001,
    })
  }

  if (missing.length) {
    const { data: created } = await fastify.supabase
      .from('salary_components')
      .insert(
        missing.map(m => ({
          tenant_id:      tenantId,
          name:           m.name,
          code:           m.code,
          component_type: m.component_type,
          display_order:  m.sequence,
          is_taxable:     false,
          is_pf_applicable: false,
          affects_pf:     false,
          affects_nlc:    false,
          is_basic:       false,
        })),
      )
      .select('id, code')

    for (const row of created ?? []) {
      map.set(row.code as string, row.id as string)
    }
  }

  return map
}

// ── Compensation component SELECT fragment ────────────────────────────────────
const COMP_COMPONENT_SELECT =
  'id, calculation_type, value, computed_monthly, computed_annual, sequence, ' +
  'salary_components(id, name, code, component_type, is_basic, affects_pf, affects_nlc, display_order)'

// ── Helper: shape components for API response ─────────────────────────────────
function shapeComponents(rawComponents: any[]): any[] {
  return (rawComponents ?? [])
    .sort((a: any, b: any) => a.sequence - b.sequence)
    .map((c: any) => ({
      id:               c.id,
      name:             c.salary_components?.name              ?? null,
      code:             c.salary_components?.code              ?? null,
      component_type:   c.salary_components?.component_type    ?? null,
      is_basic:         c.salary_components?.is_basic          ?? false,
      affects_pf:       c.salary_components?.affects_pf        ?? false,
      affects_nlc:      c.salary_components?.affects_nlc       ?? false,
      calculation_type: c.calculation_type,
      value:            c.value,
      sequence:         c.sequence,
      monthly_amount:   c.computed_monthly,
      annual_amount:    c.computed_annual,
    }))
}

/** Compute totals from a shaped component list */
function computeTotals(shaped: ReturnType<typeof shapeComponents>) {
  const earnings     = shaped.filter(c => c.component_type === 'earning')
  const deductions   = shaped.filter(c => c.component_type === 'deduction')
  const empContribs  = shaped.filter(c => c.component_type === 'employer_contribution')
  const basic        = shaped.find(c => c.is_basic)

  const grossAnnual  = earnings.reduce((s, c) => s + (c.annual_amount ?? 0), 0)
  const deductAnnual = deductions.reduce((s, c) => s + (c.annual_amount ?? 0), 0)
  const erConAnnual  = empContribs.reduce((s, c) => s + (c.annual_amount ?? 0), 0)
  const r2 = (n: number) => Math.round(n * 100) / 100

  return {
    gross_monthly:                   r2(grossAnnual / 12),
    gross_annual:                    r2(grossAnnual),
    basic_monthly:                   basic ? r2((basic.annual_amount ?? 0) / 12) : 0,
    basic_annual:                    basic ? r2(basic.annual_amount ?? 0) : 0,
    deductions_monthly:              r2(deductAnnual / 12),
    deductions_annual:               r2(deductAnnual),
    employer_contributions_monthly:  r2(erConAnnual / 12),
    employer_contributions_annual:   r2(erConAnnual),
    net_monthly:                     r2((grossAnnual - deductAnnual) / 12),
    net_annual:                      r2(grossAnnual - deductAnnual),
  }
}

// ── Routes ────────────────────────────────────────────────────────────────────

export default async function compensationRoutes(fastify: FastifyInstance) {
  const auth = { preHandler: [fastify.authenticate] }

  // ── GET /employees/:id/compensation  → active compensation ──────────────────
  fastify.get('/employees/:id/compensation', auth, async (req: any, reply) => {
    if (!await verifyEmployee(fastify, req.params.id, req.tenantId))
      return reply.code(404).send({ error: 'NOT_FOUND', message: 'Employee not found' })

    const { data, error } = await fastify.supabase
      .from('employee_compensations')
      .select(
        `*, salary_structures(id, name, code),
         employee_compensation_components(${COMP_COMPONENT_SELECT})`
      )
      .eq('employee_id', req.params.id)
      .eq('tenant_id', req.tenantId)
      .eq('is_active', true)
      .maybeSingle()

    if (error)
      return reply.code(500).send({ error: 'DB_ERROR', message: error.message })
    if (!data)
      return reply.send({ data: null })

    const shaped = shapeComponents(data.employee_compensation_components ?? [])
    const totals = computeTotals(shaped)

    return reply.send({
      data: {
        id:             data.id,
        ctc_annual:     data.ctc_annual,
        ctc_monthly:    data.ctc_monthly,
        effective_from: data.effective_from,
        effective_to:   data.effective_to  ?? null,
        notes:          data.notes         ?? null,
        structure:      data.salary_structures ?? null,
        components:     shaped,
        totals,
      },
    })
  })

  // ── GET /employees/:id/compensation/history ──────────────────────────────────
  fastify.get('/employees/:id/compensation/history', auth, async (req: any, reply) => {
    if (!await verifyEmployee(fastify, req.params.id, req.tenantId))
      return reply.code(404).send({ error: 'NOT_FOUND', message: 'Employee not found' })

    const { data, error } = await fastify.supabase
      .from('employee_compensations')
      .select(
        `*, salary_structures(id, name, code),
         employee_compensation_components(${COMP_COMPONENT_SELECT})`
      )
      .eq('employee_id', req.params.id)
      .eq('tenant_id', req.tenantId)
      .order('effective_from', { ascending: false })

    if (error)
      return reply.code(500).send({ error: 'DB_ERROR', message: error.message })

    const rows = (data ?? []).map((rec: any) => {
      const shaped = shapeComponents(rec.employee_compensation_components ?? [])
      return {
        id:             rec.id,
        ctc_annual:     rec.ctc_annual,
        ctc_monthly:    rec.ctc_monthly,
        effective_from: rec.effective_from,
        effective_to:   rec.effective_to ?? null,
        is_active:      rec.is_active,
        notes:          rec.notes ?? null,
        structure:      rec.salary_structures ?? null,
        components:     shaped,
        totals:         computeTotals(shaped),
      }
    })

    return reply.send({ data: rows })
  })

  // ── GET /employees/:id/compensation/:compId ──────────────────────────────────
  fastify.get('/employees/:id/compensation/:compId', auth, async (req: any, reply) => {
    const { data, error } = await fastify.supabase
      .from('employee_compensations')
      .select(
        `*, salary_structures(id, name, code),
         employee_compensation_components(${COMP_COMPONENT_SELECT})`
      )
      .eq('id', req.params.compId)
      .eq('employee_id', req.params.id)
      .eq('tenant_id', req.tenantId)
      .maybeSingle()

    if (error)
      return reply.code(500).send({ error: 'DB_ERROR', message: error.message })
    if (!data)
      return reply.code(404).send({ error: 'NOT_FOUND', message: 'Compensation not found' })

    const shaped = shapeComponents(data.employee_compensation_components ?? [])
    return reply.send({
      ...data,
      employee_compensation_components: undefined,
      components: shaped,
      totals: computeTotals(shaped),
    })
  })

  // ── POST /employees/:id/compensation → new revision ──────────────────────────
  fastify.post('/employees/:id/compensation', auth, async (req: any, reply) => {
    if (!['super_admin', 'hr_admin'].includes(req.userRole))
      return reply.code(403).send({ error: 'FORBIDDEN', message: 'HR admin access required' })

    if (!await verifyEmployee(fastify, req.params.id, req.tenantId))
      return reply.code(404).send({ error: 'NOT_FOUND', message: 'Employee not found' })

    const parsed = createCompensationSchema.safeParse(req.body)
    if (!parsed.success)
      return reply.code(400).send({ error: 'VALIDATION', message: parsed.error.issues[0].message })

    const { components: reqComponents, ...compensationData } = parsed.data
    const ctcAnnual = compensationData.ctc_annual

    // ── Fetch salary_components metadata ─────────────────────────────────────
    const compIds = reqComponents.map(c => c.salary_component_id)
    const { data: scRows, error: scErr } = await fastify.supabase
      .from('salary_components')
      .select('id, name, code, component_type, is_basic, affects_pf, affects_nlc')
      .eq('tenant_id', req.tenantId)
      .in('id', compIds)

    if (scErr)
      return reply.code(500).send({ error: 'DB_ERROR', message: scErr.message })

    const scMap = new Map<string, any>((scRows ?? []).map((r: any) => [r.id, r]))

    // Build ComponentInput for the engine
    const engineInputs: ComponentInput[] = reqComponents.map(rc => {
      const sc = scMap.get(rc.salary_component_id)
      if (!sc) throw new Error(`Salary component ${rc.salary_component_id} not found`)
      return {
        salary_component_id: rc.salary_component_id,
        name:                sc.name,
        code:                sc.code,
        component_type:      sc.component_type as 'earning' | 'deduction' | 'employer_contribution',
        calc_type:           rc.calculation_type as 'pct_of_ctc' | 'pct_of_basic' | 'pct_of_gross' | 'fixed',
        value:               rc.value,
        sequence:            rc.sequence ?? 0,
        is_basic:            sc.is_basic    ?? false,
        affects_pf:          sc.affects_pf  ?? false,
        affects_nlc:         sc.affects_nlc ?? false,
      }
    })

    // ── Fetch employee PF flags ───────────────────────────────────────────────
    const { data: bankRow } = await fastify.supabase
      .from('employee_bank_statutory')
      .select('pf_enabled, pf_capped')
      .eq('employee_id', req.params.id)
      .eq('tenant_id', req.tenantId)
      .maybeSingle()

    const employee = {
      pf_enabled: bankRow?.pf_enabled ?? false,
      pf_capped:  bankRow?.pf_capped  ?? true,
    }

    // ── Fetch tenant compensation policy ─────────────────────────────────────
    const policy = await fetchCompensationPolicy(fastify, req.tenantId)

    // ── Run the engine ────────────────────────────────────────────────────────
    let result
    try {
      result = computeCompensation({ ctcAnnual, components: engineInputs, employee, policy })
    } catch (err: any) {
      return reply.code(422).send({ error: err.code ?? 'ENGINE_ERROR', message: err.message })
    }

    // ── Resolve PF salary_component IDs if PF was applied ────────────────────
    let pfIdMap = new Map<string, string>()
    if (result.pf_applied) {
      try {
        pfIdMap = await resolvePfSalaryComponents(fastify, req.tenantId)
      } catch (err: any) {
        return reply.code(500).send({ error: 'PF_SETUP_FAILED', message: err.message })
      }
    }

    // ── Build DB rows from engine output ──────────────────────────────────────
    const componentRows = result.components.map(c => {
      let salaryComponentId = c.salary_component_id
      if (c.salary_component_id === PF_EMPLOYEE_SENTINEL) salaryComponentId = pfIdMap.get(PF_EMPLOYEE_CODE) ?? ''
      if (c.salary_component_id === PF_EMPLOYER_SENTINEL) salaryComponentId = pfIdMap.get(PF_EMPLOYER_CODE) ?? ''

      return {
        salary_component_id: salaryComponentId,
        calculation_type:    c.calc_type,
        value:               c.value,
        sequence:            c.sequence,
        computed_monthly:    c.monthly_amount,
        computed_annual:     c.annual_amount,
        tenant_id:           req.tenantId,
      }
    }).filter(r => r.salary_component_id)  // drop if PF ID resolution failed

    // ── Insert compensation header ─────────────────────────────────────────────
    const { data: comp, error: compErr } = await fastify.supabase
      .from('employee_compensations')
      .insert({
        ...compensationData,
        employee_id:  req.params.id,
        tenant_id:    req.tenantId,
        created_by:   req.userId,
      })
      .select()
      .single()

    if (compErr)
      return reply.code(500).send({ error: 'DB_ERROR', message: compErr.message })

    // ── Insert components ─────────────────────────────────────────────────────
    const { error: compCompErr } = await fastify.supabase
      .from('employee_compensation_components')
      .insert(componentRows.map(c => ({ ...c, compensation_id: comp.id })))

    if (compCompErr) {
      // Rollback header
      await fastify.supabase.from('employee_compensations').delete().eq('id', comp.id)
      return reply.code(500).send({ error: 'DB_ERROR', message: compCompErr.message })
    }

    // ── Return full shaped record ──────────────────────────────────────────────
    const { data: full } = await fastify.supabase
      .from('employee_compensations')
      .select(
        `*, salary_structures(id, name, code),
         employee_compensation_components(${COMP_COMPONENT_SELECT})`
      )
      .eq('id', comp.id)
      .single()

    const shaped = shapeComponents(full?.employee_compensation_components ?? [])

    return reply.code(201).send({
      id:             full?.id,
      ctc_annual:     full?.ctc_annual,
      ctc_monthly:    full?.ctc_monthly,
      effective_from: full?.effective_from,
      effective_to:   full?.effective_to ?? null,
      notes:          full?.notes ?? null,
      structure:      full?.salary_structures ?? null,
      components:     shaped,
      totals:         computeTotals(shaped),
      nlc_applied:    result.nlc_applied,
      pf_applied:     result.pf_applied,
      nlc_wage_pct:   result.nlc_wage_pct,
    })
  })
}
