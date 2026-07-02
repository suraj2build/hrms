/**
 * Attendance Correction Requests
 *
 * Thin controller layer — validation, authorisation, and HTTP response.
 * All recompute logic lives in services/attendance/correction-processor.ts.
 *
 * Routes:
 *   POST   /attendance/corrections                          — submit (employee or admin on behalf)
 *   GET    /attendance/corrections/my                       — own requests (employee)
 *   GET    /attendance/corrections                          — all (admin / manager-scoped)
 *   GET    /attendance/corrections/operations/stale         — stale processing rows (HR only)
 *   POST   /attendance/corrections/:id/approve              — approve → processing → applied/failed
 *   POST   /attendance/corrections/:id/retry               — re-run failed recompute (HR only)
 *   POST   /attendance/corrections/:id/reject               — reject
 *
 * ── Status lifecycle ──────────────────────────────────────────────────────────
 *   pending    → processing   (on approval)
 *   processing → applied      (recompute succeeded)
 *   processing → failed       (recompute error — retryable up to MAX_RETRY_COUNT)
 *   pending    → rejected     (declined, terminal)
 *   failed     → processing   (HR retry)
 */

import type { FastifyInstance }         from 'fastify'
import { z }                            from 'zod'
import {
  processAttendanceCorrection,
  recoverStaleCorrectionProcessing,
  MAX_RETRY_COUNT,
  STALE_THRESHOLD_MS,
  type PunchRow,
}                                       from '../../services/attendance/correction-processor.js'
import { logAction }                    from '../../lib/audit-service.js'
import { eventBus }                     from '../../lib/event-bus.js'
import { orchestrateWorkforceEvent }    from '../../lib/workforce-orchestrator.js'
import { isMonthLocked, monthOf }       from '../../lib/period-lock.js'

import { HR_ADMIN_ROLES } from '../../lib/rbac.js'
const dateRe      = /^\d{4}-\d{2}-\d{2}$/
const ALLOW_ROLES = [...HR_ADMIN_ROLES, 'manager']

// All valid statuses — kept in one place so Zod enums stay in sync
type CorrectionStatus = 'pending' | 'processing' | 'applied' | 'failed' | 'rejected'
const ALL_STATUSES    = ['pending', 'processing', 'applied', 'failed', 'rejected'] as const

export default async function attendanceCorrectionsRoute(fastify: FastifyInstance) {
  const auth = { preHandler: [fastify.authenticate] }

  // ── Helper: resolve caller's employee_id from their profile ─────────────────
  async function resolveEmployeeId(userId: string, tenantId: string): Promise<string | null> {
    const { data } = await fastify.supabase
      .from('profiles')
      .select('employee_id')
      .eq('id', userId)
      .eq('tenant_id', tenantId)
      .maybeSingle()
    return (data as { employee_id: string | null } | null)?.employee_id ?? null
  }

  // ── Helper: authorise approver (admin OR direct manager) ───────────────────
  // Checks job_history.manager_id first (current job record) then falls back
  // to employees.manager_id for legacy denormalised data.
  async function authoriseApprover(
    approverId:   string,
    approverRole: string,
    tenantId:     string,
    employeeId:   string,
  ): Promise<{ ok: true } | { ok: false; code: number; error: string; message: string }> {
    if ((HR_ADMIN_ROLES as readonly string[]).includes(approverRole)) return { ok: true }

    const approverEmpId = await resolveEmployeeId(approverId, tenantId)
    if (!approverEmpId) {
      return { ok: false, code: 403, error: 'FORBIDDEN', message: 'Approver has no linked employee record' }
    }

    // Primary check: current job_history row (most accurate)
    const { data: jobRow } = await fastify.supabase
      .from('job_history')
      .select('manager_id')
      .eq('employee_id', employeeId)
      .eq('tenant_id', tenantId)
      .eq('is_current', true)
      .maybeSingle()

    const jobManagerId = (jobRow as { manager_id: string | null } | null)?.manager_id ?? null
    if (jobManagerId === approverEmpId) return { ok: true }

    // Fallback: employees.manager_id (legacy / denormalised)
    const { data: emp } = await fastify.supabase
      .from('employees')
      .select('manager_id')
      .eq('id', employeeId)
      .eq('tenant_id', tenantId)
      .maybeSingle()

    if ((emp as { manager_id: string | null } | null)?.manager_id === approverEmpId) {
      return { ok: true }
    }

    return {
      ok:      false,
      code:    403,
      error:   'FORBIDDEN',
      message: 'Only the direct manager or HR admin may approve this correction',
    }
  }

  // ── Helper: build punch rows from correction data ───────────────────────────
  function buildPunchRows(
    correctionId: string,
    actorId:      string,
    tenantId:     string,
    employeeId:   string,
    correctedIn:  string | null,
    correctedOut: string | null,
    verb:         string,   // e.g. 'approved' | 'retry'
  ): PunchRow[] {
    const rows: PunchRow[] = []
    const notePrefix = `Correction ${correctionId} ${verb} by ${actorId}`

    if (correctedIn) {
      rows.push({
        tenant_id:   tenantId,
        employee_id: employeeId,
        punched_at:  correctedIn,
        direction:   'IN',
        source:      'manual',
        notes:       notePrefix,
      })
    }
    if (correctedOut) {
      rows.push({
        tenant_id:   tenantId,
        employee_id: employeeId,
        punched_at:  correctedOut,
        direction:   'OUT',
        source:      'manual',
        notes:       notePrefix,
      })
    }
    return rows
  }

  // ── Helper: fire-and-forget recompute via service ──────────────────────────
  // Schedules the async worker after the HTTP response is sent.
  // Any unexpected top-level error (should never happen) is caught and logged.
  function scheduleRecompute(opts: {
    correctionId: string; tenantId: string; actorUserId: string
    trigger: 'approval' | 'retry'; employeeId: string; date: string
    punchRows: PunchRow[]
  }) {
    setImmediate(() => {
      processAttendanceCorrection({
        ...opts,
        supabase: fastify.supabase,
        log:      fastify.log as any,
      }).catch((unexpectedErr: unknown) => {
        fastify.log.error(
          { err: unexpectedErr, correction_id: opts.correctionId },
          'corrections: unexpected uncaught error from processAttendanceCorrection',
        )
      })
    })
  }

  // ── Helper: non-fatal audit write ─────────────────────────────────────────
  function auditLog(
    tenantId:    string,
    recordId:    string,
    action:      'INSERT' | 'UPDATE',
    performedBy: string | null,
    newData:     Record<string, unknown>,
  ) {
    logAction(fastify.supabase, {
      tenantId,
      tableName:   'attendance_corrections',
      recordId,
      action,
      performedBy,
      newData,
    }).catch((err: unknown) => {
      fastify.log.warn(
        { err, record_id: recordId },
        'corrections: audit_log insert failed (non-fatal)',
      )
    })
  }

  // ──────────────────────────────────────────────────────────────────────────
  // POST /attendance/corrections — submit
  // ──────────────────────────────────────────────────────────────────────────
  fastify.post('/attendance/corrections', auth, async (req: any, reply) => {
    const schema = z.object({
      /**
       * HR admin override: submit on behalf of another employee.
       * Silently ignored for non-HR roles.
       */
      employee_id:   z.string().uuid().optional(),
      date:          z.string().regex(dateRe),
      corrected_in:  z.string().datetime({ offset: true }).nullable().optional(),
      corrected_out: z.string().datetime({ offset: true }).nullable().optional(),
      reason:        z.string().min(1).max(1000),
    })

    const parsed = schema.safeParse(req.body)
    if (!parsed.success) {
      return reply.code(400).send({ error: 'VALIDATION_ERROR', message: parsed.error.issues[0]?.message })
    }

    // ── Ownership resolution ──────────────────────────────────────────────
    // HR admins may submit on behalf of any employee in their tenant.
    // All other roles use their own linked employee_id.
    let employeeId: string

    if (HR_ADMIN_ROLES.includes(req.userRole) && parsed.data.employee_id) {
      const { data: empRow } = await fastify.supabase
        .from('employees')
        .select('id')
        .eq('id', parsed.data.employee_id)
        .eq('tenant_id', req.tenantId)
        .maybeSingle()

      if (!empRow) {
        return reply.code(400).send({
          error:   'NOT_FOUND',
          message: 'Employee not found in your organisation',
        })
      }
      employeeId = parsed.data.employee_id
    } else {
      const resolved = await resolveEmployeeId(req.userId, req.tenantId)
      if (!resolved) {
        return reply.code(400).send({
          error:   'NO_EMPLOYEE_LINK',
          message: 'Your profile is not linked to an employee record',
        })
      }
      employeeId = resolved
    }

    // Prevent duplicate pending corrections for the same date
    const { count } = await fastify.supabase
      .from('attendance_corrections')
      .select('id', { count: 'exact', head: true })
      .eq('tenant_id', req.tenantId)
      .eq('employee_id', employeeId)
      .eq('date', parsed.data.date)
      .eq('status', 'pending')

    if ((count ?? 0) > 0) {
      return reply.code(409).send({
        error:   'CONFLICT',
        message: 'A pending correction already exists for this date. Please wait for it to be processed.',
      })
    }

    const { data, error } = await fastify.supabase
      .from('attendance_corrections')
      .insert({
        tenant_id:     req.tenantId,
        employee_id:   employeeId,
        date:          parsed.data.date,
        corrected_in:  parsed.data.corrected_in  ?? null,
        corrected_out: parsed.data.corrected_out ?? null,
        reason:        parsed.data.reason,
        submitted_by:  req.userId,
      })
      .select('id, date, status, corrected_in, corrected_out, reason, created_at')
      .single()

    if (error) {
      return reply.code(500).send({ error: 'INSERT_FAILED', message: 'Failed to submit correction request' })
    }

    auditLog(req.tenantId, (data as { id: string }).id, 'INSERT', req.userId, {
      event:             'correction.submitted',
      employee_id:       employeeId,
      date:              parsed.data.date,
      submitted_by_role: req.userRole,
      on_behalf: HR_ADMIN_ROLES.includes(req.userRole) && parsed.data.employee_id
        ? parsed.data.employee_id
        : null,
    })

    return reply.code(201).send({ data })
  })

  // ──────────────────────────────────────────────────────────────────────────
  // GET /attendance/corrections/my — employee's own requests
  // ──────────────────────────────────────────────────────────────────────────
  fastify.get('/attendance/corrections/my', auth, async (req: any, reply) => {
    const querySchema = z.object({
      status: z.enum(ALL_STATUSES).optional(),
      limit:  z.coerce.number().int().min(1).max(100).default(50),
      offset: z.coerce.number().int().min(0).default(0),
    })

    const parsed = querySchema.safeParse(req.query)
    if (!parsed.success) {
      return reply.code(400).send({ error: 'VALIDATION_ERROR', message: parsed.error.issues[0]?.message })
    }

    const employeeId = await resolveEmployeeId(req.userId, req.tenantId)
    if (!employeeId) return reply.send({ data: [], total: 0 })

    let q = fastify.supabase
      .from('attendance_corrections')
      .select(
        'id, date, corrected_in, corrected_out, reason, status,' +
        ' rejection_reason, failure_reason, retry_count,' +
        ' created_at, approved_at, applied_at, processing_started_at',
        { count: 'exact' },
      )
      .eq('tenant_id', req.tenantId)
      .eq('employee_id', employeeId)
      .order('created_at', { ascending: false })
      .range(parsed.data.offset, parsed.data.offset + parsed.data.limit - 1)

    if (parsed.data.status) q = q.eq('status', parsed.data.status)

    const { data, error, count } = await q
    if (error) return reply.code(500).send({ error: 'QUERY_FAILED', message: 'Failed to fetch corrections' })
    return reply.send({ data: data ?? [], total: count ?? 0 })
  })

  // ──────────────────────────────────────────────────────────────────────────
  // GET /attendance/corrections/operations/stale   — Step 5
  //
  // HR admin / super_admin only.
  // Returns corrections stuck in 'processing' longer than STALE_THRESHOLD_MS.
  // Also triggers recovery (marks them failed) as a side-effect so the endpoint
  // is self-healing: call it to both observe and recover stale rows.
  // ──────────────────────────────────────────────────────────────────────────
  fastify.get('/attendance/corrections/operations/stale', auth, async (req: any, reply) => {
    if (!HR_ADMIN_ROLES.includes(req.userRole)) {
      return reply.code(403).send({ error: 'FORBIDDEN', message: 'HR admin access required' })
    }

    const cutoff = new Date(Date.now() - STALE_THRESHOLD_MS).toISOString()

    // Fetch rows still in processing that started before the cutoff
    const { data: staleRows, error: fetchErr } = await fastify.supabase
      .from('attendance_corrections')
      .select(`
        id, date, processing_started_at, retry_count,
        employees!inner(id, first_name, last_name, employee_code)
      `)
      .eq('tenant_id', req.tenantId)
      .eq('status', 'processing')
      .lt('processing_started_at', cutoff)
      .order('processing_started_at', { ascending: true })

    if (fetchErr) {
      return reply.code(500).send({ error: 'QUERY_FAILED', message: 'Failed to query stale corrections' })
    }

    const now = Date.now()

    const rows = ((staleRows ?? []) as unknown as Array<{
      id:                    string
      date:                  string
      processing_started_at: string
      retry_count:           number
      employees:             { id: string; first_name: string; last_name: string; employee_code: string } | null
    }>).map((r) => ({
      id:                      r.id,
      date:                    r.date,
      processing_started_at:   r.processing_started_at,
      processing_duration_min: parseFloat(
        ((now - new Date(r.processing_started_at).getTime()) / 60_000).toFixed(1),
      ),
      retry_count:             r.retry_count,
      employee_id:             r.employees?.id             ?? null,
      employee_name:           r.employees
        ? `${r.employees.first_name} ${r.employees.last_name}`.trim()
        : null,
      employee_code:           r.employees?.employee_code  ?? null,
    }))

    // Self-healing: if any stale rows exist, trigger recovery asynchronously
    if (rows.length > 0) {
      setImmediate(() => {
        recoverStaleCorrectionProcessing(
          fastify.supabase,
          req.tenantId,
          fastify.log as any,
        ).catch((err: unknown) => {
          fastify.log.error(
            { err, tenant_id: req.tenantId },
            'corrections: stale recovery failed',
          )
        })
      })
    }

    return reply.send({
      data:              rows,
      total:             rows.length,
      stale_threshold_minutes: Math.round(STALE_THRESHOLD_MS / 60_000),
    })
  })

  // ──────────────────────────────────────────────────────────────────────────
  // GET /attendance/corrections — admin / manager view
  // ──────────────────────────────────────────────────────────────────────────
  fastify.get('/attendance/corrections', auth, async (req: any, reply) => {
    if (!ALLOW_ROLES.includes(req.userRole)) {
      return reply.code(403).send({ error: 'FORBIDDEN', message: 'Manager or HR access required' })
    }

    const querySchema = z.object({
      status:      z.enum(ALL_STATUSES).optional(),
      employee_id: z.string().uuid().optional(),
      date:        z.string().regex(dateRe).optional(),
      limit:       z.coerce.number().int().min(1).max(200).default(50),
      offset:      z.coerce.number().int().min(0).default(0),
    })

    const parsed = querySchema.safeParse(req.query)
    if (!parsed.success) {
      return reply.code(400).send({ error: 'VALIDATION_ERROR', message: parsed.error.issues[0]?.message })
    }

    // Manager scope: only direct reports
    let employeeFilter: string[] | null = null
    if (!HR_ADMIN_ROLES.includes(req.userRole)) {
      const myEmpId = await resolveEmployeeId(req.userId, req.tenantId)
      if (!myEmpId) return reply.send({ data: [], total: 0 })

      const { data: reports } = await fastify.supabase
        .from('employees')
        .select('id')
        .eq('tenant_id', req.tenantId)
        .eq('manager_id', myEmpId)

      employeeFilter = (reports ?? []).map((e: { id: string }) => e.id)
      if (!employeeFilter.length) return reply.send({ data: [], total: 0 })
    }

    let q = fastify.supabase
      .from('attendance_corrections')
      .select(`
        id, date, corrected_in, corrected_out, reason, status,
        rejection_reason, failure_reason, retry_count,
        created_at, approved_at, applied_at, processing_started_at,
        employees!inner(id, first_name, last_name, employee_code)
      `, { count: 'exact' })
      .eq('tenant_id', req.tenantId)
      .order('created_at', { ascending: false })
      .range(parsed.data.offset, parsed.data.offset + parsed.data.limit - 1)

    if (parsed.data.status)      q = q.eq('status', parsed.data.status)
    if (parsed.data.employee_id) q = q.eq('employee_id', parsed.data.employee_id)
    if (parsed.data.date)        q = q.eq('date', parsed.data.date)
    if (employeeFilter)          q = q.in('employee_id', employeeFilter)

    const { data, error, count } = await q
    if (error) return reply.code(500).send({ error: 'QUERY_FAILED', message: 'Failed to fetch corrections' })

    // Flatten nested employee join so consumers get flat employee_name / employee_code
    const rows = (data ?? []).map((r: any) => {
      const emp = Array.isArray(r.employees) ? r.employees[0] : r.employees
      return {
        id:                     r.id,
        date:                   r.date,
        corrected_in:           r.corrected_in,
        corrected_out:          r.corrected_out,
        reason:                 r.reason,
        status:                 r.status,
        rejection_reason:       r.rejection_reason,
        failure_reason:         r.failure_reason,
        retry_count:            r.retry_count,
        created_at:             r.created_at,
        approved_at:            r.approved_at,
        applied_at:             r.applied_at,
        processing_started_at:  r.processing_started_at,
        employee_id:            emp?.id           ?? null,
        employee_name:          emp ? `${emp.first_name} ${emp.last_name}` : null,
        employee_code:          emp?.employee_code ?? null,
      }
    })

    return reply.send({ data: rows, total: count ?? 0 })
  })

  // ──────────────────────────────────────────────────────────────────────────
  // POST /attendance/corrections/:id/approve
  // ──────────────────────────────────────────────────────────────────────────
  fastify.post('/attendance/corrections/:id/approve', auth, async (req: any, reply) => {
    if (!ALLOW_ROLES.includes(req.userRole)) {
      return reply.code(403).send({ error: 'FORBIDDEN', message: 'Manager or HR access required' })
    }

    const { id } = req.params as { id: string }

    const { data: correction, error: fetchErr } = await fastify.supabase
      .from('attendance_corrections')
      .select('id, status, employee_id, date, corrected_in, corrected_out')
      .eq('id', id)
      .eq('tenant_id', req.tenantId)
      .maybeSingle()

    if (fetchErr || !correction) {
      return reply.code(404).send({ error: 'NOT_FOUND', message: 'Correction request not found' })
    }

    const c = correction as {
      id: string; status: CorrectionStatus; employee_id: string; date: string
      corrected_in: string | null; corrected_out: string | null
    }

    if (c.status === 'processing') {
      return reply.code(409).send({
        error:   'CONFLICT',
        message: 'This correction is already being processed. Please wait for it to complete.',
      })
    }
    if (c.status !== 'pending') {
      return reply.code(409).send({ error: 'CONFLICT', message: `Correction is already ${c.status}` })
    }

    // Period protection — approving a correction inserts punches and recomputes
    // attendance_daily for c.date, bypassing the route-level period guards. If the
    // month is locked/finalized for payroll, that would silently rewrite sealed
    // attendance. Block it here (and again in the async worker as defence-in-depth).
    if (await isMonthLocked(fastify.supabase, req.tenantId, monthOf(c.date))) {
      return reply.code(409).send({
        error:   'PERIOD_LOCKED',
        message: `Attendance period ${monthOf(c.date)} is locked for payroll — corrections cannot be applied to it.`,
      })
    }

    const authResult = await authoriseApprover(req.userId, req.userRole, req.tenantId, c.employee_id)
    if (!authResult.ok) {
      return reply.code(authResult.code).send({ error: authResult.error, message: authResult.message })
    }

    // ── Atomically advance to 'processing' ───────────────────────────────
    // approved_by / approved_at are set here and MUST NOT be overwritten by
    // any subsequent failure or retry — they represent the immutable approval
    // record regardless of how many recompute attempts follow. The status='pending'
    // guard makes this a compare-and-swap so two concurrent approvals can't both
    // dispatch the worker.
    const now = new Date().toISOString()
    const { data: claimed, error: updateErr } = await fastify.supabase
      .from('attendance_corrections')
      .update({
        status:                'processing',
        approved_by:           req.userId,
        approved_at:           now,
        processing_started_at: now,
      })
      .eq('id', id)
      .eq('tenant_id', req.tenantId)
      .eq('status', 'pending')
      .select('id')
      .maybeSingle()

    if (updateErr) {
      return reply.code(500).send({ error: 'UPDATE_FAILED', message: 'Failed to approve correction' })
    }
    if (!claimed) {
      return reply.code(409).send({
        error:   'CONFLICT',
        message: 'This correction was already picked up by another approval.',
      })
    }

    auditLog(req.tenantId, id, 'UPDATE', req.userId, {
      event:                 'correction.processing_started',
      employee_id:           c.employee_id,
      date:                  c.date,
      approved_by:           req.userId,
      approved_at:           now,
      processing_started_at: now,
    })

    scheduleRecompute({
      correctionId:  id,
      tenantId:      req.tenantId,
      actorUserId:   req.userId,
      trigger:       'approval',
      employeeId:    c.employee_id,
      date:          c.date,
      punchRows:     buildPunchRows(id, req.userId, req.tenantId, c.employee_id, c.corrected_in, c.corrected_out, 'approved'),
    })

    // In-process event bus — drives SLA resolution, notification triggers
    eventBus.emit({
      type:          'correction.approved',
      tenantId:      req.tenantId,
      correlationId: req.correlationId,
      payload: {
        tenantId:     req.tenantId,
        employeeId:   c.employee_id,
        correctionId: id,
        approverId:   req.userId,
        date:         c.date,
      },
    })

    // Workforce orchestrator — fire-and-forget cascade sequencing (attendance → leave → payroll)
    orchestrateWorkforceEvent(fastify.supabase, {
      tenantId:         req.tenantId,
      eventType:        'attendance_corrected',
      sourceEventId:    id,
      employeeId:       c.employee_id,
      affectedFromDate: c.date,
      affectedToDate:   c.date,
      triggeredBy:      req.userId,
      metadata: { correction_id: id, approver_id: req.userId },
    }).catch((err) => {
      req.log.warn({ err, correctionId: id }, 'workforce orchestration failed for correction approval')
    })

    return reply.send({ data: { id, status: 'processing', approved_at: now } })
  })

  // ──────────────────────────────────────────────────────────────────────────
  // POST /attendance/corrections/:id/retry   — Step 7 safeguards applied
  //
  // HR admin / super_admin only.
  // Re-runs the recompute for a failed correction without requiring re-approval.
  // approved_by / approved_at remain immutable throughout all retry cycles.
  // ──────────────────────────────────────────────────────────────────────────
  fastify.post('/attendance/corrections/:id/retry', auth, async (req: any, reply) => {
    if (!HR_ADMIN_ROLES.includes(req.userRole)) {
      return reply.code(403).send({
        error:   'FORBIDDEN',
        message: 'Only HR admins and super admins can retry failed corrections',
      })
    }

    const { id } = req.params as { id: string }

    const { data: correction, error: fetchErr } = await fastify.supabase
      .from('attendance_corrections')
      .select('id, status, employee_id, date, corrected_in, corrected_out, retry_count')
      .eq('id', id)
      .eq('tenant_id', req.tenantId)
      .maybeSingle()

    if (fetchErr || !correction) {
      return reply.code(404).send({ error: 'NOT_FOUND', message: 'Correction request not found' })
    }

    const c = correction as {
      id: string; status: CorrectionStatus; employee_id: string; date: string
      corrected_in: string | null; corrected_out: string | null
      retry_count: number
    }

    // ── Step 7 safeguard 2: already processing ────────────────────────────
    if (c.status === 'processing') {
      return reply.code(409).send({
        error:   'CONFLICT',
        message: 'This correction is already being processed. Please wait for it to complete.',
      })
    }

    // ── Step 7 safeguard 3: already applied ───────────────────────────────
    if (c.status === 'applied') {
      return reply.code(409).send({
        error:   'CONFLICT',
        message: 'This correction has already been applied to attendance.',
      })
    }

    // Only failed corrections can be retried
    if (c.status !== 'failed') {
      return reply.code(409).send({
        error:   'CONFLICT',
        message: `Only failed corrections can be retried. Current status: ${c.status}`,
      })
    }

    // Period protection — a retry re-applies the correction (punches + recompute)
    // for c.date. Refuse if the month has since been locked/finalized for payroll.
    if (await isMonthLocked(fastify.supabase, req.tenantId, monthOf(c.date))) {
      return reply.code(409).send({
        error:   'PERIOD_LOCKED',
        message: `Attendance period ${monthOf(c.date)} is locked for payroll — corrections cannot be applied to it.`,
      })
    }

    // ── Step 7 safeguard 1: max retry limit ───────────────────────────────
    // retry_count is incremented by the processor on each failure, so it
    // reflects how many times the recompute has been attempted total.
    if (c.retry_count >= MAX_RETRY_COUNT) {
      return reply.code(409).send({
        error:   'RETRY_LIMIT_EXCEEDED',
        message: `This correction has reached the maximum of ${MAX_RETRY_COUNT} retry attempts. `
               + 'Please investigate the failure_reason and contact support if the issue persists.',
        retry_count: c.retry_count,
        max_retries: MAX_RETRY_COUNT,
      })
    }

    // ── Reset to processing (approved_by / approved_at intentionally NOT touched) ──
    const now = new Date().toISOString()
    const { error: updateErr } = await fastify.supabase
      .from('attendance_corrections')
      .update({
        status:                'processing',
        processing_started_at: now,
        failure_reason:        null,   // cleared — re-set if this retry also fails
      })
      .eq('id', id)
      .eq('tenant_id', req.tenantId)

    if (updateErr) {
      return reply.code(500).send({ error: 'UPDATE_FAILED', message: 'Failed to initiate retry' })
    }

    // ── Step 8: structured log — retry requested ──────────────────────────
    fastify.log.info(
      {
        event:                'attendance_correction_retry_requested',
        correction_id:        id,
        tenant_id:            req.tenantId,
        employee_id:          c.employee_id,
        retry_count:          c.retry_count,   // count BEFORE this retry
        requested_by:         req.userId,
      },
      'corrections: retry requested by HR',
    )

    auditLog(req.tenantId, id, 'UPDATE', req.userId, {
      event:                 'correction.retry_requested',
      employee_id:           c.employee_id,
      date:                  c.date,
      requested_by:          req.userId,
      retry_count_before:    c.retry_count,
      processing_started_at: now,
    })

    scheduleRecompute({
      correctionId:  id,
      tenantId:      req.tenantId,
      actorUserId:   req.userId,
      trigger:       'retry',
      employeeId:    c.employee_id,
      date:          c.date,
      punchRows:     buildPunchRows(id, req.userId, req.tenantId, c.employee_id, c.corrected_in, c.corrected_out, 'retry'),
    })

    return reply.send({
      data: {
        id,
        status:                'processing',
        processing_started_at: now,
        retry_count:           c.retry_count,
      },
    })
  })

  // ──────────────────────────────────────────────────────────────────────────
  // POST /attendance/corrections/:id/reject
  // ──────────────────────────────────────────────────────────────────────────
  fastify.post('/attendance/corrections/:id/reject', auth, async (req: any, reply) => {
    if (!ALLOW_ROLES.includes(req.userRole)) {
      return reply.code(403).send({ error: 'FORBIDDEN', message: 'Manager or HR access required' })
    }

    const { id } = req.params as { id: string }

    const rejectSchema = z.object({
      rejection_reason: z.string().max(500).optional(),
    })
    const parsed          = rejectSchema.safeParse(req.body ?? {})
    const rejectionReason = parsed.success ? (parsed.data.rejection_reason ?? null) : null

    const { data: correction, error: fetchErr } = await fastify.supabase
      .from('attendance_corrections')
      .select('id, status, employee_id, date')
      .eq('id', id)
      .eq('tenant_id', req.tenantId)
      .maybeSingle()

    if (fetchErr || !correction) {
      return reply.code(404).send({ error: 'NOT_FOUND', message: 'Correction request not found' })
    }

    const c = correction as { id: string; status: CorrectionStatus; employee_id: string; date: string }

    if (c.status !== 'pending') {
      return reply.code(409).send({ error: 'CONFLICT', message: `Correction is already ${c.status}` })
    }

    const authResult = await authoriseApprover(req.userId, req.userRole, req.tenantId, c.employee_id)
    if (!authResult.ok) {
      return reply.code(authResult.code).send({ error: authResult.error, message: authResult.message })
    }

    const { error: updateErr } = await fastify.supabase
      .from('attendance_corrections')
      .update({ status: 'rejected', rejection_reason: rejectionReason })
      .eq('id', id)
      .eq('tenant_id', req.tenantId)

    if (updateErr) {
      return reply.code(500).send({ error: 'UPDATE_FAILED', message: 'Failed to reject correction' })
    }

    auditLog(req.tenantId, id, 'UPDATE', req.userId, {
      event:            'correction.rejected',
      employee_id:      c.employee_id,
      date:             c.date,
      rejected_by:      req.userId,
      rejection_reason: rejectionReason,
    })

    // In-process event bus
    eventBus.emit({
      type:          'correction.rejected',
      tenantId:      req.tenantId,
      correlationId: req.correlationId,
      payload: {
        tenantId:     req.tenantId,
        employeeId:   c.employee_id,
        correctionId: id,
        approverId:   req.userId,
        reason:       rejectionReason ?? undefined,
      },
    })

    return reply.send({ data: { id, status: 'rejected' } })
  })
}
