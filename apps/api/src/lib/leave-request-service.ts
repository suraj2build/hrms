/**
 * LeaveRequestService — CRUD + business rules for leave_requests.
 *
 * Responsibilities:
 *  - createLeaveRequest: validate inputs, compute days (LeaveEngine),
 *    insert row.  Does NOT check balance (deferred to approval).
 *  - getLeaveRequest: fetch single request (tenant-scoped).
 *  - listLeaveRequests: filter by employee, status, date range.
 *  - cancelLeaveRequest: employee can cancel their own PENDING request.
 *
 * Approval / rejection is handled by ApprovalService (Step 3).
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import { computeLeaveDays, computeLeaveSession, type LeaveSession } from './leave-engine.js'
import { eventService }    from './event-service.js'

// ── Types ──────────────────────────────────────────────────────────────────────

export interface CreateLeaveRequestOpts {
  tenantId:       string
  employeeId:     string
  leaveTypeId:    string
  fromDate:       string    // YYYY-MM-DD
  toDate:         string    // YYYY-MM-DD
  reason?:        string
  /** @deprecated use session instead */
  halfDay?:       boolean
  /** Leave session granularity — defaults to 'full_day' */
  session?:       LeaveSession
  /** Required when session = 'hourly'. Hours in DECIMAL(4,2) increments (min 0.25). */
  hoursRequested?: number
  requestedBy:    string   // profiles.id of the requester (usually the employee's own profile)
}

export interface LeaveRequestRow {
  id:               string
  tenant_id:        string
  employee_id:      string
  leave_type_id:    string
  from_date:        string
  to_date:          string
  computed_days:    number
  half_day:         boolean
  /** Session granularity added in migration 068 */
  session:          LeaveSession
  /** Non-null only when session = 'hourly' */
  hours_requested:  number | null
  status:           'PENDING' | 'APPROVED' | 'REJECTED' | 'CANCELLED'
  reason:           string | null
  rejection_reason: string | null
  requested_by:     string
  approved_by:      string | null
  approved_at:      string | null
  created_at:       string
  updated_at:       string
  // Joined fields (may be present depending on query)
  leave_types?:     { id: string; name: string; is_paid: boolean; allow_sandwich: boolean; allow_half_day: boolean; allow_hourly: boolean } | null
  employees?:       { id: string; first_name: string; last_name: string; employee_code: string } | null
}

export type LeaveRequestError =
  | { type: 'NOT_FOUND';          message: string }
  | { type: 'VALIDATION_ERROR';   message: string }
  | { type: 'CONFLICT';           message: string }
  | { type: 'DB_ERROR';           message: string }

export type LeaveRequestResult<T> =
  | { ok: true;  value: T }
  | { ok: false; error: LeaveRequestError }

// ── Helpers ────────────────────────────────────────────────────────────────────

const SELECT_FIELDS = `
  id, tenant_id, employee_id, leave_type_id,
  from_date, to_date, computed_days, half_day,
  session, hours_requested,
  status, reason, rejection_reason,
  requested_by, approved_by, approved_at,
  created_at, updated_at,
  leave_types(id, name, is_paid, allow_sandwich, allow_half_day, allow_hourly),
  employees!inner(id, first_name, last_name, employee_code)
`

// ── Service functions ──────────────────────────────────────────────────────────

/**
 * Create a new leave request.
 * - Validates leave type exists and is active for the tenant.
 * - Computes days via LeaveEngine (computeLeaveDays).
 * - Does NOT validate balance (deferred to approval time).
 * - Does NOT change attendance_daily (deferred to approval).
 */
export async function createLeaveRequest(
  supabase: SupabaseClient,
  opts:     CreateLeaveRequestOpts,
): Promise<LeaveRequestResult<LeaveRequestRow>> {
  const {
    tenantId, employeeId, leaveTypeId, fromDate, toDate, reason, requestedBy,
    halfDay = false,
    session: rawSession,
    hoursRequested,
  } = opts

  // Resolve session: new field takes priority; fall back to legacy halfDay flag
  const session: LeaveSession = rawSession ?? (halfDay ? 'first_half' : 'full_day')

  // Validate session-specific constraints
  if (session === 'hourly') {
    if (!hoursRequested || hoursRequested <= 0) {
      return {
        ok:    false,
        error: { type: 'VALIDATION_ERROR', message: 'hours_requested is required and must be > 0 for hourly leave' },
      }
    }
    if (hoursRequested > 24) {
      return {
        ok:    false,
        error: { type: 'VALIDATION_ERROR', message: 'hours_requested cannot exceed 24 hours' },
      }
    }
    // For hourly leave fromDate must equal toDate (single-day only)
    if (fromDate !== toDate) {
      return {
        ok:    false,
        error: { type: 'VALIDATION_ERROR', message: 'Hourly leave must be on a single day (from_date must equal to_date)' },
      }
    }
  }

  // For half-day sessions, fromDate must equal toDate
  if ((session === 'first_half' || session === 'second_half') && fromDate !== toDate) {
    return {
      ok:    false,
      error: { type: 'VALIDATION_ERROR', message: 'Half-day leave must be on a single day (from_date must equal to_date)' },
    }
  }

  // Date order check
  if (fromDate > toDate) {
    return {
      ok:    false,
      error: { type: 'VALIDATION_ERROR', message: 'from_date must be on or before to_date' },
    }
  }

  // Verify leave type is active and belongs to tenant
  const { data: lt, error: ltErr } = await supabase
    .from('leave_types')
    .select('id, name, is_paid, allow_sandwich, is_active, allow_half_day, allow_hourly')
    .eq('id', leaveTypeId)
    .eq('tenant_id', tenantId)
    .maybeSingle()

  if (ltErr || !lt) {
    return { ok: false, error: { type: 'NOT_FOUND', message: 'Leave type not found' } }
  }
  if (!lt.is_active) {
    return { ok: false, error: { type: 'VALIDATION_ERROR', message: 'Leave type is inactive' } }
  }

  // Validate session is permitted by leave type
  if ((session === 'first_half' || session === 'second_half') && !lt.allow_half_day) {
    return {
      ok:    false,
      error: { type: 'VALIDATION_ERROR', message: `${lt.name} does not allow half-day leave` },
    }
  }
  if (session === 'hourly' && !lt.allow_hourly) {
    return {
      ok:    false,
      error: { type: 'VALIDATION_ERROR', message: `${lt.name} does not allow hourly leave` },
    }
  }

  // Overlap check — prevent duplicate or overlapping PENDING/APPROVED requests
  // Overlap condition: existing.from_date <= new.to_date AND existing.to_date >= new.from_date
  const { data: overlapping } = await supabase
    .from('leave_requests')
    .select('id')
    .eq('tenant_id', tenantId)
    .eq('employee_id', employeeId)
    .in('status', ['PENDING', 'APPROVED'])
    .lte('from_date', toDate)   // existing starts on or before new end
    .gte('to_date', fromDate)   // existing ends on or after new start
    .limit(1)
    .maybeSingle()

  if (overlapping) {
    return {
      ok:    false,
      error: {
        type:    'CONFLICT',
        message: 'You already have a leave request that overlaps with this date range',
      },
    }
  }

  // Compute days via LeaveEngine (session-aware)
  const { computed_days } = computeLeaveSession(fromDate, toDate, session, hoursRequested)

  // Derive half_day boolean for backward compatibility
  const halfDayFlag = session === 'first_half' || session === 'second_half'

  // Insert
  const { data, error } = await supabase
    .from('leave_requests')
    .insert({
      tenant_id:      tenantId,
      employee_id:    employeeId,
      leave_type_id:  leaveTypeId,
      from_date:      fromDate,
      to_date:        toDate,
      computed_days,
      half_day:       halfDayFlag,
      session,
      hours_requested: session === 'hourly' ? hoursRequested : null,
      reason:          reason ?? null,
      status:          'PENDING',
      requested_by:    requestedBy,
    })
    .select(SELECT_FIELDS)
    .single()

  if (error) {
    return { ok: false, error: { type: 'DB_ERROR', message: 'Failed to create leave request' } }
  }

  return { ok: true, value: data as unknown as LeaveRequestRow }
}

/**
 * Fetch a single leave request by id (tenant-scoped).
 */
export async function getLeaveRequest(
  supabase:  SupabaseClient,
  tenantId:  string,
  requestId: string,
): Promise<LeaveRequestResult<LeaveRequestRow>> {
  const { data, error } = await supabase
    .from('leave_requests')
    .select(SELECT_FIELDS)
    .eq('id', requestId)
    .eq('tenant_id', tenantId)
    .maybeSingle()

  if (error || !data) {
    return { ok: false, error: { type: 'NOT_FOUND', message: 'Leave request not found' } }
  }

  return { ok: true, value: data as unknown as LeaveRequestRow }
}

/**
 * List leave requests with optional filters.
 */
export async function listLeaveRequests(
  supabase:   SupabaseClient,
  tenantId:   string,
  filters: {
    employeeId?: string
    status?:     string
    fromDate?:   string
    toDate?:     string
    limit?:      number
    offset?:     number
  } = {},
): Promise<LeaveRequestResult<LeaveRequestRow[]>> {
  let q = supabase
    .from('leave_requests')
    .select(SELECT_FIELDS)
    .eq('tenant_id', tenantId)
    .order('created_at', { ascending: false })

  if (filters.employeeId) q = q.eq('employee_id', filters.employeeId)
  if (filters.status)     q = q.eq('status', filters.status)
  if (filters.fromDate)   q = q.gte('from_date', filters.fromDate)
  if (filters.toDate)     q = q.lte('to_date',   filters.toDate)

  const limit  = filters.limit  ?? 50
  const offset = filters.offset ?? 0
  q = q.range(offset, offset + limit - 1)

  const { data, error } = await q

  if (error) {
    return { ok: false, error: { type: 'DB_ERROR', message: 'Failed to fetch leave requests' } }
  }

  return { ok: true, value: (data ?? []) as unknown as LeaveRequestRow[] }
}

/**
 * Cancel a PENDING leave request (employee action only).
 * HR cancellation goes through ApprovalService.reject().
 */
export async function cancelLeaveRequest(
  supabase:   SupabaseClient,
  tenantId:   string,
  requestId:  string,
  requestedBy: string,   // must match the original requested_by
): Promise<LeaveRequestResult<LeaveRequestRow>> {
  // Fetch and validate
  const existing = await getLeaveRequest(supabase, tenantId, requestId)
  if (!existing.ok) return existing

  const req = existing.value

  if (req.status !== 'PENDING') {
    return {
      ok:    false,
      error: { type: 'CONFLICT', message: `Cannot cancel a request that is already ${req.status}` },
    }
  }

  if (req.requested_by !== requestedBy) {
    return {
      ok:    false,
      error: { type: 'VALIDATION_ERROR', message: 'Only the requester can cancel their own leave request' },
    }
  }

  const { data, error } = await supabase
    .from('leave_requests')
    .update({ status: 'CANCELLED' })
    .eq('id', requestId)
    .eq('tenant_id', tenantId)
    .select(SELECT_FIELDS)
    .single()

  if (error) {
    return { ok: false, error: { type: 'DB_ERROR', message: 'Failed to cancel leave request' } }
  }

  const cancelled = data as unknown as LeaveRequestRow

  // Event emission — fire-and-forget, after DB write succeeds
  const lt = req.leave_types as { name: string } | null
  eventService.emit('leave.cancelled', {
    tenant_id:   tenantId,
    employee_id: req.employee_id,
    request_id:  requestId,
    from_date:   req.from_date,
    to_date:     req.to_date,
    leave_type:  lt?.name,
  })

  return { ok: true, value: cancelled }
}
