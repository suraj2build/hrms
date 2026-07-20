/**
 * shift-resolution-engine.ts
 *
 * Single authoritative shift resolver — replaces the four divergent implementations
 * previously spread across attendance-engine, attendance-processor,
 * roster-calendar-engine, and work-session-engine.
 *
 * Priority chain (immutable, documented once):
 *   1. shift_roster              — date-specific override         (highest)
 *   2. rotation_policy           — employee override → site default → condition→shift
 *   3. employee_shifts           — effective as of date (temporal, not is_current)
 *   4. sites.default_shift_id   — DEPRECATED legacy fallback
 *
 * Every caller receives a ResolvedShift with full attribution so the result can be
 * persisted to attendance_daily.expected_shift_id + companion columns.
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import { dayOfWeekToCondition } from './rotation-engine.js'

/** Rows per .in() call — keeps the request URL well under server/proxy
 *  request-line limits (confirmed to fail in production above ~400 UUIDs). */
const ID_CHUNK = 100

/** Runs `queryFn` once per chunk of `ids` and concatenates the results. */
async function fetchChunked<T>(
  ids: string[],
  queryFn: (chunk: string[]) => PromiseLike<{ data: T[] | null }>,
): Promise<T[]> {
  const all: T[] = []
  for (let i = 0; i < ids.length; i += ID_CHUNK) {
    const { data } = await queryFn(ids.slice(i, i + ID_CHUNK))
    if (data) all.push(...data)
  }
  return all
}

// ── Public types ───────────────────────────────────────────────────────────────

export type ShiftResolutionSource =
  | 'shift_roster'
  | 'rotation_policy'
  | 'standing_shift'
  | 'site_default'

export interface ResolvedShift {
  // Shift identity
  shift_id:      string
  shift_name:    string | null

  // Timing (snapshot — safe to persist; FK to shifts is advisory)
  start_time:    string   // "HH:MM:SS"
  end_time:      string
  grace_minutes: number
  is_night_shift: boolean
  duration_minutes: number

  // Attribution — persisted to attendance_daily for historical integrity
  resolution_source:       ShiftResolutionSource
  rotation_policy_id:      string | null
  rotation_condition_type: string | null
}

// ── Internal helpers ───────────────────────────────────────────────────────────

function shiftDurationMinutes(start: string, end: string, isNight: boolean): number {
  const [sh, sm] = start.split(':').map(Number)
  const [eh, em] = end.split(':').map(Number)
  let mins = (eh * 60 + em) - (sh * 60 + sm)
  if (isNight && mins <= 0) mins += 24 * 60
  return mins
}

interface RawShift {
  id: string; name: string | null
  start_time: string; end_time: string
  grace_minutes: number; is_night_shift: boolean
}

function buildResolved(s: RawShift, source: ShiftResolutionSource, rotPolicyId?: string | null, rotCondition?: string | null): ResolvedShift {
  return {
    shift_id:               s.id,
    shift_name:             s.name,
    start_time:             s.start_time,
    end_time:               s.end_time,
    grace_minutes:          s.grace_minutes ?? 15,
    is_night_shift:         s.is_night_shift ?? false,
    duration_minutes:       shiftDurationMinutes(s.start_time, s.end_time, s.is_night_shift ?? false),
    resolution_source:      source,
    rotation_policy_id:     rotPolicyId ?? null,
    rotation_condition_type: rotCondition ?? null,
  }
}

// ── Single-employee resolver ───────────────────────────────────────────────────

/**
 * Resolve the shift for one employee on one local date with full attribution.
 * Returns null only when no shift can be resolved at any priority level.
 */
export async function resolveShiftWithAttribution(
  supabase:   SupabaseClient,
  tenantId:   string,
  employeeId: string,
  date:       string,  // YYYY-MM-DD tenant-local
): Promise<ResolvedShift | null> {

  // ── Priority 1: shift_roster date-specific override ───────────────────────
  const { data: rosterRow } = await supabase
    .from('shift_roster')
    .select('shift_id, shifts!inner(id, name, start_time, end_time, grace_minutes, is_night_shift)')
    .eq('tenant_id', tenantId)
    .eq('employee_id', employeeId)
    .eq('date', date)
    .maybeSingle()

  if (rosterRow) {
    const s = (rosterRow as any).shifts as RawShift | null
    if (s) return buildResolved(s, 'shift_roster')
  }

  // ── Priority 2: rotation policy (employee override → site default) ────────
  // One query fetches everything the lower priorities also need: the site's
  // default rotation policy AND its default shift (snapshot), so the
  // site_default fallback below never has to re-query.
  const { data: empRow } = await supabase
    .from('employees')
    .select('site_id, rotation_policy_id, sites!employees_site_id_fkey(default_rotation_policy_id, default_shift_id, shifts!sites_default_shift_id_fkey(id, name, start_time, end_time, grace_minutes, is_night_shift))')
    .eq('id', employeeId)
    .eq('tenant_id', tenantId)
    .maybeSingle()

  const emp = empRow as any
  const empSite = emp ? (Array.isArray(emp.sites) ? emp.sites[0] : emp.sites) : null
  const rotPolicyId: string | null =
    emp?.rotation_policy_id ??
    empSite?.default_rotation_policy_id ??
    null

  if (rotPolicyId) {
    const dow = new Date(`${date}T12:00:00`).getDay()
    const condition = dayOfWeekToCondition(dow)
    if (condition) {
      // Temporal: pick the rule version effective ON `date` (AHI-3). Falls back
      // to the open version (effective_to IS NULL) and to backfilled rows whose
      // window started in the past.
      const { data: ruleRow } = await supabase
        .from('rotation_policy_rules')
        .select('effective_from, shifts!inner(id, name, start_time, end_time, grace_minutes, is_night_shift)')
        .eq('rotation_policy_id', rotPolicyId)
        .eq('condition_type', condition)
        .lte('effective_from', date)
        .or('effective_to.is.null,effective_to.gte.' + date)
        .order('effective_from', { ascending: false })
        .limit(1)
        .maybeSingle()

      const s = (ruleRow as any)?.shifts as RawShift | null
      if (s) return buildResolved(s, 'rotation_policy', rotPolicyId, condition)
    }
  }

  // ── Priority 3: employee_shifts — temporal (effective as of date) ─────────
  const { data: standing } = await supabase
    .from('employee_shifts')
    .select('shift_id, shifts!inner(id, name, start_time, end_time, grace_minutes, is_night_shift)')
    .eq('tenant_id', tenantId)
    .eq('employee_id', employeeId)
    .lte('effective_from', date)
    .or('effective_to.is.null,effective_to.gte.' + date)
    .order('effective_from', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (standing) {
    const s = (standing as any).shifts as RawShift | null
    if (s) return buildResolved(s, 'standing_shift')
  }

  // ── Priority 4: sites.default_shift_id (deprecated legacy fallback) ───────
  // Uses the site default shift already embedded by the Priority-2 query —
  // identical to the batch resolver's site_default branch.
  const siteShift = empSite ? (Array.isArray(empSite.shifts) ? empSite.shifts[0] : empSite.shifts) as RawShift | null : null
  if (siteShift) return buildResolved(siteShift, 'site_default')

  return null
}

// ── Batch resolver ─────────────────────────────────────────────────────────────

/**
 * Resolve shifts for multiple employees on one date.
 * All DB queries are batched — zero per-employee round-trips.
 * Returns a Map keyed by employee_id; missing key = no shift resolved.
 */
export async function resolveShiftBatch(
  supabase:    SupabaseClient,
  tenantId:    string,
  employeeIds: string[],
  date:        string,
): Promise<Map<string, ResolvedShift>> {
  if (!employeeIds.length) return new Map()

  const result = new Map<string, ResolvedShift>()

  // ── Step 1: shift_roster overrides ───────────────────────────────────────
  const rosterRows = await fetchChunked(employeeIds, (chunk) =>
    supabase
      .from('shift_roster')
      .select('employee_id, shift_id')
      .eq('tenant_id', tenantId)
      .eq('date', date)
      .in('employee_id', chunk),
  )

  const rosterShiftIds = new Map<string, string>()
  for (const r of rosterRows as { employee_id: string; shift_id: string }[]) {
    rosterShiftIds.set(r.employee_id, r.shift_id)
  }

  // ── Step 2: employee rotation policies + site rotation fallbacks ──────────
  const unrosteredIds = employeeIds.filter(id => !rosterShiftIds.has(id))

  const rotationPolicyMap = new Map<string, { policyId: string; siteId: string | null }>()
  const siteIdMap         = new Map<string, string>()

  if (unrosteredIds.length) {
    const empRows = await fetchChunked(unrosteredIds, (chunk) =>
      supabase
        .from('employees')
        .select('id, site_id, rotation_policy_id, sites!employees_site_id_fkey(id, default_rotation_policy_id, default_shift_id)')
        .eq('tenant_id', tenantId)
        .in('id', chunk),
    )

    for (const e of empRows as any[]) {
      const site = Array.isArray(e.sites) ? e.sites[0] : e.sites
      if (e.site_id) siteIdMap.set(e.id, e.site_id)

      const policyId: string | null =
        e.rotation_policy_id ??
        site?.default_rotation_policy_id ??
        null

      if (policyId) {
        rotationPolicyMap.set(e.id, { policyId, siteId: e.site_id ?? null })
      }
    }
  }

  // ── Step 3: resolve rotation policy rules (batched by unique policy ids) ──
  const dow = new Date(`${date}T12:00:00`).getDay()
  const condition = dayOfWeekToCondition(dow)

  const rotationShiftIds = new Map<string, { shiftId: string; policyId: string; condition: string }>()

  if (condition && rotationPolicyMap.size > 0) {
    const uniquePolicyIds = [...new Set([...rotationPolicyMap.values()].map(v => v.policyId))]
    // Temporal (AHI-3): fetch all rule versions effective on `date`, newest
    // effective_from first, then keep the first (latest-effective) per policy.
    const { data: ruleRows } = await supabase
      .from('rotation_policy_rules')
      .select('rotation_policy_id, shift_id, effective_from')
      .in('rotation_policy_id', uniquePolicyIds)
      .eq('condition_type', condition)
      .lte('effective_from', date)
      .or('effective_to.is.null,effective_to.gte.' + date)
      .order('effective_from', { ascending: false })

    const policyToShift = new Map<string, string>()
    for (const r of (ruleRows ?? []) as any[]) {
      if (!policyToShift.has(r.rotation_policy_id)) {
        policyToShift.set(r.rotation_policy_id, r.shift_id)
      }
    }

    for (const [empId, { policyId }] of rotationPolicyMap) {
      const shiftId = policyToShift.get(policyId)
      if (shiftId) rotationShiftIds.set(empId, { shiftId, policyId, condition })
    }
  }

  // ── Step 4: standing shifts (temporal) for employees still unresolved ─────
  const needStanding = unrosteredIds.filter(id => !rotationShiftIds.has(id))
  const standingShiftIds = new Map<string, string>()

  if (needStanding.length) {
    // Temporal query: effective_from <= date AND (effective_to IS NULL OR effective_to >= date)
    // We fetch all candidates then pick the most recent effective_from per employee
    const { data: standingRows } = await supabase
      .from('employee_shifts')
      .select('employee_id, shift_id, effective_from')
      .eq('tenant_id', tenantId)
      .in('employee_id', needStanding)
      .lte('effective_from', date)
      .or('effective_to.is.null,effective_to.gte.' + date)
      .order('effective_from', { ascending: false })

    const seen = new Set<string>()
    for (const r of (standingRows ?? []) as { employee_id: string; shift_id: string; effective_from: string }[]) {
      if (!seen.has(r.employee_id)) {
        standingShiftIds.set(r.employee_id, r.shift_id)
        seen.add(r.employee_id)
      }
    }
  }

  // ── Step 5: site default_shift_id for remaining employees ─────────────────
  const needSiteDefault = needStanding.filter(id => !standingShiftIds.has(id))
  const siteDefaultShiftIds = new Map<string, string>()

  if (needSiteDefault.length) {
    const siteIds = [...new Set(needSiteDefault.map(id => siteIdMap.get(id)).filter(Boolean))] as string[]
    if (siteIds.length) {
      const { data: siteRows } = await supabase
        .from('sites')
        .select('id, default_shift_id')
        .in('id', siteIds)
        .not('default_shift_id', 'is', null)

      const siteShiftMap = new Map<string, string>(
        (siteRows ?? []).filter((s: any) => s.default_shift_id).map((s: any) => [s.id, s.default_shift_id])
      )
      for (const empId of needSiteDefault) {
        const siteId = siteIdMap.get(empId)
        if (siteId && siteShiftMap.has(siteId)) {
          siteDefaultShiftIds.set(empId, siteShiftMap.get(siteId)!)
        }
      }
    }
  }

  // ── Step 6: batch-fetch all unique shift details ───────────────────────────
  const allShiftIds = new Set<string>([
    ...rosterShiftIds.values(),
    ...[...rotationShiftIds.values()].map(v => v.shiftId),
    ...standingShiftIds.values(),
    ...siteDefaultShiftIds.values(),
  ])

  const shiftDetails = new Map<string, RawShift>()
  if (allShiftIds.size) {
    const { data: shifts } = await supabase
      .from('shifts')
      .select('id, name, start_time, end_time, grace_minutes, is_night_shift')
      .in('id', [...allShiftIds])

    for (const s of (shifts ?? []) as RawShift[]) {
      shiftDetails.set(s.id, s)
    }
  }

  // ── Step 7: build result map ───────────────────────────────────────────────
  for (const empId of employeeIds) {
    // Priority 1: shift_roster
    const rosterShiftId = rosterShiftIds.get(empId)
    if (rosterShiftId) {
      const s = shiftDetails.get(rosterShiftId)
      if (s) { result.set(empId, buildResolved(s, 'shift_roster')); continue }
    }

    // Priority 2: rotation policy
    const rotInfo = rotationShiftIds.get(empId)
    if (rotInfo) {
      const s = shiftDetails.get(rotInfo.shiftId)
      if (s) { result.set(empId, buildResolved(s, 'rotation_policy', rotInfo.policyId, rotInfo.condition)); continue }
    }

    // Priority 3: standing shift (temporal)
    const standingId = standingShiftIds.get(empId)
    if (standingId) {
      const s = shiftDetails.get(standingId)
      if (s) { result.set(empId, buildResolved(s, 'standing_shift')); continue }
    }

    // Priority 4: site default (deprecated)
    const siteDefaultId = siteDefaultShiftIds.get(empId)
    if (siteDefaultId) {
      const s = shiftDetails.get(siteDefaultId)
      if (s) { result.set(empId, buildResolved(s, 'site_default')); continue }
    }
  }

  return result
}

/**
 * Convert a ResolvedShift to the ShiftMeta shape used by computeDay / computeDaily.
 * Call this after resolveShiftWithAttribution / resolveShiftBatch.
 */
export function toShiftMeta(r: ResolvedShift): {
  startTime: string; endTime: string; graceMinutes: number
  isNightShift: boolean; durationMin: number
} {
  return {
    startTime:    r.start_time,
    endTime:      r.end_time,
    graceMinutes: r.grace_minutes,
    isNightShift: r.is_night_shift,
    durationMin:  r.duration_minutes,
  }
}
