/**
 * rotation-engine.ts
 *
 * Pure utility — resolves which shift an employee should work on a given date
 * by evaluating the Rotation Policy assigned to them (or to their site).
 *
 * Priority chain used by the attendance engine:
 *   1. shift_roster  (date-level override)          — handled in attendance-engine.ts
 *   2. rotation policy  ← THIS MODULE               — employee override → site default
 *   3. employee_shifts  (standing assignment)        — fallback
 *
 * Condition types (V1):
 *   weekday_working   → Mon–Fri (JS dow 1–5)
 *   saturday_working  → Sat     (JS dow 6)
 *   sunday_working    → Sun     (JS dow 0)
 *   half_day          → driven externally; not resolved from date alone (reserved)
 *   holiday_working   → driven externally; not resolved from date alone (reserved)
 *
 * Note: half_day and holiday_working are stored in the DB for HR to configure,
 * but cannot be determined from a date alone — they require attendance context.
 * The engine therefore resolves only weekday/saturday/sunday from the date,
 * and half_day / holiday_working rules are carried in the policy for future use.
 */

import type { SupabaseClient } from '@supabase/supabase-js'

// ── Types ─────────────────────────────────────────────────────────────────────

export type RotationConditionType =
  | 'weekday_working'
  | 'saturday_working'
  | 'sunday_working'
  | 'half_day'
  | 'holiday_working'

export interface RotationShiftMeta {
  shiftId:   string
  startTime: string
  endTime:   string
  graceMinutes: number
  isNightShift: boolean
  durationMin: number
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Map a JS day-of-week (0=Sun … 6=Sat) to the matching rotation condition.
 * Returns null if the day cannot be resolved from the date alone (never happens
 * for the three basic cases, but makes typing explicit).
 */
export function dayOfWeekToCondition(
  dow: number,
): 'weekday_working' | 'saturday_working' | 'sunday_working' | null {
  if (dow === 0) return 'sunday_working'
  if (dow === 6) return 'saturday_working'
  if (dow >= 1 && dow <= 5) return 'weekday_working'
  return null
}

/** Shift duration in minutes, handling night shifts that cross midnight. */
function shiftDurationMinutes(start: string, end: string, isNight: boolean): number {
  const [sh, sm] = start.split(':').map(Number)
  const [eh, em] = end.split(':').map(Number)
  let mins = (eh * 60 + em) - (sh * 60 + sm)
  if (isNight && mins <= 0) mins += 24 * 60
  return mins
}

// ── Core resolution ───────────────────────────────────────────────────────────

/**
 * Get the effective rotation_policy_id for an employee.
 *
 * Returns the employee-level override first; falls back to the site default.
 * Returns null if neither is set (caller should fall through to employee_shifts).
 */
export async function getEffectiveRotationPolicyId(
  supabase:   SupabaseClient,
  tenantId:   string,
  employeeId: string,
): Promise<string | null> {
  const { data } = await supabase
    .from('employees')
    .select(`
      rotation_policy_id,
      sites!employees_site_id_fkey (
        default_rotation_policy_id
      )
    `)
    .eq('id', employeeId)
    .eq('tenant_id', tenantId)
    .maybeSingle()

  if (!data) return null

  // Supabase PostgREST returns joined relations as arrays; cast via unknown.
  const emp = data as unknown as {
    rotation_policy_id: string | null
    sites: { default_rotation_policy_id: string | null } | null
  }

  return (
    emp.rotation_policy_id ??
    emp.sites?.default_rotation_policy_id ??
    null
  )
}

/**
 * Resolve the shift for a given condition type within a rotation policy.
 *
 * Returns full shift metadata or null if no rule covers the condition.
 */
export async function resolveRotationCondition(
  supabase:          SupabaseClient,
  rotationPolicyId:  string,
  conditionType:     RotationConditionType,
  date:              string,  // YYYY-MM-DD — picks the rule version effective on this date (AHI-3)
): Promise<RotationShiftMeta | null> {
  // Temporal (AHI-3): a rotation_policy_rules row is closed (effective_to set)
  // and a new one opened whenever the policy is edited (PUT /masters/
  // rotation-policies/:id), so two rows can match the same
  // (rotation_policy_id, condition_type) at once. Without this filter,
  // .maybeSingle() throws "multiple rows returned" as soon as a policy has
  // been edited even once, and the error was silently discarded by the
  // caller — resolving to null and blanking the roster-planner grid for
  // every employee on that policy. Mirrors the fix already applied in
  // shift-resolution-engine.ts for the same table.
  const { data: rule } = await supabase
    .from('rotation_policy_rules')
    .select(`
      shift_id,
      shifts!rotation_policy_rules_shift_id_fkey (
        id,
        start_time,
        end_time,
        grace_minutes,
        is_night_shift
      )
    `)
    .eq('rotation_policy_id', rotationPolicyId)
    .eq('condition_type', conditionType)
    .lte('effective_from', date)
    .or('effective_to.is.null,effective_to.gte.' + date)
    .order('effective_from', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (!rule) return null

  // Supabase PostgREST returns joined relations as arrays; cast via unknown.
  const r = rule as unknown as {
    shift_id: string
    shifts: {
      id: string
      start_time: string
      end_time: string
      grace_minutes: number
      is_night_shift: boolean
    } | null
  }

  if (!r.shifts) return null

  const s = r.shifts
  return {
    shiftId:      s.id,
    startTime:    s.start_time,
    endTime:      s.end_time,
    graceMinutes: s.grace_minutes ?? 15,
    isNightShift: s.is_night_shift ?? false,
    durationMin:  shiftDurationMinutes(s.start_time, s.end_time, s.is_night_shift ?? false),
  }
}

/**
 * Primary entry point used by the attendance engine.
 *
 * Accepts a YYYY-MM-DD local date string and resolves:
 *   1. Effective policy for the employee (employee override → site default)
 *   2. Condition type from the day of week
 *   3. Shift mapped to that condition in the policy
 *
 * Returns null (fall through to employee_shifts) if:
 *   - No rotation policy is configured for the employee/site
 *   - The policy has no rule for the day's condition type
 *   - The mapped shift no longer exists
 */
export async function resolveViaRotationPolicy(
  supabase:   SupabaseClient,
  tenantId:   string,
  employeeId: string,
  date:       string,  // YYYY-MM-DD local date
): Promise<RotationShiftMeta | null> {
  // Step 1 — find effective policy
  const policyId = await getEffectiveRotationPolicyId(supabase, tenantId, employeeId)
  if (!policyId) return null

  // Step 2 — map date → condition
  const dow = new Date(`${date}T00:00:00`).getDay()  // 0=Sun … 6=Sat
  const condition = dayOfWeekToCondition(dow)
  if (!condition) return null

  // Step 3 — look up the shift for this condition
  return resolveRotationCondition(supabase, policyId, condition, date)
}
