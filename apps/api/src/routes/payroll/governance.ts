/**
 * Payroll Governance Routes
 * Freeze/unfreeze, maker-checker workflow, variance approvals.
 */

import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { HR_ADMIN_ROLES } from '../../lib/rbac.js'
import { serverError, ErrorCode } from '../../lib/api-errors.js'

export default async function governanceRoutes(fastify: FastifyInstance) {
  const auth = { preHandler: [fastify.authenticate] }

  function requireHrAdmin(req: any, reply: any, done: () => void) {
    if (!(HR_ADMIN_ROLES as readonly string[]).includes(req.userRole)) {
      reply.code(403).send({ error: 'FORBIDDEN', message: 'HR admin access required' })
      return
    }
    done()
  }

  // ── GET /payroll/governance/freeze ────────────────────────────────────────────
  fastify.get('/freeze', auth, async (req: any, reply) => {
    const querySchema = z.object({
      month: z.string().optional(),
    })

    const parsed = querySchema.safeParse(req.query)
    if (!parsed.success) {
      return reply.code(400).send({ error: 'VALIDATION_ERROR', message: parsed.error.issues[0]?.message })
    }

    const build = (sel: string) => {
      let q = fastify.supabase
        .from('payroll_freeze_log')
        .select(sel)
        .eq('tenant_id', req.tenantId)
        .order('frozen_at', { ascending: false })
      if (parsed.data.month) q = q.eq('freeze_month', parsed.data.month)
      return q
    }

    let { data, error } = await build('*, profiles!frozen_by(id, full_name, email)')
    if (error) {
      // The profiles!frozen_by FK relationship may be missing on a drifted DB →
      // PostgREST 500. Fall back to raw rows (no joined name) so the page loads.
      req.log.warn({ err: error }, 'governance/freeze embed failed — serving raw rows')
      ;({ data, error } = await build('*'))
      if (error) return serverError(req, reply, error, ErrorCode.QUERY_FAILED, 'Failed to fetch freeze log')
    }
    return reply.send({ data: data ?? [] })
  })

  // ── POST /payroll/governance/freeze ──────────────────────────────────────────
  fastify.post('/freeze', { preHandler: [fastify.authenticate, requireHrAdmin] }, async (req: any, reply) => {
    const schema = z.object({
      freeze_month: z.string().regex(/^\d{4}-\d{2}$/),
      reason: z.string().min(1),
      department_ids: z.array(z.string().uuid()).optional(),
    })

    const parsed = schema.safeParse(req.body)
    if (!parsed.success) {
      return reply.code(400).send({ error: 'VALIDATION_ERROR', message: parsed.error.issues[0]?.message })
    }

    // Idempotency guard: prevent duplicate active freeze records for the same month.
    // Multiple active freeze rows require multiple unfreeze calls to clear — confusing
    // and invisible in the UI.  Return 409 instead of silently stacking freeze records.
    const { data: existingFreeze } = await fastify.supabase
      .from('payroll_freeze_log')
      .select('id')
      .eq('tenant_id', req.tenantId)
      .eq('freeze_month', parsed.data.freeze_month)
      .eq('action', 'freeze')
      .is('unfrozen_at', null)
      .maybeSingle()

    if (existingFreeze) {
      return reply.code(409).send({
        error:   'ALREADY_FROZEN',
        message: `Payroll for ${parsed.data.freeze_month} is already frozen. Unfreeze it before re-freezing.`,
      })
    }

    const { data, error } = await fastify.supabase
      .from('payroll_freeze_log')
      .insert({
        ...parsed.data,
        tenant_id: req.tenantId,
        action: 'freeze',
        frozen_by: req.userId,
        frozen_at: new Date().toISOString(),
      })
      .select()
      .single()

    if (error) return serverError(req, reply, error, ErrorCode.INSERT_FAILED, 'Failed to create freeze record')
    return reply.code(201).send({ data })
  })

  // ── POST /payroll/governance/unfreeze ─────────────────────────────────────────
  fastify.post('/unfreeze', { preHandler: [fastify.authenticate, requireHrAdmin] }, async (req: any, reply) => {
    const schema = z.object({
      freeze_month: z.string().regex(/^\d{4}-\d{2}$/),
      reason: z.string().min(1),
    })

    const parsed = schema.safeParse(req.body)
    if (!parsed.success) {
      return reply.code(400).send({ error: 'VALIDATION_ERROR', message: parsed.error.issues[0]?.message })
    }

    const now = new Date().toISOString()

    // ── Atomic unfreeze: update the freeze record FIRST ──────────────────────────
    //
    // checkFreezeGuard queries WHERE action='freeze' AND unfrozen_at IS NULL.
    // Setting unfrozen_at on the freeze row is the SINGLE operation that lifts the
    // freeze.  We do this before inserting the audit record so that a partial write
    // never leaves the month frozen with the caller believing it is unfrozen.
    //
    // Recovery contract:
    //   • If UPDATE fails  → return 500; month stays frozen; caller retries safely.
    //   • If INSERT fails  → freeze is ALREADY lifted; warn in response; no data loss.

    // Step 1: Find and verify there is an active freeze to lift
    const { data: latestFreeze } = await fastify.supabase
      .from('payroll_freeze_log')
      .select('id')
      .eq('tenant_id', req.tenantId)
      .eq('freeze_month', parsed.data.freeze_month)
      .eq('action', 'freeze')
      .is('unfrozen_at', null)
      .order('frozen_at', { ascending: false })
      .limit(1)
      .maybeSingle()

    if (!latestFreeze) {
      return reply.code(409).send({
        error:   'NOT_FROZEN',
        message: `Payroll for ${parsed.data.freeze_month} is not currently frozen.`,
      })
    }

    // Step 2: Stamp unfrozen_at on the freeze record (critical — this is what lifts the freeze)
    const { error: updateErr } = await fastify.supabase
      .from('payroll_freeze_log')
      .update({
        unfrozen_by: req.userId,
        unfrozen_at: now,
      })
      .eq('id', (latestFreeze as any).id)
      .eq('tenant_id', req.tenantId)

    if (updateErr) {
      req.log.error(
        { err: updateErr, freeze_id: (latestFreeze as any).id, freeze_month: parsed.data.freeze_month },
        'governance: unfreeze — freeze record update failed; month remains frozen',
      )
      return reply.code(500).send({
        error:   'UNFREEZE_FAILED',
        message: 'Failed to lift freeze — the month remains frozen. Retry the unfreeze operation.',
      })
    }

    // Step 3: Insert unfreeze audit record (non-critical — freeze is already lifted by step 2)
    const { data, error: insertErr } = await fastify.supabase
      .from('payroll_freeze_log')
      .insert({
        tenant_id:    req.tenantId,
        freeze_month: parsed.data.freeze_month,
        action:       'unfreeze',
        reason:       parsed.data.reason,
        frozen_by:    req.userId,
        frozen_at:    now,
        unfrozen_by:  req.userId,
        unfrozen_at:  now,
      })
      .select()
      .single()

    if (insertErr) {
      // Non-fatal: the freeze IS already lifted (step 2 committed).
      // Log the audit gap and return success with a warning so the caller knows.
      req.log.warn(
        { err: insertErr, freeze_month: parsed.data.freeze_month },
        'governance: unfreeze — audit record insert failed; freeze is lifted but audit entry is missing',
      )
      return reply.send({
        data:    { freeze_month: parsed.data.freeze_month, action: 'unfreeze', reason: parsed.data.reason },
        warning: 'Freeze lifted successfully but the audit log entry could not be created.',
      })
    }

    return reply.send({ data })
  })

  // ── GET /payroll/governance/maker-checker ─────────────────────────────────────
  fastify.get('/maker-checker', { preHandler: [fastify.authenticate, requireHrAdmin] }, async (req: any, reply) => {
    const querySchema = z.object({
      entity_type: z.string().optional(),
      status: z.string().optional(),
    })

    const parsed = querySchema.safeParse(req.query)
    if (!parsed.success) {
      return reply.code(400).send({ error: 'VALIDATION_ERROR', message: parsed.error.issues[0]?.message })
    }

    const build = (sel: string) => {
      let q = fastify.supabase
        .from('maker_checker_log')
        .select(sel)
        .eq('tenant_id', req.tenantId)
        .order('submitted_at', { ascending: false })
      if (parsed.data.entity_type) q = q.eq('entity_type', parsed.data.entity_type)
      if (parsed.data.status) q = q.eq('status', parsed.data.status)
      return q
    }

    let { data, error } = await build('*, profiles!maker_id(id, full_name, email)')
    if (error) {
      // profiles!maker_id FK may be missing on a drifted DB → 500. Serve raw rows.
      req.log.warn({ err: error }, 'governance/maker-checker embed failed — serving raw rows')
      ;({ data, error } = await build('*'))
      if (error) return serverError(req, reply, error, ErrorCode.QUERY_FAILED, 'Failed to fetch maker-checker log')
    }
    return reply.send({ data: data ?? [] })
  })

  // ── POST /payroll/governance/maker-checker/:id/approve ───────────────────────
  fastify.post('/maker-checker/:id/approve', { preHandler: [fastify.authenticate, requireHrAdmin] }, async (req: any, reply) => {
    const { id } = req.params as { id: string }

    const schema = z.object({
      checker_notes: z.string().optional(),
    })

    const parsed = schema.safeParse(req.body)
    if (!parsed.success) {
      return reply.code(400).send({ error: 'VALIDATION_ERROR', message: parsed.error.issues[0]?.message })
    }

    const now = new Date().toISOString()

    const { data, error } = await fastify.supabase
      .from('maker_checker_log')
      .update({
        status: 'approved',
        checker_id: req.userId,
        reviewed_at: now,
        checker_notes: parsed.data.checker_notes ?? null,
      })
      .eq('id', id)
      .eq('tenant_id', req.tenantId)
      // Guard: only update if still pending — prevents concurrent double-approval
      // overwriting the audit trail if two checkers act simultaneously.
      .eq('status', 'pending')
      .select()
      .single()

    if (error) return serverError(req, reply, error, ErrorCode.UPDATE_FAILED, 'Failed to approve maker-checker entry')
    if (!data) return reply.code(409).send({ error: 'ALREADY_ACTIONED', message: 'This entry has already been approved or rejected' })

    return reply.send({ data })
  })

  // ── POST /payroll/governance/maker-checker/:id/reject ────────────────────────
  fastify.post('/maker-checker/:id/reject', { preHandler: [fastify.authenticate, requireHrAdmin] }, async (req: any, reply) => {
    const { id } = req.params as { id: string }

    const schema = z.object({
      checker_notes: z.string().min(1),
    })

    const parsed = schema.safeParse(req.body)
    if (!parsed.success) {
      return reply.code(400).send({ error: 'VALIDATION_ERROR', message: parsed.error.issues[0]?.message })
    }

    const now = new Date().toISOString()

    const { data, error } = await fastify.supabase
      .from('maker_checker_log')
      .update({
        status: 'rejected',
        checker_id: req.userId,
        reviewed_at: now,
        checker_notes: parsed.data.checker_notes,
      })
      .eq('id', id)
      .eq('tenant_id', req.tenantId)
      // Guard: only update if still pending — prevents concurrent double-rejection
      .eq('status', 'pending')
      .select()
      .single()

    if (error) return serverError(req, reply, error, ErrorCode.UPDATE_FAILED, 'Failed to reject maker-checker entry')
    if (!data) return reply.code(409).send({ error: 'ALREADY_ACTIONED', message: 'This entry has already been approved or rejected' })

    return reply.send({ data })
  })

  // ── GET /payroll/governance/variance-approvals ────────────────────────────────
  fastify.get('/variance-approvals', { preHandler: [fastify.authenticate, requireHrAdmin] }, async (req: any, reply) => {
    const querySchema = z.object({
      payroll_run_id: z.string().uuid().optional(),
      status: z.string().optional(),
    })

    const parsed = querySchema.safeParse(req.query)
    if (!parsed.success) {
      return reply.code(400).send({ error: 'VALIDATION_ERROR', message: parsed.error.issues[0]?.message })
    }

    let q = fastify.supabase
      .from('payroll_variance_approvals')
      .select('*, employees(id, first_name, last_name, employee_code)')
      .eq('tenant_id', req.tenantId)

    if (parsed.data.payroll_run_id) q = q.eq('payroll_run_id', parsed.data.payroll_run_id)
    if (parsed.data.status) q = q.eq('status', parsed.data.status)

    const { data, error } = await q
    if (error) return serverError(req, reply, error, ErrorCode.QUERY_FAILED, 'Failed to fetch variance approvals')
    return reply.send({ data: data ?? [] })
  })

  // ── POST /payroll/governance/variance-approvals/:id/approve ──────────────────
  fastify.post('/variance-approvals/:id/approve', { preHandler: [fastify.authenticate, requireHrAdmin] }, async (req: any, reply) => {
    const { id } = req.params as { id: string }
    const now = new Date().toISOString()

    const { data, error } = await fastify.supabase
      .from('payroll_variance_approvals')
      .update({
        status: 'approved',
        reviewed_by: req.userId,
        reviewed_at: now,
      })
      .eq('id', id)
      .eq('tenant_id', req.tenantId)
      // Guard: only update if still pending
      .eq('status', 'pending')
      .select()
      .single()

    if (error) return serverError(req, reply, error, ErrorCode.UPDATE_FAILED, 'Failed to approve variance')
    if (!data) return reply.code(409).send({ error: 'ALREADY_ACTIONED', message: 'This variance has already been approved or rejected' })

    return reply.send({ data })
  })

  // ── POST /payroll/governance/variance-approvals/:id/reject ───────────────────
  fastify.post('/variance-approvals/:id/reject', { preHandler: [fastify.authenticate, requireHrAdmin] }, async (req: any, reply) => {
    const { id } = req.params as { id: string }

    const schema = z.object({
      notes: z.string().optional(),
    })

    const parsed = schema.safeParse(req.body)
    if (!parsed.success) {
      return reply.code(400).send({ error: 'VALIDATION_ERROR', message: parsed.error.issues[0]?.message })
    }

    const now = new Date().toISOString()

    const { data, error } = await fastify.supabase
      .from('payroll_variance_approvals')
      .update({
        status: 'rejected',
        notes: parsed.data.notes ?? null,
        reviewed_by: req.userId,
        reviewed_at: now,
      })
      .eq('id', id)
      .eq('tenant_id', req.tenantId)
      // Guard: only update if still pending
      .eq('status', 'pending')
      .select()
      .single()

    if (error) return serverError(req, reply, error, ErrorCode.UPDATE_FAILED, 'Failed to reject variance')
    if (!data) return reply.code(409).send({ error: 'ALREADY_ACTIONED', message: 'This variance has already been approved or rejected' })

    return reply.send({ data })
  })

  // ── GET /payroll/governance/is-frozen/:month ──────────────────────────────────
  fastify.get('/is-frozen/:month', auth, async (req: any, reply) => {
    const { month } = req.params as { month: string }

    const { data, error } = await fastify.supabase
      .from('payroll_freeze_log')
      .select('*')
      .eq('tenant_id', req.tenantId)
      .eq('freeze_month', month)
      .eq('action', 'freeze')
      .is('unfrozen_at', null)
      .order('frozen_at', { ascending: false })
      .limit(1)
      .maybeSingle()

    if (error) return serverError(req, reply, error, ErrorCode.QUERY_FAILED, 'Failed to check payroll freeze status')

    return reply.send({
      is_frozen: !!data,
      freeze_record: data ?? null,
      month,
    })
  })
}
