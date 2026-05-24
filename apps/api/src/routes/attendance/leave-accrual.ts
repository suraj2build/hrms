/**
 * Leave Accrual Routes
 *
 * GET    /leave/accrual/rules               — list accrual rules (admin)
 * POST   /leave/accrual/rules               — create rule (admin)
 * PUT    /leave/accrual/rules/:id           — update rule (admin)
 * DELETE /leave/accrual/rules/:id           — deactivate rule (admin)
 * POST   /leave/accrual/run                 — trigger manual accrual (admin)
 * POST   /leave/accrual/carry-forward       — trigger carry-forward processing (admin)
 * GET    /leave/accrual/runs                — list accrual run history (admin)
 * GET    /leave/accrual/ledger/:employeeId  — ledger for one employee
 *
 * Encashment:
 * POST   /leave/encashment/request           — employee submits encashment request
 * GET    /leave/encashment/my                — employee views own encashment requests
 * GET    /leave/encashment/pending           — admin views pending encashment requests
 * POST   /leave/encashment/:id/approve       — admin approves
 * POST   /leave/encashment/:id/reject        — admin rejects
 * POST   /leave/encashment/:id/mark-paid     — admin marks as paid (payroll)
 */
import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { requireRole, HR_ADMIN_ROLES } from '../../lib/rbac.js'
import {
  runMonthlyAccrual,
  processCarryForward,
  processEncashment,
} from '../../lib/accrual-engine.js'

const dateRe = /^\d{4}-\d{2}-\d{2}$/

const ruleSchema = z.object({
  leave_type_id:               z.string().uuid(),
  accrual_frequency:           z.enum(['monthly', 'quarterly', 'annually', 'on_joining']).default('monthly'),
  days_per_period:             z.number().min(0.1).max(100),
  prorate_on_joining:          z.boolean().default(true),
  carry_forward_max:           z.number().min(0).max(365).default(0),
  carry_forward_expiry_months: z.number().int().min(0).max(12).default(3),
  encashable:                  z.boolean().default(false),
  max_encashable_per_year:     z.number().min(0).max(365).default(0),
  effective_from:              z.string().regex(dateRe).default(() => new Date().toISOString().slice(0, 10)),
  effective_to:                z.string().regex(dateRe).nullable().optional(),
  is_active:                   z.boolean().default(true),
})

export default async function leaveAccrualRoutes(fastify: FastifyInstance) {
  const auth        = { preHandler: [fastify.authenticate] }
  const hrAdminAuth = { preHandler: [fastify.authenticate, requireRole(...HR_ADMIN_ROLES)] }

  // ── GET /leave/accrual/rules ──────────────────────────────────────────────
  fastify.get('/leave/accrual/rules', hrAdminAuth, async (req: any, reply) => {
    const { data, error } = await fastify.supabase
      .from('leave_accrual_rules')
      .select('*, leave_types(id, name, is_paid)')
      .eq('tenant_id', req.tenantId)
      .order('effective_from', { ascending: false })

    if (error) return reply.code(500).send({ error: 'QUERY_FAILED', message: 'Failed to fetch accrual rules' })
    return reply.send({ data: data ?? [] })
  })

  // ── POST /leave/accrual/rules ─────────────────────────────────────────────
  fastify.post('/leave/accrual/rules', hrAdminAuth, async (req: any, reply) => {
    const parsed = ruleSchema.safeParse(req.body)
    if (!parsed.success) return reply.code(400).send({ error: 'VALIDATION_ERROR', message: parsed.error.issues[0]?.message })

    const { data, error } = await fastify.supabase
      .from('leave_accrual_rules')
      .insert({ tenant_id: req.tenantId, ...parsed.data })
      .select('*, leave_types(id, name)')
      .single()

    if (error) {
      if (error.code === '23505') return reply.code(409).send({ error: 'DUPLICATE', message: 'An accrual rule already exists for this leave type on that effective date' })
      return reply.code(500).send({ error: 'INSERT_FAILED', message: 'Failed to create accrual rule' })
    }

    return reply.code(201).send({ data })
  })

  // ── PUT /leave/accrual/rules/:id ──────────────────────────────────────────
  fastify.put('/leave/accrual/rules/:id', hrAdminAuth, async (req: any, reply) => {
    const parsed = ruleSchema.partial().safeParse(req.body)
    if (!parsed.success) return reply.code(400).send({ error: 'VALIDATION_ERROR', message: parsed.error.issues[0]?.message })

    const { data, error } = await fastify.supabase
      .from('leave_accrual_rules')
      .update(parsed.data)
      .eq('id', req.params.id)
      .eq('tenant_id', req.tenantId)
      .select('*')
      .single()

    if (error) return reply.code(500).send({ error: 'UPDATE_FAILED', message: 'Failed to update rule' })
    if (!data) return reply.code(404).send({ error: 'NOT_FOUND', message: 'Accrual rule not found' })
    return reply.send({ data })
  })

  // ── DELETE /leave/accrual/rules/:id ──────────────────────────────────────
  fastify.delete('/leave/accrual/rules/:id', hrAdminAuth, async (req: any, reply) => {
    // Soft-deactivate to preserve history
    const { error } = await fastify.supabase
      .from('leave_accrual_rules')
      .update({ is_active: false })
      .eq('id', req.params.id)
      .eq('tenant_id', req.tenantId)

    if (error) return reply.code(500).send({ error: 'UPDATE_FAILED', message: 'Failed to deactivate rule' })
    return reply.code(204).send()
  })

  // ── POST /leave/accrual/run ───────────────────────────────────────────────
  // Manually trigger monthly accrual for a specific YYYY-MM period.
  fastify.post('/leave/accrual/run', hrAdminAuth, async (req: any, reply) => {
    const schema = z.object({
      period: z.string().regex(/^\d{4}-\d{2}$/, 'period must be YYYY-MM'),
    })
    const parsed = schema.safeParse(req.body)
    if (!parsed.success) return reply.code(400).send({ error: 'VALIDATION_ERROR', message: parsed.error.issues[0]?.message })

    const [year, month] = parsed.data.period.split('-').map(Number)
    const result = await runMonthlyAccrual(fastify.supabase, req.tenantId, year, month)
    return reply.send({ data: result, period: parsed.data.period })
  })

  // ── POST /leave/accrual/carry-forward ─────────────────────────────────────
  fastify.post('/leave/accrual/carry-forward', hrAdminAuth, async (req: any, reply) => {
    const schema = z.object({ from_year: z.number().int().min(2020).max(2099) })
    const parsed = schema.safeParse(req.body)
    if (!parsed.success) return reply.code(400).send({ error: 'VALIDATION_ERROR', message: parsed.error.issues[0]?.message })

    const result = await processCarryForward(fastify.supabase, req.tenantId, parsed.data.from_year)
    return reply.send({ data: result })
  })

  // ── GET /leave/accrual/runs ───────────────────────────────────────────────
  fastify.get('/leave/accrual/runs', hrAdminAuth, async (req: any, reply) => {
    const { limit = 50, offset = 0 } = req.query as { limit?: number; offset?: number }
    const { data, error, count } = await fastify.supabase
      .from('leave_accrual_runs')
      .select('*, leave_types(id, name)', { count: 'exact' })
      .eq('tenant_id', req.tenantId)
      .order('ran_at', { ascending: false })
      .range(Number(offset), Number(offset) + Number(limit) - 1)

    if (error) return reply.code(500).send({ error: 'QUERY_FAILED', message: 'Failed to fetch runs' })
    return reply.send({ data: data ?? [], total: count ?? 0 })
  })

  // ── GET /leave/accrual/ledger/:employeeId ─────────────────────────────────
  fastify.get('/leave/accrual/ledger/:employeeId', auth, async (req: any, reply) => {
    const { employeeId } = req.params as { employeeId: string }
    const { year, leave_type_id, limit = 100, offset = 0 } = req.query as {
      year?: string; leave_type_id?: string; limit?: number; offset?: number
    }

    // Non-admins can only see their own ledger
    if (!HR_ADMIN_ROLES.includes(req.userRole)) {
      const { data: prof } = await fastify.supabase
        .from('profiles')
        .select('employee_id')
        .eq('id', req.userId)
        .single()
      if (prof?.employee_id !== employeeId) {
        return reply.code(403).send({ error: 'FORBIDDEN', message: 'Access denied' })
      }
    }

    let q = fastify.supabase
      .from('leave_balance_ledger')
      .select('*, leave_types(id, name)', { count: 'exact' })
      .eq('tenant_id', req.tenantId)
      .eq('employee_id', employeeId)
      .order('created_at', { ascending: false })
      .range(Number(offset), Number(offset) + Number(limit) - 1)

    if (year)          q = q.eq('year', Number(year))
    if (leave_type_id) q = q.eq('leave_type_id', leave_type_id)

    const { data, error, count } = await q
    if (error) return reply.code(500).send({ error: 'QUERY_FAILED', message: 'Failed to fetch ledger' })
    return reply.send({ data: data ?? [], total: count ?? 0 })
  })

  // ════════════════════════════════════════════════════════════════════════════
  // Encashment Routes
  // ════════════════════════════════════════════════════════════════════════════

  // ── POST /leave/encashment/request ────────────────────────────────────────
  fastify.post('/leave/encashment/request', auth, async (req: any, reply) => {
    const schema = z.object({
      leave_type_id: z.string().uuid(),
      days:          z.number().min(0.5),
      year:          z.number().int().optional(),
      notes:         z.string().max(500).optional(),
    })
    const parsed = schema.safeParse(req.body)
    if (!parsed.success) return reply.code(400).send({ error: 'VALIDATION_ERROR', message: parsed.error.issues[0]?.message })

    // Resolve employee_id
    const { data: prof } = await fastify.supabase
      .from('profiles')
      .select('employee_id')
      .eq('id', req.userId)
      .single()

    if (!prof?.employee_id) {
      return reply.code(400).send({ error: 'NO_EMPLOYEE_LINK', message: 'Profile not linked to employee record' })
    }

    const year = parsed.data.year ?? new Date().getFullYear()

    // Verify encashment is allowed for this leave type
    const { data: rule } = await fastify.supabase
      .from('leave_accrual_rules')
      .select('encashable, max_encashable_per_year')
      .eq('tenant_id', req.tenantId)
      .eq('leave_type_id', parsed.data.leave_type_id)
      .eq('is_active', true)
      .maybeSingle()

    if (!rule?.encashable) {
      return reply.code(422).send({ error: 'NOT_ENCASHABLE', message: 'This leave type does not allow encashment' })
    }

    // Check annual encashment limit
    if (rule.max_encashable_per_year > 0) {
      const { data: existingEnc } = await fastify.supabase
        .from('leave_encashment_requests')
        .select('days')
        .eq('tenant_id', req.tenantId)
        .eq('employee_id', prof.employee_id)
        .eq('leave_type_id', parsed.data.leave_type_id)
        .eq('year', year)
        .not('status', 'eq', 'rejected')

      const alreadyEncashed = (existingEnc ?? []).reduce((sum: number, r: { days: number }) => sum + Number(r.days), 0)
      if (alreadyEncashed + parsed.data.days > rule.max_encashable_per_year) {
        return reply.code(422).send({
          error:   'ENCASHMENT_LIMIT_EXCEEDED',
          message: `Annual encashment limit is ${rule.max_encashable_per_year} days. Already requested: ${alreadyEncashed}`,
        })
      }
    }

    const { data, error } = await fastify.supabase
      .from('leave_encashment_requests')
      .insert({
        tenant_id:     req.tenantId,
        employee_id:   prof.employee_id,
        leave_type_id: parsed.data.leave_type_id,
        year,
        days:          parsed.data.days,
        notes:         parsed.data.notes ?? null,
      })
      .select('id, days, status, created_at')
      .single()

    if (error) return reply.code(500).send({ error: 'INSERT_FAILED', message: 'Failed to submit encashment request' })
    return reply.code(201).send({ data })
  })

  // ── GET /leave/encashment/my ──────────────────────────────────────────────
  fastify.get('/leave/encashment/my', auth, async (req: any, reply) => {
    const { data: prof } = await fastify.supabase
      .from('profiles').select('employee_id').eq('id', req.userId).single()
    if (!prof?.employee_id) return reply.send({ data: [] })

    const { data, error } = await fastify.supabase
      .from('leave_encashment_requests')
      .select('*, leave_types(id, name)')
      .eq('tenant_id', req.tenantId)
      .eq('employee_id', prof.employee_id)
      .order('created_at', { ascending: false })

    if (error) return reply.code(500).send({ error: 'QUERY_FAILED', message: 'Failed to fetch encashment requests' })
    return reply.send({ data: data ?? [] })
  })

  // ── GET /leave/encashment/pending ─────────────────────────────────────────
  fastify.get('/leave/encashment/pending', hrAdminAuth, async (req: any, reply) => {
    const { data, error } = await fastify.supabase
      .from('leave_encashment_requests')
      .select(`
        *, leave_types(id, name),
        employees!inner(id, first_name, last_name, employee_code)
      `)
      .eq('tenant_id', req.tenantId)
      .eq('status', 'pending')
      .order('created_at', { ascending: false })

    if (error) return reply.code(500).send({ error: 'QUERY_FAILED', message: 'Failed to fetch encashment requests' })

    const rows = (data ?? []).map((r: any) => ({
      ...r,
      employee_name: r.employees ? `${r.employees.first_name} ${r.employees.last_name}` : null,
      employee_code: r.employees?.employee_code ?? null,
      employees:     undefined,
    }))

    return reply.send({ data: rows })
  })

  // ── POST /leave/encashment/:id/approve ────────────────────────────────────
  fastify.post('/leave/encashment/:id/approve', hrAdminAuth, async (req: any, reply) => {
    const result = await processEncashment(fastify.supabase, req.tenantId, req.params.id, req.userId)
    if (!result.ok) return reply.code(422).send({ error: 'ENCASHMENT_FAILED', message: result.message })
    return reply.send({ message: result.message })
  })

  // ── POST /leave/encashment/:id/reject ─────────────────────────────────────
  fastify.post('/leave/encashment/:id/reject', hrAdminAuth, async (req: any, reply) => {
    const schema = z.object({ reason: z.string().max(500).optional() })
    const parsed = schema.safeParse(req.body)
    if (!parsed.success) return reply.code(400).send({ error: 'VALIDATION_ERROR', message: parsed.error.issues[0]?.message })

    const { error } = await fastify.supabase
      .from('leave_encashment_requests')
      .update({ status: 'rejected', approved_by: req.userId, approved_at: new Date().toISOString(), notes: parsed.data.reason ?? null })
      .eq('id', req.params.id)
      .eq('tenant_id', req.tenantId)
      .eq('status', 'pending')

    if (error) return reply.code(500).send({ error: 'UPDATE_FAILED', message: 'Failed to reject encashment' })
    return reply.send({ message: 'Encashment request rejected' })
  })

  // ── POST /leave/encashment/:id/mark-paid ──────────────────────────────────
  fastify.post('/leave/encashment/:id/mark-paid', hrAdminAuth, async (req: any, reply) => {
    const { error } = await fastify.supabase
      .from('leave_encashment_requests')
      .update({ status: 'paid', paid_at: new Date().toISOString() })
      .eq('id', req.params.id)
      .eq('tenant_id', req.tenantId)
      .eq('status', 'approved')

    if (error) return reply.code(500).send({ error: 'UPDATE_FAILED', message: 'Failed to mark as paid' })
    return reply.send({ message: 'Marked as paid' })
  })
}
