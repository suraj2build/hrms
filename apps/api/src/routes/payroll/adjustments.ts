/**
 * Payroll Adjustment Queue Routes
 *
 * When a payroll period is frozen/locked and a retroactive change occurs
 * (e.g. leave approved for that period, statutory correction), the change is
 * queued here as a pending adjustment rather than silently mutating the locked data.
 *
 * Flow:
 *   Retro change on locked period
 *     → payroll_adjustment created (pending)
 *     → HR reviews + approves
 *     → HR applies to next open payroll run
 *
 * GET  /payroll/adjustments           — list adjustments (filter by status, month, employee)
 * POST /payroll/adjustments           — create manual adjustment
 * GET  /payroll/adjustments/:id       — single adjustment
 * PUT  /payroll/adjustments/:id/approve — approve (hr_admin only)
 * PUT  /payroll/adjustments/:id/reject  — reject (hr_admin only)
 * POST /payroll/adjustments/:id/apply   — apply to a payroll run (hr_admin only)
 * GET  /payroll/adjustments/summary     — aggregate counts by status/month
 */

import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { notifyHrAdmins } from '../../lib/notify.js'
import { logAction } from '../../lib/audit-service.js'
import { HR_ADMIN_ROLES } from '../../lib/rbac.js'

export default async function payrollAdjustmentsRoutes(fastify: FastifyInstance) {
  const auth      = { preHandler: [fastify.authenticate] }
  const adminAuth = { preHandler: [fastify.authenticate, (req: any, reply: any, done: () => void) => {
    if (!(HR_ADMIN_ROLES as readonly string[]).includes(req.userRole)) {
      reply.code(403).send({ error: 'FORBIDDEN', message: 'HR admin access required' })
      return
    }
    done()
  }] }

  // ── GET /payroll/adjustments/summary ─────────────────────────────────────────
  // Register before /:id so static path wins
  fastify.get('/summary', adminAuth, async (req: any, reply) => {
    const { data, error } = await fastify.supabase
      .from('payroll_adjustments')
      .select('status, locked_month, adjustment_type')
      .eq('tenant_id', req.tenantId)

    if (error) return reply.code(500).send({ error: 'QUERY_FAILED', message: error.message })

    const rows = (data ?? []) as any[]
    const byStatus: Record<string, number> = {}
    const byType:   Record<string, number> = {}
    const byMonth:  Record<string, number> = {}

    for (const r of rows) {
      byStatus[r.status]          = (byStatus[r.status] ?? 0) + 1
      byType[r.adjustment_type]   = (byType[r.adjustment_type] ?? 0) + 1
      byMonth[r.locked_month]     = (byMonth[r.locked_month] ?? 0) + 1
    }

    return reply.send({
      total:    rows.length,
      pending:  byStatus['pending']  ?? 0,
      approved: byStatus['approved'] ?? 0,
      applied:  byStatus['applied']  ?? 0,
      rejected: byStatus['rejected'] ?? 0,
      by_status: byStatus,
      by_type:   byType,
      by_month:  byMonth,
    })
  })

  // ── GET /payroll/adjustments ──────────────────────────────────────────────────
  fastify.get('/', adminAuth, async (req: any, reply) => {
    const querySchema = z.object({
      status:          z.enum(['pending','approved','applied','rejected','cancelled']).optional(),
      locked_month:    z.string().optional(),
      adjustment_type: z.enum(['lop_adjustment','arrear','statutory_correction','manual']).optional(),
      employee_id:     z.string().uuid().optional(),
      limit:           z.coerce.number().int().min(1).max(200).default(50),
      offset:          z.coerce.number().int().min(0).default(0),
    })

    const parsed = querySchema.safeParse(req.query)
    if (!parsed.success) {
      return reply.code(400).send({ error: 'VALIDATION_ERROR', message: parsed.error.issues[0]?.message })
    }

    let q = fastify.supabase
      .from('payroll_adjustments')
      .select(`
        *,
        employees(id, first_name, last_name, employee_code),
        profiles!created_by(full_name),
        payroll_runs!applied_run_id(id, month, status)
      `, { count: 'exact' })
      .eq('tenant_id', req.tenantId)
      .order('created_at', { ascending: false })
      .range(parsed.data.offset, parsed.data.offset + parsed.data.limit - 1)

    if (parsed.data.status)          q = q.eq('status', parsed.data.status)
    if (parsed.data.locked_month)    q = q.eq('locked_month', parsed.data.locked_month)
    if (parsed.data.adjustment_type) q = q.eq('adjustment_type', parsed.data.adjustment_type)
    if (parsed.data.employee_id)     q = q.eq('employee_id', parsed.data.employee_id)

    const { data, error, count } = await q
    if (error) return reply.code(500).send({ error: 'QUERY_FAILED', message: error.message })
    return reply.send({ data: data ?? [], total: count ?? 0 })
  })

  // ── GET /payroll/adjustments/:id ─────────────────────────────────────────────
  fastify.get('/:id', adminAuth, async (req: any, reply) => {
    const { id } = req.params as { id: string }

    const { data, error } = await fastify.supabase
      .from('payroll_adjustments')
      .select(`
        *,
        employees(id, first_name, last_name, employee_code),
        profiles!created_by(full_name),
        profiles!approved_by(full_name)
      `)
      .eq('id', id)
      .eq('tenant_id', req.tenantId)
      .single()

    if (error || !data) return reply.code(404).send({ error: 'NOT_FOUND' })
    return reply.send({ data })
  })

  // ── POST /payroll/adjustments ─────────────────────────────────────────────────
  // Manual adjustment creation (for corrections not triggered automatically)
  fastify.post('/', adminAuth, async (req: any, reply) => {
    const schema = z.object({
      employee_id:     z.string().uuid(),
      locked_month:    z.string().regex(/^\d{4}-\d{2}$/, 'Must be YYYY-MM'),
      adjustment_type: z.enum(['lop_adjustment','arrear','statutory_correction','manual']),
      amount:          z.number().default(0),
      lop_days_delta:  z.number().optional(),
      reason:          z.string().min(3),
      notes:           z.string().optional(),
    })

    const parsed = schema.safeParse(req.body)
    if (!parsed.success) {
      return reply.code(400).send({ error: 'VALIDATION_ERROR', message: parsed.error.issues[0]?.message })
    }

    // Verify the locked_month is actually frozen (or warn if not)
    const { data: freeze } = await fastify.supabase
      .from('payroll_freeze_log')
      .select('id')
      .eq('tenant_id', req.tenantId)
      .eq('freeze_month', parsed.data.locked_month)
      .eq('action', 'freeze')
      .is('unfrozen_at', null)
      .limit(1)
      .maybeSingle()

    const { data, error } = await fastify.supabase
      .from('payroll_adjustments')
      .insert({
        ...parsed.data,
        tenant_id:   req.tenantId,
        source_type: 'manual',
        status:      'pending',
        created_by:  req.userId,
      })
      .select()
      .single()

    if (error) return reply.code(500).send({ error: 'INSERT_FAILED', message: error.message })

    await logAction(fastify.supabase, {
      tenantId:    req.tenantId,
      tableName:   'payroll_adjustments',
      recordId:    (data as any).id,
      action:      'INSERT',
      performedBy: req.userId,
      onBehalfOf:  parsed.data.employee_id,
      newData:     { ...parsed.data, status: 'pending' },
    })

    return reply.code(201).send({
      data,
      period_frozen: !!freeze,
    })
  })

  // ── PUT /payroll/adjustments/:id/approve ─────────────────────────────────────
  fastify.put('/:id/approve', adminAuth, async (req: any, reply) => {
    const { id } = req.params as { id: string }
    const schema = z.object({
      apply_to_month: z.string().regex(/^\d{4}-\d{2}$/).optional(),
      notes:          z.string().optional(),
    })

    const parsed = schema.safeParse(req.body ?? {})
    if (!parsed.success) {
      return reply.code(400).send({ error: 'VALIDATION_ERROR', message: parsed.error.issues[0]?.message })
    }

    const { data: existing } = await fastify.supabase
      .from('payroll_adjustments')
      .select('status')
      .eq('id', id)
      .eq('tenant_id', req.tenantId)
      .single()

    if (!existing) return reply.code(404).send({ error: 'NOT_FOUND' })
    if ((existing as any).status !== 'pending') {
      return reply.code(409).send({ error: 'INVALID_STATUS', message: `Adjustment is ${(existing as any).status}` })
    }

    const { data, error } = await fastify.supabase
      .from('payroll_adjustments')
      .update({
        status:         'approved',
        approved_by:    req.userId,
        approved_at:    new Date().toISOString(),
        apply_to_month: parsed.data.apply_to_month ?? null,
        notes:          parsed.data.notes          ?? null,
      })
      .eq('id', id)
      .select()
      .single()

    if (error) return reply.code(500).send({ error: 'UPDATE_FAILED', message: error.message })

    await logAction(fastify.supabase, {
      tenantId:    req.tenantId,
      tableName:   'payroll_adjustments',
      recordId:    id,
      action:      'UPDATE',
      performedBy: req.userId,
      onBehalfOf:  (data as any).employee_id ?? null,
      newData:     { status: 'approved', apply_to_month: parsed.data.apply_to_month ?? null, notes: parsed.data.notes ?? null },
    })

    return reply.send({ data })
  })

  // ── PUT /payroll/adjustments/:id/reject ──────────────────────────────────────
  fastify.put('/:id/reject', adminAuth, async (req: any, reply) => {
    const { id } = req.params as { id: string }
    const schema = z.object({ reason: z.string().min(3) })

    const parsed = schema.safeParse(req.body ?? {})
    if (!parsed.success) {
      return reply.code(400).send({ error: 'VALIDATION_ERROR', message: parsed.error.issues[0]?.message })
    }

    const { data, error } = await fastify.supabase
      .from('payroll_adjustments')
      .update({ status: 'rejected', notes: parsed.data.reason })
      .eq('id', id)
      .eq('tenant_id', req.tenantId)
      .in('status', ['pending', 'approved'])
      .select()
      .single()

    if (error || !data) return reply.code(404).send({ error: 'NOT_FOUND_OR_INVALID_STATUS' })

    await logAction(fastify.supabase, {
      tenantId:    req.tenantId,
      tableName:   'payroll_adjustments',
      recordId:    id,
      action:      'UPDATE',
      performedBy: req.userId,
      onBehalfOf:  (data as any).employee_id ?? null,
      newData:     { status: 'rejected', reason: parsed.data.reason },
    })

    return reply.send({ data })
  })

  // ── POST /payroll/adjustments/:id/apply ──────────────────────────────────────
  // Mark an approved adjustment as applied to a specific payroll run.
  // The actual payroll recomputation is handled by the payroll run engine.
  // This endpoint closes the adjustment record with the run it was folded into.
  fastify.post('/:id/apply', adminAuth, async (req: any, reply) => {
    const { id } = req.params as { id: string }
    const schema = z.object({
      run_id:         z.string().uuid(),
      apply_to_month: z.string().regex(/^\d{4}-\d{2}$/).optional(),
      notes:          z.string().optional(),
    })

    const parsed = schema.safeParse(req.body)
    if (!parsed.success) {
      return reply.code(400).send({ error: 'VALIDATION_ERROR', message: parsed.error.issues[0]?.message })
    }

    const { data: existing } = await fastify.supabase
      .from('payroll_adjustments')
      .select('status, employee_id, adjustment_type, reason')
      .eq('id', id)
      .eq('tenant_id', req.tenantId)
      .single()

    if (!existing) return reply.code(404).send({ error: 'NOT_FOUND' })
    if ((existing as any).status !== 'approved') {
      return reply.code(409).send({ error: 'INVALID_STATUS', message: 'Only approved adjustments can be applied' })
    }

    // Verify the run exists and belongs to this tenant
    const { data: run } = await fastify.supabase
      .from('payroll_runs')
      .select('id, month, status')
      .eq('id', parsed.data.run_id)
      .eq('tenant_id', req.tenantId)
      .single()

    if (!run) return reply.code(404).send({ error: 'RUN_NOT_FOUND' })
    if ((run as any).status === 'finalized') {
      return reply.code(409).send({ error: 'RUN_FINALIZED', message: 'Cannot apply to a finalized run' })
    }

    const { data, error } = await fastify.supabase
      .from('payroll_adjustments')
      .update({
        status:         'applied',
        applied_run_id: parsed.data.run_id,
        apply_to_month: parsed.data.apply_to_month ?? (run as any).month,
        applied_at:     new Date().toISOString(),
        notes:          parsed.data.notes ?? null,
      })
      .eq('id', id)
      .select()
      .single()

    if (error) return reply.code(500).send({ error: 'UPDATE_FAILED', message: error.message })

    await logAction(fastify.supabase, {
      tenantId:    req.tenantId,
      tableName:   'payroll_adjustments',
      recordId:    id,
      action:      'UPDATE',
      performedBy: req.userId,
      onBehalfOf:  (existing as any).employee_id ?? null,
      newData:     { status: 'applied', applied_run_id: parsed.data.run_id, apply_to_month: parsed.data.apply_to_month ?? (run as any).month },
    })

    return reply.send({ data, run_month: (run as any).month })
  })
}
