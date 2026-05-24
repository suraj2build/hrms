/**
 * Attendance Regularisation Routes
 *
 * POST   /attendance/regularisation           — employee submits correction request
 * GET    /attendance/regularisation/my        — employee views own requests
 * GET    /attendance/regularisation/pending   — HR views pending approvals (admin only)
 * POST   /attendance/regularisation/:id/approve — HR approves + recomputes daily
 * POST   /attendance/regularisation/:id/reject  — HR rejects
 *
 * Route shadowing note: /my and /pending must be registered BEFORE /:id/...
 * This file registers all five routes so ordering is guaranteed within it.
 */
import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { requireRole, HR_ADMIN_ROLES } from '../../lib/rbac.js'
import { approveRegularisation, rejectRegularisation } from '../../lib/approval-service.js'
import { recomputeRange } from '../../lib/attendance-engine.js'
import { emitEvent } from '../../lib/event-emitter.js'
import { writeLedgerEntry, dateToMonth } from '../../lib/ledger-writer.js'

const dateRe = /^\d{4}-\d{2}-\d{2}$/

const submitSchema = z.object({
  date:                z.string().regex(dateRe, 'date must be YYYY-MM-DD'),
  requested_check_in:  z.string().datetime({ offset: true }).nullable().optional(),
  requested_check_out: z.string().datetime({ offset: true }).nullable().optional(),
  reason:              z.string().min(1, 'reason is required').max(500),
})

export default async function regularisationRoute(fastify: FastifyInstance) {
  const auth        = { preHandler: [fastify.authenticate] }
  const hrAdminAuth = { preHandler: [fastify.authenticate, requireRole(...HR_ADMIN_ROLES)] }

  // ── POST /attendance/regularisation ─────────────────────────────────────────
  // Employee submits a correction request for a specific date.
  // Enforces: submission window, monthly frequency limit, attaches SLA deadline.
  fastify.post('/attendance/regularisation', auth, async (req, reply) => {
    const parsed = submitSchema.safeParse(req.body)
    if (!parsed.success) {
      return reply.code(400).send({
        error:   'VALIDATION_ERROR',
        message: parsed.error.issues[0]?.message,
      })
    }

    // Resolve employee_id from the caller's profile
    const { data: profile, error: profError } = await fastify.supabase
      .from('profiles')
      .select('employee_id')
      .eq('id', req.userId)
      .eq('tenant_id', req.tenantId)
      .single()

    if (profError || !profile?.employee_id) {
      return reply.code(400).send({
        error:   'NO_EMPLOYEE_LINK',
        message: 'Your profile is not linked to an employee record',
      })
    }

    const { date, requested_check_in, requested_check_out, reason } = parsed.data

    // ── Load tenant regularisation policy ──────────────────────────────────────
    const { data: policy } = await fastify.supabase
      .from('regularisation_policy')
      .select('submission_window_days, max_per_month, sla_hours')
      .eq('tenant_id', req.tenantId)
      .maybeSingle()

    const windowDays = policy?.submission_window_days ?? 7
    const maxPerMonth = policy?.max_per_month ?? 5
    const slaHours = policy?.sla_hours ?? 48

    // ── Submission window check ────────────────────────────────────────────────
    const attendanceDate = new Date(`${date}T12:00:00.000Z`)
    const today = new Date()
    today.setUTCHours(12, 0, 0, 0)
    const diffDays = Math.floor((today.getTime() - attendanceDate.getTime()) / 86_400_000)

    if (diffDays > windowDays) {
      return reply.code(422).send({
        error:   'SUBMISSION_WINDOW_CLOSED',
        message: `Regularisation must be submitted within ${windowDays} days of the attendance date. This date is ${diffDays} days ago.`,
      })
    }

    if (diffDays < 0) {
      return reply.code(422).send({
        error:   'FUTURE_DATE',
        message: 'Regularisation cannot be submitted for a future date.',
      })
    }

    // ── Monthly frequency limit check ─────────────────────────────────────────
    const monthStart = `${date.slice(0, 7)}-01`
    const monthEnd = new Date(new Date(`${date.slice(0, 7)}-01`).setUTCMonth(
      new Date(`${date.slice(0, 7)}-01`).getUTCMonth() + 1
    )).toISOString().slice(0, 10)

    const { count: monthCount } = await fastify.supabase
      .from('attendance_regularisation')
      .select('id', { count: 'exact', head: true })
      .eq('tenant_id', req.tenantId)
      .eq('employee_id', profile.employee_id)
      .gte('created_at', monthStart)
      .lt('created_at', monthEnd)

    if ((monthCount ?? 0) >= maxPerMonth) {
      return reply.code(422).send({
        error:   'FREQUENCY_LIMIT_EXCEEDED',
        message: `You have reached the maximum of ${maxPerMonth} regularisation requests for this month.`,
      })
    }

    // ── Compute SLA deadline ───────────────────────────────────────────────────
    const slaDeadline = new Date(Date.now() + slaHours * 3_600_000).toISOString()

    const { data, error } = await fastify.supabase
      .from('attendance_regularisation')
      .insert({
        tenant_id:           req.tenantId,
        employee_id:         profile.employee_id,
        date,
        requested_check_in:  requested_check_in  ?? null,
        requested_check_out: requested_check_out ?? null,
        reason,
        sla_deadline:        slaDeadline,
      })
      .select('id, date, status, reason, sla_deadline, created_at')
      .single()

    if (error) {
      req.log.error({ err: error }, 'regularisation insert failed')
      return reply.code(500).send({ error: 'INSERT_FAILED', message: 'Failed to submit request' })
    }

    return reply.code(201).send({ data })
  })

  // ── GET /attendance/regularisation/my ────────────────────────────────────────
  // Employee views their own correction requests (optionally filtered by date range).
  fastify.get('/attendance/regularisation/my', auth, async (req, reply) => {
    const { from, to } = req.query as { from?: string; to?: string }

    const { data: profile } = await fastify.supabase
      .from('profiles')
      .select('employee_id')
      .eq('id', req.userId)
      .eq('tenant_id', req.tenantId)
      .single()

    if (!profile?.employee_id) {
      return reply.send([])
    }

    let query = fastify.supabase
      .from('attendance_regularisation')
      .select('id, date, requested_check_in, requested_check_out, reason, status, approved_at, created_at')
      .eq('tenant_id', req.tenantId)
      .eq('employee_id', profile.employee_id)
      .order('date', { ascending: false })

    if (from) query = query.gte('date', from)
    if (to)   query = query.lte('date', to)

    const { data, error } = await query

    if (error) {
      req.log.error({ err: error }, 'regularisation my-list query failed')
      return reply.code(500).send({ error: 'QUERY_FAILED', message: 'Failed to fetch requests' })
    }

    return reply.send(data ?? [])
  })

  // ── GET /attendance/regularisation/pending ────────────────────────────────────
  // HR admin views all pending correction requests across the tenant.
  fastify.get('/attendance/regularisation/pending', hrAdminAuth, async (req, reply) => {

    const { data, error } = await fastify.supabase
      .from('attendance_regularisation')
      .select(`
        id, date, requested_check_in, requested_check_out, reason, status,
        rejection_reason, sla_deadline, sla_breached, created_at, approved_at,
        employees!inner(id, first_name, last_name, employee_code)
      `)
      .eq('tenant_id', req.tenantId)
      .eq('status', 'pending')
      .order('created_at', { ascending: false })

    if (error) {
      req.log.error({ err: error }, 'regularisation pending query failed')
      return reply.code(500).send({ error: 'QUERY_FAILED', message: 'Failed to fetch pending requests' })
    }

    // Flatten employee info for easier frontend consumption
    const now = new Date()
    const rows = (data ?? []).map((r: Record<string, unknown>) => {
      const emp = r.employees as { id: string; first_name: string; last_name: string; employee_code: string } | null
      const slaDeadline = r.sla_deadline ? new Date(r.sla_deadline as string) : null
      const isBreached = slaDeadline ? now > slaDeadline : false
      const hoursRemaining = slaDeadline
        ? Math.round((slaDeadline.getTime() - now.getTime()) / 3_600_000)
        : null
      return {
        id:                  r.id,
        date:                r.date,
        requested_check_in:  r.requested_check_in,
        requested_check_out: r.requested_check_out,
        reason:              r.reason,
        status:              r.status,
        rejection_reason:    r.rejection_reason,
        sla_deadline:        r.sla_deadline,
        sla_breached:        (r.sla_breached as boolean) || isBreached,
        hours_remaining:     hoursRemaining,
        created_at:          r.created_at,
        approved_at:         r.approved_at,
        employee_id:         emp?.id ?? null,
        employee_name:       emp ? `${emp.first_name} ${emp.last_name}` : null,
        employee_code:       emp?.employee_code ?? null,
      }
    })

    return reply.send(rows)
  })

  // ── POST /attendance/regularisation/:id/approve ───────────────────────────────
  // Manager or HR admin approves a pending request; triggers recomputation of
  // attendance_daily via the processor.
  // Auth: any authenticated user — ApprovalService validates manager/admin role.
  fastify.post('/attendance/regularisation/:id/approve', auth, async (req: any, reply) => {
    const { id } = req.params as { id: string }

    const result = await approveRegularisation(fastify.supabase, {
      tenantId:         req.tenantId,
      regularisationId: id,
      ctx: {
        approverId:   req.userId,
        approverRole: req.userRole,
        tenantId:     req.tenantId,
      },
    })

    if (!result.ok) {
      const statusMap: Record<string, number> = {
        NOT_FOUND: 404, FORBIDDEN: 403, CONFLICT: 409, DB_ERROR: 500,
      }
      return reply.code(statusMap[result.error.type] ?? 500).send({
        error:   result.error.type,
        message: result.error.message,
      })
    }

    const approved = result.value

    // Insert approved check-in/out into attendance_punch_logs (source = 'regularisation')
    // so the AttendanceEngine picks them up during recompute.
    const punchRows: Array<{
      tenant_id:   string
      employee_id: string
      punched_at:  string
      direction:   'IN' | 'OUT'
      source:      string
      notes:       string
    }> = []

    if (approved.requested_check_in) {
      punchRows.push({
        tenant_id:   req.tenantId,
        employee_id: approved.employee_id,
        punched_at:  approved.requested_check_in,
        direction:   'IN',
        source:      'regularisation',
        notes:       `Regularisation ${id}`,
      })
    }
    if (approved.requested_check_out) {
      punchRows.push({
        tenant_id:   req.tenantId,
        employee_id: approved.employee_id,
        punched_at:  approved.requested_check_out,
        direction:   'OUT',
        source:      'regularisation',
        notes:       `Regularisation ${id}`,
      })
    }

    if (punchRows.length > 0) {
      const { error: punchErr } = await fastify.supabase
        .from('attendance_punch_logs')
        .insert(punchRows)
      if (punchErr) {
        req.log.warn({ err: punchErr, reg_id: id }, 'punch_logs insert failed after regularisation approval')
      }
    }

    // Recompute attendance_daily for the approved date via AttendanceEngine
    try {
      await recomputeRange(fastify.supabase, {
        tenant_id:   req.tenantId,
        employee_id: approved.employee_id,
        from_date:   approved.date,
        to_date:     approved.date,
        changed_by:  req.userId,
      })
    } catch (engineErr) {
      req.log.warn({ err: engineErr, reg_id: id }, 'attendance recompute after regularisation failed')
    }

    // Fire-and-forget — non-blocking
    emitEvent({
      supabase:   fastify.supabase,
      tenantId:   req.tenantId,
      eventType:  'correction.applied',
      payload:    { regularisation_id: approved.id, date: approved.date },
      actorId:    req.userId,
      targetType: 'employee',
      targetId:   approved.employee_id,
    }).catch(() => {/* non-fatal */})

    // Write explainability ledger entry (non-fatal)
    void writeLedgerEntry(fastify.supabase, {
      tenant_id:          req.tenantId,
      employee_id:        approved.employee_id,
      month:              dateToMonth(approved.date),
      event_type:         'correction_approved',
      event_description:  `Attendance correction approved for ${approved.date}.` +
        (approved.requested_check_in
          ? ` Check-in adjusted to ${new Date(approved.requested_check_in).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })}.`
          : '') +
        (approved.requested_check_out
          ? ` Check-out adjusted to ${new Date(approved.requested_check_out).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })}.`
          : ''),
      impact_type:        'attendance_recomputed',
      source_entity_type: 'attendance_regularisation',
      source_entity_id:   id,
      created_by:         req.userId,
    }, req.log).catch(() => {/* non-fatal */})

    return reply.send({ message: 'Approved successfully', data: { id: approved.id, status: approved.status } })
  })

  // ── POST /attendance/regularisation/:id/reject ────────────────────────────────
  // Manager or HR admin rejects a pending request.
  // Auth: any authenticated user — ApprovalService validates manager/admin role.
  fastify.post('/attendance/regularisation/:id/reject', auth, async (req: any, reply) => {
    const { id } = req.params as { id: string }

    const schema = z.object({ rejection_reason: z.string().max(500).optional() })
    const parsed = schema.safeParse(req.body)
    if (!parsed.success) {
      return reply.code(400).send({ error: 'VALIDATION_ERROR', message: parsed.error.issues[0]?.message })
    }

    // Pre-fetch reg fields needed for event emission after rejection
    const { data: regForEvent } = await fastify.supabase
      .from('attendance_regularisation')
      .select('id, employee_id, date')
      .eq('id', id)
      .eq('tenant_id', req.tenantId)
      .maybeSingle()

    const result = await rejectRegularisation(fastify.supabase, {
      tenantId:         req.tenantId,
      regularisationId: id,
      ctx: {
        approverId:   req.userId,
        approverRole: req.userRole,
        tenantId:     req.tenantId,
      },
      rejectionReason: parsed.data.rejection_reason,
    })

    if (!result.ok) {
      const statusMap: Record<string, number> = {
        NOT_FOUND: 404, FORBIDDEN: 403, CONFLICT: 409, DB_ERROR: 500,
      }
      return reply.code(statusMap[result.error.type] ?? 500).send({
        error:   result.error.type,
        message: result.error.message,
      })
    }

    // Fire-and-forget — non-blocking
    if (regForEvent) {
      emitEvent({
        supabase:   fastify.supabase,
        tenantId:   req.tenantId,
        eventType:  'correction.rejected',
        payload:    { regularisation_id: regForEvent.id, date: regForEvent.date },
        actorId:    req.userId,
        targetType: 'employee',
        targetId:   regForEvent.employee_id,
      }).catch(() => {/* non-fatal */})
    }

    return reply.send({ message: 'Rejected successfully', data: result.value })
  })

  // ── GET /attendance/regularisation/summary ────────────────────────────────────
  //    Lightweight pending count + oldest-pending age for operational banner.
  fastify.get('/attendance/regularisation/summary', hrAdminAuth, async (req: any, reply) => {
    const [pendingRes, oldestRes] = await Promise.all([
      fastify.supabase
        .from('attendance_regularisation')
        .select('id', { count: 'exact', head: true })
        .eq('tenant_id', req.tenantId)
        .eq('status', 'pending'),

      fastify.supabase
        .from('attendance_regularisation')
        .select('created_at')
        .eq('tenant_id', req.tenantId)
        .eq('status', 'pending')
        .order('created_at', { ascending: true })
        .limit(1)
        .maybeSingle(),
    ])

    if (pendingRes.error) return reply.code(500).send({ error: 'QUERY_FAILED', message: 'Failed to fetch summary' })

    let oldestPendingDays: number | null = null
    if (oldestRes.data?.created_at) {
      oldestPendingDays = Math.floor(
        (Date.now() - new Date(oldestRes.data.created_at).getTime()) / 86_400_000
      )
    }

    return reply.send({
      pending_count:       pendingRes.count ?? 0,
      oldest_pending_days: oldestPendingDays,
      approved_today:      0,   // future: add approved_at filter
    })
  })
}
