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
import { orchestrateWorkforceEvent } from '../../lib/workforce-orchestrator.js'
import {
  isHrAdmin, resolveCallerEmployeeId, getDirectReportIds,
} from '../../lib/manager-scope.js'

const dateRe = /^\d{4}-\d{2}-\d{2}$/

const isoDate = (d: Date) => d.toISOString().slice(0, 10)

/**
 * Bounds of the configurable limit period containing `now` (UTC).
 * Returns [start, end) as YYYY-MM-DD strings, comparable against created_at.
 * The window is anchored to submission time (now), so the cap means
 * "requests an employee raises per <period>", regardless of which date is
 * being regularised.
 */
function limitPeriodBounds(period: string, now: Date): { start: string; end: string; label: string } {
  const y = now.getUTCFullYear(), m = now.getUTCMonth(), d = now.getUTCDate()
  if (period === 'week') {
    const dow = now.getUTCDay() === 0 ? 7 : now.getUTCDay()   // Mon=1 … Sun=7
    const monday = new Date(Date.UTC(y, m, d - (dow - 1)))
    const next   = new Date(Date.UTC(y, m, d - (dow - 1) + 7))
    return { start: isoDate(monday), end: isoDate(next), label: 'week' }
  }
  if (period === 'quarter') {
    const qStart = Math.floor(m / 3) * 3
    return { start: isoDate(new Date(Date.UTC(y, qStart, 1))), end: isoDate(new Date(Date.UTC(y, qStart + 3, 1))), label: 'quarter' }
  }
  if (period === 'year') {
    return { start: `${y}-01-01`, end: `${y + 1}-01-01`, label: 'year' }
  }
  // month (default)
  return { start: isoDate(new Date(Date.UTC(y, m, 1))), end: isoDate(new Date(Date.UTC(y, m + 1, 1))), label: 'month' }
}

// All accepted regularization_type values.
// Legacy abstract types kept for backward compat; ESS descriptive types added in migration 150.
const REGULARIZATION_TYPES = [
  // ESS descriptive types (used by EssRegularization.tsx)
  'missed_punch', 'forgot_checkout', 'onsite_duty',
  'biometric_issue', 'client_visit', 'wfh', 'field_work', 'system_issue',
  // Legacy abstract types (backward compat)
  'check_in', 'check_out', 'both', 'absence', 'other',
] as const

const submitSchema = z.object({
  date:                  z.string().regex(dateRe, 'date must be YYYY-MM-DD'),
  regularization_type:   z.enum(REGULARIZATION_TYPES).optional(),
  requested_check_in:    z.string().datetime({ offset: true }).nullable().optional(),
  requested_check_out:   z.string().datetime({ offset: true }).nullable().optional(),
  reason:                z.string().min(1, 'reason is required').max(500),
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

    const { date, regularization_type, requested_check_in, requested_check_out, reason } = parsed.data

    // ── Load tenant regularisation policy ──────────────────────────────────────
    const { data: policy } = await fastify.supabase
      .from('regularisation_policy')
      .select('submission_window_days, max_per_month, sla_hours, limit_period, exclude_rejected, per_type_limits')
      .eq('tenant_id', req.tenantId)
      .maybeSingle()

    const windowDays      = policy?.submission_window_days ?? 7
    const maxPerPeriod    = policy?.max_per_month ?? 5
    const slaHours        = policy?.sla_hours ?? 48
    const limitPeriod     = policy?.limit_period ?? 'month'
    const excludeRejected = policy?.exclude_rejected ?? true
    const perTypeLimits   = (policy?.per_type_limits ?? {}) as Record<string, number>

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

    // ── Frequency limit check (configurable period + status filter) ────────────
    // Statuses that consume quota: pending + approved always; rejected too unless
    // the policy excludes them. Cancelled requests never count.
    const countedStatuses = excludeRejected
      ? ['pending', 'approved']
      : ['pending', 'approved', 'rejected']

    const { start: periodStart, end: periodEnd, label: periodLabel } = limitPeriodBounds(limitPeriod, new Date())

    const { count: periodCount } = await fastify.supabase
      .from('attendance_regularisation')
      .select('id', { count: 'exact', head: true })
      .eq('tenant_id', req.tenantId)
      .eq('employee_id', profile.employee_id)
      .in('status', countedStatuses)
      .gte('created_at', periodStart)
      .lt('created_at', periodEnd)

    if ((periodCount ?? 0) >= maxPerPeriod) {
      return reply.code(422).send({
        error:   'FREQUENCY_LIMIT_EXCEEDED',
        message: `You have reached the maximum of ${maxPerPeriod} regularisation requests for this ${periodLabel}.`,
      })
    }

    // ── Per-type sub-limit check ───────────────────────────────────────────────
    // If the policy caps this specific request type, enforce it within the period.
    const typeCap = regularization_type ? Number(perTypeLimits[regularization_type]) : NaN
    if (regularization_type && Number.isFinite(typeCap) && typeCap > 0) {
      const { count: typeCount } = await fastify.supabase
        .from('attendance_regularisation')
        .select('id', { count: 'exact', head: true })
        .eq('tenant_id', req.tenantId)
        .eq('employee_id', profile.employee_id)
        .eq('regularization_type', regularization_type)
        .in('status', countedStatuses)
        .gte('created_at', periodStart)
        .lt('created_at', periodEnd)

      if ((typeCount ?? 0) >= typeCap) {
        return reply.code(422).send({
          error:   'TYPE_LIMIT_EXCEEDED',
          message: `You have reached the maximum of ${typeCap} "${regularization_type.replace(/_/g, ' ')}" requests for this ${periodLabel}.`,
        })
      }
    }

    // ── Period lock check ──────────────────────────────────────────────────────
    const { data: periodLock } = await fastify.supabase
      .from('attendance_period_locks')
      .select('state')
      .eq('tenant_id', req.tenantId)
      .eq('period_month', date.slice(0, 7))
      .maybeSingle()

    if (periodLock && periodLock.state !== 'OPEN') {
      return reply.code(422).send({
        error:   'PERIOD_LOCKED',
        message: 'Regularisation submissions are closed for this pay period.',
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
        regularization_type: regularization_type ?? null,
        requested_check_in:  requested_check_in  ?? null,
        requested_check_out: requested_check_out ?? null,
        reason,
        sla_deadline:        slaDeadline,
      })
      .select('id, date, status, regularization_type, reason, sla_deadline, created_at')
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
      .select('id, date, regularization_type, requested_check_in, requested_check_out, reason, status, rejection_reason, approved_at, created_at', { count: 'exact' })
      .eq('tenant_id', req.tenantId)
      .eq('employee_id', profile.employee_id)
      .order('date', { ascending: false })

    if (from) query = query.gte('date', from)
    if (to)   query = query.lte('date', to)

    const { data, count, error } = await query

    if (error) {
      req.log.error({ err: error }, 'regularisation my-list query failed')
      return reply.code(500).send({ error: 'QUERY_FAILED', message: 'Failed to fetch requests' })
    }

    return reply.send({ data: data ?? [], total: count ?? 0 })
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

  // ── GET /attendance/regularisation/team ──────────────────────────────────────
  // Manager views direct reports' pending regularisation requests.
  fastify.get('/attendance/regularisation/team', auth, async (req: any, reply) => {
    // Find the manager's employee_id from their profile
    const { data: profile } = await fastify.supabase
      .from('profiles')
      .select('employee_id')
      .eq('id', req.userId)
      .eq('tenant_id', req.tenantId)
      .single()

    if (!profile?.employee_id) {
      return reply.send({ data: [], total: 0 })
    }

    const { from, to, status: statusFilter } = req.query as { from?: string; to?: string; status?: string }

    // Get direct reports. The org hierarchy is keyed on employees.manager_id /
    // status (see lib/manager-scope.ts) — `reporting_manager_id` and
    // `employment_status` are not columns on employees and silently match nothing.
    const { data: directReports } = await fastify.supabase
      .from('employees')
      .select('id')
      .eq('tenant_id', req.tenantId)
      .eq('manager_id', profile.employee_id)
      .eq('status', 'active')

    if (!directReports || directReports.length === 0) {
      return reply.send({ data: [], total: 0 })
    }

    const reportIds = directReports.map((e: any) => e.id)

    let query = fastify.supabase
      .from('attendance_regularisation')
      .select(`
        id, date, regularization_type, requested_check_in, requested_check_out,
        reason, status, rejection_reason, sla_deadline, sla_breached, created_at, approved_at,
        employees!inner(id, first_name, last_name, employee_code)
      `, { count: 'exact' })
      .eq('tenant_id', req.tenantId)
      .in('employee_id', reportIds)
      .order('created_at', { ascending: false })

    if (statusFilter) query = query.eq('status', statusFilter)
    else query = query.eq('status', 'pending')
    if (from) query = query.gte('date', from)
    if (to)   query = query.lte('date', to)

    const { data, count, error } = await query

    if (error) {
      req.log.error({ err: error }, 'regularisation team-list query failed')
      return reply.code(500).send({ error: 'QUERY_FAILED', message: 'Failed to fetch team requests' })
    }

    const now = new Date()
    const rows = (data ?? []).map((r: any) => {
      const emp = r.employees as { id: string; first_name: string; last_name: string; employee_code: string } | null
      const slaDeadline = r.sla_deadline ? new Date(r.sla_deadline) : null
      const hoursRemaining = slaDeadline ? Math.round((slaDeadline.getTime() - now.getTime()) / 3_600_000) : null
      return {
        id: r.id, date: r.date,
        regularization_type: r.regularization_type,
        requested_check_in:  r.requested_check_in,
        requested_check_out: r.requested_check_out,
        reason: r.reason, status: r.status,
        rejection_reason: r.rejection_reason,
        sla_deadline: r.sla_deadline,
        sla_breached: (r.sla_breached as boolean) || (slaDeadline ? now > slaDeadline : false),
        hours_remaining: hoursRemaining,
        created_at: r.created_at, approved_at: r.approved_at,
        employee_id:   emp?.id ?? null,
        employee_name: emp ? `${emp.first_name} ${emp.last_name}` : null,
        employee_code: emp?.employee_code ?? null,
      }
    })

    return reply.send({ data: rows, total: count ?? 0 })
  })

  // ── POST /attendance/regularisation/bulk-approve ──────────────────────────────
  // Manager bulk approves team requests.
  // P6.5 security fix: every request in the batch must belong to a direct report.
  fastify.post('/attendance/regularisation/bulk-approve', auth, async (req: any, reply) => {
    const schema = z.object({ ids: z.array(z.string().uuid()).min(1).max(50) })
    const parsed = schema.safeParse(req.body)
    if (!parsed.success) return reply.code(400).send({ error: 'VALIDATION_ERROR', message: parsed.error.issues[0]?.message })

    // Direct-report ownership guard — HR admins bypass; managers are scoped.
    if (!isHrAdmin(req.userRole)) {
      const myEmpId = await resolveCallerEmployeeId(fastify.supabase, req.userId, req.tenantId)
      if (!myEmpId) return reply.code(403).send({ error: 'FORBIDDEN', message: 'No employee record linked to your profile' })
      const reportIds = await getDirectReportIds(fastify.supabase, req.tenantId, myEmpId)
      const reportSet = new Set(reportIds)

      const { data: regs } = await fastify.supabase
        .from('attendance_regularisation')
        .select('id, employee_id')
        .in('id', parsed.data.ids)
        .eq('tenant_id', req.tenantId)

      const unauthorized = (regs ?? []).filter((r: any) => !reportSet.has(r.employee_id))
      if (unauthorized.length > 0) {
        return reply.code(403).send({
          error:   'FORBIDDEN',
          message: 'One or more requests do not belong to your direct reports',
          unauthorized_ids: (unauthorized as any[]).map((r: any) => r.id),
        })
      }
    }

    const results: Array<{ id: string; ok: boolean; error?: string }> = []

    for (const id of parsed.data.ids) {
      try {
        const result = await approveRegularisation(fastify.supabase, {
          tenantId:         req.tenantId,
          regularisationId: id,
          ctx: { approverId: req.userId, approverRole: req.userRole, tenantId: req.tenantId },
        })
        if (result.ok) {
          const approved = result.value
          const punchRows: any[] = []
          if (approved.requested_check_in) punchRows.push({ tenant_id: req.tenantId, employee_id: approved.employee_id, punched_at: approved.requested_check_in, direction: 'IN', source: 'regularisation', notes: `Regularisation ${id}` })
          if (approved.requested_check_out) punchRows.push({ tenant_id: req.tenantId, employee_id: approved.employee_id, punched_at: approved.requested_check_out, direction: 'OUT', source: 'regularisation', notes: `Regularisation ${id}` })
          if (punchRows.length > 0) {
            await fastify.supabase.from('attendance_punch_logs').insert(punchRows).then(() => {}, () => {})
          }
          await recomputeRange(fastify.supabase, {
            tenant_id: req.tenantId, employee_id: approved.employee_id,
            from_date: approved.date, to_date: approved.date, changed_by: req.userId,
          }).catch(() => {})
          results.push({ id, ok: true })
        } else {
          results.push({ id, ok: false, error: result.error.message })
        }
      } catch (err: any) {
        results.push({ id, ok: false, error: err?.message ?? 'Unknown error' })
      }
    }

    const approved = results.filter(r => r.ok).length
    const failed   = results.filter(r => !r.ok).length
    return reply.send({ results, summary: { approved, failed, total: parsed.data.ids.length } })
  })

  // ── POST /attendance/regularisation/bulk-reject ───────────────────────────────
  // Manager bulk rejects team requests.
  // P6.5 security fix: every request in the batch must belong to a direct report.
  fastify.post('/attendance/regularisation/bulk-reject', auth, async (req: any, reply) => {
    const schema = z.object({
      ids: z.array(z.string().uuid()).min(1).max(50),
      rejection_reason: z.string().max(500).optional(),
    })
    const parsed = schema.safeParse(req.body)
    if (!parsed.success) return reply.code(400).send({ error: 'VALIDATION_ERROR', message: parsed.error.issues[0]?.message })

    // Direct-report ownership guard — HR admins bypass; managers are scoped.
    if (!isHrAdmin(req.userRole)) {
      const myEmpId = await resolveCallerEmployeeId(fastify.supabase, req.userId, req.tenantId)
      if (!myEmpId) return reply.code(403).send({ error: 'FORBIDDEN', message: 'No employee record linked to your profile' })
      const reportIds = await getDirectReportIds(fastify.supabase, req.tenantId, myEmpId)
      const reportSet = new Set(reportIds)

      const { data: regs } = await fastify.supabase
        .from('attendance_regularisation')
        .select('id, employee_id')
        .in('id', parsed.data.ids)
        .eq('tenant_id', req.tenantId)

      const unauthorized = (regs ?? []).filter((r: any) => !reportSet.has(r.employee_id))
      if (unauthorized.length > 0) {
        return reply.code(403).send({
          error:   'FORBIDDEN',
          message: 'One or more requests do not belong to your direct reports',
          unauthorized_ids: (unauthorized as any[]).map((r: any) => r.id),
        })
      }
    }

    const results: Array<{ id: string; ok: boolean; error?: string }> = []

    for (const id of parsed.data.ids) {
      try {
        const result = await rejectRegularisation(fastify.supabase, {
          tenantId: req.tenantId, regularisationId: id,
          ctx: { approverId: req.userId, approverRole: req.userRole, tenantId: req.tenantId },
          rejectionReason: parsed.data.rejection_reason,
        })
        results.push({ id, ok: result.ok, error: result.ok ? undefined : (result as any).error?.message })
      } catch (err: any) {
        results.push({ id, ok: false, error: err?.message ?? 'Unknown error' })
      }
    }

    const rejected = results.filter(r => r.ok).length
    const failed   = results.filter(r => !r.ok).length
    return reply.send({ results, summary: { rejected, failed, total: parsed.data.ids.length } })
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

    // Workforce orchestrator — fire-and-forget cascade sequencing (attendance → leave → payroll)
    orchestrateWorkforceEvent(fastify.supabase, {
      tenantId:         req.tenantId,
      eventType:        'attendance_corrected',
      sourceEventId:    id,
      employeeId:       approved.employee_id,
      affectedFromDate: approved.date,
      affectedToDate:   approved.date,
      triggeredBy:      req.userId,
      metadata: { regularisation_id: id, approver_id: req.userId },
    }).catch((err) => {
      req.log.warn({ err, regularisationId: id }, 'workforce orchestration failed for regularisation approval')
    })

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

  // ── POST /attendance/regularisation/:id/cancel ───────────────────────────────
  // Employee withdraws their own pending request (sets status = 'withdrawn').
  // Only allowed while status = 'pending'; only the owning employee may cancel.
  fastify.post('/attendance/regularisation/:id/cancel', auth, async (req: any, reply) => {
    const { id } = req.params as { id: string }

    // Resolve employee_id of the caller
    const { data: callerProfile } = await fastify.supabase
      .from('profiles')
      .select('employee_id')
      .eq('id', req.userId)
      .eq('tenant_id', req.tenantId)
      .single()

    if (!callerProfile?.employee_id) {
      return reply.code(400).send({ error: 'NO_EMPLOYEE_LINK', message: 'Profile not linked to an employee record' })
    }

    // Fetch the regularisation to verify ownership + current status
    const { data: reg, error: fetchErr } = await fastify.supabase
      .from('attendance_regularisation')
      .select('id, status, employee_id')
      .eq('id', id)
      .eq('tenant_id', req.tenantId)
      .maybeSingle()

    if (fetchErr || !reg) {
      return reply.code(404).send({ error: 'NOT_FOUND', message: 'Regularisation request not found' })
    }

    if (reg.employee_id !== callerProfile.employee_id) {
      return reply.code(403).send({ error: 'FORBIDDEN', message: 'You can only cancel your own requests' })
    }

    if (reg.status !== 'pending') {
      return reply.code(409).send({
        error:   'INVALID_STATUS_TRANSITION',
        message: `Cannot cancel a request with status '${reg.status}'. Only pending requests can be withdrawn.`,
      })
    }

    const { data: updated, error: updateErr } = await fastify.supabase
      .from('attendance_regularisation')
      .update({ status: 'withdrawn' })
      .eq('id', id)
      .eq('tenant_id', req.tenantId)
      .select('id, status, date')
      .single()

    if (updateErr) {
      req.log.error({ err: updateErr }, 'regularisation cancel failed')
      return reply.code(500).send({ error: 'UPDATE_FAILED', message: 'Failed to cancel request' })
    }

    return reply.send({ message: 'Request withdrawn successfully', data: updated })
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
