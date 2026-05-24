/**
 * Payroll Validation Routes
 * Validation rules, run engine, reconciliation, and result management.
 */

import type { FastifyInstance } from 'fastify'
import { z } from 'zod'

const RULE_CATEGORIES = [
  'employee_data',
  'compensation',
  'attendance',
  'statutory',
  'bank_details',
  'tax',
  'other',
] as const

const RULE_SEVERITIES = ['error', 'warning', 'info'] as const

const RECONCILIATION_TYPES = [
  'bank_vs_payroll',
  'statutory_vs_payroll',
  'headcount',
  'component_totals',
  'other',
] as const

export default async function validationRoutes(fastify: FastifyInstance) {
  const auth = { preHandler: [fastify.authenticate] }

  function requireHrAdmin(req: any, reply: any, done: () => void) {
    if (!['super_admin', 'hr_admin'].includes(req.userRole)) {
      reply.code(403).send({ error: 'FORBIDDEN', message: 'HR admin access required' })
      return
    }
    done()
  }

  // ── GET /payroll/validation/rules ─────────────────────────────────────────────
  fastify.get('/rules', auth, async (req: any, reply) => {
    const querySchema = z.object({
      category: z.string().optional(),
      is_active: z.enum(['true', 'false']).optional(),
    })

    const parsed = querySchema.safeParse(req.query)
    if (!parsed.success) {
      return reply.code(400).send({ error: 'VALIDATION_ERROR', message: parsed.error.issues[0]?.message })
    }

    let q = fastify.supabase
      .from('payroll_validation_rules')
      .select('*')
      .eq('tenant_id', req.tenantId)
      .order('rule_code', { ascending: true })

    if (parsed.data.category) q = q.eq('category', parsed.data.category)
    if (parsed.data.is_active !== undefined) q = q.eq('is_active', parsed.data.is_active === 'true')

    const { data, error } = await q
    if (error) return reply.code(500).send({ error: 'QUERY_FAILED', message: error.message })
    return reply.send({ data: data ?? [] })
  })

  // ── POST /payroll/validation/rules ────────────────────────────────────────────
  fastify.post('/rules', { preHandler: [fastify.authenticate, requireHrAdmin] }, async (req: any, reply) => {
    const schema = z.object({
      rule_code: z.string().min(1),
      rule_name: z.string().min(1),
      category: z.enum(RULE_CATEGORIES),
      severity: z.enum(RULE_SEVERITIES),
      description: z.string().optional(),
      threshold_config: z.record(z.unknown()).optional(),
      auto_resolve: z.boolean().optional(),
    })

    const parsed = schema.safeParse(req.body)
    if (!parsed.success) {
      return reply.code(400).send({ error: 'VALIDATION_ERROR', message: parsed.error.issues[0]?.message })
    }

    const { data, error } = await fastify.supabase
      .from('payroll_validation_rules')
      .insert({ ...parsed.data, tenant_id: req.tenantId, is_active: true })
      .select()
      .single()

    if (error) return reply.code(500).send({ error: 'INSERT_FAILED', message: error.message })
    return reply.code(201).send({ data })
  })

  // ── PUT /payroll/validation/rules/:id ─────────────────────────────────────────
  fastify.put('/rules/:id', { preHandler: [fastify.authenticate, requireHrAdmin] }, async (req: any, reply) => {
    const { id } = req.params as { id: string }

    const schema = z.object({
      rule_code: z.string().optional(),
      rule_name: z.string().optional(),
      category: z.enum(RULE_CATEGORIES).optional(),
      severity: z.enum(RULE_SEVERITIES).optional(),
      description: z.string().optional(),
      threshold_config: z.record(z.unknown()).optional(),
      auto_resolve: z.boolean().optional(),
      is_active: z.boolean().optional(),
    })

    const parsed = schema.safeParse(req.body)
    if (!parsed.success) {
      return reply.code(400).send({ error: 'VALIDATION_ERROR', message: parsed.error.issues[0]?.message })
    }

    const { data, error } = await fastify.supabase
      .from('payroll_validation_rules')
      .update({ ...parsed.data, updated_at: new Date().toISOString() })
      .eq('id', id)
      .eq('tenant_id', req.tenantId)
      .select()
      .single()

    if (error) return reply.code(500).send({ error: 'UPDATE_FAILED', message: error.message })
    if (!data) return reply.code(404).send({ error: 'NOT_FOUND', message: 'Rule not found' })

    return reply.send({ data })
  })

  // ── POST /payroll/validation/run ──────────────────────────────────────────────
  fastify.post('/run', { preHandler: [fastify.authenticate, requireHrAdmin] }, async (req: any, reply) => {
    const schema = z.object({
      validation_month: z.string().regex(/^\d{4}-\d{2}$/),
      payroll_run_id: z.string().uuid().optional(),
    })

    const parsed = schema.safeParse(req.body)
    if (!parsed.success) {
      return reply.code(400).send({ error: 'VALIDATION_ERROR', message: parsed.error.issues[0]?.message })
    }

    const { validation_month, payroll_run_id } = parsed.data
    const startTime = Date.now()

    // Create validation run record
    const { data: runRow, error: runErr } = await fastify.supabase
      .from('payroll_validation_runs')
      .insert({
        tenant_id: req.tenantId,
        validation_month,
        payroll_run_id: payroll_run_id ?? null,
        status: 'running',
        started_at: new Date().toISOString(),
        created_by: req.userId,
      })
      .select('id')
      .single()

    if (runErr || !runRow) {
      return reply.code(500).send({ error: 'INSERT_FAILED', message: 'Failed to create validation run' })
    }

    const validationRunId = (runRow as any).id as string

    // Fetch active rules and active employees in parallel
    const [
      { data: rules },
      { data: employees },
    ] = await Promise.all([
      fastify.supabase
        .from('payroll_validation_rules')
        .select('*')
        .eq('tenant_id', req.tenantId)
        .eq('is_active', true),
      fastify.supabase
        .from('employees')
        .select('id, first_name, last_name, employee_code')
        .eq('tenant_id', req.tenantId)
        .eq('status', 'active'),
    ])

    const employeeList = (employees ?? []) as Array<{ id: string; first_name: string; last_name: string; employee_code: string }>
    const ruleList = (rules ?? []) as any[]

    // Check MISSING_COMPENSATION: employees with no active employee_compensations
    const { data: compensations } = await fastify.supabase
      .from('employee_compensations')
      .select('employee_id')
      .eq('tenant_id', req.tenantId)
      .eq('is_active', true)

    const hasComp = new Set<string>((compensations ?? []).map((c: any) => c.employee_id))

    // Check MISSING_BANK: employees with no bank_statutory record
    const { data: bankRecords } = await fastify.supabase
      .from('employee_bank_statutory')
      .select('employee_id')
      .eq('tenant_id', req.tenantId)

    const hasBank = new Set<string>((bankRecords ?? []).map((b: any) => b.employee_id))

    // Find built-in rule codes
    const missingCompRule = ruleList.find(r => r.rule_code === 'MISSING_COMPENSATION')
    const missingBankRule = ruleList.find(r => r.rule_code === 'MISSING_BANK')
    const zeroNetRule = ruleList.find(r => r.rule_code === 'ZERO_NET_PAY')

    const validationResults: any[] = []

    for (const emp of employeeList) {
      // MISSING_COMPENSATION check
      if (missingCompRule && !hasComp.has(emp.id)) {
        validationResults.push({
          tenant_id: req.tenantId,
          validation_run_id: validationRunId,
          rule_id: missingCompRule.id,
          employee_id: emp.id,
          severity: missingCompRule.severity ?? 'error',
          message: `Employee ${emp.employee_code} has no active compensation`,
          auto_resolved: false,
        })
      }

      // MISSING_BANK check
      if (missingBankRule && !hasBank.has(emp.id)) {
        validationResults.push({
          tenant_id: req.tenantId,
          validation_run_id: validationRunId,
          rule_id: missingBankRule.id,
          employee_id: emp.id,
          severity: missingBankRule.severity ?? 'error',
          message: `Employee ${emp.employee_code} has no bank/statutory details`,
          auto_resolved: false,
        })
      }

      // ZERO_NET_PAY — placeholder warning for all employees
      if (zeroNetRule) {
        validationResults.push({
          tenant_id: req.tenantId,
          validation_run_id: validationRunId,
          rule_id: zeroNetRule.id,
          employee_id: emp.id,
          severity: zeroNetRule.severity ?? 'warning',
          message: `ZERO_NET_PAY check pending actual computation for ${emp.employee_code}`,
          auto_resolved: false,
        })
      }
    }

    // Insert validation results
    if (validationResults.length > 0) {
      await fastify.supabase
        .from('payroll_validation_results')
        .insert(validationResults)
    }

    const errorCount = validationResults.filter(r => r.severity === 'error').length
    const warningCount = validationResults.filter(r => r.severity === 'warning').length
    const isPayrollBlocked = errorCount > 0
    const durationMs = Date.now() - startTime

    // Update validation run
    await fastify.supabase
      .from('payroll_validation_runs')
      .update({
        status: 'completed',
        error_count: errorCount,
        warning_count: warningCount,
        is_payroll_blocked: isPayrollBlocked,
        completed_at: new Date().toISOString(),
        duration_ms: durationMs,
        updated_at: new Date().toISOString(),
      })
      .eq('id', validationRunId)

    return reply.send({
      validation_run_id: validationRunId,
      error_count: errorCount,
      warning_count: warningCount,
      is_payroll_blocked: isPayrollBlocked,
    })
  })

  // ── GET /payroll/validation/runs ──────────────────────────────────────────────
  fastify.get('/runs', auth, async (req: any, reply) => {
    const querySchema = z.object({
      validation_month: z.string().optional(),
    })

    const parsed = querySchema.safeParse(req.query)
    if (!parsed.success) {
      return reply.code(400).send({ error: 'VALIDATION_ERROR', message: parsed.error.issues[0]?.message })
    }

    let q = fastify.supabase
      .from('payroll_validation_runs')
      .select('*')
      .eq('tenant_id', req.tenantId)
      .order('started_at', { ascending: false })

    if (parsed.data.validation_month) q = q.eq('validation_month', parsed.data.validation_month)

    const { data, error } = await q
    if (error) return reply.code(500).send({ error: 'QUERY_FAILED', message: error.message })
    return reply.send({ data: data ?? [] })
  })

  // ── GET /payroll/validation/runs/:id ──────────────────────────────────────────
  fastify.get('/runs/:id', auth, async (req: any, reply) => {
    const { id } = req.params as { id: string }

    const [{ data: runData, error: runErr }, { data: resultsData, error: resultsErr }] = await Promise.all([
      fastify.supabase
        .from('payroll_validation_runs')
        .select('*')
        .eq('id', id)
        .eq('tenant_id', req.tenantId)
        .single(),
      fastify.supabase
        .from('payroll_validation_results')
        .select(`
          *,
          employees(id, first_name, last_name, employee_code),
          payroll_validation_rules(id, rule_code, rule_name, category, severity)
        `)
        .eq('validation_run_id', id)
        .eq('tenant_id', req.tenantId),
    ])

    if (runErr || !runData) return reply.code(404).send({ error: 'NOT_FOUND', message: 'Validation run not found' })
    if (resultsErr) req.log.warn({ err: resultsErr }, 'Failed to fetch validation results')

    return reply.send({ data: { ...runData, results: resultsData ?? [] } })
  })

  // ── POST /payroll/validation/runs/:id/results/:resultId/resolve ───────────────
  fastify.post('/runs/:id/results/:resultId/resolve', { preHandler: [fastify.authenticate, requireHrAdmin] }, async (req: any, reply) => {
    const { id, resultId } = req.params as { id: string; resultId: string }

    const schema = z.object({
      resolution_notes: z.string().min(1),
    })

    const parsed = schema.safeParse(req.body)
    if (!parsed.success) {
      return reply.code(400).send({ error: 'VALIDATION_ERROR', message: parsed.error.issues[0]?.message })
    }

    const now = new Date().toISOString()

    const { error: updateErr } = await fastify.supabase
      .from('payroll_validation_results')
      .update({
        auto_resolved: true,
        resolution_notes: parsed.data.resolution_notes,
        resolved_by: req.userId,
        resolved_at: now,
        updated_at: now,
      })
      .eq('id', resultId)
      .eq('validation_run_id', id)
      .eq('tenant_id', req.tenantId)

    if (updateErr) return reply.code(500).send({ error: 'UPDATE_FAILED', message: updateErr.message })

    // Check if all errors are now resolved for this run
    const { count: unresolvedErrors } = await fastify.supabase
      .from('payroll_validation_results')
      .select('id', { count: 'exact', head: true })
      .eq('validation_run_id', id)
      .eq('tenant_id', req.tenantId)
      .eq('severity', 'error')
      .eq('auto_resolved', false)

    if ((unresolvedErrors ?? 0) === 0) {
      await fastify.supabase
        .from('payroll_validation_runs')
        .update({ is_payroll_blocked: false, updated_at: now })
        .eq('id', id)
        .eq('tenant_id', req.tenantId)
    }

    return reply.send({ message: 'Result resolved', is_payroll_blocked: (unresolvedErrors ?? 0) > 0 })
  })

  // ── POST /payroll/validation/reconcile ────────────────────────────────────────
  fastify.post('/reconcile', { preHandler: [fastify.authenticate, requireHrAdmin] }, async (req: any, reply) => {
    const schema = z.object({
      reconciliation_month: z.string().regex(/^\d{4}-\d{2}$/),
      reconciliation_type: z.enum(RECONCILIATION_TYPES),
      payroll_run_id: z.string().uuid().optional(),
    })

    const parsed = schema.safeParse(req.body)
    if (!parsed.success) {
      return reply.code(400).send({ error: 'VALIDATION_ERROR', message: parsed.error.issues[0]?.message })
    }

    const startTime = Date.now()
    const now = new Date().toISOString()

    // Insert reconciliation run
    const { data: reconRun, error: reconErr } = await fastify.supabase
      .from('payroll_reconciliation_runs')
      .insert({
        ...parsed.data,
        tenant_id: req.tenantId,
        status: 'running',
        started_at: now,
        created_by: req.userId,
      })
      .select('id')
      .single()

    if (reconErr || !reconRun) {
      return reply.code(500).send({ error: 'INSERT_FAILED', message: 'Failed to create reconciliation run' })
    }

    const reconciliationRunId = (reconRun as any).id as string

    // Simple reconciliation: count employees
    const { count: employeeCount } = await fastify.supabase
      .from('employees')
      .select('id', { count: 'exact', head: true })
      .eq('tenant_id', req.tenantId)
      .eq('status', 'active')

    const durationMs = Date.now() - startTime

    await fastify.supabase
      .from('payroll_reconciliation_runs')
      .update({
        status: 'completed',
        employee_count: employeeCount ?? 0,
        completed_at: new Date().toISOString(),
        duration_ms: durationMs,
        updated_at: new Date().toISOString(),
      })
      .eq('id', reconciliationRunId)

    return reply.send({ reconciliation_run_id: reconciliationRunId })
  })

  // ── GET /payroll/validation/reconciliation-runs ───────────────────────────────
  fastify.get('/reconciliation-runs', auth, async (req: any, reply) => {
    const querySchema = z.object({
      reconciliation_month: z.string().optional(),
    })

    const parsed = querySchema.safeParse(req.query)
    if (!parsed.success) {
      return reply.code(400).send({ error: 'VALIDATION_ERROR', message: parsed.error.issues[0]?.message })
    }

    let q = fastify.supabase
      .from('payroll_reconciliation_runs')
      .select('*')
      .eq('tenant_id', req.tenantId)
      .order('started_at', { ascending: false })

    if (parsed.data.reconciliation_month) q = q.eq('reconciliation_month', parsed.data.reconciliation_month)

    const { data, error } = await q
    if (error) return reply.code(500).send({ error: 'QUERY_FAILED', message: error.message })
    return reply.send({ data: data ?? [] })
  })
}
