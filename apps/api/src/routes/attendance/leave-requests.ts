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
import {
  createLeaveRequest,
  listLeaveRequests,
  getLeaveRequest,
  cancelLeaveRequest,
}                               from '../../lib/leave-request-service.js'
import {
  approveLeaveRequest,
  rejectLeaveRequest,
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
    })

    if (!result.ok) {
      return reply.code(errorToHttp(result.error.type)).send({
        error:   result.error.type,
        message: result.error.message,
      })
    }

    return reply.code(201).send({ data: result.value })
  })

  // ── GET /leave-requests ─────────────────────────────────────────────────────
  fastify.get('/leave-requests', auth, async (req: any, reply) => {
    const querySchema = z.object({
      employee_id: z.string().uuid().optional(),
      status:      z.enum(['PENDING', 'APPROVED', 'REJECTED', 'CANCELLED']).optional(),
      from_date:   z.string().regex(dateRe).optional(),
      to_date:     z.string().regex(dateRe).optional(),
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

    // Non-admins may only list their own requests
    const isAdmin = ['super_admin', 'hr_admin', 'manager'].includes(req.userRole)
    let employeeId = parsed.data.employee_id

    if (!isAdmin) {
      // Resolve own employee_id
      const { data: profile } = await fastify.supabase
        .from('profiles')
        .select('employee_id')
        .eq('id', req.userId)
        .eq('tenant_id', req.tenantId)
        .maybeSingle()

      const myEmployeeId = (profile as { employee_id: string | null } | null)?.employee_id
      if (!myEmployeeId) return reply.send({ data: [] })
      employeeId = myEmployeeId
    }

    const result = await listLeaveRequests(fastify.supabase, req.tenantId, {
      employeeId,
      status:    parsed.data.status,
      fromDate:  parsed.data.from_date,
      toDate:    parsed.data.to_date,
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
