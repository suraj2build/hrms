/**
 * Employee-facing Leave Routes
 *
 * These endpoints are for employees to manage their own leave requests.
 * Authorization is purely from the JWT — no HR admin check needed for reads/creates.
 *
 * POST /leave/apply                  — submit a new leave request
 * GET  /leave/my-requests            — list caller's own requests (paginated, filterable)
 * POST /leave/:id/cancel             — cancel a PENDING request (requester only)
 * GET  /leave/requests               — HR alias: list requests by employee_id (queue workspace)
 *
 * Business rules enforced at the service layer:
 *   · No overlapping PENDING/APPROVED requests for the same employee
 *   · Cancellation only if status = PENDING and caller is the requester
 *   · Computed days calculated via LeaveEngine (never trusts client input)
 *   · No balance deduction at submit — happens at approval time
 */
import type { FastifyInstance } from 'fastify'
import { z }                    from 'zod'
import {
  createLeaveRequest,
  listLeaveRequests,
  cancelLeaveRequest,
}                               from '../../lib/leave-request-service.js'
import { MANAGER_ROLES }       from '../../lib/rbac.js'

const dateRe = /^\d{4}-\d{2}-\d{2}$/

function errorToHttp(type: string): number {
  switch (type) {
    case 'NOT_FOUND':        return 404
    case 'CONFLICT':         return 409
    case 'VALIDATION_ERROR': return 400
    default:                 return 500
  }
}

/** Resolve the caller's employee_id from their profile (tenant-scoped). */
async function resolveEmployeeId(
  fastify:  FastifyInstance,
  userId:   string,
  tenantId: string,
): Promise<string | null> {
  const { data } = await fastify.supabase
    .from('profiles')
    .select('employee_id')
    .eq('id', userId)
    .eq('tenant_id', tenantId)
    .maybeSingle()
  return (data as { employee_id: string | null } | null)?.employee_id ?? null
}

export default async function leaveEmployeeRoutes(fastify: FastifyInstance) {
  const auth = { preHandler: [fastify.authenticate] }

  // ── POST /leave/apply ────────────────────────────────────────────────────────
  /**
   * Employee submits a new leave request.
   *
   * Rules enforced here:
   *  · Caller must have a linked employee record.
   *  · from_date ≤ to_date.
   *  · Leave type must be active and belong to tenant.
   *  · No overlap with existing PENDING/APPROVED requests.
   *
   * Balance is NOT checked or deducted — that happens at approval time.
   */
  fastify.post('/leave/apply', auth, async (req: any, reply) => {
    const schema = z.object({
      leave_type_id: z.string().uuid('leave_type_id must be a valid UUID'),
      from_date:     z.string().regex(dateRe, 'from_date must be YYYY-MM-DD'),
      to_date:       z.string().regex(dateRe, 'to_date must be YYYY-MM-DD'),
      half_day:      z.boolean().optional(),
      reason:        z.string().min(1, 'reason is required').max(500),
    })

    const parsed = schema.safeParse(req.body)
    if (!parsed.success) {
      return reply.code(400).send({
        error:   'VALIDATION_ERROR',
        message: parsed.error.issues[0]?.message ?? 'Invalid request body',
      })
    }

    // from_date must not be after to_date
    if (parsed.data.from_date > parsed.data.to_date) {
      return reply.code(400).send({
        error:   'VALIDATION_ERROR',
        message: 'from_date must be on or before to_date',
      })
    }

    // Resolve the caller's employee record — employee_id is authoritative from auth
    const employeeId = await resolveEmployeeId(fastify, req.userId, req.tenantId)
    if (!employeeId) {
      return reply.code(400).send({
        error:   'NO_EMPLOYEE_RECORD',
        message: 'Your profile is not linked to an employee record. Contact HR.',
      })
    }

    const result = await createLeaveRequest(fastify.supabase, {
      tenantId:    req.tenantId,
      employeeId,
      leaveTypeId: parsed.data.leave_type_id,
      fromDate:    parsed.data.from_date,
      toDate:      parsed.data.to_date,
      halfDay:     parsed.data.half_day ?? false,
      reason:      parsed.data.reason,
      requestedBy: req.userId,
    })

    if (!result.ok) {
      return reply.code(errorToHttp(result.error.type)).send({
        error:   result.error.type,
        message: result.error.message,
      })
    }

    return reply.code(201).send({ data: result.value })
  })

  // ── GET /leave/my-requests ────────────────────────────────────────────────────
  /**
   * Returns the caller's own leave requests, paginated and filterable by status.
   *
   * Query params:
   *   page    — 1-based page number (default 1)
   *   limit   — items per page (default 20, max 100)
   *   status  — filter by PENDING | APPROVED | REJECTED | CANCELLED (optional)
   */
  fastify.get('/leave/my-requests', auth, async (req: any, reply) => {
    const querySchema = z.object({
      page:   z.coerce.number().int().min(1).default(1),
      limit:  z.coerce.number().int().min(1).max(100).default(20),
      status: z.enum(['PENDING', 'APPROVED', 'REJECTED', 'CANCELLED']).optional(),
    })

    const parsed = querySchema.safeParse(req.query)
    if (!parsed.success) {
      return reply.code(400).send({
        error:   'VALIDATION_ERROR',
        message: parsed.error.issues[0]?.message,
      })
    }

    const { page, limit, status } = parsed.data
    const offset = (page - 1) * limit

    // Resolve employee_id from auth (non-admins only see their own records)
    const employeeId = await resolveEmployeeId(fastify, req.userId, req.tenantId)
    if (!employeeId) {
      // No employee record → empty result (not an error for the route)
      return reply.send({
        data:       [],
        pagination: { page, limit, total: 0 },
      })
    }

    const result = await listLeaveRequests(fastify.supabase, req.tenantId, {
      employeeId,
      status,
      limit,
      offset,
    })

    if (!result.ok) {
      return reply.code(500).send({ error: result.error.type, message: result.error.message })
    }

    return reply.send({
      data: result.value,
      pagination: {
        page,
        limit,
        // total is not available from listLeaveRequests (uses offset, not count).
        // If a precise total is needed, add a count query to listLeaveRequests.
        has_more: result.value.length === limit,
      },
    })
  })

  // ── GET /leave/requests ───────────────────────────────────────────────────────
  /**
   * HR/admin alias for leave-requests, consumed by EmployeeResolutionWorkspace.
   * Returns a plain array (not wrapped in { data: [] }) to match the workspace's
   * Array.isArray() check.
   *
   * Query params:
   *   employee_id  — UUID filter (required for meaningful results)
   *   status       — PENDING | APPROVED | REJECTED | CANCELLED (case-insensitive)
   *   limit        — default 20
   */
  fastify.get('/leave/requests', auth, async (req: any, reply) => {
    // HR/manager only — this alias accepts an arbitrary employee_id (and
    // returns every tenant leave request, including reasons/rejection
    // reasons, when employee_id is omitted), unlike /leave/my-requests
    // above which always self-scopes. Was previously reachable by any
    // authenticated employee.
    if (!(MANAGER_ROLES as readonly string[]).includes(req.userRole)) {
      return reply.code(403).send({ error: 'FORBIDDEN', message: 'Not authorised' })
    }

    const querySchema = z.object({
      employee_id: z.string().uuid().optional(),
      status:      z.string().optional(),
      limit:       z.coerce.number().int().min(1).max(200).default(20),
      offset:      z.coerce.number().int().min(0).default(0),
    })

    const parsed = querySchema.safeParse(req.query)
    if (!parsed.success) {
      return reply.code(400).send({ error: 'VALIDATION_ERROR', message: parsed.error.issues[0]?.message })
    }

    const { employee_id, limit, offset } = parsed.data

    // Normalise status to uppercase to match the DB enum
    const VALID_STATUSES = ['PENDING', 'APPROVED', 'REJECTED', 'CANCELLED'] as const
    type LeaveStatus = typeof VALID_STATUSES[number]
    const rawStatus   = parsed.data.status?.toUpperCase()
    const status: LeaveStatus | undefined = VALID_STATUSES.includes(rawStatus as LeaveStatus)
      ? rawStatus as LeaveStatus
      : undefined

    const result = await listLeaveRequests(fastify.supabase, req.tenantId, {
      employeeId: employee_id,
      status,
      limit,
      offset,
    })

    if (!result.ok) {
      return reply.code(500).send({ error: result.error.type, message: result.error.message })
    }

    // Return plain array — the workspace does Array.isArray(data) check
    return reply.send(result.value)
  })

  // ── POST /leave/:id/cancel ────────────────────────────────────────────────────
  /**
   * Employee cancels their own PENDING leave request.
   *
   * Rules:
   *  · Only the original requester (profiles.id match) can cancel.
   *  · Only PENDING requests can be cancelled — APPROVED/REJECTED/CANCELLED → 409.
   *  · Emits 'leave.cancelled' event (fire-and-forget, via service layer).
   */
  fastify.post('/leave/:id/cancel', auth, async (req: any, reply) => {
    const { id } = req.params as { id: string }

    const result = await cancelLeaveRequest(
      fastify.supabase,
      req.tenantId,
      id,
      req.userId,  // must match original requested_by
    )

    if (!result.ok) {
      return reply.code(errorToHttp(result.error.type)).send({
        error:   result.error.type,
        message: result.error.message,
      })
    }

    return reply.send({ data: result.value })
  })
}
