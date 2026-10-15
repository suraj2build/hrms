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
 * Encashment (G12 — standalone leave encashment, completed end to end;
 * see migrations 446/447 and lib/accrual-engine.ts's computeEncashmentPayout):
 * POST   /leave/encashment/request              — employee submits encashment request
 * GET    /leave/encashment/my                   — employee views own encashment requests
 * GET    /leave/encashment/pending              — admin views pending encashment requests
 * GET    /leave/encashment/all?status=           — admin views requests by any status
 * POST   /leave/encashment/:id/approve          — admin approves (computes rate/gross/TDS/net)
 * POST   /leave/encashment/:id/reject           — admin rejects
 * POST   /leave/encashment/:id/assign-payroll-run — admin reserves a draft payroll run for
 *                                                    this request (status stays 'approved' —
 *                                                    NOT yet paid; every (re)generation of
 *                                                    that run folds the payout into the
 *                                                    employee's payslip fresh, so it survives
 *                                                    any number of re-runs; finalizing that
 *                                                    run is what actually flips this to
 *                                                    'paid' — see runs.ts's finalize route)
 * POST   /leave/encashment/:id/reverse          — admin reverses an approved/paid request:
 *                                                   credits the leave balance back; refuses
 *                                                   if the linked run is already finalized
 *                                                   (roll it back to draft first)
 */
import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { requireRole, HR_ADMIN_ROLES } from '../../lib/rbac.js'
import {
  runMonthlyAccrual,
  processCarryForward,
  processEncashment,
} from '../../lib/accrual-engine.js'
import { checkIdempotency, storeIdempotency } from '../../lib/idempotency.js'
import { notFound, serverError, ErrorCode } from '../../lib/api-errors.js'

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

  // ── GET /leave/encashment/encashable-types ────────────────────────────────
  // G12: an employee submitting a request needs to know which of their leave
  // types allow encashment, and the per-year cap — GET /leave/accrual/rules
  // is HR-admin only and returns every rule field, so this is a minimal,
  // employee-safe projection of just the two fields the request form needs.
  // Registered before the hrAdminAuth rules route so both coexist cleanly.
  fastify.get('/leave/encashment/encashable-types', auth, async (req: any, reply) => {
    const { data, error } = await fastify.supabase
      .from('leave_accrual_rules')
      .select('leave_type_id, max_encashable_per_year, leave_types(id, name)')
      .eq('tenant_id', req.tenantId)
      .eq('is_active', true)
      .eq('encashable', true)

    if (error) return serverError(req, reply, error, ErrorCode.QUERY_FAILED, 'Failed to fetch encashable leave types')
    return reply.send({ data: data ?? [] })
  })

  // ── GET /leave/accrual/rules ──────────────────────────────────────────────
  fastify.get('/leave/accrual/rules', hrAdminAuth, async (req: any, reply) => {
    const { data, error } = await fastify.supabase
      .from('leave_accrual_rules')
      .select('*, leave_types(id, name, is_paid)')
      .eq('tenant_id', req.tenantId)
      .order('effective_from', { ascending: false })

    if (error) return serverError(req, reply, error, ErrorCode.QUERY_FAILED, 'Failed to fetch accrual rules')
    return reply.send({ data: data ?? [] })
  })

  // ── POST /leave/accrual/rules ─────────────────────────────────────────────
  fastify.post('/leave/accrual/rules', hrAdminAuth, async (req: any, reply) => {
    const parsed = ruleSchema.safeParse(req.body)
    if (!parsed.success) return reply.code(400).send({ error: 'VALIDATION_ERROR', message: parsed.error.issues[0]?.message })

    // leave_type_id is caller-supplied and the FK only checks existence, not
    // tenant — an unverified value would let this rule (and the accrual
    // engine that reads it) reference another tenant's leave_types row.
    const { data: leaveType } = await fastify.supabase
      .from('leave_types')
      .select('id')
      .eq('id', parsed.data.leave_type_id)
      .eq('tenant_id', req.tenantId)
      .maybeSingle()
    if (!leaveType) {
      return reply.code(400).send({ error: 'INVALID_LEAVE_TYPE', message: 'Leave type not found in your organisation' })
    }

    const { data, error } = await fastify.supabase
      .from('leave_accrual_rules')
      .insert({ tenant_id: req.tenantId, ...parsed.data })
      .select('*, leave_types(id, name)')
      .single()

    if (error) {
      if (error.code === '23505') return reply.code(409).send({ error: 'DUPLICATE', message: 'An accrual rule already exists for this leave type on that effective date' })
      return serverError(req, reply, error, ErrorCode.INSERT_FAILED, 'Failed to create accrual rule')
    }

    return reply.code(201).send({ data })
  })

  // ── PUT /leave/accrual/rules/:id ──────────────────────────────────────────
  fastify.put('/leave/accrual/rules/:id', hrAdminAuth, async (req: any, reply) => {
    const parsed = ruleSchema.partial().safeParse(req.body)
    if (!parsed.success) return reply.code(400).send({ error: 'VALIDATION_ERROR', message: parsed.error.issues[0]?.message })

    // Same cross-tenant guard as the POST handler, for when a rule is
    // re-pointed to a different leave_type_id on update.
    if (parsed.data.leave_type_id) {
      const { data: leaveType } = await fastify.supabase
        .from('leave_types')
        .select('id')
        .eq('id', parsed.data.leave_type_id)
        .eq('tenant_id', req.tenantId)
        .maybeSingle()
      if (!leaveType) {
        return reply.code(400).send({ error: 'INVALID_LEAVE_TYPE', message: 'Leave type not found in your organisation' })
      }
    }

    const { data, error } = await fastify.supabase
      .from('leave_accrual_rules')
      .update(parsed.data)
      .eq('id', req.params.id)
      .eq('tenant_id', req.tenantId)
      .select('*')
      .single()

    if (error) return serverError(req, reply, error, ErrorCode.UPDATE_FAILED, 'Failed to update rule')
    if (!data) return reply.code(404).send({ error: 'NOT_FOUND', message: 'Accrual rule not found' })
    return reply.send({ data })
  })

  // ── DELETE /leave/accrual/rules/:id ──────────────────────────────────────
  fastify.delete('/leave/accrual/rules/:id', hrAdminAuth, async (req: any, reply) => {
    // Soft-deactivate to preserve history
    const { data, error } = await fastify.supabase
      .from('leave_accrual_rules')
      .update({ is_active: false })
      .eq('id', req.params.id)
      .eq('tenant_id', req.tenantId)
      .select('id')
      .maybeSingle()

    if (error) return serverError(req, reply, error, ErrorCode.UPDATE_FAILED, 'Failed to deactivate rule')
    if (!data) return notFound(reply, 'NOT_FOUND', 'Accrual rule not found')
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

    const iKey = (req.headers['idempotency-key'] as string | undefined)?.trim()
    if (iKey) {
      const cached = await checkIdempotency(fastify.supabase, req.tenantId, iKey, 'leave-accrual-run')
      if (cached) {
        reply.header('Idempotency-Replayed', 'true')
        return reply.code(cached.status_code).send(cached.response)
      }
    }

    const [year, month] = parsed.data.period.split('-').map(Number)
    try {
      const result = await runMonthlyAccrual(fastify.supabase, req.tenantId, year, month)
      const responseBody = { data: result, period: parsed.data.period }
      if (iKey) await storeIdempotency(fastify.supabase, req.tenantId, iKey, 'leave-accrual-run', 200, responseBody)
      return reply.send(responseBody)
    } catch (err: unknown) {
      return serverError(req, reply, err, ErrorCode.COMPUTE_FAILED, 'Failed to run monthly accrual')
    }
  })

  // ── POST /leave/accrual/carry-forward ─────────────────────────────────────
  fastify.post('/leave/accrual/carry-forward', hrAdminAuth, async (req: any, reply) => {
    const schema = z.object({ from_year: z.number().int().min(2020).max(2099) })
    const parsed = schema.safeParse(req.body)
    if (!parsed.success) return reply.code(400).send({ error: 'VALIDATION_ERROR', message: parsed.error.issues[0]?.message })

    try {
      const result = await processCarryForward(fastify.supabase, req.tenantId, parsed.data.from_year)
      return reply.send({ data: result })
    } catch (err: unknown) {
      return serverError(req, reply, err, ErrorCode.COMPUTE_FAILED, 'Failed to process carry-forward')
    }
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

    if (error) return serverError(req, reply, error, ErrorCode.QUERY_FAILED, 'Failed to fetch runs')
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
    if (error) return serverError(req, reply, error, ErrorCode.QUERY_FAILED, 'Failed to fetch ledger')
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

    // SYSTEM_AUDIT_2026-10-14 checkpoint 10+1 — this is the one write
    // endpoint in this file that submits money-affecting state (a request
    // against the leave_accrual_rules.max_encashable_per_year cap) with no
    // Idempotency-Key handling, unlike the sibling /leave/accrual/run a
    // few lines above. The annual-cap check below reads a SUM then
    // inserts — no DB constraint enforces the cap (confirmed: migration
    // 072's index on leave_encashment_requests is non-unique) and
    // processEncashment() at approval time only re-checks leave BALANCE
    // sufficiency, never this cap again — so a double-click or a client
    // retry after a timeout could submit two requests that each read the
    // same pre-insert sum, each pass the cap check, and both later get
    // approved independently, exceeding the configured annual cap with
    // nothing to catch it. An idempotency key closes the common
    // double-click/retry case the same way /leave/accrual/run already
    // does. A fully concurrency-proof fix (re-checking the cap atomically
    // under a row/advisory lock at insert AND at approval time) is a
    // larger lift than this specific gap warrants — not attempted,
    // disclosed rather than silently left implicit.
    const iKey = (req.headers['idempotency-key'] as string | undefined)?.trim()
    if (iKey) {
      const cached = await checkIdempotency(fastify.supabase, req.tenantId, iKey, 'leave-encashment-request')
      if (cached) {
        reply.header('Idempotency-Replayed', 'true')
        return reply.code(cached.status_code).send(cached.response)
      }
    }

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

    if (error) return serverError(req, reply, error, ErrorCode.INSERT_FAILED, 'Failed to submit encashment request')

    const responseBody = { data }
    if (iKey) await storeIdempotency(fastify.supabase, req.tenantId, iKey, 'leave-encashment-request', 201, responseBody)
    return reply.code(201).send(responseBody)
  })

  // ── GET /leave/encashment/my ──────────────────────────────────────────────
  fastify.get('/leave/encashment/my', auth, async (req: any, reply) => {
    const { data: prof } = await fastify.supabase
      .from('profiles').select('employee_id').eq('id', req.userId).eq('tenant_id', req.tenantId).single()
    if (!prof?.employee_id) return reply.send({ data: [] })

    const { data, error } = await fastify.supabase
      .from('leave_encashment_requests')
      .select('*, leave_types(id, name)')
      .eq('tenant_id', req.tenantId)
      .eq('employee_id', prof.employee_id)
      .order('created_at', { ascending: false })

    if (error) return serverError(req, reply, error, ErrorCode.QUERY_FAILED, 'Failed to fetch encashment requests')
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

    if (error) return serverError(req, reply, error, ErrorCode.QUERY_FAILED, 'Failed to fetch encashment requests')

    const rows = (data ?? []).map((r: any) => ({
      ...r,
      employee_name: r.employees ? `${r.employees.first_name} ${r.employees.last_name}` : null,
      employee_code: r.employees?.employee_code ?? null,
      employees:     undefined,
    }))

    return reply.send({ data: rows })
  })

  // ── GET /leave/encashment/all ──────────────────────────────────────────────
  // Admin visibility beyond 'pending' (the only status /pending shows) — needed
  // so HR can find an approved/paid request to mark-paid or reverse.
  fastify.get('/leave/encashment/all', hrAdminAuth, async (req: any, reply) => {
    const schema = z.object({ status: z.enum(['pending', 'approved', 'rejected', 'paid', 'reversed']).optional() })
    const parsed = schema.safeParse(req.query)
    if (!parsed.success) return reply.code(400).send({ error: 'VALIDATION_ERROR', message: parsed.error.issues[0]?.message })

    let q = fastify.supabase
      .from('leave_encashment_requests')
      .select(`
        *, leave_types(id, name),
        employees!inner(id, first_name, last_name, employee_code)
      `)
      .eq('tenant_id', req.tenantId)
      .order('created_at', { ascending: false })
    if (parsed.data.status) q = q.eq('status', parsed.data.status)

    const { data, error } = await q
    if (error) return serverError(req, reply, error, ErrorCode.QUERY_FAILED, 'Failed to fetch encashment requests')

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
    try {
      const result = await processEncashment(fastify.supabase, req.tenantId, req.params.id, req.userId)
      if (!result.ok) return reply.code(422).send({ error: 'ENCASHMENT_FAILED', message: result.message })
      return reply.send({ message: result.message })
    } catch (err: unknown) {
      return serverError(req, reply, err, ErrorCode.COMPUTE_FAILED, 'Failed to process encashment')
    }
  })

  // ── POST /leave/encashment/:id/reject ─────────────────────────────────────
  fastify.post('/leave/encashment/:id/reject', hrAdminAuth, async (req: any, reply) => {
    const schema = z.object({ reason: z.string().max(500).optional() })
    const parsed = schema.safeParse(req.body)
    if (!parsed.success) return reply.code(400).send({ error: 'VALIDATION_ERROR', message: parsed.error.issues[0]?.message })

    const { data, error } = await fastify.supabase
      .from('leave_encashment_requests')
      .update({ status: 'rejected', approved_by: req.userId, approved_at: new Date().toISOString(), notes: parsed.data.reason ?? null })
      .eq('id', req.params.id)
      .eq('tenant_id', req.tenantId)
      .eq('status', 'pending')
      .select('id')
      .maybeSingle()

    if (error) return serverError(req, reply, error, ErrorCode.UPDATE_FAILED, 'Failed to reject encashment')
    if (!data) return notFound(reply, 'NOT_FOUND', 'Pending encashment request not found')
    return reply.send({ message: 'Encashment request rejected' })
  })

  // ── POST /leave/encashment/:id/assign-payroll-run ─────────────────────────
  // G12, round 2: this used to flip straight to 'paid' and splice the payout
  // directly into an already-persisted payroll_slips row — which a
  // regeneration of that (still-draft) run would silently wipe, since
  // POST /payroll/runs's own re-run path deletes and recomputes all slips
  // for a non-finalized month. Fixed by separating "reserve a run" from
  // "actually paid": this only sets payroll_run_id (status stays
  // 'approved') — assign_leave_encashment_to_payroll_run_atomic, migration
  // 447. Every (re)generation of that run then folds this request's
  // gross/TDS into the slip fresh (computeOneEmployee →
  // fetchEncashmentPayout, apps/api/src/routes/payroll/runs.ts), so it
  // survives any number of re-runs. The request only becomes 'paid' once
  // that run is actually finalized (migration 447's
  // fn_finalize_leave_encashments_for_run, called from the finalize route)
  // — the slip's numbers are locked by migration 438's trigger at that
  // point, so "paid" now means the number can no longer silently change.
  fastify.post('/leave/encashment/:id/assign-payroll-run', hrAdminAuth, async (req: any, reply) => {
    const schema = z.object({ payroll_run_id: z.string().uuid() })
    const parsed = schema.safeParse(req.body)
    if (!parsed.success) return reply.code(400).send({ error: 'VALIDATION_ERROR', message: parsed.error.issues[0]?.message })

    const { data, error } = await fastify.supabase.rpc('assign_leave_encashment_to_payroll_run_atomic', {
      p_tenant_id:      req.tenantId,
      p_request_id:     req.params.id,
      p_payroll_run_id: parsed.data.payroll_run_id,
    })

    if (error) {
      const msg = error.message ?? ''
      // RUN_NOT_FOUND/NO_PAYSLIP contain the substring "NOT_FOUND:" — check
      // every multi-word prefix BEFORE the plain NOT_FOUND: check, or they'd
      // be misclassified (confirmed regression risk — see the route tests).
      if (msg.includes('RUN_NOT_FOUND:'))     return notFound(reply, 'RUN_NOT_FOUND', msg.replace(/^.*RUN_NOT_FOUND:\s*/, ''))
      if (msg.includes('NO_PAYSLIP:'))        return reply.code(409).send({ error: 'NO_PAYSLIP', message: msg.replace(/^.*NO_PAYSLIP:\s*/, '') })
      if (msg.includes('RUN_NOT_DRAFT:'))     return reply.code(409).send({ error: 'RUN_NOT_DRAFT', message: msg.replace(/^.*RUN_NOT_DRAFT:\s*/, '') })
      if (msg.includes('ALREADY_ASSIGNED:'))  return reply.code(409).send({ error: 'ALREADY_ASSIGNED', message: msg.replace(/^.*ALREADY_ASSIGNED:\s*/, '') })
      if (msg.includes('ALREADY_DECIDED:'))   return reply.code(409).send({ error: 'ALREADY_DECIDED', message: msg.replace(/^.*ALREADY_DECIDED:\s*/, '') })
      if (msg.includes('NOT_COMPUTED:'))      return reply.code(409).send({ error: 'NOT_COMPUTED', message: msg.replace(/^.*NOT_COMPUTED:\s*/, '') })
      if (msg.includes('NOT_FOUND:'))         return notFound(reply, 'NOT_FOUND', msg.replace(/^.*NOT_FOUND:\s*/, ''))
      return serverError(req, reply, error, ErrorCode.UPDATE_FAILED, 'Failed to assign to payroll run')
    }

    return reply.send({ message: 'Assigned to payroll run — not yet paid. Run (or re-run) payroll for this month, then finalize to mark paid.', data })
  })

  // ── POST /leave/encashment/:id/reverse ────────────────────────────────────
  // G12: the audit raised no reversal path at all — an approved-in-error or
  // paid-in-error request had no way back, and the employee's balance
  // stayed deducted forever. reverse_leave_encashment_atomic (migration
  // 446) credits the balance back and, if already posted into a still-
  // draft payslip, removes that posting too — refusing if the payslip has
  // since been finalized (roll the run back to draft first, same break-
  // glass model as migration 438).
  fastify.post('/leave/encashment/:id/reverse', hrAdminAuth, async (req: any, reply) => {
    const schema = z.object({ reason: z.string().max(500).optional() })
    const parsed = schema.safeParse(req.body)
    if (!parsed.success) return reply.code(400).send({ error: 'VALIDATION_ERROR', message: parsed.error.issues[0]?.message })

    const { data, error } = await fastify.supabase.rpc('reverse_leave_encashment_atomic', {
      p_tenant_id:  req.tenantId,
      p_request_id: req.params.id,
      p_actor_id:   req.userId,
      p_reason:     parsed.data.reason ?? null,
    })

    if (error) {
      const msg = error.message ?? ''
      if (msg.includes('NOT_FOUND:'))          return notFound(reply, 'NOT_FOUND', msg.replace(/^.*NOT_FOUND:\s*/, ''))
      if (msg.includes('CONFLICT:'))           return reply.code(409).send({ error: 'CONFLICT', message: msg.replace(/^.*CONFLICT:\s*/, '') })
      if (msg.includes('PAYROLL_FINALIZED:'))  return reply.code(409).send({ error: 'PAYROLL_FINALIZED', message: msg.replace(/^.*PAYROLL_FINALIZED:\s*/, '') })
      return serverError(req, reply, error, ErrorCode.UPDATE_FAILED, 'Failed to reverse encashment')
    }

    return reply.send({ message: 'Encashment reversed and balance credited back', data })
  })
}
