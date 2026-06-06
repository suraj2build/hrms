/**
 * EPF (Employees' Provident Fund) Routes
 * Configuration, eligibility, contributions, and ECR export.
 */

import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { computeEPF } from '../../../lib/statutory/epf-engine.js'
import type { EPFConfig, EPFInput } from '../../../lib/statutory/epf-engine.js'

export default async function epfRoutes(fastify: FastifyInstance) {
  const auth = { preHandler: [fastify.authenticate] }

  function requireHrAdmin(req: any, reply: any, done: () => void) {
    if (!['super_admin', 'hr_admin'].includes(req.userRole)) {
      reply.code(403).send({ error: 'FORBIDDEN', message: 'HR admin access required' })
      return
    }
    done()
  }

  // ── GET /payroll/statutory/epf/config ─────────────────────────────────────────
  // Returns the currently active (open-ended) config row.
  fastify.get('/config', auth, async (req: any, reply) => {
    // Fetch the most recent config row.  We intentionally avoid filtering on
    // `effective_to IS NULL` because that column was added in migration 166
    // and may not yet exist in all deployments.  Ordering by effective_from
    // DESC LIMIT 1 is semantically equivalent — it returns the latest version.
    const { data, error } = await fastify.supabase
      .from('epf_config')
      .select('*')
      .eq('tenant_id', req.tenantId)
      .order('effective_from', { ascending: false })
      .limit(1)
      .maybeSingle()

    if (error) return reply.code(500).send({ error: 'QUERY_FAILED', message: error.message })
    return reply.send({ data: data ?? null })
  })

  // ── PUT /payroll/statutory/epf/config ─────────────────────────────────────────
  // Creates a new versioned config row.
  // The partial unique index (WHERE effective_to IS NULL) allows only one open-ended
  // config per tenant at a time.  Before inserting, close the current open-ended row
  // by setting effective_to = effective_from - 1 day (so slabs don't overlap).
  fastify.put('/config', { preHandler: [fastify.authenticate, requireHrAdmin] }, async (req: any, reply) => {
    const schema = z.object({
      employee_contribution_pct:  z.number().optional(),
      employer_pf_pct:            z.number().optional(),
      employer_eps_pct:           z.number().optional(),
      wage_ceiling:               z.number().optional(),
      is_wage_ceiling_applicable: z.boolean().optional(),
      allow_voluntary_pf:         z.boolean().optional(),
      edli_rate_pct:              z.number().optional(),
      edli_cap:                   z.number().optional(),
      edli_floor:                 z.number().optional(),
      admin_charges_pct:          z.number().optional(),
      include_hra_in_pf_wages:    z.boolean().optional(),
      pf_account_number:          z.string().optional(),
      establishment_code:         z.string().optional(),
      effective_from:             z.string(),
    })

    const parsed = schema.safeParse(req.body)
    if (!parsed.success) {
      return reply.code(400).send({ error: 'VALIDATION_ERROR', message: parsed.error.issues[0]?.message })
    }

    const { effective_from, ...rest } = parsed.data

    // Close the current open-ended config (if any) one day before the new effective_from
    const prevDay = new Date(effective_from)
    prevDay.setDate(prevDay.getDate() - 1)
    const closingDate = prevDay.toISOString().slice(0, 10)

    await fastify.supabase
      .from('epf_config')
      .update({ effective_to: closingDate })
      .eq('tenant_id', req.tenantId)
      .is('effective_to', null)

    // Insert new open-ended version
    const { data, error } = await fastify.supabase
      .from('epf_config')
      .insert({
        ...rest,
        effective_from,
        tenant_id:  req.tenantId,
        updated_at: new Date().toISOString(),
      })
      .select()
      .single()

    if (error) return reply.code(500).send({ error: 'INSERT_FAILED', message: error.message })
    return reply.send({ data })
  })

  // ── GET /payroll/statutory/epf/eligibility ────────────────────────────────────
  fastify.get('/eligibility', auth, async (req: any, reply) => {
    const { data, error } = await fastify.supabase
      .from('epf_eligibility_overrides')
      .select('*, employees(id, first_name, last_name, employee_code)')
      .eq('tenant_id', req.tenantId)

    if (error) return reply.code(500).send({ error: 'QUERY_FAILED', message: error.message })
    return reply.send({ data: data ?? [] })
  })

  // ── PUT /payroll/statutory/epf/eligibility/:employeeId ───────────────────────
  fastify.put('/eligibility/:employeeId', { preHandler: [fastify.authenticate, requireHrAdmin] }, async (req: any, reply) => {
    const { employeeId } = req.params as { employeeId: string }

    const schema = z.object({
      is_epf_applicable:       z.boolean().optional(),
      is_exempt:               z.boolean().optional(),
      exemption_reason:        z.string().optional(),
      voluntary_pf_pct:        z.number().optional(),
      // Employee-level ceiling restriction (migration 170).
      // null = follow tenant policy, true = always cap, false = never cap.
      restrict_pf_to_ceiling:  z.boolean().nullable().optional(),
      override_reason:         z.string().min(1),
      effective_from:          z.string(),
    })

    const parsed = schema.safeParse(req.body)
    if (!parsed.success) {
      return reply.code(400).send({ error: 'VALIDATION_ERROR', message: parsed.error.issues[0]?.message })
    }

    const { data, error } = await fastify.supabase
      .from('epf_eligibility_overrides')
      .upsert({
        ...parsed.data,
        employee_id: employeeId,
        tenant_id: req.tenantId,
      }, { onConflict: 'tenant_id,employee_id' })
      .select()
      .single()

    if (error) return reply.code(500).send({ error: 'UPSERT_FAILED', message: error.message })
    return reply.send({ data })
  })

  // ── GET /payroll/statutory/epf/contributions ──────────────────────────────────
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
      .from('epf_contributions')
      .select('*, employees(id, first_name, last_name, employee_code)')
      .eq('tenant_id', req.tenantId)
      .order('contribution_month', { ascending: false })

    if (parsed.data.month) q = q.eq('contribution_month', parsed.data.month)
    if (parsed.data.employee_id) q = q.eq('employee_id', parsed.data.employee_id)

    const { data, error } = await q
    if (error) return reply.code(500).send({ error: 'QUERY_FAILED', message: error.message })
    return reply.send({ data: data ?? [] })
  })

  // ── POST /payroll/statutory/epf/contributions/compute ────────────────────────
  fastify.post('/contributions/compute', { preHandler: [fastify.authenticate, requireHrAdmin] }, async (req: any, reply) => {
    const schema = z.object({
      month: z.string().regex(/^\d{4}-\d{2}$/, 'month must be YYYY-MM'),
    })

    const parsed = schema.safeParse(req.body)
    if (!parsed.success) {
      return reply.code(400).send({ error: 'VALIDATION_ERROR', message: parsed.error.issues[0]?.message })
    }

    const { month } = parsed.data
    const monthDate = `${month}-01`

    // Guard: statutory contributions must be computed from a FINALIZED payroll run,
    // never from mutable draft numbers.
    {
      const { data: runRow } = await fastify.supabase
        .from('payroll_runs').select('status').eq('tenant_id', req.tenantId).eq('month', month).maybeSingle()
      const st = (runRow as any)?.status
      if (st !== 'finalized' && st !== 'partial_failed' && st !== 'frozen') {
        return reply.code(409).send({
          error: 'RUN_NOT_FINALIZED',
          message: `Finalize the ${month} payroll run before computing EPF contributions (current: ${st ?? 'no run'}).`,
        })
      }
    }

    // ── EPF config (effective-date-guarded, most recent row) ──────────────────
    const { data: configRow, error: configErr } = await fastify.supabase
      .from('epf_config')
      .select('*')
      .eq('tenant_id', req.tenantId)
      .lte('effective_from', monthDate)
      .or(`effective_to.is.null,effective_to.gte.${monthDate}`)
      .order('effective_from', { ascending: false })
      .limit(1)
      .maybeSingle()

    // Non-fatal: if the config row can't be read (table missing / transient), fall
    // back to the statutory defaults below rather than blocking the whole compute.
    if (configErr) req.log.warn({ err: configErr, tenant: req.tenantId }, 'EPF config fetch failed — using statutory defaults')

    const config: EPFConfig = configRow ? {
      employeeContributionPct: configRow.employee_contribution_pct    ?? 12,
      employerPfPct:           configRow.employer_pf_pct              ?? 3.67,
      employerEpsPct:          configRow.employer_eps_pct             ?? 8.33,
      wageCeiling:             configRow.wage_ceiling                 ?? 15000,
      isWageCeilingApplicable: configRow.is_wage_ceiling_applicable   ?? true,
      allowVoluntaryPf:        configRow.allow_voluntary_pf           ?? false,
      edliRatePct:             configRow.edli_rate_pct                ?? 0.5,
      edliCap:                 configRow.edli_cap                     ?? 75,
      edliFloor:               configRow.edli_floor                   ?? 25,
      adminChargesPct:         configRow.admin_charges_pct            ?? 0.50,
    } : {
      employeeContributionPct: 12,
      employerPfPct:           3.67,
      employerEpsPct:          8.33,
      wageCeiling:             15000,
      isWageCeilingApplicable: true,
      allowVoluntaryPf:        false,
      edliRatePct:             0.5,
      edliCap:                 75,
      edliFloor:               25,
      adminChargesPct:         0.50,
    }

    // Fetch active employees
    const { data: employees, error: empErr } = await fastify.supabase
      .from('employees')
      .select('id, employee_code, first_name, last_name')
      .eq('tenant_id', req.tenantId)
      .eq('status', 'active')

    if (empErr) return reply.code(500).send({ error: 'QUERY_FAILED', message: 'Failed to fetch employees' })

    const empList = (employees ?? []) as Array<{ id: string; employee_code: string; first_name: string; last_name: string }>

    // EPF is a CENTRAL scheme: one tenant config + a per-employee Yes/No (and PF wage
    // basis capped/actual) from epf_eligibility_overrides. No statutory group / state.

    // ── EPF eligibility overrides (configure-once → persists) ─────────────────
    // Fetch the current active override for each employee — includes UAN,
    // international worker flag, higher PF opt-in (migration 166), and
    // employee-level ceiling restriction (migration 170: restrict_pf_to_ceiling).
    //
    // Resolution model: the MOST RECENT override with effective_from <= month wins
    // and keeps applying to later months until a newer row supersedes it. We do NOT
    // filter on effective_to here — an override whose nominal end-date has passed
    // would otherwise be silently dropped, reverting the employee to default and
    // breaking the operator's expectation that an employee-level config, once set,
    // keeps applying. Future-dated rows (effective_from > month) are still excluded.
    const { data: eligibilityRows } = await fastify.supabase
      .from('epf_eligibility_overrides')
      .select(
        'employee_id, is_epf_applicable, is_exempt, voluntary_pf_pct, ' +
        'is_international_worker, higher_pf_opted, higher_pf_pct, uan, ' +
        'restrict_pf_to_ceiling',
      )
      .eq('tenant_id', req.tenantId)
      .lte('effective_from', monthDate)
      .order('effective_from', { ascending: false })

    // Keep only the most recent override per employee
    const eligibilityMap = new Map<string, {
      is_epf_applicable:       boolean
      is_exempt:               boolean
      voluntary_pf_pct:        number
      is_international_worker: boolean
      higher_pf_opted:         boolean
      higher_pf_pct:           number | null
      uan:                     string | null
      restrict_pf_to_ceiling:  boolean | null
    }>()
    for (const r of (eligibilityRows ?? []) as any[]) {
      if (!eligibilityMap.has(r.employee_id)) {
        eligibilityMap.set(r.employee_id, r)
      }
    }

    // ── Fetch PF-applicable wage base (is_pf_applicable components) ──────────────
    //
    // Statutory correctness: EPF wages = sum of salary components where
    // is_pf_applicable = true (typically Basic + DA only).  Using gross_pay or
    // ctc_monthly over-deducts for employees with HRA, bonuses, or other
    // non-PF-eligible allowances.
    //
    // Approach:
    //   1. Get active compensation IDs for all employees.
    //   2. Sum computed_monthly for components where is_pf_applicable = true.
    //   3. Apply LOP fraction from finalized payslip (if available) so partial-
    //      month employees are not over-charged.
    //   4. Fallback to wageCeiling if no active compensation is found.

    // 1. Active compensation IDs
    const pfBaseMap = new Map<string, number>()
    let wagesFromPfComponents = 0
    let wagesFromSlip         = 0
    let wagesFallbackCount   = 0

    if (empList.length > 0) {
      const { data: activeCompRows } = await fastify.supabase
        .from('employee_compensations')
        .select('id, employee_id')
        .eq('tenant_id', req.tenantId)
        .eq('is_active', true)
        .in('employee_id', empList.map(e => e.id))

      const activeCompIds    = (activeCompRows ?? []).map((c: any) => c.id)
      const empIdByCompId    = new Map<string, string>(
        (activeCompRows ?? []).map((c: any) => [c.id, c.employee_id]),
      )

      // 2. PF-applicable components for those compensation records
      if (activeCompIds.length > 0) {
        const { data: pfCompRows } = await fastify.supabase
          .from('employee_compensation_components')
          .select('compensation_id, computed_monthly, salary_components!inner(is_pf_applicable)')
          .in('compensation_id', activeCompIds)
          .eq('salary_components.is_pf_applicable', true)

        for (const row of (pfCompRows ?? []) as Array<{ compensation_id: string; computed_monthly: number }>) {
          const empId = empIdByCompId.get(row.compensation_id)
          if (empId) {
            pfBaseMap.set(empId, (pfBaseMap.get(empId) ?? 0) + (row.computed_monthly ?? 0))
          }
        }
      }
    }

    // 3. Finalized payslips — the AUTHORITATIVE PF wage base.
    //
    // PF-base unify (H3): the live payroll run derives PF wages from the slip's
    // PF-applicable EARNINGS (already LOP-prorated by the day_fraction engine —
    // see statutory-payroll.applyStatutoryToSlip). To make statutory filing
    // reconcile EXACTLY against the slip (no linear-LOP drift), we mirror that
    // here: sum is_pf_applicable / affects_pf earnings from the slip's stored
    // component_breakdown. The master × linear-LOP path below is a FALLBACK only
    // for employees with no finalized slip.
    const { data: lopSlipRows } = await fastify.supabase
      .from('payroll_slips')
      .select('employee_id, total_working_days, payable_days, component_breakdown')
      .eq('tenant_id', req.tenantId)
      .eq('month', month)
      .eq('status', 'finalized')

    const lopFractionMap = new Map<string, number>(
      (lopSlipRows ?? []).map((r: any) => [
        r.employee_id,
        r.total_working_days > 0 ? r.payable_days / r.total_working_days : 1.0,
      ]),
    )

    // PF wages straight off the finalized slip's PF-applicable earnings —
    // the same base the live run used for PF_EMPLOYEE / PF_EMPLOYER lines.
    const slipPfWagesMap = new Map<string, number>()
    for (const r of (lopSlipRows ?? []) as any[]) {
      const breakdown = Array.isArray(r.component_breakdown) ? r.component_breakdown : []
      const pfWages = breakdown
        .filter((c: any) =>
          c?.component_type === 'earning' && (c?.is_pf_applicable || c?.affects_pf))
        .reduce((s: number, c: any) => s + (Number(c?.monthly_amount) || 0), 0)
      slipPfWagesMap.set(r.employee_id, Math.round(pfWages * 100) / 100)
    }

    // Compute EPF for each employee
    const contributions = empList.map(emp => {
      const eligibility = eligibilityMap.get(emp.id)

      // PF wages — authoritative source priority:
      //   1. Finalized slip's PF-applicable earnings (already LOP-adjusted) — matches the run.
      //   2. Fallback: master PF components × linear LOP fraction (no slip yet).
      //   3. Fallback: statutory wage ceiling × LOP fraction (no compensation).
      let rawWages: number
      if (slipPfWagesMap.has(emp.id)) {
        rawWages = slipPfWagesMap.get(emp.id)!
        wagesFromSlip++
      } else {
        const pfBase      = pfBaseMap.get(emp.id) ?? config.wageCeiling
        const lopFraction = lopFractionMap.get(emp.id) ?? 1.0
        rawWages = Math.round(pfBase * lopFraction * 100) / 100
        if (pfBaseMap.has(emp.id)) wagesFromPfComponents++
        else                       wagesFallbackCount++
      }

      // Per-employee Yes/No (employee master). is_exempt or is_epf_applicable=false
      // forces zero. Default (no override) = applicable.
      const isExempt       = eligibility?.is_exempt               ?? false
      const isApplicable   = isExempt ? false : (eligibility?.is_epf_applicable ?? true)
      const higherPfOpted  = eligibility?.higher_pf_opted          ?? false
      const higherPfPct    = eligibility?.higher_pf_pct             ?? 12

      const input: EPFInput = {
        employeeId:            emp.id,
        pfWages:               rawWages,
        voluntaryPfPct:        eligibility?.voluntary_pf_pct       ?? 0,
        isEpfApplicable:       isApplicable,
        isInternationalWorker: eligibility?.is_international_worker ?? false,
        higherPfOpted,
        higherPfPct,
      }

      // Per-employee PF wage basis (migration 170: restrict_pf_to_ceiling).
      // NULL  = follow tenant policy (config.isWageCeilingApplicable).
      // true  = Capped: restrict PF wages to the statutory ceiling.
      // false = Actual: PF on full PF-applicable wages, no ceiling.
      const restrictPfToCeiling = eligibility?.restrict_pf_to_ceiling ?? null
      const employeeConfig: EPFConfig =
        restrictPfToCeiling === null
          ? config   // no employee-level override — use tenant policy as-is
          : { ...config, isWageCeilingApplicable: restrictPfToCeiling }

      const result = computeEPF(input, employeeConfig)

      // NOTE: capped_pf_wages, total_employer_contribution and admin_charges are
      // intentionally excluded — they are not insertable columns in epf_contributions.
      // total_employer_contribution is GENERATED ALWAYS AS (employer_pf + employer_eps
      // + edli_contribution). capped_pf_wages and admin_charges are not in the schema
      // (admin charges are an A/c-2 employer liability derived at filing time, not
      // stored per-row).
      return {
        tenant_id:             req.tenantId,
        employee_id:           emp.id,
        contribution_month:    month,
        pf_wages:              result.pfWages,
        employee_contribution: result.employeeContribution,
        voluntary_pf:          result.voluntaryPfContribution,  // column is voluntary_pf, not voluntary_pf_contribution
        employer_pf:           result.employerPf,
        employer_eps:          result.employerEps,
        edli_contribution:     result.edliContribution,
        is_capped:             result.isCapped,
      }
    })

    if (contributions.length > 0) {
      const { error: upsertErr } = await fastify.supabase
        .from('epf_contributions')
        .upsert(contributions, { onConflict: 'tenant_id,employee_id,contribution_month' })

      if (upsertErr) return reply.code(500).send({ error: 'UPSERT_FAILED', message: upsertErr.message })
    }

    return reply.send({
      computed_count:          contributions.length,
      // Wage source breakdown for auditability
      wages_from_slip:          wagesFromSlip,
      wages_from_pf_components: wagesFromPfComponents,
      wages_fallback:           wagesFallbackCount,
      month,
    })
  })

  // ── GET /payroll/statutory/epf/registrations ──────────────────────────────────
  fastify.get('/registrations', { preHandler: [fastify.authenticate, requireHrAdmin] }, async (req: any, reply) => {
    const { data, error } = await fastify.supabase
      .from('statutory_registrations')
      .select('id, registration_number, code_label, is_default, pf_sub_code, site_id, effective_from, is_active, notes')
      .eq('tenant_id', req.tenantId)
      .eq('statutory_type', 'epf')
      .eq('is_active', true)
      .order('is_default', { ascending: false })
      .order('effective_from', { ascending: false })

    if (error) return reply.code(500).send({ error: 'QUERY_FAILED', message: error.message })
    return reply.send({ data: data ?? [] })
  })

  // ── POST /payroll/statutory/epf/registrations ─────────────────────────────────
  fastify.post('/registrations', { preHandler: [fastify.authenticate, requireHrAdmin] }, async (req: any, reply) => {
    const schema = z.object({
      registration_number: z.string().min(1),
      code_label:          z.string().optional(),
      pf_sub_code:         z.string().max(3).optional(),
      is_default:          z.boolean().optional().default(false),
      site_id:             z.string().uuid().optional(),
      notes:               z.string().optional(),
    })

    const parsed = schema.safeParse(req.body)
    if (!parsed.success) {
      return reply.code(400).send({ error: 'VALIDATION_ERROR', message: parsed.error.issues[0]?.message })
    }

    // If setting as default, clear existing default first
    if (parsed.data.is_default) {
      await fastify.supabase
        .from('statutory_registrations')
        .update({ is_default: false })
        .eq('tenant_id', req.tenantId)
        .eq('statutory_type', 'epf')
        .eq('is_default', true)
    }

    const { data, error } = await fastify.supabase
      .from('statutory_registrations')
      .insert({
        tenant_id:           req.tenantId,
        statutory_type:      'epf',
        registration_number: parsed.data.registration_number,
        code_label:          parsed.data.code_label ?? null,
        pf_sub_code:         parsed.data.pf_sub_code ?? null,
        is_default:          parsed.data.is_default,
        is_active:           true,
        site_id:             parsed.data.site_id ?? null,
        notes:               parsed.data.notes ?? null,
        effective_from:      new Date().toISOString().slice(0, 10),
        created_by:          req.userId ?? null,
      })
      .select()
      .single()

    if (error) return reply.code(500).send({ error: 'INSERT_FAILED', message: error.message })
    return reply.code(201).send({ data })
  })

  // ── PUT /payroll/statutory/epf/registrations/:id ──────────────────────────────
  fastify.put('/registrations/:id', { preHandler: [fastify.authenticate, requireHrAdmin] }, async (req: any, reply) => {
    const { id } = req.params as { id: string }

    const schema = z.object({
      registration_number: z.string().min(1).optional(),
      code_label:          z.string().optional(),
      pf_sub_code:         z.string().max(3).nullable().optional(),
      is_default:          z.boolean().optional(),
      notes:               z.string().optional(),
    })

    const parsed = schema.safeParse(req.body)
    if (!parsed.success) {
      return reply.code(400).send({ error: 'VALIDATION_ERROR', message: parsed.error.issues[0]?.message })
    }

    // If setting as default, clear existing default first
    if (parsed.data.is_default === true) {
      await fastify.supabase
        .from('statutory_registrations')
        .update({ is_default: false })
        .eq('tenant_id', req.tenantId)
        .eq('statutory_type', 'epf')
        .eq('is_default', true)
        .neq('id', id)
    }

    const { data, error } = await fastify.supabase
      .from('statutory_registrations')
      .update({ ...parsed.data })
      .eq('id', id)
      .eq('tenant_id', req.tenantId)
      .eq('statutory_type', 'epf')
      .select()
      .single()

    if (error) return reply.code(500).send({ error: 'UPDATE_FAILED', message: error.message })
    return reply.send({ data })
  })

  // ── DELETE /payroll/statutory/epf/registrations/:id (soft delete) ────────────
  fastify.delete('/registrations/:id', { preHandler: [fastify.authenticate, requireHrAdmin] }, async (req: any, reply) => {
    const { id } = req.params as { id: string }

    const { error } = await fastify.supabase
      .from('statutory_registrations')
      .update({ is_active: false, is_default: false })
      .eq('id', id)
      .eq('tenant_id', req.tenantId)
      .eq('statutory_type', 'epf')

    if (error) return reply.code(500).send({ error: 'UPDATE_FAILED', message: error.message })
    return reply.code(204).send()
  })

  // ── GET /payroll/statutory/epf/export/:month ──────────────────────────────────
  fastify.get('/export/:month', auth, async (req: any, reply) => {
    const { month } = req.params as { month: string }

    const { data, error } = await fastify.supabase
      .from('epf_contributions')
      .select('*, employees(employee_code, first_name, last_name)')
      .eq('tenant_id', req.tenantId)
      .eq('contribution_month', month)

    if (error) return reply.code(500).send({ error: 'QUERY_FAILED', message: error.message })

    const ecr = (data ?? []).map((row: any) => ({
      uan: null,
      employee_code: row.employees?.employee_code ?? null,
      name: row.employees ? `${row.employees.first_name} ${row.employees.last_name}` : null,
      pf_wages: row.pf_wages,
      employee_contribution: row.employee_contribution,
      employer_pf: row.employer_pf,
      employer_eps: row.employer_eps,
      edli_contribution: row.edli_contribution,
      voluntary_pf: row.voluntary_pf,  // column is voluntary_pf in epf_contributions
    }))

    return reply.send({ data: ecr, month })
  })
}
