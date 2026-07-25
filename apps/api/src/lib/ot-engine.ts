/**
 * OvertimeEngine — Phase 4
 *
 * Responsibilities:
 *  - computeOtMinutes: apply policy rules to raw OT from attendance_daily
 *  - resolveOtPolicy: find the applicable OT policy for an employee
 *  - createOtRequest: generate an overtime_requests row (with auto-approve logic)
 *  - approveOtRequest / rejectOtRequest: workflow actions
 */
import type { SupabaseClient } from '@supabase/supabase-js'

// ── Types ──────────────────────────────────────────────────────────────────────

export interface OtPolicy {
  id:                       string
  tenant_id:                string
  name:                     string
  calculation_mode:         'threshold' | 'shift_end' | 'fixed_rate'
  ot_start_after_minutes:   number
  max_ot_minutes_per_day:   number | null
  max_ot_minutes_per_week:  number | null
  max_ot_minutes_per_month: number | null
  requires_approval:        boolean
  auto_approve_below_min:   number | null
  rate_type:                'flat' | 'multiplier'
  extra_rate:               number
  weekend_rate:             number | null
  holiday_rate:             number | null
  rounding_minutes:         number
  is_default:               boolean
  is_active:                boolean
}

export interface OtComputeResult {
  /** Raw OT extracted from attendance (before policy caps/rounding) */
  raw_ot_minutes:     number
  /** After applying caps + rounding */
  eligible_minutes:   number
  /** Whether auto-approval threshold is met */
  auto_approved:      boolean
  /** Effective rate for payroll */
  effective_rate:     number
  rate_type:          'flat' | 'multiplier'
  is_weekend_day:     boolean
  is_holiday_day:     boolean
}

// ── Policy resolution ──────────────────────────────────────────────────────────

/**
 * Resolve the OT policy for an employee.
 * Chain: employee assignment → tenant default → null (no OT policy)
 */
export async function resolveOtPolicy(
  supabase:   SupabaseClient,
  tenantId:   string,
  employeeId: string,
): Promise<OtPolicy | null> {
  // 1. Per-employee assignment
  const { data: assignment } = await supabase
    .from('employee_overtime_policies')
    .select('ot_policy_id')
    .eq('tenant_id', tenantId)
    .eq('employee_id', employeeId)
    .maybeSingle()

  const policyId = assignment?.ot_policy_id ?? null

  if (policyId) {
    const { data } = await supabase
      .from('overtime_policies')
      .select('*')
      .eq('id', policyId)
      .eq('is_active', true)
      .maybeSingle()
    if (data) return data as OtPolicy
  }

  // 2. Tenant default
  const { data: defaultPolicy } = await supabase
    .from('overtime_policies')
    .select('*')
    .eq('tenant_id', tenantId)
    .eq('is_default', true)
    .eq('is_active', true)
    .maybeSingle()

  return defaultPolicy ? (defaultPolicy as OtPolicy) : null
}

// ── OT computation ─────────────────────────────────────────────────────────────

/**
 * Apply policy rules to raw overtime_minutes from attendance_daily.
 *
 * @param policy         The resolved OT policy (null → no OT)
 * @param rawOtMinutes   overtime_minutes from attendance_daily (already > shift threshold)
 * @param isWeekendDay   Whether the attendance date falls on a weekly off day
 * @param isHolidayDay   Whether the attendance date is a declared holiday
 */
export function computeOtMinutes(
  policy:        OtPolicy | null,
  rawOtMinutes:  number,
  isWeekendDay:  boolean = false,
  isHolidayDay:  boolean = false,
): OtComputeResult {
  if (!policy || rawOtMinutes <= 0) {
    return {
      raw_ot_minutes:   rawOtMinutes,
      eligible_minutes: 0,
      auto_approved:    false,
      effective_rate:   0,
      rate_type:        'multiplier',
      is_weekend_day:   isWeekendDay,
      is_holiday_day:   isHolidayDay,
    }
  }

  // Step 1: subtract ot_start_after_minutes (threshold buffer)
  let eligible = Math.max(0, rawOtMinutes - policy.ot_start_after_minutes)

  // Step 2: apply daily cap
  if (policy.max_ot_minutes_per_day !== null) {
    eligible = Math.min(eligible, policy.max_ot_minutes_per_day)
  }

  // Step 3: rounding (round UP to nearest N minutes)
  if (policy.rounding_minutes > 0 && eligible > 0) {
    eligible = Math.ceil(eligible / policy.rounding_minutes) * policy.rounding_minutes
    // Re-apply cap after rounding
    if (policy.max_ot_minutes_per_day !== null) {
      eligible = Math.min(eligible, policy.max_ot_minutes_per_day)
    }
  }

  // Step 4: auto-approve check
  const auto_approved =
    !policy.requires_approval ||
    (policy.auto_approve_below_min !== null && eligible < policy.auto_approve_below_min)

  // Step 5: effective rate
  let effective_rate = policy.extra_rate
  if (isHolidayDay && policy.holiday_rate !== null) {
    effective_rate = policy.holiday_rate
  } else if (isWeekendDay && policy.weekend_rate !== null) {
    effective_rate = policy.weekend_rate
  }

  return {
    raw_ot_minutes:   rawOtMinutes,
    eligible_minutes: eligible,
    auto_approved,
    effective_rate,
    rate_type:        policy.rate_type,
    is_weekend_day:   isWeekendDay,
    is_holiday_day:   isHolidayDay,
  }
}

// ── Request creation ───────────────────────────────────────────────────────────

export interface CreateOtRequestOpts {
  tenantId:       string
  employeeId:     string
  attendanceDate: string   // YYYY-MM-DD
  rawOtMinutes:   number
  requestedBy:    string   // profiles.id
  isWeekendDay?:  boolean
  isHolidayDay?:  boolean
}

export interface OtRequestResult {
  ok:    boolean
  data?: { id: string; status: string; approved_minutes: number | null }
  error?: string
}

/**
 * Create an OT request for a given attendance date.
 * - Resolves policy, computes eligible minutes
 * - If auto-approved: inserts with status AUTO_APPROVED + approved_minutes
 * - Otherwise: inserts with status PENDING
 * - Also updates attendance_daily.ot_eligible = true
 * - Idempotent: if row exists for (tenant, employee, date) → returns existing
 */
export async function createOtRequest(
  supabase: SupabaseClient,
  opts:     CreateOtRequestOpts,
): Promise<OtRequestResult> {
  const {
    tenantId, employeeId, attendanceDate, rawOtMinutes, requestedBy,
    isWeekendDay = false, isHolidayDay = false,
  } = opts

  // Idempotency check
  const { data: existing } = await supabase
    .from('overtime_requests')
    .select('id, status, approved_minutes')
    .eq('tenant_id', tenantId)
    .eq('employee_id', employeeId)
    .eq('attendance_date', attendanceDate)
    .maybeSingle()

  if (existing) return { ok: true, data: existing as { id: string; status: string; approved_minutes: number | null } }

  // Resolve policy
  const policy = await resolveOtPolicy(supabase, tenantId, employeeId)
  const result = computeOtMinutes(policy, rawOtMinutes, isWeekendDay, isHolidayDay)

  if (result.eligible_minutes <= 0) {
    return { ok: false, error: 'No eligible OT minutes after policy application' }
  }

  const now    = new Date().toISOString()
  const status = result.auto_approved ? 'AUTO_APPROVED' : 'PENDING'
  const approved_minutes = result.auto_approved ? result.eligible_minutes : null
  const approved_at      = result.auto_approved ? now : null

  const row: Record<string, unknown> = {
    tenant_id:       tenantId,
    employee_id:     employeeId,
    attendance_date: attendanceDate,
    raw_ot_minutes:  rawOtMinutes,
    approved_minutes,
    status,
    requested_by:    requestedBy,
    approved_by:     result.auto_approved ? null : null,
    approved_at,
    ot_policy_id:    policy?.id ?? null,
    rate_type:       result.rate_type,
    extra_rate:      result.effective_rate,
    is_weekend_day:  isWeekendDay,
    is_holiday_day:  isHolidayDay,
  }

  const { data, error } = await supabase
    .from('overtime_requests')
    .insert(row)
    .select('id, status, approved_minutes')
    .single()

  if (error) return { ok: false, error: 'Failed to create OT request' }

  // Mark attendance_daily.ot_eligible = true
  await supabase
    .from('attendance_daily')
    .update({ ot_eligible: true, ot_approved_minutes: approved_minutes })
    .eq('tenant_id', tenantId)
    .eq('employee_id', employeeId)
    .eq('date', attendanceDate)

  return { ok: true, data: data as { id: string; status: string; approved_minutes: number | null } }
}

// ── Approval / rejection ───────────────────────────────────────────────────────

export async function approveOtRequest(
  supabase:    SupabaseClient,
  tenantId:    string,
  requestId:   string,
  approverId:  string,
  minutesOverride?: number,   // HR can override the computed minutes
): Promise<OtRequestResult> {
  // Fetch request
  const { data: req, error: fetchErr } = await supabase
    .from('overtime_requests')
    .select('id, status, raw_ot_minutes, ot_policy_id, employee_id, attendance_date')
    .eq('id', requestId)
    .eq('tenant_id', tenantId)
    .maybeSingle()

  if (fetchErr || !req) return { ok: false, error: 'OT request not found' }
  if (req.status !== 'PENDING') return { ok: false, error: `Cannot approve a request with status ${req.status}` }

  const approved_minutes = minutesOverride ?? req.raw_ot_minutes
  const now = new Date().toISOString()

  // .eq('status', 'PENDING') + row-count check (fresh audit finding): without
  // this, two concurrent approve calls for the same request could both pass
  // the precheck above and both write — lower-impact than a balance-affecting
  // approval since this is a plain overwrite (last writer wins, no double
  // credit), but the same missing-guard pattern already fixed elsewhere in
  // this session's leave/encashment approval races.
  const { data, error } = await supabase
    .from('overtime_requests')
    .update({
      status:           'APPROVED',
      approved_minutes,
      approved_by:      approverId,
      approved_at:      now,
    })
    .eq('id', requestId)
    .eq('tenant_id', tenantId)
    .eq('status', 'PENDING')
    .select('id, status, approved_minutes')
    .maybeSingle()

  if (error) return { ok: false, error: 'Failed to approve OT request' }
  if (!data) return { ok: false, error: 'This request was already actioned by another request' }

  // Sync to attendance_daily
  await supabase
    .from('attendance_daily')
    .update({ ot_approved_minutes: approved_minutes })
    .eq('tenant_id', tenantId)
    .eq('employee_id', req.employee_id)
    .eq('date', req.attendance_date)

  return { ok: true, data: data as { id: string; status: string; approved_minutes: number | null } }
}

export async function rejectOtRequest(
  supabase:        SupabaseClient,
  tenantId:        string,
  requestId:       string,
  approverId:      string,
  rejectionReason?: string,
): Promise<OtRequestResult> {
  const { data: req } = await supabase
    .from('overtime_requests')
    .select('id, status')
    .eq('id', requestId)
    .eq('tenant_id', tenantId)
    .maybeSingle()

  if (!req) return { ok: false, error: 'OT request not found' }
  if (req.status !== 'PENDING') return { ok: false, error: `Cannot reject a request with status ${req.status}` }

  const { data, error } = await supabase
    .from('overtime_requests')
    .update({
      status:           'REJECTED',
      approved_by:      approverId,
      approved_at:      new Date().toISOString(),
      rejection_reason: rejectionReason ?? null,
      approved_minutes: 0,
    })
    .eq('id', requestId)
    .eq('tenant_id', tenantId)
    .select('id, status, approved_minutes')
    .single()

  if (error) return { ok: false, error: 'Failed to reject OT request' }
  return { ok: true, data: data as { id: string; status: string; approved_minutes: number | null } }
}
