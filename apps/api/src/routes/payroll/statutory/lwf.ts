/**
 * LWF Routes — Labour Welfare Fund
 * State-wise configuration, per-employee state assignment, contribution compute.
 *
 *   GET  /payroll/statutory/lwf/states                  list all LWF states
 *   PUT  /payroll/statutory/lwf/states/:stateCode       upsert state settings
 *   GET  /payroll/statutory/lwf/state-config            employee state config
 *   PUT  /payroll/statutory/lwf/state-config/:employeeId set employee LWF state
 *   GET  /payroll/statutory/lwf/contributions           monthly contributions
 *   POST /payroll/statutory/lwf/contributions/compute   compute for a month
 */

import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { computeLWF, parseDeductionMonths } from '../../../lib/statutory/lwf-engine.js'
import type { LWFConfig } from '../../../lib/statutory/lwf-engine.js'
import { logAction } from '../../../lib/audit-service.js'
import { HR_ADMIN_ROLES } from '../../../lib/rbac.js'
import { fetchAllRows } from '../../../lib/supabase-paginate.js'
import { serverError, ErrorCode } from '../../../lib/api-errors.js'

// States that levy LWF in India
const LWF_STATES: Record<string, string> = {
  AP: 'Andhra Pradesh',
  CG: 'Chhattisgarh',
  GA: 'Goa',
  GJ: 'Gujarat',
  HR: 'Haryana',
  KA: 'Karnataka',
  KL: 'Kerala',
  MP: 'Madhya Pradesh',
  MH: 'Maharashtra',
  OR: 'Odisha',
  PB: 'Punjab',
  TN: 'Tamil Nadu',
  TS: 'Telangana',
  WB: 'West Bengal',
}

export default async function lwfRoutes(fastify: FastifyInstance) {
  const auth = { preHandler: [fastify.authenticate] }

  function requireHrAdmin(req: any, reply: any, done: () => void) {
    if (!(HR_ADMIN_ROLES as readonly string[]).includes(req.userRole)) {
      reply.code(403).send({ error: 'FORBIDDEN', message: 'HR admin access required' })
      return
    }
    done()
  }

  // ── GET /payroll/statutory/lwf/states ─────────────────────────────────────────
  fastify.get('/states', { preHandler: [fastify.authenticate, requireHrAdmin] }, async (req: any, reply) => {
    const { data: settings } = await fastify.supabase
      .from('lwf_state_settings')
      .select('*')
      .eq('tenant_id', req.tenantId)

    if (!settings) return reply.send([])

    const settingsMap = new Map<string, any>()
    for (const s of settings) settingsMap.set(s.state_code, s)

    // Merge known LWF states with tenant settings
    const knownStates = Object.entries(LWF_STATES).map(([code, name]) => {
      const row = settingsMap.get(code)
      return {
        state_code:          code,
        state_name:          name,
        enabled:             row?.enabled             ?? false,
        employee_amount:     row?.employee_amount     ?? 0,
        employer_amount:     row?.employer_amount     ?? 0,
        wage_ceiling:        row?.wage_ceiling        ?? null,
        frequency:           row?.frequency           ?? 'monthly',
        deduction_months:    row?.deduction_months    ?? null,
        registration_number: row?.registration_number ?? null,
        is_custom:           false,
      }
    })

    // Also include any custom/extra states the tenant has configured
    const customStates = settings
      .filter(s => !LWF_STATES[s.state_code])
      .map(s => ({ ...s, state_name: s.state_name ?? s.state_code, is_custom: true }))

    return reply.send([...knownStates, ...customStates])
  })

  // ── PUT /payroll/statutory/lwf/states/:stateCode ─────────────────────────────
  fastify.put('/states/:stateCode', { preHandler: [fastify.authenticate, requireHrAdmin] }, async (req: any, reply) => {
    const { stateCode } = req.params as { stateCode: string }

    const schema = z.object({
      enabled:             z.boolean().optional(),
      state_name:          z.string().optional(),
      employee_amount:     z.number().min(0).optional(),
      employer_amount:     z.number().min(0).optional(),
      wage_ceiling:        z.number().nullable().optional(),
      frequency:           z.enum(['monthly','half_yearly','annual']).optional(),
      deduction_months:    z.string().nullable().optional(),
      registration_number: z.string().nullable().optional(),
    })

    const parsed = schema.safeParse(req.body)
    if (!parsed.success) return reply.code(400).send({ error: 'VALIDATION_ERROR', message: parsed.error.issues[0]?.message })

    const upsertPayload: Record<string, any> = {
      tenant_id:  req.tenantId,
      state_code: stateCode,
      state_name: LWF_STATES[stateCode] ?? parsed.data.state_name ?? stateCode,
      updated_at: new Date().toISOString(),
    }
    if (parsed.data.enabled             !== undefined) upsertPayload.enabled             = parsed.data.enabled
    if (parsed.data.employee_amount     !== undefined) upsertPayload.employee_amount     = parsed.data.employee_amount
    if (parsed.data.employer_amount     !== undefined) upsertPayload.employer_amount     = parsed.data.employer_amount
    if (parsed.data.wage_ceiling        !== undefined) upsertPayload.wage_ceiling        = parsed.data.wage_ceiling
    if (parsed.data.frequency           !== undefined) upsertPayload.frequency           = parsed.data.frequency
    if (parsed.data.deduction_months    !== undefined) upsertPayload.deduction_months    = parsed.data.deduction_months
    if (parsed.data.registration_number !== undefined) upsertPayload.registration_number = parsed.data.registration_number

    if (upsertPayload.enabled === undefined) {
      const { data: existing } = await fastify.supabase
        .from('lwf_state_settings').select('enabled')
        .eq('tenant_id', req.tenantId).eq('state_code', stateCode).maybeSingle()
      upsertPayload.enabled = existing?.enabled ?? true
    }

    const { error } = await fastify.supabase
      .from('lwf_state_settings')
      .upsert(upsertPayload, { onConflict: 'tenant_id,state_code' })

    if (error) return serverError(req, reply, error, ErrorCode.UPDATE_FAILED, 'Failed to update LWF state settings')
    await logAction(fastify.supabase, {
      tenantId:    req.tenantId,
      tableName:   'lwf_state_settings',
      recordId:    stateCode,
      action:      'UPDATE',
      performedBy: req.userId,
      newData:     parsed.data as Record<string, unknown>,
    })
    return reply.send({ ...upsertPayload })
  })

  // ── GET /payroll/statutory/lwf/state-config ───────────────────────────────────
  fastify.get('/state-config', { preHandler: [fastify.authenticate, requireHrAdmin] }, async (req: any, reply) => {
    const { employee_id } = (req.query ?? {}) as { employee_id?: string }
    let q = fastify.supabase
      .from('lwf_state_config')
      .select('*')
      .eq('tenant_id', req.tenantId)
      .order('effective_from', { ascending: false })
    if (employee_id) q = q.eq('employee_id', employee_id)
    const { data, error } = await q
    if (error) return serverError(req, reply, error, ErrorCode.QUERY_FAILED, 'Failed to fetch LWF state config')
    return reply.send({ data: data ?? [] })
  })

  // ── PUT /payroll/statutory/lwf/state-config/:employeeId ──────────────────────
  fastify.put('/state-config/:employeeId', { preHandler: [fastify.authenticate, requireHrAdmin] }, async (req: any, reply) => {
    const { employeeId } = req.params as { employeeId: string }
    const schema = z.object({
      state_code:      z.string().min(1),
      effective_from:  z.string().optional(),
      override_reason: z.string().optional(),
    })
    const parsed = schema.safeParse(req.body)
    if (!parsed.success) return reply.code(400).send({ error: 'VALIDATION_ERROR', message: parsed.error.issues[0]?.message })

    const effectiveFrom = parsed.data.effective_from || new Date().toISOString().slice(0, 10)

    // Idempotent: delete open rows then insert
    await fastify.supabase
      .from('lwf_state_config')
      .delete()
      .eq('employee_id', employeeId)
      .eq('tenant_id', req.tenantId)
      .is('effective_to', null)

    const { data, error } = await fastify.supabase
      .from('lwf_state_config')
      .insert({
        employee_id:     employeeId,
        tenant_id:       req.tenantId,
        state_code:      parsed.data.state_code,
        effective_from:  effectiveFrom,
        override_reason: parsed.data.override_reason ?? 'Set from employee master',
      })
      .select().single()

    if (error) return serverError(req, reply, error, ErrorCode.INSERT_FAILED, 'Failed to set employee LWF state')
    await logAction(fastify.supabase, {
      tenantId:    req.tenantId,
      tableName:   'lwf_state_config',
      recordId:    (data as any)?.id ?? employeeId,
      action:      'UPDATE',
      performedBy: req.userId,
      onBehalfOf:  employeeId,
      newData:     parsed.data as Record<string, unknown>,
    })
    return reply.send({ data })
  })

  // ── GET /payroll/statutory/lwf/contributions ──────────────────────────────────
  fastify.get('/contributions', { preHandler: [fastify.authenticate, requireHrAdmin] }, async (req: any, reply) => {
    const { month, employee_id } = (req.query ?? {}) as { month?: string; employee_id?: string }
    let q = fastify.supabase
      .from('lwf_contributions')
      .select('*')
      .eq('tenant_id', req.tenantId)
      .order('contribution_month', { ascending: false })
    if (month)       q = q.eq('contribution_month', month)
    if (employee_id) q = q.eq('employee_id', employee_id)
    const { data, error } = await q
    if (error) return serverError(req, reply, error, ErrorCode.QUERY_FAILED, 'Failed to fetch LWF contributions')
    return reply.send({ data: data ?? [] })
  })

  // ── POST /payroll/statutory/lwf/contributions/compute ────────────────────────
  fastify.post('/contributions/compute', { preHandler: [fastify.authenticate, requireHrAdmin] }, async (req: any, reply) => {
    const schema = z.object({
      month: z.string().regex(/^\d{4}-\d{2}$/, 'month must be YYYY-MM'),
    })
    const parsed = schema.safeParse(req.body)
    if (!parsed.success) return reply.code(400).send({ error: 'VALIDATION_ERROR', message: parsed.error.issues[0]?.message })

    const { month } = parsed.data
    const monthDate    = `${month}-01`
    const calendarMonth = parseInt(month.split('-')[1], 10)

    // Guard: run must be finalized / frozen
    const { data: runRow } = await fastify.supabase
      .from('payroll_runs').select('status').eq('tenant_id', req.tenantId).eq('month', month).maybeSingle()
    const st = (runRow as any)?.status
    if (st !== 'finalized' && st !== 'partial_failed' && st !== 'frozen') {
      return reply.code(409).send({
        error: 'RUN_NOT_FINALIZED',
        message: `Finalize the ${month} payroll run before computing LWF contributions (current: ${st ?? 'no run'}).`,
      })
    }

    // Active employees — fetchAllRows() (not a plain .select()): tenants
    // above 1,000 active employees would otherwise silently get LWF computed
    // for only the first 1,000 (PostgREST's server-side max-rows ceiling).
    let empList: any[]
    try {
      empList = await fetchAllRows((from, to) =>
        fastify.supabase
          .from('employees')
          .select('id, employee_code, site_id')
          .eq('tenant_id', req.tenantId)
          .eq('status', 'active')
          .range(from, to),
      )
    } catch (empErr) {
      return serverError(req, reply, empErr, ErrorCode.QUERY_FAILED, 'Failed to fetch employees')
    }

    // Site state codes
    const siteIds = [...new Set(empList.map((e: any) => e.site_id).filter(Boolean))] as string[]
    const siteStateMap = new Map<string, string>()
    if (siteIds.length > 0) {
      const { data: siteRows } = await fastify.supabase.from('sites').select('id, state_code').in('id', siteIds)
      for (const s of (siteRows ?? []) as any[]) if (s.state_code) siteStateMap.set(s.id, s.state_code)
    }

    // Manual LWF state overrides (latest row per employee)
    const { data: stateConfigs } = await fastify.supabase
      .from('lwf_state_config')
      .select('employee_id, state_code')
      .eq('tenant_id', req.tenantId)
      .order('effective_from', { ascending: false })
    const manualStateMap = new Map<string, string>()
    for (const r of (stateConfigs ?? []) as any[]) {
      if (!manualStateMap.has(r.employee_id)) manualStateMap.set(r.employee_id, r.state_code)
    }

    // LWF exemptions (latest)
    const { data: exemptRows } = await fastify.supabase
      .from('employee_statutory_overrides')
      .select('employee_id')
      .eq('tenant_id', req.tenantId)
      .eq('statutory_type', 'lwf')
      .eq('is_exempt', true)
      .order('effective_from', { ascending: false })
    const exemptSet = new Set<string>(((exemptRows ?? []) as any[]).map(r => r.employee_id))

    // LWF state settings keyed by state_code
    const { data: settingsRows } = await fastify.supabase
      .from('lwf_state_settings')
      .select('*')
      .eq('tenant_id', req.tenantId)
      .eq('enabled', true)
      .eq('is_active', true)
    const settingsMap = new Map<string, any>()
    for (const s of (settingsRows ?? []) as any[]) settingsMap.set(s.state_code, s)

    // Gross wages from finalized slips
    const { data: slipRows } = await fastify.supabase
      .from('payroll_slips')
      .select('employee_id, gross_pay, component_breakdown')
      .eq('tenant_id', req.tenantId)
      .eq('month', month)
      .eq('status', 'finalized')
    const slipGrossMap = new Map<string, number>(
      ((slipRows ?? []) as any[]).map(r => [r.employee_id, r.gross_pay ?? 0]),
    )
    // Actual LWF lines from slip if already computed on the run
    const slipLwfEmpMap = new Map<string, number>()
    const slipLwfEmprMap = new Map<string, number>()
    for (const r of (slipRows ?? []) as any[]) {
      const bd = Array.isArray(r.component_breakdown) ? r.component_breakdown : []
      for (const c of bd) {
        const code = String(c?.code ?? '').toUpperCase()
        const amt  = Number(c?.monthly_amount) || 0
        if (code === 'LWF_EMPLOYEE') slipLwfEmpMap.set(r.employee_id, amt)
        else if (code === 'LWF_EMPLOYER') slipLwfEmprMap.set(r.employee_id, amt)
      }
    }

    // Fallback gross from compensation
    const { data: fallbackRows } = await fastify.supabase
      .from('employee_compensation_components')
      .select('employee_compensations!inner(employee_id), computed_monthly, salary_components!inner(component_type)')
      .eq('employee_compensations.tenant_id', req.tenantId)
      .eq('employee_compensations.is_active', true)
      .eq('salary_components.component_type', 'earning')
    const fallbackGrossMap = new Map<string, number>()
    for (const r of (fallbackRows ?? []) as any[]) {
      const empId = r.employee_compensations?.employee_id
      if (empId) fallbackGrossMap.set(empId, (fallbackGrossMap.get(empId) ?? 0) + (r.computed_monthly ?? 0))
    }

    const contributions: any[] = []
    let skippedExempt = 0, skippedNoState = 0, skippedNoConfig = 0, wagesFromSlip = 0, wagesFallback = 0

    for (const emp of empList) {
      if (exemptSet.has(emp.id)) { skippedExempt++; continue }

      const stateCode = manualStateMap.get(emp.id) ?? (emp.site_id ? siteStateMap.get(emp.site_id) ?? null : null)
      if (!stateCode) { skippedNoState++; continue }

      const setting = settingsMap.get(stateCode)
      if (!setting) { skippedNoConfig++; continue }

      let grossSalary: number
      if (slipGrossMap.has(emp.id)) { grossSalary = slipGrossMap.get(emp.id)!; wagesFromSlip++ }
      else { grossSalary = fallbackGrossMap.get(emp.id) ?? 0; wagesFallback++ }

      const config: LWFConfig = {
        stateCode,
        employeeAmount:  Number(setting.employee_amount) || 0,
        employerAmount:  Number(setting.employer_amount) || 0,
        wageCeiling:     setting.wage_ceiling != null ? Number(setting.wage_ceiling) : null,
        frequency:       setting.frequency ?? 'monthly',
        deductionMonths: parseDeductionMonths(setting.frequency ?? 'monthly', setting.deduction_months),
      }
      const result = computeLWF(grossSalary, calendarMonth, config)

      if (result.isEligible) {
        // Prefer actual slip lines if already on the payslip
        contributions.push({
          tenant_id:             req.tenantId,
          employee_id:           emp.id,
          contribution_month:    month,
          state_code:            stateCode,
          gross_salary:          grossSalary,
          employee_contribution: slipLwfEmpMap.get(emp.id)  ?? result.employeeContribution,
          employer_contribution: slipLwfEmprMap.get(emp.id) ?? result.employerContribution,
          is_eligible:           true,
        })
      }
    }

    // Remove stale rows for employees no longer in this month's deductible set
    // (e.g. became exempt / state disabled / no longer configured since the last
    // compute), so a re-finalize cannot leave a phantom LWF liability on the filing.
    {
      const keepIds = contributions.map((c: any) => c.employee_id)
      let delQ = fastify.supabase
        .from('lwf_contributions')
        .delete()
        .eq('tenant_id', req.tenantId)
        .eq('contribution_month', month)
      if (keepIds.length > 0) delQ = delQ.not('employee_id', 'in', `(${keepIds.join(',')})`)
      const { error: delErr } = await delQ
      if (delErr) return serverError(req, reply, delErr, ErrorCode.DELETE_FAILED, 'Failed to clean up stale LWF contributions')
    }

    if (contributions.length > 0) {
      const { error: upsertErr } = await fastify.supabase
        .from('lwf_contributions')
        .upsert(contributions, { onConflict: 'tenant_id,employee_id,contribution_month' })
      if (upsertErr) return serverError(req, reply, upsertErr, ErrorCode.UPDATE_FAILED, 'Failed to save LWF contributions')
    }

    return reply.send({
      computed_count: contributions.length,
      skipped_exempt: skippedExempt,
      skipped_no_state: skippedNoState,
      skipped_no_config: skippedNoConfig,
      wages_from_slip: wagesFromSlip,
      wages_fallback: wagesFallback,
      month,
    })
  })
}
