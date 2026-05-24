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
  fastify.get('/config', auth, async (req: any, reply) => {
    const { data, error } = await fastify.supabase
      .from('epf_config')
      .select('*')
      .eq('tenant_id', req.tenantId)
      .maybeSingle()

    if (error) return reply.code(500).send({ error: 'QUERY_FAILED', message: error.message })
    return reply.send({ data: data ?? null })
  })

  // ── PUT /payroll/statutory/epf/config ─────────────────────────────────────────
  fastify.put('/config', { preHandler: [fastify.authenticate, requireHrAdmin] }, async (req: any, reply) => {
    const schema = z.object({
      employee_contribution_pct: z.number().optional(),
      employer_pf_pct: z.number().optional(),
      employer_eps_pct: z.number().optional(),
      wage_ceiling: z.number().optional(),
      is_wage_ceiling_applicable: z.boolean().optional(),
      allow_voluntary_pf: z.boolean().optional(),
      include_hra_in_pf_wages: z.boolean().optional(),
      pf_account_number: z.string().optional(),
      establishment_code: z.string().optional(),
      effective_from: z.string(),
    })

    const parsed = schema.safeParse(req.body)
    if (!parsed.success) {
      return reply.code(400).send({ error: 'VALIDATION_ERROR', message: parsed.error.issues[0]?.message })
    }

    const { data, error } = await fastify.supabase
      .from('epf_config')
      .upsert({
        ...parsed.data,
        tenant_id: req.tenantId,
        updated_at: new Date().toISOString(),
      }, { onConflict: 'tenant_id' })
      .select()
      .single()

    if (error) return reply.code(500).send({ error: 'UPSERT_FAILED', message: error.message })
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
      is_epf_applicable: z.boolean().optional(),
      is_exempt: z.boolean().optional(),
      exemption_reason: z.string().optional(),
      voluntary_pf_pct: z.number().optional(),
      override_reason: z.string().min(1),
      effective_from: z.string(),
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
        updated_at: new Date().toISOString(),
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

    // Fetch EPF config
    const { data: configRow, error: configErr } = await fastify.supabase
      .from('epf_config')
      .select('*')
      .eq('tenant_id', req.tenantId)
      .maybeSingle()

    if (configErr) return reply.code(500).send({ error: 'QUERY_FAILED', message: 'Failed to fetch EPF config' })

    const config: EPFConfig = configRow ? {
      employeeContributionPct: configRow.employee_contribution_pct ?? 12,
      employerPfPct: configRow.employer_pf_pct ?? 3.67,
      employerEpsPct: configRow.employer_eps_pct ?? 8.33,
      wageCeiling: configRow.wage_ceiling ?? 15000,
      isWageCeilingApplicable: configRow.is_wage_ceiling_applicable ?? true,
      allowVoluntaryPf: configRow.allow_voluntary_pf ?? false,
    } : {
      employeeContributionPct: 12,
      employerPfPct: 3.67,
      employerEpsPct: 8.33,
      wageCeiling: 15000,
      isWageCeilingApplicable: true,
      allowVoluntaryPf: false,
    }

    // Fetch active employees
    const { data: employees, error: empErr } = await fastify.supabase
      .from('employees')
      .select('id, employee_code, first_name, last_name')
      .eq('tenant_id', req.tenantId)
      .eq('status', 'active')

    if (empErr) return reply.code(500).send({ error: 'QUERY_FAILED', message: 'Failed to fetch employees' })

    const empList = (employees ?? []) as Array<{ id: string; employee_code: string; first_name: string; last_name: string }>

    // Compute EPF for each employee
    const contributions = empList.map(emp => {
      const input: EPFInput = {
        employeeId: emp.id,
        pfWages: 15000, // placeholder
        voluntaryPfPct: 0,
        isEpfApplicable: true,
      }

      const result = computeEPF(input, config)

      return {
        tenant_id: req.tenantId,
        employee_id: emp.id,
        contribution_month: month,
        pf_wages: result.pfWages,
        capped_pf_wages: result.cappedPfWages,
        employee_contribution: result.employeeContribution,
        voluntary_pf_contribution: result.voluntaryPfContribution,
        employer_pf: result.employerPf,
        employer_eps: result.employerEps,
        edli_contribution: result.edliContribution,
        total_employer_contribution: result.totalEmployerContribution,
        is_capped: result.isCapped,
      }
    })

    if (contributions.length > 0) {
      const { error: upsertErr } = await fastify.supabase
        .from('epf_contributions')
        .upsert(contributions, { onConflict: 'tenant_id,employee_id,contribution_month' })

      if (upsertErr) return reply.code(500).send({ error: 'UPSERT_FAILED', message: upsertErr.message })
    }

    return reply.send({ computed_count: contributions.length })
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
      voluntary_pf: row.voluntary_pf_contribution,
    }))

    return reply.send({ data: ecr, month })
  })
}
