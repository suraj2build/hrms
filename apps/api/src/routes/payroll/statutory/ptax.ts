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

    // Fetch active employees
    const { data: employees, error: empErr } = await fastify.supabase
      .from('employees')
      .select('id, employee_code')
      .eq('tenant_id', req.tenantId)
      .eq('status', 'active')

    if (empErr) return reply.code(500).send({ error: 'QUERY_FAILED', message: 'Failed to fetch employees' })

    const empList = (employees ?? []) as Array<{ id: string; employee_code: string }>

    // Fetch state configs — get most recent effective_from <= month for each employee
    const { data: stateConfigs } = await fastify.supabase
      .from('ptax_state_config')
      .select('*')
      .eq('tenant_id', req.tenantId)
      .lte('effective_from', `${month}-31`)
      .order('effective_from', { ascending: false })

    const stateConfigMap = new Map<string, string>()
    for (const cfg of (stateConfigs ?? []) as any[]) {
      if (!stateConfigMap.has(cfg.employee_id)) {
        stateConfigMap.set(cfg.employee_id, cfg.state_code)
      }
    }

    // Fetch all ptax slabs for this tenant + financial year
    const { data: allSlabs } = await fastify.supabase
      .from('ptax_slabs')
      .select('*')
      .eq('tenant_id', req.tenantId)
      .eq('financial_year', financial_year)

    const slabsByState = new Map<string, PTaxSlab[]>()
    for (const slab of (allSlabs ?? []) as any[]) {
      const existing = slabsByState.get(slab.state_code) ?? []
      existing.push({
        monthlyIncomeFrom: slab.monthly_income_from,
        monthlyIncomeTo: slab.monthly_income_to ?? undefined,
        monthlyPtax: slab.monthly_ptax,
      })
      slabsByState.set(slab.state_code, existing)
    }

    const contributions: any[] = []

    for (const emp of empList) {
      const stateCode = stateConfigMap.get(emp.id)
      if (!stateCode) continue

      const slabs = slabsByState.get(stateCode) ?? []
      const grossSalary = 30000 // placeholder
      const ptaxAmount = computePTax(grossSalary, slabs)

      contributions.push({
        tenant_id: req.tenantId,
        employee_id: emp.id,
        contribution_month: month,
        state_code: stateCode,
        financial_year,
        gross_salary: grossSalary,
        ptax_amount: ptaxAmount,
      })
    }

    if (contributions.length > 0) {
      const { error: upsertErr } = await fastify.supabase
        .from('ptax_contributions')
        .upsert(contributions, { onConflict: 'tenant_id,employee_id,contribution_month' })

      if (upsertErr) return reply.code(500).send({ error: 'UPSERT_FAILED', message: upsertErr.message })
    }

    return reply.send({ computed_count: contributions.length })
  })
}
