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
import type { LeaveSession }  from './leave-engine.js'
import {
  computeLeaveDuration,
  buildPolicyFromRule,
  buildPolicyFromLegacy,
  buildDateRange,
  isDefaultWeekoff,
  DEFAULT_POLICY,
  type DurationPolicy,
  type DayContext,
  type LeaveSessionSpan,
} from './leave-duration-engine.js'
import { resolveEmployeeOrgContext, getWeeklyOffDays, getLocalDayOfWeek } from './org-context.js'
import { eventService }    from './event-service.js'
import {
  captureRuleSnapshot,
  captureLegacySnapshot,
  captureDefaultSnapshot,
} from './leave-policy-snapshot-service.js'

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
  /**
   * New duration-engine session fields.
   * When provided, these override the legacy `session` field for start/end day
   * multiplier calculation and are persisted to start_session / end_session columns.
   * Cross-date half-day requests are allowed via these fields (unlike the legacy
   * `session` path which requires fromDate === toDate for half-day sessions).
   */
  startSession?:  'full_day' | 'first_half' | 'second_half' | 'hourly'
  endSession?:    'full_day' | 'first_half' | 'second_half' | 'hourly'
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
  /** Duration-engine fields (added alongside engine v1) */
  start_session:    'full_day' | 'first_half' | 'second_half' | 'hourly' | null
  end_session:      'full_day' | 'first_half' | 'second_half' | 'hourly' | null
  calculated_days:  number | null
  duration_breakdown: Record<string, unknown> | null
  engine_version:   string | null
  /** Replay infrastructure (migration 163) — snapshot of the policy that governed this request */
  policy_snapshot_id: string | null
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
  start_session, end_session, calculated_days, duration_breakdown, engine_version,
  policy_snapshot_id,
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
    startSession,
    endSession,
  } = opts

  // Resolve session: new field takes priority; fall back to legacy halfDay flag
  const session: LeaveSession = rawSession ?? (halfDay ? 'first_half' : 'full_day')

  // Determine whether the caller is using the new duration-engine path.
  // The new path is active when startSession or endSession is explicitly supplied.
  const usingNewSessionPath = startSession !== undefined || endSession !== undefined

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

  // For half-day sessions on the LEGACY path, fromDate must equal toDate.
  // The new startSession/endSession path intentionally allows cross-date half-day
  // requests (e.g. start second_half Monday → end first_half Wednesday).
  if (!usingNewSessionPath && (session === 'first_half' || session === 'second_half') && fromDate !== toDate) {
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

  // ── Policy-level governance enforcement (session + application window) ────────
  // Fetch all columns so both the session-governance checks and the duration
  // engine builders (buildPolicyFromRule / buildPolicyFromLegacy) have everything
  // they need from a single round-trip.
  const { data: policyRule } = await supabase
    .from('leave_policy_rules')
    .select('*, leave_policy_masters!inner(tenant_id)')
    .eq('leave_type_id', leaveTypeId)
    .eq('leave_policy_masters.tenant_id', tenantId)
    .maybeSingle()

  const { data: legacyPolicy } = policyRule ? { data: null } : await supabase
    .from('leave_policies')
    .select('*')
    .eq('leave_type_id', leaveTypeId)
    .eq('tenant_id', tenantId)
    .maybeSingle()

  const gov = (policyRule ?? legacyPolicy) as {
    allow_half_day:                       boolean
    allow_hourly_leave:                   boolean
    allow_cross_session:                  boolean
    minimum_leave_unit:                   number
    maximum_sessions_per_day:             number
    allow_past_dated_leave:               boolean
    maximum_past_days:                    number
    allow_current_period_leave:           boolean
    allow_future_leave:                   boolean
    maximum_future_days:                  number | null
    future_application_requires_approval: boolean
    same_day_application_mode:            'allowed' | 'restricted' | 'manager_override_only'
  } | null

  // Build the full DurationPolicy for the engine.
  // buildPolicyFromRule / buildPolicyFromLegacy map each table's column names
  // to the canonical DurationPolicy shape — we just need to know which table won.
  const durationPolicy: DurationPolicy = policyRule
    ? buildPolicyFromRule(policyRule as Record<string, unknown>)
    : legacyPolicy
      ? buildPolicyFromLegacy(legacyPolicy as Record<string, unknown>)
      : DEFAULT_POLICY

  // ── Session validation (effective permissions: policy > type-level fallback) ──
  // When a policy is configured, policy flags are authoritative.
  // When no policy exists, fall back to the leave_types-level flags.
  {
    const effectiveAllowHalfDay = gov ? gov.allow_half_day     : lt.allow_half_day
    const effectiveAllowHourly  = gov ? gov.allow_hourly_leave : lt.allow_hourly
    const effectiveAllowCross   = gov ? gov.allow_cross_session : true   // no type-level cross-session flag; default allow

    const effectiveStartSession = startSession ?? session
    const effectiveEndSession   = endSession   ?? session

    const isHalfDay =
      effectiveStartSession === 'first_half'  || effectiveStartSession === 'second_half' ||
      effectiveEndSession   === 'first_half'  || effectiveEndSession   === 'second_half'
    const isHourly  = effectiveStartSession === 'hourly' || session === 'hourly'
    const isMultiDay     = fromDate !== toDate
    const isCrossSession = isMultiDay &&
                           effectiveStartSession !== effectiveEndSession &&
                           !(effectiveStartSession === 'full_day' && effectiveEndSession === 'full_day')

    if (isHalfDay && !effectiveAllowHalfDay) {
      return {
        ok:    false,
        error: { type: 'VALIDATION_ERROR', message: `${lt.name} does not allow half-day leave` },
      }
    }
    if (isHourly && !effectiveAllowHourly) {
      return {
        ok:    false,
        error: { type: 'VALIDATION_ERROR', message: `${lt.name} does not allow hourly leave` },
      }
    }
    if (isCrossSession && !effectiveAllowCross) {
      return {
        ok:    false,
        error: { type: 'VALIDATION_ERROR', message: `Cross-session multi-day leave is not allowed for ${lt.name}` },
      }
    }
  }

  // ── Application window enforcement ──────────────────────────────────────────
  // Calendar-date comparison in server-local time (YYYY-MM-DD string compare is safe
  // since both sides are ISO date strings with no timezone component).
  const todayStr = new Date().toISOString().slice(0, 10)

  // Derive defaults when no policy is configured: allow everything
  const windowGov = gov ?? {
    allow_past_dated_leave:               false,  // conservative: no past leave without explicit policy
    maximum_past_days:                    0,
    allow_current_period_leave:           true,
    allow_future_leave:                   true,
    maximum_future_days:                  null,
    future_application_requires_approval: false,
    same_day_application_mode:            'allowed' as const,
  }

  const isPast      = fromDate < todayStr
  const isSameDay   = fromDate === todayStr
  const isFuture    = fromDate > todayStr
  const currentYM   = todayStr.slice(0, 7)   // YYYY-MM
  const fromDateYM  = fromDate.slice(0, 7)

  // Past-dated leave
  if (isPast) {
    if (!windowGov.allow_past_dated_leave) {
      return {
        ok:    false,
        error: { type: 'VALIDATION_ERROR', message: `${lt.name} does not allow past-dated leave applications` },
      }
    }
    // Calculate how many calendar days in the past the start date is
    const msPerDay   = 86_400_000
    const pastDays   = Math.round((Date.parse(todayStr) - Date.parse(fromDate)) / msPerDay)
    if (pastDays > windowGov.maximum_past_days) {
      return {
        ok:    false,
        error: {
          type:    'VALIDATION_ERROR',
          message: `${lt.name} allows retroactive leave up to ${windowGov.maximum_past_days} day(s) in the past. Your request starts ${pastDays} day(s) ago.`,
        },
      }
    }
  }

  // Same-day leave
  if (isSameDay) {
    if (windowGov.same_day_application_mode === 'restricted') {
      return {
        ok:    false,
        error: { type: 'VALIDATION_ERROR', message: `${lt.name} does not allow same-day leave applications` },
      }
    }
    // manager_override_only: allow submission but flag it — handled below in insert
  }

  // Future leave
  if (isFuture) {
    if (!windowGov.allow_future_leave) {
      return {
        ok:    false,
        error: { type: 'VALIDATION_ERROR', message: `${lt.name} does not allow future leave applications` },
      }
    }
    if (windowGov.maximum_future_days !== null) {
      const msPerDay    = 86_400_000
      const futureDays  = Math.round((Date.parse(fromDate) - Date.parse(todayStr)) / msPerDay)
      if (futureDays > windowGov.maximum_future_days) {
        return {
          ok:    false,
          error: {
            type:    'VALIDATION_ERROR',
            message: `${lt.name} allows future leave applications up to ${windowGov.maximum_future_days} day(s) ahead. Your request starts ${futureDays} day(s) from now.`,
          },
        }
      }
    }
  }

  // Current-period lock
  if (!windowGov.allow_current_period_leave && fromDateYM === currentYM) {
    return {
      ok:    false,
      error: { type: 'VALIDATION_ERROR', message: `${lt.name} does not allow leave applications for the current calendar month` },
    }
  }

  // Compute window metadata for persistence
  const requiresManagerOverride = isSameDay && windowGov.same_day_application_mode === 'manager_override_only'
  const applicationWindowNote   =
    isPast    ? `Retroactive — ${Math.round((Date.parse(todayStr) - Date.parse(fromDate)) / 86_400_000)} day(s) past` :
    isSameDay ? 'Same-day application' :
    isFuture  ? `Future — ${Math.round((Date.parse(fromDate) - Date.parse(todayStr)) / 86_400_000)} day(s) ahead` :
    null

  // Overlap check — prevent duplicate or overlapping PENDING/APPROVED requests.
  // This is the ONLY guard against overlapping requests: leave_requests has no
  // UNIQUE/EXCLUDE constraint backstopping it at the DB level (confirmed via
  // migration grep — the `error.code === '23505'` handler further down in this
  // function is dead code for this scenario; nothing in the schema can raise
  // it for a non-identical overlapping range). error was previously discarded
  // here — a query failure (RLS hiccup, connection blip) silently proceeded as
  // "no overlap found," letting a duplicate/overlapping PENDING request
  // through with no error anywhere. Fail closed instead. (fresh audit finding)
  // Overlap condition: existing.from_date <= new.to_date AND existing.to_date >= new.from_date
  const { data: overlapping, error: overlapErr } = await supabase
    .from('leave_requests')
    .select('id')
    .eq('tenant_id', tenantId)
    .eq('employee_id', employeeId)
    .in('status', ['PENDING', 'APPROVED'])
    .lte('from_date', toDate)   // existing starts on or before new end
    .gte('to_date', fromDate)   // existing ends on or after new start
    .limit(1)
    .maybeSingle()

  if (overlapErr) {
    return { ok: false, error: { type: 'DB_ERROR', message: 'Failed to check for overlapping leave requests' } }
  }

  if (overlapping) {
    return {
      ok:    false,
      error: {
        type:    'CONFLICT',
        message: 'You already have a leave request that overlaps with this date range',
      },
    }
  }

  // ── Resolve start/end sessions (needed for engine span + insert) ─────────────
  // Prefer the explicit new-path fields; otherwise mirror the legacy session value.
  const resolvedStartSession = startSession ?? session
  const resolvedEndSession   = endSession   ?? session

  // ── Fetch holiday calendar for the requested span ─────────────────────────
  // Non-optional holidays only — optional holidays don't affect leave duration.
  const { data: holidayRows } = await supabase
    .from('holiday_calendar')
    .select('date, name')
    .eq('tenant_id', tenantId)
    .eq('is_optional', false)
    .gte('date', fromDate)
    .lte('date', toDate)

  const holidayMap = new Map<string, string>(
    ((holidayRows ?? []) as Array<{ date: string; name: string }>)
      .map(h => [h.date, h.name] as [string, string]),
  )

  // ── Resolve the employee's ACTUAL weekly-off from the roster ──────────────
  // Hard-coding Sat/Sun (isDefaultWeekoff) over/under-charges leave for tenants
  // whose weekly off isn't Sat/Sun (retail, manufacturing, Gulf Fri-Sat) and
  // diverges from what attendance/payroll later compute. Resolve roster + site
  // timezone exactly as computeWorkingLeaveDays does, with a Sat/Sun fallback.
  const orgCtx        = await resolveEmployeeOrgContext(supabase, tenantId, employeeId, fromDate)
  const weeklyOffDays = getWeeklyOffDays([], orgCtx.emp_roster_weekly_off, orgCtx.site_default_roster_weekly_off)
  const isWeeklyOff   = (date: string): boolean =>
    weeklyOffDays.length > 0
      ? weeklyOffDays.includes(getLocalDayOfWeek(date, orgCtx.site_timezone))
      : isDefaultWeekoff(date)

  // ── Build per-day context for the duration engine ─────────────────────────
  const spanDates  = buildDateRange(fromDate, toDate)
  const dayInfo: DayContext[] = spanDates.map(date => ({
    date,
    is_holiday:    holidayMap.has(date),
    is_weekly_off: isWeeklyOff(date),
    holiday_name:  holidayMap.get(date),
  }))

  // ── Compute duration via the authoritative duration engine (v1) ───────────
  const durSpan: LeaveSessionSpan = {
    start_date:      fromDate,
    start_session:   resolvedStartSession,
    end_date:        toDate,
    end_session:     resolvedEndSession,
    requested_hours: session === 'hourly' ? hoursRequested : undefined,
  }

  const durResult = computeLeaveDuration(durSpan, dayInfo, durationPolicy)

  // Block-level engine errors (e.g. policy blocks sandwich, all days are holidays)
  if (!durResult.is_valid) {
    return {
      ok:    false,
      error: {
        type:    'VALIDATION_ERROR',
        message: durResult.errors[0] ?? 'Leave duration could not be computed with the current policy settings',
      },
    }
  }

  // Reject zero-duration requests (all days non-working, or fully skipped)
  if (durResult.calculated_days <= 0) {
    return {
      ok:    false,
      error: {
        type:    'VALIDATION_ERROR',
        message: 'Leave duration computed as 0 days — all days in the selected range are non-working days',
      },
    }
  }

  const computed_days = durResult.calculated_days

  // ── Capture immutable policy snapshot (non-fatal) ─────────────────────────
  // Captures the exact policy state that governed this request so replays can
  // deterministically reconstruct what the engine computed. Failures are swallowed
  // — the governance action must never be blocked by a snapshot write failure.
  let policySnapshotId: string | null = null
  if (policyRule) {
    policySnapshotId = await captureRuleSnapshot(
      supabase, tenantId, employeeId, leaveTypeId,
      policyRule as Record<string, unknown>,
      'employee',          // most specific scope that resolved — rule is already employee-level
      fromDate,
      'leave_request_creation',
    )
  } else if (legacyPolicy) {
    policySnapshotId = await captureLegacySnapshot(
      supabase, tenantId, employeeId, leaveTypeId,
      legacyPolicy as Record<string, unknown>,
      fromDate,
      'leave_request_creation',
    )
  } else {
    policySnapshotId = await captureDefaultSnapshot(
      supabase, tenantId, employeeId, leaveTypeId,
      fromDate,
      'leave_request_creation',
    )
  }

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
      hours_requested:           session === 'hourly' ? hoursRequested : null,
      reason:                    reason ?? null,
      status:                    'PENDING',
      requested_by:              requestedBy,
      // Duration-engine v1 fields — fully populated from engine result
      start_session:             resolvedStartSession,
      end_session:               resolvedEndSession,
      calculated_days:           computed_days,
      duration_breakdown:        durResult.breakdown,
      engine_version:            durResult.engine_version,
      // Application window governance fields (migration 161)
      requires_manager_override: requiresManagerOverride,
      application_window_note:   applicationWindowNote ?? null,
      // Replay infrastructure (migration 163) — links request to governing policy snapshot
      policy_snapshot_id:        policySnapshotId ?? null,
    })
    .select(SELECT_FIELDS)
    .single()

  if (error) {
    // 23505: unique violation — two concurrent submissions raced through the
    // overlap check and both attempted to insert. Surface as CONFLICT so the
    // route handler maps it to 409, same as the application-layer overlap guard.
    if (error.code === '23505') {
      return {
        ok:    false,
        error: { type: 'CONFLICT', message: 'You already have a leave request that overlaps with this date range' },
      }
    }
    return { ok: false, error: { type: 'DB_ERROR', message: error.message ?? 'Failed to create leave request' } }
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

  // Fold the PENDING precondition into the WHERE clause — every other
  // canonical mutation (approve/reject/reverse) routes through a FOR
  // UPDATE-locked, status-rechecked RPC; this plain read-then-write could
  // otherwise clobber a request a concurrent approve had already locked and
  // advanced (approve_leave_request_atomic correctly deducts balance/writes
  // the ledger under its own lock, but this UPDATE — reading a stale
  // PENDING snapshot — would still overwrite it to CANCELLED with no
  // reversal, leaving the ledger/balance out of sync with the visible status).
  const { data, error } = await supabase
    .from('leave_requests')
    .update({ status: 'CANCELLED' })
    .eq('id', requestId)
    .eq('tenant_id', tenantId)
    .eq('status', 'PENDING')
    .select(SELECT_FIELDS)
    .maybeSingle()

  if (error) {
    return { ok: false, error: { type: 'DB_ERROR', message: 'Failed to cancel leave request' } }
  }
  if (!data) {
    return {
      ok:    false,
      error: { type: 'CONFLICT', message: 'Request was already actioned by another request' },
    }
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
