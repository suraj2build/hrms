/**
 * ESI (Employees' State Insurance) Routes
 * Configuration, eligibility, and contributions.
 */

import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { computeESI } from '../../../lib/statutory/esi-engine.js'
import type { ESIConfig } from '../../../lib/statutory/esi-engine.js'

export default async function esiRoutes(fastify: FastifyInstance) {
  const auth = { preHandler: [fastify.authenticate] }

  function requireHrAdmin(req: any, reply: any, done: () => void) {
    if (!['super_admin', 'hr_admin'].includes(req.userRole)) {
      reply.code(403).send({ error: 'FORBIDDEN', message: 'HR admin access required' })
      return
    }
    done()
  }

  // ── GET /payroll/statutory/esi/config ─────────────────────────────────────────
  fastify.get('/config', auth, async (req: any, reply) => {
    const { data, error } = await fastify.supabase
      .from('esi_config')
      .select('*')
      .eq('tenant_id', req.tenantId)
      .maybeSingle()

    if (error) return reply.code(500).send({ error: 'QUERY_FAILED', message: error.message })
    return reply.send({ data: data ?? null })
  })

  // ── PUT /payroll/statutory/esi/config ─────────────────────────────────────────
  fastify.put('/config', { preHandler: [fastify.authenticate, requireHrAdmin] }, async (req: any, reply) => {
    const schema = z.object({
      employee_contribution_pct: z.number().optional(),
      employer_contribution_pct: z.number().optional(),
      wage_ceiling: z.number().optional(),
      effective_from: z.string(),
    })

    const parsed = schema.safeParse(req.body)
    if (!parsed.success) {
      return reply.code(400).send({ error: 'VALIDATION_ERROR', message: parsed.error.issues[0]?.message })
    }

    const { data, error } = await fastify.supabase
      .from('esi_config')
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

  // ── GET /payroll/statutory/esi/eligibility ────────────────────────────────────
  fastify.get('/eligibility', auth, async (req: any, reply) => {
    const querySchema = z.object({
      employee_id: z.string().uuid().optional(),
      active_only: z.enum(['true', 'false']).optional(),
    })

    const parsed = querySchema.safeParse(req.query)
    if (!parsed.success) {
      return reply.code(400).send({ error: 'VALIDATION_ERROR', message: parsed.error.issues[0]?.message })
    }

    let q = fastify.supabase
      .from('esi_eligibility_timeline')
      .select('*')
      .eq('tenant_id', req.tenantId)

    if (parsed.data.employee_id) q = q.eq('employee_id', parsed.data.employee_id)
    if (parsed.data.active_only === 'true') q = q.is('effective_to', null)

    const { data, error } = await q
    if (error) return reply.code(500).send({ error: 'QUERY_FAILED', message: error.message })
    return reply.send({ data: data ?? [] })
  })

  // ── POST /payroll/statutory/esi/eligibility ───────────────────────────────────
  fastify.post('/eligibility', { preHandler: [fastify.authenticate, requireHrAdmin] }, async (req: any, reply) => {
    const schema = z.object({
      employee_id: z.string().uuid(),
      is_esi_applicable: z.boolean(),
      gross_wages: z.number(),
      effective_from: z.string(),
      effective_to: z.string().optional(),
      reason: z.string().optional(),
    })

    const parsed = schema.safeParse(req.body)
    if (!parsed.success) {
      return reply.code(400).send({ error: 'VALIDATION_ERROR', message: parsed.error.issues[0]?.message })
    }

    const { data, error } = await fastify.supabase
      .from('esi_eligibility_timeline')
      .insert({ ...parsed.data, tenant_id: req.tenantId })
      .select()
      .single()

    if (error) return reply.code(500).send({ error: 'INSERT_FAILED', message: error.message })
    return reply.code(201).send({ data })
  })

  // ── GET /payroll/statutory/esi/contributions ──────────────────────────────────
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
      .from('esi_contributions')
      .select('*')
      .eq('tenant_id', req.tenantId)

    if (parsed.data.month) q = q.eq('contribution_month', parsed.data.month)
    if (parsed.data.employee_id) q = q.eq('employee_id', parsed.data.employee_id)

    const { data, error } = await q
    if (error) return reply.code(500).send({ error: 'QUERY_FAILED', message: error.message })
    return reply.send({ data: data ?? [] })
  })

  // ── POST /payroll/statutory/esi/contributions/compute ────────────────────────
  fastify.post('/contributions/compute', { preHandler: [fastify.authenticate, requireHrAdmin] }, async (req: any, reply) => {
    const schema = z.object({
      month: z.string().regex(/^\d{4}-\d{2}$/, 'month must be YYYY-MM'),
    })

    const parsed = schema.safeParse(req.body)
    if (!parsed.success) {
      return reply.code(400).send({ error: 'VALIDATION_ERROR', message: parsed.error.issues[0]?.message })
    }

    const { month } = parsed.data

    // Fetch ESI config
    const { data: configRow, error: configErr } = await fastify.supabase
      .from('esi_config')
      .select('*')
      .eq('tenant_id', req.tenantId)
      .maybeSingle()

    if (configErr) return reply.code(500).send({ error: 'QUERY_FAILED', message: 'Failed to fetch ESI config' })

    const config: ESIConfig = configRow ? {
      employeeContributionPct: configRow.employee_contribution_pct ?? 0.75,
      employerContributionPct: configRow.employer_contribution_pct ?? 3.25,
      wageCeiling: configRow.wage_ceiling ?? 21000,
    } : {
      employeeContributionPct: 0.75,
      employerContributionPct: 3.25,
      wageCeiling: 21000,
    }

    // Fetch active employees
    const { data: employees, error: empErr } = await fastify.supabase
      .from('employees')
      .select('id, employee_code')
      .eq('tenant_id', req.tenantId)
      .eq('status', 'active')

    if (empErr) return reply.code(500).send({ error: 'QUERY_FAILED', message: 'Failed to fetch employees' })

    const empList = (employees ?? []) as Array<{ id: string; employee_code: string }>

    // Fetch latest eligibility for each employee
    const { data: eligibilityRows } = await fastify.supabase
      .from('esi_eligibility_timeline')
      .select('*')
      .eq('tenant_id', req.tenantId)
      .is('effective_to', null)

    const eligibilityMap = new Map<string, any>()
    for (const row of (eligibilityRows ?? []) as any[]) {
      eligibilityMap.set(row.employee_id, row)
    }

    const contributions: any[] = []

    for (const emp of empList) {
      const eligibility = eligibilityMap.get(emp.id)
      const grossWages = eligibility?.gross_wages ?? 21000
      const isApplicable = eligibility?.is_esi_applicable ?? true

      if (!isApplicable) continue

      const result = computeESI(grossWages, config)

      if (result.isEligible) {
        contributions.push({
          tenant_id: req.tenantId,
          employee_id: emp.id,
          contribution_month: month,
          esi_wages: result.esiWages,
          is_eligible: result.isEligible,
          employee_contribution: result.employeeContribution,
          employer_contribution: result.employerContribution,
          total_contribution: result.totalContribution,
        })
      }
    }

    if (contributions.length > 0) {
      const { error: upsertErr } = await fastify.supabase
        .from('esi_contributions')
        .upsert(contributions, { onConflict: 'tenant_id,employee_id,contribution_month' })

      if (upsertErr) return reply.code(500).send({ error: 'UPSERT_FAILED', message: upsertErr.message })
    }

    return reply.send({ computed_count: contributions.length })
  })
}
