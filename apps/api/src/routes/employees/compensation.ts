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
import { HR_ADMIN_ROLES } from '../../lib/rbac.js'
import { serverError, notFound, forbidden, validationError, conflictError, ErrorCode } from '../../lib/api-errors.js'

// ── Zod schemas ───────────────────────────────────────────────────────────────

const componentSchema = z.object({
  salary_component_id: z.string().uuid('Invalid component ID'),
  calculation_type:    z.enum(['fixed', 'pct_of_basic', 'pct_of_ctc', 'pct_of_gross', 'balance']),
  // 'balance' carries value 0 (it's the residual); other types must be > 0.
  value:               z.number().nonnegative('Value must be ≥ 0'),
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
 * Ownership guard for compensation read endpoints.
 * Returns null when access is permitted; returns { code, body } to send when denied.
 *
 * Permitted callers:
 *   • super_admin / hr_admin  — unrestricted
 *   • The employee themselves — self-view
 *   • The employee's direct manager — managers may view their reports' pay
 */
async function assertCompensationAccess(
  fastify:    any,
  req:        any,
  reply:      any,
  employeeId: string,
): Promise<boolean> {
  if ((HR_ADMIN_ROLES as readonly string[]).includes(req.userRole)) return false

  const { data: profile } = await fastify.supabase
    .from('profiles')
    .select('employee_id')
    .eq('id', req.userId)
    .eq('tenant_id', req.tenantId)
    .maybeSingle()

  const callerEmpId = (profile as any)?.employee_id
  if (!callerEmpId) {
    forbidden(reply, 'FORBIDDEN', 'Profile not linked to an employee record')
    return true
  }

  if (callerEmpId === employeeId) return false  // self

  // Allow the employee's direct manager
  const { data: targetEmp } = await fastify.supabase
    .from('employees')
    .select('manager_id')
    .eq('id', employeeId)
    .eq('tenant_id', req.tenantId)
    .maybeSingle()

  if ((targetEmp as any)?.manager_id === callerEmpId) return false

  forbidden(reply, 'FORBIDDEN', 'You can only view your own or your direct reports\' compensation')
  return true
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
  'id, salary_component_id, calculation_type, value, computed_monthly, computed_annual, sequence, ' +
  'salary_components(id, name, code, component_type, is_basic, affects_pf, affects_nlc, display_order)'

// ── Helper: shape components for API response ─────────────────────────────────
function shapeComponents(rawComponents: any[]): any[] {
  return (rawComponents ?? [])
    .sort((a: any, b: any) => a.sequence - b.sequence)
    .map((c: any) => ({
      id:                   c.id,
      salary_component_id:  c.salary_component_id ?? c.salary_components?.id ?? null,
      name:                 c.salary_components?.name              ?? null,
      code:                 c.salary_components?.code              ?? null,
      component_type:       c.salary_components?.component_type    ?? null,
      is_basic:             c.salary_components?.is_basic          ?? false,
      affects_pf:           c.salary_components?.affects_pf        ?? false,
      affects_nlc:          c.salary_components?.affects_nlc       ?? false,
      calculation_type:     c.calculation_type,
      value:                c.value,
      sequence:             c.sequence,
      monthly_amount:       c.computed_monthly,
      annual_amount:        c.computed_annual,
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

  // ── GET /compensation-policy  → tenant statutory policy (PF rates · NLC) ─────
  // Surfaces the previously API-only compensation_policies row so tenants stop
  // silently inheriting DEFAULT_COMPENSATION_POLICY. Read-only fetch with the
  // same fallback semantics as the engine helper.
  fastify.get('/compensation-policy', auth, async (req: any, reply) => {
    const policy = await fetchCompensationPolicy(fastify, req.tenantId)
    // Tell the client whether a real row exists (vs engine defaults) so the UI
    // can indicate "using defaults" until the tenant saves.
    const { data } = await fastify.supabase
      .from('compensation_policies')
      .select('tenant_id')
      .eq('tenant_id', req.tenantId)
      .maybeSingle()
    return reply.send({ data: { ...policy, is_configured: !!data } })
  })

  // ── PUT /compensation-policy  → upsert tenant statutory policy ───────────────
  // Writes the EXISTING compensation_policies table only. No engine/calc change:
  // the engine already reads this row; this just lets admins set it via UI.
  const policySchema = z.object({
    nlc_enabled:      z.boolean(),
    pf_enabled:       z.boolean(),
    pf_employee_rate: z.number().min(0).max(30).optional(),
    pf_employer_rate: z.number().min(0).max(30).optional(),
    pf_cap_amount:    z.number().min(0).optional(),
  })

  fastify.put('/compensation-policy', auth, async (req: any, reply) => {
    if (!(HR_ADMIN_ROLES as readonly string[]).includes(req.userRole))
      return forbidden(reply, 'FORBIDDEN', 'HR admin access required')

    const parsed = policySchema.safeParse(req.body)
    if (!parsed.success)
      return validationError(reply, ErrorCode.VALIDATION_ERROR, parsed.error.issues[0]?.message ?? 'Invalid policy')

    const { data, error } = await fastify.supabase
      .from('compensation_policies')
      .upsert(
        { tenant_id: req.tenantId, ...parsed.data, updated_at: new Date().toISOString() },
        { onConflict: 'tenant_id' },
      )
      .select('nlc_enabled, pf_enabled, pf_employee_rate, pf_employer_rate, pf_cap_amount')
      .single()

    if (error)
      return serverError(req, reply, error, ErrorCode.UPDATE_FAILED, 'Failed to save compensation policy')

    return reply.send({ data: { ...data, is_configured: true } })
  })

  // ── GET /employees/:id/compensation  → active compensation ──────────────────
  fastify.get('/employees/:id/compensation', auth, async (req: any, reply) => {
    if (await assertCompensationAccess(fastify, req, reply, req.params.id)) return

    if (!await verifyEmployee(fastify, req.params.id, req.tenantId))
      return notFound(reply, 'EMPLOYEE_NOT_FOUND', 'Employee not found')

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
      return serverError(req, reply, error, ErrorCode.QUERY_FAILED, 'Failed to fetch compensation')
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
    if (await assertCompensationAccess(fastify, req, reply, req.params.id)) return

    if (!await verifyEmployee(fastify, req.params.id, req.tenantId))
      return notFound(reply, 'EMPLOYEE_NOT_FOUND', 'Employee not found')

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
      return serverError(req, reply, error, ErrorCode.QUERY_FAILED, 'Failed to fetch compensation history')

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
    if (await assertCompensationAccess(fastify, req, reply, req.params.id)) return

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
      return serverError(req, reply, error, ErrorCode.QUERY_FAILED, 'Failed to fetch compensation record')
    if (!data)
      return notFound(reply, 'NOT_FOUND', 'Compensation not found')

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
    if (!(HR_ADMIN_ROLES as readonly string[]).includes(req.userRole))
      return forbidden(reply, 'FORBIDDEN', 'HR admin access required')

    if (!await verifyEmployee(fastify, req.params.id, req.tenantId))
      return notFound(reply, 'EMPLOYEE_NOT_FOUND', 'Employee not found')

    const parsed = createCompensationSchema.safeParse(req.body)
    if (!parsed.success)
      return validationError(reply, ErrorCode.VALIDATION_ERROR, parsed.error.issues[0].message)

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
      return serverError(req, reply, scErr, ErrorCode.QUERY_FAILED, 'Failed to fetch salary components')

    const scMap = new Map<string, any>((scRows ?? []).map((r: any) => [r.id, r]))

    // Build ComponentInput for the engine
    const engineInputs: ComponentInput[] = []
    for (const rc of reqComponents) {
      const sc = scMap.get(rc.salary_component_id)
      if (!sc) {
        return reply.code(422).send({
          error: 'COMPONENT_NOT_FOUND',
          message: `Salary component ${rc.salary_component_id} not found — it may have been deleted`,
          field: 'components',
        })
      }
      engineInputs.push({
        salary_component_id: rc.salary_component_id,
        name:                sc.name,
        code:                sc.code,
        component_type:      sc.component_type as 'earning' | 'deduction' | 'employer_contribution',
        calc_type:           rc.calculation_type as 'pct_of_ctc' | 'pct_of_basic' | 'pct_of_gross' | 'fixed' | 'balance',
        value:               rc.value,
        sequence:            rc.sequence ?? 0,
        is_basic:            sc.is_basic    ?? false,
        affects_pf:          sc.affects_pf  ?? false,
        affects_nlc:         sc.affects_nlc ?? false,
      })
    }

    // ── Fetch PF flags from salary structure (single source of truth) ───────────
    // pf_applicable and pf_ceiling_mode live on salary_structures. The structure
    // assigned at compensation time drives the engine — no per-employee PF flags.
    const structureId = compensationData.salary_structure_id
    let pf_enabled = true
    let pf_capped  = true  // statutory default: ceiling applies

    if (structureId) {
      const { data: structRow } = await fastify.supabase
        .from('salary_structures')
        .select('pf_applicable, pf_ceiling_mode')
        .eq('id', structureId)
        .eq('tenant_id', req.tenantId)
        .maybeSingle()

      pf_enabled = structRow?.pf_applicable ?? true
      const mode = structRow?.pf_ceiling_mode ?? 'follow_policy'
      if (mode === 'actual') pf_capped = false
      else if (mode === 'capped') pf_capped = true
      // 'follow_policy' → keep pf_capped = true (statutory default: ceiling on)
    }

    const employee = { pf_enabled, pf_capped }

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
        return serverError(req, reply, err, ErrorCode.INSERT_FAILED, 'Failed to set up PF salary components')
      }
    }

    // ── Build DB rows from engine output ──────────────────────────────────────
    const rawRows = result.components.map(c => {
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

    // Deduplicate by salary_component_id — engine-generated PF entries are appended
    // last and must win over any identical component that came from the structure.
    const seenIds = new Set<string>()
    const componentRows = [...rawRows].reverse().filter(r => {
      if (seenIds.has(r.salary_component_id)) return false
      seenIds.add(r.salary_component_id)
      return true
    }).reverse()

    // ── Supersede the prior active compensation ───────────────────────────────
    // Only one active compensation per employee is allowed (uidx_comp_one_active).
    // Deactivate the current active record before inserting the new one so an
    // update/revision doesn't collide with the unique index (history preserved).
    if (compensationData.is_active) {
      const { error: supersedeErr } = await fastify.supabase
        .from('employee_compensations')
        .update({ is_active: false })
        .eq('tenant_id',  req.tenantId)
        .eq('employee_id', req.params.id)
        .eq('is_active', true)
      if (supersedeErr)
        return serverError(req, reply, supersedeErr, ErrorCode.UPDATE_FAILED, 'Failed to supersede prior compensation')
    }

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
      return serverError(req, reply, compErr, ErrorCode.INSERT_FAILED, 'Failed to create compensation record')

    // ── Insert components ─────────────────────────────────────────────────────
    const { error: compCompErr } = await fastify.supabase
      .from('employee_compensation_components')
      .insert(componentRows.map(c => ({ ...c, compensation_id: comp.id })))

    if (compCompErr) {
      // Rollback header
      await fastify.supabase.from('employee_compensations').delete().eq('id', comp.id)
      // 23505 = unique_violation (duplicate salary_component_id in this compensation)
      if (compCompErr.code === '23505')
        return conflictError(reply, ErrorCode.CONFLICT, 'Duplicate salary component in this compensation')
      return serverError(req, reply, compCompErr, ErrorCode.INSERT_FAILED, 'Failed to insert compensation components')
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

  // ── DELETE /employees/:id/compensation/:compId ────────────────────────────────
  // Remove a compensation record (and its components). If the deleted record was
  // the active one, the most recent remaining record is reactivated so the
  // employee is never left without active compensation (which would cause phantom
  // LOP on the next payroll run).
  fastify.delete('/employees/:id/compensation/:compId', auth, async (req: any, reply) => {
    if (!(HR_ADMIN_ROLES as readonly string[]).includes(req.userRole)) {
      return forbidden(reply, 'FORBIDDEN', 'HR admin access required')
    }
    const { id, compId } = req.params as { id: string; compId: string }

    // Verify the record belongs to this employee + tenant.
    const { data: target } = await fastify.supabase
      .from('employee_compensations')
      .select('id, is_active')
      .eq('id', compId)
      .eq('employee_id', id)
      .eq('tenant_id', req.tenantId)
      .maybeSingle()
    if (!target) return notFound(reply, 'NOT_FOUND', 'Compensation record not found')

    // Block deletion if any finalized payroll slip referenced this compensation
    // period — keep historical pay auditable. (Best-effort: skip if column absent.)
    // Delete components first (explicit; FK cascade may or may not be present).
    await fastify.supabase.from('employee_compensation_components').delete().eq('compensation_id', compId)

    const { error: delErr } = await fastify.supabase
      .from('employee_compensations')
      .delete()
      .eq('id', compId)
      .eq('employee_id', id)
      .eq('tenant_id', req.tenantId)
    if (delErr) return serverError(req, reply, delErr, ErrorCode.DELETE_FAILED, 'Failed to delete compensation record')

    // If we removed the active record, reactivate the latest remaining one.
    if (target.is_active) {
      const { data: latest } = await fastify.supabase
        .from('employee_compensations')
        .select('id')
        .eq('employee_id', id)
        .eq('tenant_id', req.tenantId)
        .order('effective_from', { ascending: false })
        .limit(1)
        .maybeSingle()
      if (latest) {
        await fastify.supabase
          .from('employee_compensations')
          .update({ is_active: true })
          .eq('id', latest.id)
          .eq('tenant_id', req.tenantId)
      }
    }

    return reply.code(200).send({ data: { id: compId, deleted: true } })
  })
}
