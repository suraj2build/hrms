/**
 * org-context.ts
 *
 * Shared helpers for resolving employee organisational context (site, roster,
 * work location, timezone) and applying consistent holiday / weekly-off rules
 * across the attendance processor and leave engine.
 *
 * Precedence rules
 * ─────────────────
 * Shift (timing):   shift_roster override  >  employee_shifts standing  >  site default_shift_id
 * Weekly-off days:  employee roster  >  site default roster  >  []
 *   NOTE: shifts NO LONGER carry weekly_off_days — that concept belongs exclusively
 *   to rosters. The first parameter of getWeeklyOffDays() is kept as [] by callers.
 * Holiday scoping:  location-specific  >  site-specific  >  global   (deduplicated by date)
 * Site/roster:      employee_org_assignments (date-effective)  >  employees.site_id / roster_id
 */

import type { SupabaseClient } from '@supabase/supabase-js'

// ── Exported interfaces ───────────────────────────────────────────────────────

/** Minimal applicability fields on a holiday row (no date needed for single-date checks). */
export interface HolidayApplicability {
  site_id:     string | null
  location_id: string | null
}

/** Full holiday row with date — used in date-range queries (leave engine). */
export interface HolidayRowWithDate extends HolidayApplicability {
  date:        string
  name:        string
  is_optional: boolean
}

/** Resolved organisational context for one employee on one date. */
export interface EmployeeOrgContext {
  site_id:                        string | null
  roster_id:                      string | null
  work_location_id:               string | null
  /** IANA timezone string from the employee's site; 'Asia/Kolkata' when no site. */
  site_timezone:                  string
  /** weekly_off_days from the employee's own roster ([] when none). */
  emp_roster_weekly_off:          number[]
  /** weekly_off_days from the site's default_roster ([] when none). */
  site_default_roster_weekly_off: number[]
  /**
   * The site-level default shift id (sites.default_shift_id).
   * Used as the 3rd-priority fallback in shift resolution when the employee has
   * neither a shift_roster override nor a standing employee_shifts assignment.
   * null when the employee has no site or the site has no default shift.
   */
  site_default_shift_id:          string | null
}

const DEFAULT_TZ = 'Asia/Kolkata'

// ── Pure synchronous helpers ──────────────────────────────────────────────────

/**
 * Resolve weekly-off days using the unified precedence rule:
 *   employee roster > site default roster > []
 *
 * Shifts NO LONGER carry weekly-off information — that concept belongs
 * exclusively to rosters.  The `shiftWeeklyOff` parameter is kept for
 * backwards-compatibility with existing call sites but must always be
 * passed as `[]`.  It will be removed in a future cleanup pass.
 *
 * @param shiftWeeklyOff  DEPRECATED — always pass [].
 */
export function getWeeklyOffDays(
  shiftWeeklyOff:              number[],
  empRosterWeeklyOff:          number[],
  siteDefaultRosterWeeklyOff:  number[],
): number[] {
  // shiftWeeklyOff is deprecated; callers should pass [] — ignored here.
  if (empRosterWeeklyOff.length > 0)          return empRosterWeeklyOff
  if (siteDefaultRosterWeeklyOff.length > 0)  return siteDefaultRosterWeeklyOff
  return []
}

/**
 * Check whether a holiday (pre-filtered to a single date) applies to an employee.
 * Applicability: global (site_id IS NULL AND location_id IS NULL)
 *             OR site matches employee site
 *             OR location matches employee work location.
 */
export function isHolidayForEmployee(
  holidays: HolidayApplicability[],
  ctx:      Pick<EmployeeOrgContext, 'site_id' | 'work_location_id'>,
): boolean {
  return holidays.some((h) => {
    if (!h.site_id && !h.location_id)                                    return true  // global
    if (ctx.site_id          && h.site_id    === ctx.site_id)            return true  // site
    if (ctx.work_location_id && h.location_id === ctx.work_location_id)  return true  // location
    return false
  })
}

/**
 * Build the set of holiday dates applicable to an employee across a date range.
 * Deduplicates: if the same date has both a location and a global holiday, it
 * counts once (location takes priority for naming, but both are still "a holiday").
 *
 * Priority (highest wins when two rows share a date):
 *   location-specific  >  site-specific  >  global
 */
export function getHolidayDates(
  holidays: HolidayRowWithDate[],
  ctx:      Pick<EmployeeOrgContext, 'site_id' | 'work_location_id'>,
): Set<string> {
  // Separate by applicability tier
  const globals   = holidays.filter((h) => !h.site_id && !h.location_id)
  const siteHols  = holidays.filter((h) => h.site_id    !== null && h.site_id    === ctx.site_id)
  const locHols   = holidays.filter((h) => h.location_id !== null && h.location_id === ctx.work_location_id)

  // Fill map in ascending priority (lower-priority first, higher overwrites)
  const byDate = new Map<string, HolidayRowWithDate>()
  for (const h of globals)  byDate.set(h.date, h)
  for (const h of siteHols) byDate.set(h.date, h)   // overrides global for same date
  for (const h of locHols)  byDate.set(h.date, h)   // overrides site+global for same date

  return new Set(byDate.keys())
}

/**
 * Return the day-of-week (0 = Sun … 6 = Sat) for a local date in the given
 * IANA timezone.  Uses UTC noon as the anchor (safe for all UTC offsets ≤ ±13h).
 * Falls back to UTC getUTCDay() on invalid timezone.
 */
export function getLocalDayOfWeek(localDate: string, timezone: string): number {
  const utcNoon = new Date(`${localDate}T12:00:00.000Z`)
  try {
    const short = new Intl.DateTimeFormat('en-US', {
      timeZone: timezone,
      weekday:  'short',
    }).format(utcNoon).toLowerCase()
    const DAYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat']
    const idx  = DAYS.indexOf(short.slice(0, 3))
    return idx >= 0 ? idx : utcNoon.getUTCDay()
  } catch {
    return utcNoon.getUTCDay()
  }
}

/**
 * Return the local time as minutes-since-midnight for a UTC ISO timestamp
 * in the given IANA timezone.  Falls back to UTC on invalid timezone.
 */
export function getLocalTimeMinutes(utcIso: string, timezone: string): number {
  try {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: timezone,
      hour:     '2-digit',
      minute:   '2-digit',
      hour12:   false,
    }).formatToParts(new Date(utcIso))
    const hour   = Number(parts.find((p) => p.type === 'hour')?.value   ?? '0')
    const minute = Number(parts.find((p) => p.type === 'minute')?.value ?? '0')
    return hour * 60 + minute
  } catch {
    const d = new Date(utcIso)
    return d.getUTCHours() * 60 + d.getUTCMinutes()
  }
}

/**
 * Return the local calendar date (YYYY-MM-DD) for a UTC ISO timestamp in the
 * given IANA timezone.  Falls back to UTC date slice on invalid timezone.
 */
export function getLocalDate(utcIso: string, timezone: string): string {
  try {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: timezone,
      year:     'numeric',
      month:    '2-digit',
      day:      '2-digit',
    }).formatToParts(new Date(utcIso))
    const y = parts.find((p) => p.type === 'year')?.value  ?? '2000'
    const m = parts.find((p) => p.type === 'month')?.value ?? '01'
    const d = parts.find((p) => p.type === 'day')?.value   ?? '01'
    return `${y}-${m}-${d}`
  } catch {
    return new Date(utcIso).toISOString().slice(0, 10)
  }
}

// ── Async resolvers ───────────────────────────────────────────────────────────

/**
 * Resolve EmployeeOrgContext for MANY employees on a single date.
 *
 * Resolution order for site_id / roster_id per employee:
 *   1. employee_org_assignments  WHERE effective_from <= date AND (effective_to IS NULL OR effective_to >= date)
 *   2. employees.site_id / employees.roster_id  (fallback)
 *
 * All DB queries are batched — no per-employee round trips.
 */
export async function resolveEmployeeOrgContextBatch(
  supabase:    SupabaseClient,
  tenantId:    string,
  employeeIds: string[],
  date:        string,
): Promise<Map<string, EmployeeOrgContext>> {
  const result = new Map<string, EmployeeOrgContext>()
  if (employeeIds.length === 0) return result

  // 1. Check history assignments effective on `date`
  const { data: histRows } = await supabase
    .from('employee_org_assignments')
    .select('employee_id, site_id, roster_id')
    .eq('tenant_id', tenantId)
    .in('employee_id', employeeIds)
    .lte('effective_from', date)
    .or(`effective_to.is.null,effective_to.gte.${date}`)
    .order('effective_from', { ascending: false })

  // Keep only the most-recent effective row per employee
  const histMap = new Map<string, { site_id: string | null; roster_id: string | null }>()
  for (const r of (histRows ?? []) as { employee_id: string; site_id: string | null; roster_id: string | null }[]) {
    if (!histMap.has(r.employee_id)) histMap.set(r.employee_id, { site_id: r.site_id, roster_id: r.roster_id })
  }

  // 2. Fallback: employees.site_id / roster_id for those without history
  const needFallback = employeeIds.filter((id) => !histMap.has(id))
  const fallbackMap  = new Map<string, { site_id: string | null; roster_id: string | null }>()

  if (needFallback.length > 0) {
    const { data: empRows } = await supabase
      .from('employees')
      .select('id, site_id, roster_id')
      .eq('tenant_id', tenantId)
      .in('id', needFallback)
    for (const e of (empRows ?? []) as { id: string; site_id: string | null; roster_id: string | null }[]) {
      fallbackMap.set(e.id, { site_id: e.site_id ?? null, roster_id: e.roster_id ?? null })
    }
  }

  // Merge
  const orgByEmp = new Map<string, { site_id: string | null; roster_id: string | null }>()
  for (const id of employeeIds) {
    orgByEmp.set(id, histMap.get(id) ?? fallbackMap.get(id) ?? { site_id: null, roster_id: null })
  }

  // 3. Work location from current job_history
  const { data: jobRows } = await supabase
    .from('job_history')
    .select('employee_id, work_location_id')
    .eq('tenant_id', tenantId)
    .in('employee_id', employeeIds)
    .eq('is_current', true)

  const locMap = new Map<string, string | null>()
  for (const j of (jobRows ?? []) as { employee_id: string; work_location_id: string | null }[]) {
    locMap.set(j.employee_id, j.work_location_id ?? null)
  }

  // 4. Fetch unique sites (timezone + default_roster_id + default_shift_id)
  const uniqueSiteIds = [...new Set(
    [...orgByEmp.values()].map((v) => v.site_id).filter((id): id is string => id !== null),
  )]
  const siteDetailMap = new Map<string, {
    timezone:          string
    default_roster_id: string | null
    default_shift_id:  string | null
  }>()

  if (uniqueSiteIds.length > 0) {
    const { data: siteRows } = await supabase
      .from('sites')
      .select('id, timezone, default_roster_id, default_shift_id')
      .eq('tenant_id', tenantId)
      .in('id', uniqueSiteIds)
    for (const s of (siteRows ?? []) as {
      id:                string
      timezone:          string
      default_roster_id: string | null
      default_shift_id:  string | null
    }[]) {
      siteDetailMap.set(s.id, {
        timezone:          s.timezone          ?? DEFAULT_TZ,
        default_roster_id: s.default_roster_id ?? null,
        default_shift_id:  s.default_shift_id  ?? null,
      })
    }
  }

  // 5. Collect all unique roster ids (employee own + site defaults)
  const uniqueRosterIds = new Set<string>()
  for (const { roster_id } of orgByEmp.values())        if (roster_id)                    uniqueRosterIds.add(roster_id)
  for (const { default_roster_id } of siteDetailMap.values()) if (default_roster_id) uniqueRosterIds.add(default_roster_id)

  const rosterWOMap = new Map<string, number[]>()
  if (uniqueRosterIds.size > 0) {
    const { data: rosterRows } = await supabase
      .from('rosters')
      .select('id, pattern_json')
      .eq('tenant_id', tenantId)
      .in('id', [...uniqueRosterIds])
    for (const r of (rosterRows ?? []) as { id: string; pattern_json: { weekly_off_days?: number[] } }[]) {
      rosterWOMap.set(r.id, r.pattern_json?.weekly_off_days ?? [])
    }
  }

  // 6. Assemble per-employee context
  for (const [empId, org] of orgByEmp) {
    const site     = org.site_id ? siteDetailMap.get(org.site_id) : null
    const siteDefR = site?.default_roster_id ?? null

    result.set(empId, {
      site_id:                        org.site_id,
      roster_id:                      org.roster_id,
      work_location_id:               locMap.get(empId) ?? null,
      site_timezone:                  site?.timezone ?? DEFAULT_TZ,
      emp_roster_weekly_off:          org.roster_id ? (rosterWOMap.get(org.roster_id) ?? []) : [],
      site_default_roster_weekly_off: siteDefR       ? (rosterWOMap.get(siteDefR)     ?? []) : [],
      site_default_shift_id:          site?.default_shift_id ?? null,
    })
  }

  return result
}

/**
 * Single-employee convenience wrapper around `resolveEmployeeOrgContextBatch`.
 */
export async function resolveEmployeeOrgContext(
  supabase:   SupabaseClient,
  tenantId:   string,
  employeeId: string,
  date:       string,
): Promise<EmployeeOrgContext> {
  const batch = await resolveEmployeeOrgContextBatch(supabase, tenantId, [employeeId], date)
  return batch.get(employeeId) ?? {
    site_id:                        null,
    roster_id:                      null,
    work_location_id:               null,
    site_timezone:                  DEFAULT_TZ,
    emp_roster_weekly_off:          [],
    site_default_roster_weekly_off: [],
    site_default_shift_id:          null,
  }
}
