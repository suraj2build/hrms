/**
 * Regularisation Policy Routes
 *
 * GET  /attendance/regularisation/policy        — fetch tenant policy (creates default if absent)
 * PUT  /attendance/regularisation/policy        — upsert policy (HR admin only)
 * GET  /attendance/regularisation/sla-report    — pending requests with SLA status (admin only)
 * POST /attendance/regularisation/breach-check  — trigger SLA breach scan (admin / cron)
 */
import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { requireRole, HR_ADMIN_ROLES } from '../../lib/rbac.js'
import { serverError, ErrorCode } from '../../lib/api-errors.js'
import { fetchAllRows } from '../../lib/supabase-paginate.js'

const policySchema = z.object({
  submission_window_days:   z.number().int().min(1).max(90).optional(),
  max_per_month:            z.number().int().min(1).max(100).optional(),
  sla_hours:                z.number().int().min(1).max(720).optional(),
  auto_reject_on_sla_breach: z.boolean().optional(),
  sla_breach_notify:        z.string().max(500).nullable().optional(),
  limit_period:             z.enum(['week', 'month', 'quarter', 'year']).optional(),
  exclude_rejected:         z.boolean().optional(),
  // Per-type sub-caps, e.g. { wfh: 2, missed_punch: 3 }. Zero/blank entries are dropped client-side.
  per_type_limits:          z.record(z.string(), z.number().int().min(0).max(100)).optional(),
})

export default async function regularisationPolicyRoutes(fastify: FastifyInstance) {
  const auth        = { preHandler: [fastify.authenticate] }
  const hrAdminAuth = { preHandler: [fastify.authenticate, requireRole(...HR_ADMIN_ROLES)] }

  // ── GET /attendance/regularisation/policy ────────────────────────────────────
  // Returns the tenant regularisation policy. Creates a default row if absent.
  fastify.get('/attendance/regularisation/policy', auth, async (req: any, reply) => {
    // Fetch existing policy
    const { data: existing, error } = await fastify.supabase
      .from('regularisation_policy')
      .select('*')
      .eq('tenant_id', req.tenantId)
      .maybeSingle()

    if (error) {
      return serverError(req, reply, error, ErrorCode.QUERY_FAILED, 'Failed to fetch policy')
    }

    if (existing) {
      return reply.send({ data: existing })
    }

    // Create default policy for tenant
    const { data: created, error: createErr } = await fastify.supabase
      .from('regularisation_policy')
      .insert({
        tenant_id:                req.tenantId,
        submission_window_days:   7,
        max_per_month:            5,
        sla_hours:                48,
        auto_reject_on_sla_breach: false,
        sla_breach_notify:        null,
      })
      .select('*')
      .single()

    if (createErr) {
      return serverError(req, reply, createErr, ErrorCode.INSERT_FAILED, 'Failed to create default policy')
    }

    return reply.send({ data: created })
  })

  // ── PUT /attendance/regularisation/policy ─────────────────────────────────────
  // Upserts the tenant regularisation policy (HR admin only).
  // Resilient to migration 251 not yet applied: strips new columns and retries
  // with just the original fields so saves always work on older DBs.
  fastify.put('/attendance/regularisation/policy', hrAdminAuth, async (req: any, reply) => {
    const parsed = policySchema.safeParse(req.body)
    if (!parsed.success) {
      return reply.code(400).send({
        error:   'VALIDATION_ERROR',
        message: parsed.error.issues[0]?.message,
      })
    }

    const fullPayload = { tenant_id: req.tenantId, ...parsed.data }

    let { data, error } = await fastify.supabase
      .from('regularisation_policy')
      .upsert(fullPayload, { onConflict: 'tenant_id' })
      .select('*')
      .single()

    // If new columns don't exist yet (migration 251 pending), retry with base fields only.
    if (error) {
      const { limit_period: _lp, exclude_rejected: _er, per_type_limits: _ptl, ...basePayload } = fullPayload
      const retry = await fastify.supabase
        .from('regularisation_policy')
        .upsert(basePayload, { onConflict: 'tenant_id' })
        .select('*')
        .single()
      data  = retry.data
      error = retry.error
    }

    if (error) {
      return serverError(req, reply, error, ErrorCode.UPDATE_FAILED, 'Failed to save policy')
    }

    return reply.send({ data })
  })

  // ── GET /attendance/regularisation/sla-report ────────────────────────────────
  // Returns all pending regularisation requests enriched with SLA deadline info.
  // Marks breached ones live if auto_reject is disabled.
  fastify.get('/attendance/regularisation/sla-report', hrAdminAuth, async (req: any, reply) => {
    const { limit = 100, offset = 0 } = req.query as { limit?: number; offset?: number }

    // Fetch policy (for SLA hours)
    const { data: policy } = await fastify.supabase
      .from('regularisation_policy')
      .select('sla_hours, auto_reject_on_sla_breach')
      .eq('tenant_id', req.tenantId)
      .maybeSingle()

    const slaHours = policy?.sla_hours ?? 48
    const now = new Date()

    // Fetch pending + recently resolved requests with SLA info
    const { data, error, count } = await fastify.supabase
      .from('attendance_regularisation')
      .select(`
        id, date, reason, status, rejection_reason,
        requested_check_in, requested_check_out,
        sla_deadline, sla_breached, created_at, approved_at,
        employees!inner(id, first_name, last_name, employee_code)
      `, { count: 'exact' })
      .eq('tenant_id', req.tenantId)
      .order('created_at', { ascending: false })
      .range(Number(offset), Number(offset) + Number(limit) - 1)

    if (error) {
      return serverError(req, reply, error, ErrorCode.QUERY_FAILED, 'Failed to fetch SLA report')
    }

    const rows = (data ?? []).map((r: any) => {
      const emp = r.employees
      // Compute SLA deadline if not stored
      const createdAt = new Date(r.created_at)
      const computedDeadline = r.sla_deadline
        ? new Date(r.sla_deadline)
        : new Date(createdAt.getTime() + slaHours * 3_600_000)

      const isPending = r.status === 'pending'
      const isBreached = isPending && now > computedDeadline
      const hoursRemaining = isPending
        ? Math.round((computedDeadline.getTime() - now.getTime()) / 3_600_000)
        : null

      return {
        id:                  r.id,
        date:                r.date,
        reason:              r.reason,
        status:              r.status,
        rejection_reason:    r.rejection_reason,
        requested_check_in:  r.requested_check_in,
        requested_check_out: r.requested_check_out,
        sla_deadline:        computedDeadline.toISOString(),
        sla_breached:        isBreached || r.sla_breached,
        hours_remaining:     hoursRemaining,
        created_at:          r.created_at,
        approved_at:         r.approved_at,
        employee_id:         emp?.id ?? null,
        employee_name:       emp ? `${emp.first_name} ${emp.last_name}` : null,
        employee_code:       emp?.employee_code ?? null,
      }
    })

    return reply.send({ data: rows, total: count ?? 0, sla_hours: slaHours })
  })

  // ── POST /attendance/regularisation/breach-check ─────────────────────────────
  // Scans pending requests, marks breached ones, optionally auto-rejects them.
  // Called by a cron job or manually by HR admin.
  fastify.post('/attendance/regularisation/breach-check', hrAdminAuth, async (req: any, reply) => {
    // Fetch policy
    const { data: policy } = await fastify.supabase
      .from('regularisation_policy')
      .select('sla_hours, auto_reject_on_sla_breach')
      .eq('tenant_id', req.tenantId)
      .maybeSingle()

    const slaHours = policy?.sla_hours ?? 48
    const autoReject = policy?.auto_reject_on_sla_breach ?? false
    const now = new Date()
    const cutoff = new Date(now.getTime() - slaHours * 3_600_000).toISOString()

    // Find pending requests created before the SLA cutoff that haven't been marked breached.
    // Unpaginated before — a tenant with >1000 such requests (e.g. after this
    // cron job was paused, or a large org) would have the remainder silently
    // excluded from both breach-marking and auto-rejection with no signal.
    let breached: { id: string }[]
    try {
      breached = await fetchAllRows<{ id: string }>((from, to) =>
        fastify.supabase
          .from('attendance_regularisation')
          .select('id')
          .eq('tenant_id', req.tenantId)
          .eq('status', 'pending')
          .eq('sla_breached', false)
          .lt('created_at', cutoff)
          .range(from, to),
      )
    } catch (fetchErr) {
      return serverError(req, reply, fetchErr, ErrorCode.QUERY_FAILED, 'Failed to scan for breaches')
    }

    if (!breached?.length) {
      return reply.send({ breached_count: 0, auto_rejected_count: 0 })
    }

    const ids = breached.map((r: { id: string }) => r.id)

    // Mark as breached — fold status='pending' into the WHERE so a request
    // that got approved/rejected between the scan above and this write
    // isn't touched (sla_breached is otherwise harmless to flip, but this
    // keeps the flag meaningful only for requests still actually pending).
    const { data: markedBreached, error: markErr } = await fastify.supabase
      .from('attendance_regularisation')
      .update({ sla_breached: true })
      .in('id', ids)
      .eq('tenant_id', req.tenantId)
      .eq('status', 'pending')
      .select('id')

    if (markErr) {
      return serverError(req, reply, markErr, ErrorCode.UPDATE_FAILED, 'Failed to mark breached requests')
    }

    let autoRejectedCount = 0

    if (autoReject) {
      // Same fold: status='pending' in the WHERE means a request a manager
      // just approved/rejected in the race window can't be silently
      // overwritten back to 'rejected' by this scan.
      const { data: rejected, error: rejectErr } = await fastify.supabase
        .from('attendance_regularisation')
        .update({
          status:           'rejected',
          rejection_reason: `Auto-rejected: SLA of ${slaHours} hours exceeded`,
          approved_by:      null,
          approved_at:      now.toISOString(),
        })
        .in('id', ids)
        .eq('tenant_id', req.tenantId)
        .eq('status', 'pending')
        .select('id')

      if (rejectErr) {
        return serverError(req, reply, rejectErr, ErrorCode.UPDATE_FAILED, 'Failed to auto-reject breached requests')
      }

      autoRejectedCount = rejected?.length ?? 0
    }

    return reply.send({
      breached_count:      markedBreached?.length ?? 0,
      auto_rejected_count: autoRejectedCount,
      sla_hours:           slaHours,
    })
  })
}
