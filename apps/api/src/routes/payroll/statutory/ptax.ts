/**
 * Professional Tax Routes
 * State-wise slab management and contribution computation.
 */

import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { computePTax } from '../../../lib/statutory/ptax-engine.js'
import type { PTaxSlab } from '../../../lib/statutory/ptax-engine.js'

export default async function ptaxRoutes(fastify: FastifyInstance) {
  const auth = { preHandler: [fastify.authenticate] }

  function requireHrAdmin(req: any, reply: any, done: () => void) {
    if (!['super_admin', 'hr_admin'].includes(req.userRole)) {
      reply.code(403).send({ error: 'FORBIDDEN', message: 'HR admin access required' })
      return
    }
    done()
  }

  // ── Static state catalogue (all Indian states / UTs that levy P-Tax) ──────────
  const PTAX_STATES: Record<string, string> = {
    AP: 'Andhra Pradesh',
    AS: 'Assam',
    BR: 'Bihar',
    CG: 'Chhattisgarh',
    GA: 'Goa',
    GJ: 'Gujarat',
    HP: 'Himachal Pradesh',
    JH: 'Jharkhand',
    KA: 'Karnataka',
    KL: 'Kerala',
    MH: 'Maharashtra',
    MN: 'Manipur',
    ML: 'Meghalaya',
    MZ: 'Mizoram',
    NL: 'Nagaland',
    OR: 'Odisha',
    PB: 'Punjab',
    SK: 'Sikkim',
    TN: 'Tamil Nadu',
    TS: 'Telangana',
    TR: 'Tripura',
    WB: 'West Bengal',
  }

  // ── GET /payroll/statutory/ptax/states ────────────────────────────────────────
  // Returns all known P-Tax states with their enabled status for this tenant.
  // Enabled state is persisted in ptax_state_settings (migration 179).
  // Falls back to disabled if no settings row exists yet.
  fastify.get('/states', { preHandler: [fastify.authenticate, requireHrAdmin] }, async (req: any, reply) => {
    const { data: settings, error } = await fastify.supabase
      .from('ptax_state_settings')
      .select('state_code, enabled, registration_number, registration_date')
      .eq('tenant_id', req.tenantId)

    if (error) return reply.code(500).send({ error: 'QUERY_FAILED', message: error.message })

    // Build a lookup map: state_code → settings row
    const settingsMap = new Map<string, { enabled: boolean; registration_number: string | null; registration_date: string | null }>()
    for (const s of (settings ?? []) as any[]) {
      settingsMap.set(s.state_code, {
        enabled:             s.enabled,
        registration_number: s.registration_number ?? null,
        registration_date:   s.registration_date   ?? null,
      })
    }

    const result = Object.entries(PTAX_STATES).map(([code, name]) => {
      const row = settingsMap.get(code)
      return {
        state_code:          code,
        state_name:          name,
        // Default to false for states never explicitly toggled
        enabled:             row?.enabled             ?? false,
        registration_number: row?.registration_number ?? null,
        registration_date:   row?.registration_date   ?? null,
      }
    })

    return reply.send(result)
  })

  // ── PUT /payroll/statutory/ptax/states/:stateCode ─────────────────────────────
  // Toggle a state on (enabled=true) or off (enabled=false).
  // Upserts a row in ptax_state_settings.
  fastify.put('/states/:stateCode', { preHandler: [fastify.authenticate, requireHrAdmin] }, async (req: any, reply) => {
    const { stateCode } = req.params as { stateCode: string }

    if (!PTAX_STATES[stateCode]) {
      return reply.code(404).send({ error: 'NOT_FOUND', message: `Unknown state code: ${stateCode}` })
    }

    const schema = z.object({
      enabled:             z.boolean().optional(),
      registration_number: z.string().nullable().optional(),
      registration_date:   z.string().nullable().optional(),
    })

    const parsed = schema.safeParse(req.body)
    if (!parsed.success) {
      return reply.code(400).send({ error: 'VALIDATION_ERROR', message: parsed.error.issues[0]?.message })
    }

    // Default enabled to true if not explicitly provided
    const isEnabled = parsed.data.enabled !== false && parsed.data.enabled !== undefined
      ? parsed.data.enabled
      : (parsed.data.enabled === false ? false : undefined)

    // Build upsert payload — only include defined fields
    const upsertPayload: Record<string, any> = {
      tenant_id:  req.tenantId,
      state_code: stateCode,
      updated_at: new Date().toISOString(),
      updated_by: req.userId,
    }

    if (parsed.data.enabled !== undefined) {
      upsertPayload.enabled = parsed.data.enabled
    }
    if (parsed.data.registration_number !== undefined) {
      upsertPayload.registration_number = parsed.data.registration_number
    }
    if (parsed.data.registration_date !== undefined) {
      upsertPayload.registration_date = parsed.data.registration_date
    }

    // If only registration fields are being updated (no enabled flag), we need
    // to preserve the existing enabled value via upsert without overwriting it.
    // If enabled was not passed, default to true for new rows only — existing rows
    // are updated in-place via ON CONFLICT DO UPDATE, so we read the current value first.
    if (parsed.data.enabled === undefined) {
      const { data: existing } = await fastify.supabase
        .from('ptax_state_settings')
        .select('enabled')
        .eq('tenant_id', req.tenantId)
        .eq('state_code', stateCode)
        .maybeSingle()
      upsertPayload.enabled = existing?.enabled ?? true
    }

    const { error } = await fastify.supabase
      .from('ptax_state_settings')
      .upsert(upsertPayload, { onConflict: 'tenant_id,state_code' })

    if (error) return reply.code(500).send({ error: 'UPSERT_FAILED', message: error.message })

    return reply.send({
      state_code:          stateCode,
      state_name:          PTAX_STATES[stateCode],
      enabled:             upsertPayload.enabled,
      registration_number: upsertPayload.registration_number ?? null,
      registration_date:   upsertPayload.registration_date   ?? null,
    })
  })

  // ── GET /payroll/statutory/ptax/slabs ─────────────────────────────────────────
  fastify.get('/slabs', auth, async (req: any, reply) => {
    const querySchema = z.object({
      state_code: z.string().optional(),
      financial_year: z.string().optional(),
    })

    const parsed = querySchema.safeParse(req.query)
    if (!parsed.success) {
      return reply.code(400).send({ error: 'VALIDATION_ERROR', message: parsed.error.issues[0]?.message })
    }

    let q = fastify.supabase
      .from('ptax_slabs')
      .select('*')
      .eq('tenant_id', req.tenantId)
      .order('state_code', { ascending: true })
      .order('monthly_income_from', { ascending: true })

    if (parsed.data.state_code) q = q.eq('state_code', parsed.data.state_code)
    if (parsed.data.financial_year) q = q.eq('financial_year', parsed.data.financial_year)

    const { data, error } = await q
    if (error) return reply.code(500).send({ error: 'QUERY_FAILED', message: error.message })
    return reply.send({ data: data ?? [] })
  })

  // ── POST /payroll/statutory/ptax/slabs ────────────────────────────────────────
  fastify.post('/slabs', { preHandler: [fastify.authenticate, requireHrAdmin] }, async (req: any, reply) => {
    const schema = z.object({
      state_code: z.string().min(1),
      financial_year: z.string().min(1),
      gender: z.enum(['male', 'female', 'other']).optional(),
      monthly_income_from: z.number(),
      monthly_income_to: z.number().optional(),
      monthly_ptax: z.number(),
      annual_ptax: z.number().optional(),
    })

    const parsed = schema.safeParse(req.body)
    if (!parsed.success) {
      return reply.code(400).send({ error: 'VALIDATION_ERROR', message: parsed.error.issues[0]?.message })
    }

    const { data, error } = await fastify.supabase
      .from('ptax_slabs')
      .insert({ ...parsed.data, tenant_id: req.tenantId })
      .select()
      .single()

    if (error) {
      if (error.code === '23505') {
        return reply.code(409).send({ error: 'DUPLICATE_SLAB', message: 'A slab with these parameters already exists' })
      }
      return reply.code(500).send({ error: 'INSERT_FAILED', message: error.message })
    }

    return reply.code(201).send({ data })
  })

  // ── DELETE /payroll/statutory/ptax/slabs/:id ──────────────────────────────────
  fastify.delete('/slabs/:id', { preHandler: [fastify.authenticate, requireHrAdmin] }, async (req: any, reply) => {
    const { id } = req.params as { id: string }

    const { error } = await fastify.supabase
      .from('ptax_slabs')
      .delete()
      .eq('id', id)
      .eq('tenant_id', req.tenantId)

    if (error) return reply.code(500).send({ error: 'DELETE_FAILED', message: error.message })
    return reply.code(204).send()
  })

  // ── GET /payroll/statutory/ptax/state-config ──────────────────────────────────
  fastify.get('/state-config', auth, async (req: any, reply) => {
    const querySchema = z.object({
      employee_id: z.string().uuid().optional(),
    })

    const parsed = querySchema.safeParse(req.query)
    if (!parsed.success) {
      return reply.code(400).send({ error: 'VALIDATION_ERROR', message: parsed.error.issues[0]?.message })
    }

    let q = fastify.supabase
      .from('ptax_state_config')
      .select('*, employees(id, first_name, last_name, employee_code)')
      .eq('tenant_id', req.tenantId)

    if (parsed.data.employee_id) q = q.eq('employee_id', parsed.data.employee_id)

    const { data, error } = await q
    if (error) return reply.code(500).send({ error: 'QUERY_FAILED', message: error.message })
    return reply.send({ data: data ?? [] })
  })

  // ── PUT /payroll/statutory/ptax/state-config/:employeeId ─────────────────────
  fastify.put('/state-config/:employeeId', { preHandler: [fastify.authenticate, requireHrAdmin] }, async (req: any, reply) => {
    const { employeeId } = req.params as { employeeId: string }

    const schema = z.object({
      state_code: z.string().min(1),
      effective_from: z.string(),
      effective_to: z.string().optional(),
      override_reason: z.string().optional(),
    })

    const parsed = schema.safeParse(req.body)
    if (!parsed.success) {
      return reply.code(400).send({ error: 'VALIDATION_ERROR', message: parsed.error.issues[0]?.message })
    }

    const { data, error } = await fastify.supabase
      .from('ptax_state_config')
      .upsert({
        ...parsed.data,
        employee_id: employeeId,
        tenant_id: req.tenantId,
        updated_at: new Date().toISOString(),
      }, { onConflict: 'tenant_id,employee_id,effective_from' })
      .select()
      .single()

    if (error) return reply.code(500).send({ error: 'UPSERT_FAILED', message: error.message })
    return reply.send({ data })
  })

  // ── GET /payroll/statutory/ptax/contributions ─────────────────────────────────
  fastify.get('/contributions', auth, async (req: any, reply) => {
    const querySchema = z.object({
      month: z.string().optional(),
      employee_id: z.string().uuid().optional(),
    })

    const parsed = querySchema.safeParse(req.query)
    if (!parsed.success) {
      return reply.code(400).send({ error: 'VALIDATION_ERROR', message: parsed.error.issues[0]?.message })
    }

    let q = fastify.supabase
      .from('ptax_contributions')
      .select('*')
      .eq('tenant_id', req.tenantId)

    if (parsed.data.month) q = q.eq('contribution_month', parsed.data.month)
    if (parsed.data.employee_id) q = q.eq('employee_id', parsed.data.employee_id)

    const { data, error } = await q
    if (error) return reply.code(500).send({ error: 'QUERY_FAILED', message: error.message })
    return reply.send({ data: data ?? [] })
  })

  // ── POST /payroll/statutory/ptax/contributions/compute ───────────────────────
  fastify.post('/contributions/compute', { preHandler: [fastify.authenticate, requireHrAdmin] }, async (req: any, reply) => {
    const schema = z.object({
      month: z.string().regex(/^\d{4}-\d{2}$/, 'month must be YYYY-MM'),
      financial_year: z.string().min(1),
    })

    const parsed = schema.safeParse(req.body)
    if (!parsed.success) {
      return reply.code(400).send({ error: 'VALIDATION_ERROR', message: parsed.error.issues[0]?.message })
    }

    const { month, financial_year } = parsed.data
    const monthDate = `${month}-01`

    // Guard: statutory contributions must be computed from a FINALIZED payroll run.
    {
      const { data: runRow } = await fastify.supabase
        .from('payroll_runs').select('status').eq('tenant_id', req.tenantId).eq('month', month).maybeSingle()
      const st = (runRow as any)?.status
      if (st !== 'finalized' && st !== 'partial_failed') {
        return reply.code(409).send({
          error: 'RUN_NOT_FINALIZED',
          message: `Finalize the ${month} payroll run before computing Professional Tax (current: ${st ?? 'no run'}).`,
        })
      }
    }

    // Calendar month for frequency checks (1–12)
    const calendarMonth = parseInt(month.split('-')[1], 10)

    // Fetch active employees
    const { data: employees, error: empErr } = await fastify.supabase
      .from('employees')
      .select('id, employee_code, site_id, sites(id, state_code)')
      .eq('tenant_id', req.tenantId)
      .eq('status', 'active')

    if (empErr) return reply.code(500).send({ error: 'QUERY_FAILED', message: 'Failed to fetch employees' })

    // Supabase returns joined tables as arrays (even for many-to-one FK).
    // Cast to `any[]` and access .sites as a scalar at runtime.
    const empList = (employees ?? []) as any[]

    // ── State resolution ───────────────────────────────────────────────────────
    // Priority: ptax_state_config (manual) > sites.state_code (auto)
    const { data: stateConfigs } = await fastify.supabase
      .from('ptax_state_config')
      .select('employee_id, state_code')
      .eq('tenant_id', req.tenantId)
      .lte('effective_from', monthDate)
      .or(`effective_to.is.null,effective_to.gte.${monthDate}`)
      .order('effective_from', { ascending: false })

    // Map employee_id → most recent manual state override
    const manualStateMap = new Map<string, string>()
    for (const cfg of (stateConfigs ?? []) as any[]) {
      if (!manualStateMap.has(cfg.employee_id) && cfg.state_code) {
        manualStateMap.set(cfg.employee_id, cfg.state_code)
      }
    }

    // ── PTax exemptions ────────────────────────────────────────────────────────
    const { data: exemptRows } = await fastify.supabase
      .from('employee_statutory_overrides')
      .select('employee_id')
      .eq('tenant_id', req.tenantId)
      .eq('statutory_type', 'ptax')
      .eq('is_exempt', true)
      .lte('effective_from', monthDate)
      .or(`effective_to.is.null,effective_to.gte.${monthDate}`)

    const exemptSet = new Set<string>(((exemptRows ?? []) as any[]).map(r => r.employee_id))

    // ── Actual gross wages from finalized payroll slips (payroll-safe) ─────────
    // Gross = gross_pay from payroll_slips where status = finalized for this month.
    // For employees without a finalized slip, fall back to sum of all earning
    // components from their active compensation (pro-rated estimate).
    const { data: slipRows } = await fastify.supabase
      .from('payroll_slips')
      .select('employee_id, gross_pay')
      .eq('tenant_id', req.tenantId)
      .eq('month', month)
      .eq('status', 'finalized')

    const slipGrossMap = new Map<string, number>(
      ((slipRows ?? []) as any[]).map(r => [r.employee_id, r.gross_pay ?? 0]),
    )

    // Fallback: gross from active compensation components (earning type only)
    let fallbackGrossMap = new Map<string, number>()
    const empsMissingSlip = empList.filter(e => !slipGrossMap.has(e.id)).map(e => e.id)

    if (empsMissingSlip.length > 0) {
      const { data: compRows } = await fastify.supabase
        .from('employee_compensations')
        .select('id, employee_id')
        .eq('tenant_id', req.tenantId)
        .eq('is_active', true)
        .in('employee_id', empsMissingSlip)

      const compIdToEmpId = new Map<string, string>(
        ((compRows ?? []) as any[]).map((c: any) => [c.id, c.employee_id]),
      )

      if (compRows && compRows.length > 0) {
        const { data: compCompRows } = await fastify.supabase
          .from('employee_compensation_components')
          .select('compensation_id, computed_monthly, salary_components!inner(component_type)')
          .in('compensation_id', (compRows as any[]).map(c => c.id))
          .eq('salary_components.component_type', 'earning')

        for (const row of (compCompRows ?? []) as any[]) {
          const empId = compIdToEmpId.get(row.compensation_id)
          if (empId) {
            fallbackGrossMap.set(empId, (fallbackGrossMap.get(empId) ?? 0) + (row.computed_monthly ?? 0))
          }
        }
      }
    }

    // ── Fetch all ptax slabs for this tenant + financial year (all states) ─────
    const { data: allSlabs } = await fastify.supabase
      .from('ptax_slabs')
      .select('state_code, monthly_income_from, monthly_income_to, monthly_ptax, frequency, deduction_month')
      .eq('tenant_id', req.tenantId)
      .eq('financial_year', financial_year)
      .eq('is_active', true)

    const slabsByState = new Map<string, PTaxSlab[]>()
    for (const slab of (allSlabs ?? []) as any[]) {
      const existing = slabsByState.get(slab.state_code) ?? []
      existing.push({
        monthlyIncomeFrom: slab.monthly_income_from,
        monthlyIncomeTo:   slab.monthly_income_to ?? undefined,
        monthlyPtax:       slab.monthly_ptax,
        frequency:         slab.frequency ?? 'monthly',
        deductionMonth:    slab.deduction_month ?? undefined,
      } as PTaxSlab)
      slabsByState.set(slab.state_code, existing)
    }

    const contributions: any[] = []
    let skippedExempt = 0
    let skippedNoState = 0
    let wagesFromSlip = 0
    let wagesFallback = 0

    for (const emp of empList) {
      // Skip exempted employees
      if (exemptSet.has(emp.id)) { skippedExempt++; continue }

      // Resolve state: manual override → site state_code
      // emp.sites may be array (Supabase join) or object depending on relation type
      const empSites = Array.isArray(emp.sites) ? emp.sites[0] : emp.sites
      const stateCode = manualStateMap.get(emp.id) ?? (empSites?.state_code ?? null)
      if (!stateCode) { skippedNoState++; continue }

      const slabs = slabsByState.get(stateCode) ?? []
      if (slabs.length === 0) continue  // no slabs configured for this state/FY

      // Resolve gross wages
      let grossSalary: number
      if (slipGrossMap.has(emp.id)) {
        grossSalary = slipGrossMap.get(emp.id)!
        wagesFromSlip++
      } else {
        grossSalary = fallbackGrossMap.get(emp.id) ?? 0
        wagesFallback++
      }

      const result = computePTax(grossSalary, slabs, calendarMonth, stateCode)

      contributions.push({
        tenant_id:          req.tenantId,
        employee_id:        emp.id,
        contribution_month: month,
        state_code:         stateCode,
        financial_year,
        gross_salary:       grossSalary,
        ptax_amount:        result.ptaxAmount,
      })
    }

    if (contributions.length > 0) {
      const { error: upsertErr } = await fastify.supabase
        .from('ptax_contributions')
        .upsert(contributions, { onConflict: 'tenant_id,employee_id,contribution_month' })

      if (upsertErr) return reply.code(500).send({ error: 'UPSERT_FAILED', message: upsertErr.message })
    }

    return reply.send({
      computed_count:    contributions.length,
      skipped_exempt:    skippedExempt,
      skipped_no_state:  skippedNoState,
      wages_from_slip:   wagesFromSlip,
      wages_fallback:    wagesFallback,
      month,
    })
  })
}
