/**
 * Payroll Explainability Ledger Routes
 * Tracks every financial event with full audit trail.
 */

import type { FastifyInstance } from 'fastify'
import { z } from 'zod'

const EVENT_TYPES = [
  'component_change',
  'salary_revision',
  'arrear_credit',
  'advance_deduction',
  'loan_emi',
  'lop_deduction',
  'reimbursement',
  'bonus',
  'incentive',
  'tax_deduction',
  'epf_deduction',
  'esi_deduction',
  'ptax_deduction',
  'other_earning',
  'other_deduction',
] as const

const SOURCE_MODULES = [
  'payroll_run',
  'compensation',
  'attendance',
  'advance',
  'loan',
  'reimbursement',
  'variable_pay',
  'arrear',
  'statutory',
  'manual',
] as const

export default async function payrollLedgerRoutes(fastify: FastifyInstance) {
  const auth = { preHandler: [fastify.authenticate] }

  function requireHrAdmin(req: any, reply: any, done: () => void) {
    if (!['super_admin', 'hr_admin'].includes(req.userRole)) {
      reply.code(403).send({ error: 'FORBIDDEN', message: 'HR admin access required' })
      return
    }
    done()
  }

  /** Admins may view any employee; everyone else only their own records. */
  async function canViewEmployee(req: any, employeeId: string): Promise<boolean> {
    if (['super_admin', 'hr_admin'].includes(req.userRole)) return true
    const { data: profile } = await fastify.supabase
      .from('profiles')
      .select('employee_id')
      .eq('id', req.userId)
      .eq('tenant_id', req.tenantId)
      .single()
    return profile?.employee_id === employeeId
  }

  // ── GET /payroll/ledger/employee/:employeeId ──────────────────────────────────
  //    HR admins: any employee in tenant. Others: only their own ledger.
  fastify.get('/employee/:employeeId', auth, async (req: any, reply) => {
    const { employeeId } = req.params as { employeeId: string }
    if (!await canViewEmployee(req, employeeId)) {
      return reply.code(403).send({ error: 'FORBIDDEN', message: 'You can only view your own payroll ledger' })
    }

    const querySchema = z.object({
      from: z.string().optional(),
      to: z.string().optional(),
      event_type: z.string().optional(),
      source_module: z.string().optional(),
      limit: z.coerce.number().int().min(1).max(500).default(100),
    })

    const parsed = querySchema.safeParse(req.query)
    if (!parsed.success) {
      return reply.code(400).send({ error: 'VALIDATION_ERROR', message: parsed.error.issues[0]?.message })
    }

    // Verify employee belongs to tenant
    const { data: emp } = await fastify.supabase
      .from('employees')
      .select('id')
      .eq('id', employeeId)
      .eq('tenant_id', req.tenantId)
      .maybeSingle()

    if (!emp) return reply.code(404).send({ error: 'NOT_FOUND', message: 'Employee not found' })

    let q = fastify.supabase
      .from('payroll_explainability_ledger')
      .select('*')
      .eq('employee_id', employeeId)
      .eq('tenant_id', req.tenantId)
      .order('ledger_date', { ascending: false })
      .limit(parsed.data.limit)

    if (parsed.data.from) q = q.gte('ledger_date', parsed.data.from)
    if (parsed.data.to) q = q.lte('ledger_date', parsed.data.to)
    if (parsed.data.event_type) q = q.eq('event_type', parsed.data.event_type)
    if (parsed.data.source_module) q = q.eq('source_module', parsed.data.source_module)

    const { data, error } = await q
    if (error) return reply.code(500).send({ error: 'QUERY_FAILED', message: error.message })
    return reply.send({ data: data ?? [] })
  })

  // ── GET /payroll/ledger/run/:runId ────────────────────────────────────────────
  //    Run-wide ledger spans every employee in the run — HR admin only.
  fastify.get('/run/:runId', { preHandler: [fastify.authenticate, requireHrAdmin] }, async (req: any, reply) => {
    const { runId } = req.params as { runId: string }

    const { data, error } = await fastify.supabase
      .from('payroll_explainability_ledger')
      .select('*')
      .eq('payroll_run_id', runId)
      .eq('tenant_id', req.tenantId)
      .order('ledger_date', { ascending: false })

    if (error) return reply.code(500).send({ error: 'QUERY_FAILED', message: error.message })
    return reply.send({ data: data ?? [] })
  })

  // ── POST /payroll/ledger/entry ────────────────────────────────────────────────
  fastify.post('/entry', { preHandler: [fastify.authenticate, requireHrAdmin] }, async (req: any, reply) => {
    const schema = z.object({
      employee_id: z.string().uuid(),
      ledger_date: z.string(),
      event_type: z.enum(EVENT_TYPES),
      source_module: z.enum(SOURCE_MODULES),
      component_code: z.string().optional(),
      component_name: z.string().optional(),
      before_value: z.number().optional(),
      after_value: z.number(),
      reason: z.string().min(1),
      correlation_id: z.string().optional(),
      metadata: z.record(z.unknown()).optional(),
    })

    const parsed = schema.safeParse(req.body)
    if (!parsed.success) {
      return reply.code(400).send({ error: 'VALIDATION_ERROR', message: parsed.error.issues[0]?.message })
    }

    const delta = (parsed.data.after_value ?? 0) - (parsed.data.before_value ?? 0)

    const { data, error } = await fastify.supabase
      .from('payroll_explainability_ledger')
      .insert({
        ...parsed.data,
        delta,
        tenant_id: req.tenantId,
        created_by: req.userId,
      })
      .select()
      .single()

    if (error) return reply.code(500).send({ error: 'INSERT_FAILED', message: error.message })
    return reply.code(201).send({ data })
  })

  // ── GET /payroll/ledger/summary/:employeeId ───────────────────────────────────
  //    HR admins: any employee in tenant. Others: only their own summary.
  fastify.get('/summary/:employeeId', auth, async (req: any, reply) => {
    const { employeeId } = req.params as { employeeId: string }
    if (!await canViewEmployee(req, employeeId)) {
      return reply.code(403).send({ error: 'FORBIDDEN', message: 'You can only view your own payroll ledger' })
    }

    const querySchema = z.object({
      month: z.string().regex(/^\d{4}-\d{2}$/, 'month must be YYYY-MM'),
    })

    const parsed = querySchema.safeParse(req.query)
    if (!parsed.success) {
      return reply.code(400).send({ error: 'VALIDATION_ERROR', message: parsed.error.issues[0]?.message })
    }

    const { month } = parsed.data
    const [year, mon] = month.split('-').map(Number)
    const firstOfMonth = `${month}-01`
    const lastOfMonth = new Date(year, mon, 0).toISOString().slice(0, 10)

    const { data, error } = await fastify.supabase
      .from('payroll_explainability_ledger')
      .select('event_type, delta:impact_amount')
      .eq('employee_id', employeeId)
      .eq('tenant_id', req.tenantId)
      .gte('ledger_date', firstOfMonth)
      .lte('ledger_date', lastOfMonth)

    if (error) return reply.code(500).send({ error: 'QUERY_FAILED', message: error.message })

    // Group by event_type in memory
    const summaryMap = new Map<string, { total_delta: number; entry_count: number }>()
    for (const row of (data ?? []) as Array<{ event_type: string; delta: number }>) {
      const existing = summaryMap.get(row.event_type) ?? { total_delta: 0, entry_count: 0 }
      existing.total_delta += row.delta ?? 0
      existing.entry_count += 1
      summaryMap.set(row.event_type, existing)
    }

    const summary = Array.from(summaryMap.entries()).map(([event_type, s]) => ({
      event_type,
      total_delta: Math.round(s.total_delta * 100) / 100,
      entry_count: s.entry_count,
    }))

    return reply.send({ data: summary, month })
  })
}
