/**
 * Leave Requests Routes (manager-approval workflow)
 *
 * POST   /leave-requests                     — employee submits a request
 * GET    /leave-requests                     — list (filtered by status/employee)
 * GET    /leave-requests/:id                 — single request
 * DELETE /leave-requests/:id                 — employee cancels their own PENDING request
 * POST   /leave-requests/:id/approve         — manager or HR approves
 * POST   /leave-requests/:id/reject          — manager or HR rejects
 *
 * GET    /approvals/pending                  — pending items for the logged-in manager
 *
 * Auth: all routes require JWT.  Write routes enforce manager/admin check inside
 *       ApprovalService; list routes are scoped by tenant + optional role filter.
 */
import type { FastifyInstance } from 'fastify'
import { z }                    from 'zod'
import { EventType, MODULE } from '../../platform/events/index.js'
import {
  createLeaveRequest,
  listLeaveRequests,
  getLeaveRequest,
  cancelLeaveRequest,
}                               from '../../lib/leave-request-service.js'
import {
  approveLeaveRequest,
  rejectLeaveRequest,
  reverseApprovedLeaveRequest,
  getPendingApprovalsForManager,
}                               from '../../lib/approval-service.js'

const dateRe = /^\d{4}-\d{2}-\d{2}$/

// Map service error types → HTTP status codes
function errorToHttp(type: string): number {
  switch (type) {
    case 'NOT_FOUND':           return 404
    case 'FORBIDDEN':           return 403
    case 'CONFLICT':            return 409
    case 'INSUFFICIENT_BALANCE': return 422
    case 'VALIDATION_ERROR':    return 400
    default:                    return 500
  }
}

export default async function leaveRequestsRoutes(fastify: FastifyInstance) {
  const auth = { preHandler: [fastify.authenticate] }

  // ── POST /leave-requests ────────────────────────────────────────────────────
  fastify.post('/leave-requests', auth, async (req: any, reply) => {
    const schema = z.object({
      leave_type_id:   z.string().uuid(),
      from_date:       z.string().regex(dateRe, 'from_date must be YYYY-MM-DD'),
      to_date:         z.string().regex(dateRe, 'to_date must be YYYY-MM-DD'),
      reason:          z.string().max(500).optional(),
      /** @deprecated use session instead */
      half_day:        z.boolean().optional(),
      /** Session granularity — defaults to 'full_day' when omitted */
      session:         z.enum(['full_day', 'first_half', 'second_half', 'hourly']).optional(),
      /** Required when session = 'hourly' (supports 0.25 h increments) */
      hours_requested: z.number().positive().max(24).optional(),
      /**
       * Duration-engine v1 session fields.
       * When supplied, these drive the leave-duration-engine calculation and are
       * persisted to start_session / end_session columns.  They allow cross-date
       * half-day requests (e.g. start second_half → end first_half across days).
       */
      start_session:   z.enum(['full_day', 'first_half', 'second_half', 'hourly']).optional(),
      end_session:     z.enum(['full_day', 'first_half', 'second_half', 'hourly']).optional(),
    })

    const parsed = schema.safeParse(req.body)
    if (!parsed.success) {
      return reply.code(400).send({
        error:   'VALIDATION_ERROR',
        message: parsed.error.issues[0]?.message,
      })
    }

    // Resolve employee_id from caller's profile
    const { data: profile } = await fastify.supabase
      .from('profiles')
      .select('employee_id')
      .eq('id', req.userId)
      .eq('tenant_id', req.tenantId)
      .maybeSingle()

    const employeeId = (profile as { employee_id: string | null } | null)?.employee_id
    if (!employeeId) {
      return reply.code(400).send({
        error:   'NO_EMPLOYEE_RECORD',
        message: 'Your profile is not linked to an employee record',
      })
    }

    const result = await createLeaveRequest(fastify.supabase, {
      tenantId:       req.tenantId,
      employeeId,
      leaveTypeId:    parsed.data.leave_type_id,
      fromDate:       parsed.data.from_date,
      toDate:         parsed.data.to_date,
      reason:         parsed.data.reason,
      halfDay:        parsed.data.half_day,
      session:        parsed.data.session,
      hoursRequested: parsed.data.hours_requested,
      requestedBy:    req.userId,
      startSession:   parsed.data.start_session,
      endSession:     parsed.data.end_session,
    })

    if (!result.ok) {
      return reply.code(errorToHttp(result.error.type)).send({
        error:   result.error.type,
        message: result.error.message,
      })
    }

    // Fire-and-forget — never await, never blocks
    fastify.eventPublisher.publish({
      event_type:  EventType.LEAVE_REQUESTED,
      module:      MODULE.LEAVE,
      entity_type: 'leave_request',
      entity_id:   (result.value as any).id,
      org_id:      req.tenantId,
      actor_id:    req.userId,
      actor_type:  'user',
      payload:     { from_date: parsed.data.from_date, to_date: parsed.data.to_date, leave_type_id: parsed.data.leave_type_id },
      correlation_id: req.correlationId ?? undefined,
    })
    return reply.code(201).send({ data: result.value })
  })

  // ── GET /leave-requests ─────────────────────────────────────────────────────
  fastify.get('/leave-requests', auth, async (req: any, reply) => {
    const querySchema = z.object({
      employee_id: z.string().uuid().optional(),
      // Accept both uppercase and lowercase status values
      status:      z.string().optional().transform(s => s ? s.toUpperCase() as 'PENDING' | 'APPROVED' | 'REJECTED' | 'CANCELLED' : undefined),
      from_date:   z.string().regex(dateRe).optional(),
      to_date:     z.string().regex(dateRe).optional(),
      // month=YYYY-MM shorthand — expands to from_date / to_date for the full month
      month:       z.string().regex(/^\d{4}-\d{2}$/).optional(),
      // count_only=true — return { total: N } without rows (for payroll readiness checks)
      count_only:  z.coerce.boolean().optional(),
      limit:       z.coerce.number().int().min(1).max(200).default(50),
      offset:      z.coerce.number().int().min(0).default(0),
    })

    const parsed = querySchema.safeParse(req.query)
    if (!parsed.success) {
      return reply.code(400).send({
        error:   'VALIDATION_ERROR',
        message: parsed.error.issues[0]?.message,
      })
    }

    // Expand month shorthand into from_date / to_date
    if (parsed.data.month && !parsed.data.from_date && !parsed.data.to_date) {
      const [y, m] = parsed.data.month.split('-').map(Number)
      const lastDay = new Date(y, m, 0).getDate()
      ;(parsed.data as any).from_date = `${parsed.data.month}-01`
      ;(parsed.data as any).to_date   = `${parsed.data.month}-${String(lastDay).padStart(2, '0')}`
    }

    // Access rules:
    //   super_admin / hr_admin  → may filter by any employee_id (or see all)
    //   manager                 → may filter by own direct-report employee_ids only
    //   employee                → always scoped to own employee_id, param ignored
    const isHrAdmin = ['super_admin', 'hr_admin'].includes(req.userRole)
    const isManager = req.userRole === 'manager'
    let employeeId  = parsed.data.employee_id

    if (!isHrAdmin) {
      // Resolve caller's own employee_id (always needed for manager + employee paths)
      const { data: callerProfile } = await fastify.supabase
        .from('profiles')
        .select('employee_id')
        .eq('id', req.userId)
        .eq('tenant_id', req.tenantId)
        .maybeSingle()

      const myEmployeeId = (callerProfile as { employee_id: string | null } | null)?.employee_id
      if (!myEmployeeId) return reply.send({ data: [] })

      if (isManager && employeeId && employeeId !== myEmployeeId) {
        // Validate the requested employee is a direct report of this manager
        const { data: reportCheck } = await fastify.supabase
          .from('employees')
          .select('id')
          .eq('id', employeeId)
          .eq('manager_id', myEmployeeId)
          .eq('tenant_id', req.tenantId)
          .maybeSingle()

        if (!reportCheck) {
          return reply.code(403).send({
            error:   'FORBIDDEN',
            message: 'You can only view leave requests for your direct reports',
          })
        }
        // employeeId stays as the validated direct-report id
      } else {
        // Plain employee (or manager not supplying a param) → scope to self
        employeeId = myEmployeeId
      }
    }

    // count_only=true: fast-path — return just the total without fetching rows
    if (parsed.data.count_only) {
      let countQ = fastify.supabase
        .from('leave_requests')
        .select('id', { count: 'exact', head: true })
        .eq('tenant_id', req.tenantId)
      if (employeeId)            countQ = countQ.eq('employee_id', employeeId) as any
      if (parsed.data.status)    countQ = countQ.eq('status', parsed.data.status) as any
      // Mirror listLeaveRequests' date filter exactly — the columns are
      // from_date/to_date (migration 280); start_date/end_date don't exist, so the
      // old filter silently failed and skewed payroll-readiness counts.
      if ((parsed.data as any).from_date) countQ = countQ.gte('from_date', (parsed.data as any).from_date) as any
      if ((parsed.data as any).to_date)   countQ = countQ.lte('to_date',   (parsed.data as any).to_date)   as any
      const { count } = await countQ
      return reply.send({ total: count ?? 0 })
    }

    const result = await listLeaveRequests(fastify.supabase, req.tenantId, {
      employeeId,
      status:    parsed.data.status,
      fromDate:  (parsed.data as any).from_date,
      toDate:    (parsed.data as any).to_date,
      limit:     parsed.data.limit,
      offset:    parsed.data.offset,
    })

    if (!result.ok) {
      return reply.code(500).send({ error: result.error.type, message: result.error.message })
    }

    return reply.send({ data: result.value })
  })

  // ── GET /leave-requests/:id ─────────────────────────────────────────────────
  fastify.get('/leave-requests/:id', auth, async (req: any, reply) => {
    const { id } = req.params as { id: string }
    const result = await getLeaveRequest(fastify.supabase, req.tenantId, id)

    if (!result.ok) {
      return reply.code(errorToHttp(result.error.type)).send({
        error:   result.error.type,
        message: result.error.message,
      })
    }

    return reply.send({ data: result.value })
  })

  // ── DELETE /leave-requests/:id ──────────────────────────────────────────────
  // Employee cancels their own PENDING request
  fastify.delete('/leave-requests/:id', auth, async (req: any, reply) => {
    const { id } = req.params as { id: string }

    const result = await cancelLeaveRequest(
      fastify.supabase,
      req.tenantId,
      id,
      req.userId,
    )

    if (!result.ok) {
      return reply.code(errorToHttp(result.error.type)).send({
        error:   result.error.type,
        message: result.error.message,
      })
    }

    return reply.send({ data: result.value })
  })

  // ── POST /leave-requests/:id/approve ───────────────────────────────────────
  fastify.post('/leave-requests/:id/approve', auth, async (req: any, reply) => {
    const { id } = req.params as { id: string }

    const result = await approveLeaveRequest(fastify.supabase, {
      tenantId:  req.tenantId,
      requestId: id,
      ctx: {
        approverId:   req.userId,
        approverRole: req.userRole,
        tenantId:     req.tenantId,
      },
    })

    if (!result.ok) {
      const extra = result.error.type === 'INSUFFICIENT_BALANCE'
        ? { current_balance: (result.error as { type: string; message: string; currentBalance: number }).currentBalance }
        : {}
      return reply.code(errorToHttp(result.error.type)).send({
        error:   result.error.type,
        message: result.error.message,
        ...extra,
      })
    }

    // Only publish the "approved" event on a true finalization. With a multi-level
    // chain an intermediate approval leaves the request PENDING (advanced a level).
    if (result.value.status === 'APPROVED') {
      // Fire-and-forget — never await, never blocks
      fastify.eventPublisher.publish({
        event_type:  EventType.LEAVE_APPROVED,
        module:      MODULE.LEAVE,
        entity_type: 'leave_request',
        entity_id:   id,
        org_id:      req.tenantId,
        actor_id:    req.userId,
        actor_type:  'user',
        payload:     { approved_by: req.userId },
        correlation_id: req.correlationId ?? undefined,
      })
    }
    return reply.send({ data: result.value })
  })

  // ── POST /leave-requests/:id/cancel-approved ───────────────────────────────
  // Reverse an already-APPROVED request: restores the deducted balance (credit-
  // back ledger row) and reprocesses attendance for the dates. Same approver
  // authorisation as approve (direct manager or HR admin).
  fastify.post('/leave-requests/:id/cancel-approved', auth, async (req: any, reply) => {
    const { id } = req.params as { id: string }

    const result = await reverseApprovedLeaveRequest(fastify.supabase, {
      tenantId:  req.tenantId,
      requestId: id,
      ctx: {
        approverId:   req.userId,
        approverRole: req.userRole,
        tenantId:     req.tenantId,
      },
    })

    if (!result.ok) {
      return reply.code(errorToHttp(result.error.type)).send({
        error:   result.error.type,
        message: result.error.message,
      })
    }

    fastify.eventPublisher.publish({
      event_type:  EventType.LEAVE_CANCELLED,
      module:      MODULE.LEAVE,
      entity_type: 'leave_request',
      entity_id:   id,
      org_id:      req.tenantId,
      actor_id:    req.userId,
      actor_type:  'user',
      payload:     { reversed_by: req.userId },
      correlation_id: req.correlationId ?? undefined,
    })
    return reply.send({ data: result.value })
  })

  // ── POST /leave-requests/:id/reject ────────────────────────────────────────
  fastify.post('/leave-requests/:id/reject', auth, async (req: any, reply) => {
    const { id } = req.params as { id: string }

    const schema = z.object({
      rejection_reason: z.string().max(500).optional(),
    })
    const parsed = schema.safeParse(req.body)
    if (!parsed.success) {
      return reply.code(400).send({
        error:   'VALIDATION_ERROR',
        message: parsed.error.issues[0]?.message,
      })
    }

    const result = await rejectLeaveRequest(fastify.supabase, {
      tenantId:        req.tenantId,
      requestId:       id,
      ctx: {
        approverId:   req.userId,
        approverRole: req.userRole,
        tenantId:     req.tenantId,
      },
      rejectionReason: parsed.data.rejection_reason,
    })

    if (!result.ok) {
      return reply.code(errorToHttp(result.error.type)).send({
        error:   result.error.type,
        message: result.error.message,
      })
    }

    return reply.send({ data: result.value })
  })

  // ── GET /approvals/pending?page=1&limit=20 ─────────────────────────────────
  // Returns paginated PENDING items (leave requests + regularisations).
  // HR admins see ALL tenant-wide items; managers see only direct-reports'.
  //
  // Query params:
  //   page  — 1-based page number (default 1)
  //   limit — items per page per type (default 20, max 100)
  //
  // Response:
  //   { leave_requests, regularisations, pagination: { page, limit, leave_total, reg_total } }
  fastify.get('/approvals/pending', auth, async (req: any, reply) => {
    // ── Parse pagination params ────────────────────────────────────────────────
    const paginationSchema = z.object({
      page:  z.coerce.number().int().min(1).default(1),
      limit: z.coerce.number().int().min(1).max(100).default(20),
    })
    const parsedPagination = paginationSchema.safeParse(req.query)
    if (!parsedPagination.success) {
      return reply.code(400).send({
        error:   'VALIDATION_ERROR',
        message: parsedPagination.error.issues[0]?.message,
      })
    }
    const { page, limit } = parsedPagination.data
    const offset = (page - 1) * limit

    const isHrAdmin = ['super_admin', 'hr_admin'].includes(req.userRole)

    // Resolve caller's employee_id (needed for manager path + profile lookup)
    const { data: profile } = await fastify.supabase
      .from('profiles')
      .select('employee_id')
      .eq('id', req.userId)
      .eq('tenant_id', req.tenantId)
      .maybeSingle()

    const callerEmployeeId = (profile as { employee_id: string | null } | null)?.employee_id

    if (isHrAdmin) {
      // ── HR admin: all tenant-wide pending, paginated per type ────────────────
      const [leaveResult, regResult] = await Promise.all([
        fastify.supabase
          .from('leave_requests')
          .select(`
            id, from_date, to_date, computed_days, half_day, session, hours_requested,
            reason, status, created_at,
            leave_types(id, name, is_paid),
            employees!inner(id, first_name, last_name, employee_code)
          `, { count: 'exact' })
          .eq('tenant_id', req.tenantId)
          .eq('status', 'PENDING')
          .order('created_at', { ascending: false })
          .range(offset, offset + limit - 1),

        fastify.supabase
          .from('attendance_regularisation')
          .select(`
            id, date, requested_check_in, requested_check_out, reason, status, created_at,
            employees!inner(id, first_name, last_name, employee_code)
          `, { count: 'exact' })
          .eq('tenant_id', req.tenantId)
          .eq('status', 'pending')
          .order('created_at', { ascending: false })
          .range(offset, offset + limit - 1),
      ])

      return reply.send({
        leave_requests:  leaveResult.data  ?? [],
        regularisations: regResult.data    ?? [],
        pagination: {
          page,
          limit,
          leave_total: leaveResult.count  ?? 0,
          reg_total:   regResult.count    ?? 0,
        },
      })
    }

    // ── Manager: only direct-reports' pending ────────────────────────────────
    if (!callerEmployeeId) {
      return reply.send({
        leave_requests:  [],
        regularisations: [],
        pagination: { page, limit, leave_total: 0, reg_total: 0 },
      })
    }

    const pending = await getPendingApprovalsForManager(
      fastify.supabase,
      req.tenantId,
      callerEmployeeId,
      page,
      limit,
    )

    return reply.send({
      leave_requests:  pending.leaveRequests,
      regularisations: pending.regularisations,
      pagination: {
        page,
        limit,
        leave_total: pending.leaveTotal,
        reg_total:   pending.regTotal,
      },
    })
  })
}
