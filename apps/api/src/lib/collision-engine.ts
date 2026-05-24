/**
 * CollisionEngine — Holiday / Weekly-Off / Leave Collision Service
 *
 * Implements Phase 5 of the Attendance + Leave Enterprise Maturity Program.
 *
 * Core responsibilities:
 *  1. Preview: compute CollisionResult for a leave date range BEFORE submission
 *  2. Apply: enforce rules on approval (sandwich inclusions, block rejections)
 *  3. Log: write leave_collision_log rows for audit trail
 *
 * Sandwich rule semantics (per leave_policies.sandwich_mode):
 *   'include'  — days sandwiched between leave days are auto-included (charged as leave)
 *   'exclude'  — sandwiched days are not counted (employee benefit, typical for India)
 *   'block'    — leave spanning a holiday/weekend is rejected outright
 *
 * Collision on holiday (per leave_policies.collision_on_holiday):
 *   'block'              — reject the application if any day is a holiday
 *   'allow'              — permitted (charged as leave)
 *   'convert_to_holiday' — reclassify the day as 'holiday' (not deducted from leave balance)
 *
 * Collision on weekly_off (per leave_policies.collision_on_weekly_off):
 *   'block'                  — reject if any day is the employee's weekly off
 *   'allow'                  — permitted (charged as leave)
 *   'convert_to_weekly_off'  — reclassify the day as 'weekly_off' (not deducted)
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import { expandDateRange, shiftDate } from './leave-engine.js'
import {
  resolveEmployeeOrgContext,
  getWeeklyOffDays,
  getHolidayDates,
  type HolidayRowWithDate,
} from './org-context.js'

// ── Types ──────────────────────────────────────────────────────────────────────

export type SandwichMode         = 'include' | 'exclude' | 'block'
export type CollisionOnHoliday   = 'block' | 'allow' | 'convert_to_holiday'
export type CollisionOnWeeklyOff = 'block' | 'allow' | 'convert_to_weekly_off'

export interface CollisionPolicy {
  sandwich_mode:            SandwichMode
  collision_on_holiday:     CollisionOnHoliday
  collision_on_weekly_off:  CollisionOnWeeklyOff
}

export interface DayAnalysis {
  date:           string
  is_holiday:     boolean
  is_weekly_off:  boolean
  is_sandwiched:  boolean   // not directly requested; included due to sandwich
  collision_type: 'holiday' | 'weekly_off' | 'sandwich_holiday' | 'sandwich_weekly_off' | null
  resolution:     'included' | 'excluded' | 'blocked' | 'converted' | 'normal'
  charged:        boolean   // will this day be deducted from leave balance?
}

export interface CollisionResult {
  /** Days explicitly requested by the employee */
  requested_dates:    string[]
  /** Final set of dates that will be charged to leave balance */
  charged_dates:      string[]
  /** Dates auto-included via sandwich rule */
  sandwiched_dates:   string[]
  /** Dates converted to holiday (not charged) */
  converted_dates:    string[]
  /** Total days charged (may include half-day 0.5) */
  charged_days:       number
  /** Blocked — leave application should be rejected */
  is_blocked:         boolean
  block_reason:       string | null
  per_day:            DayAnalysis[]
}

// ── Policy resolver ────────────────────────────────────────────────────────────

export async function resolveCollisionPolicy(
  supabase:    SupabaseClient,
  tenantId:    string,
  leaveTypeId: string,
): Promise<CollisionPolicy> {
  const { data } = await supabase
    .from('leave_policies')
    .select('sandwich_mode, collision_on_holiday, collision_on_weekly_off')
    .eq('tenant_id', tenantId)
    .eq('leave_type_id', leaveTypeId)
    .eq('is_active', true)
    .maybeSingle()

  return {
    sandwich_mode:           ((data as any)?.sandwich_mode          ?? 'include') as SandwichMode,
    collision_on_holiday:    ((data as any)?.collision_on_holiday    ?? 'allow')  as CollisionOnHoliday,
    collision_on_weekly_off: ((data as any)?.collision_on_weekly_off ?? 'allow')  as CollisionOnWeeklyOff,
  }
}

// ── Core collision computation ─────────────────────────────────────────────────

/**
 * Analyse a leave date range for collisions with holidays/weekly-offs.
 * Returns a CollisionResult describing what will be charged and what was auto-included.
 *
 * Does NOT write to DB — call `logCollisions` separately if you want the audit trail.
 */
export async function computeCollision(
  supabase:    SupabaseClient,
  tenantId:    string,
  employeeId:  string,
  fromDate:    string,
  toDate:      string,
  policy:      CollisionPolicy,
): Promise<CollisionResult> {
  // ── Resolve org context for shift / site ─────────────────────────────────
  const orgCtx = await resolveEmployeeOrgContext(supabase, tenantId, employeeId, fromDate)

  // ── Fetch holidays in scan range (±1 day for sandwich scanning) ───────────
  const scanFrom = shiftDate(fromDate, -7)
  const scanTo   = shiftDate(toDate,    7)

  const { data: rawHolidays } = await supabase
    .from('holiday_calendar')
    .select('date, name, is_optional, site_id, location_id')
    .eq('tenant_id', tenantId)
    .gte('date', scanFrom)
    .lte('date', scanTo)

  const holidaySet = getHolidayDates(
    (rawHolidays ?? []) as HolidayRowWithDate[],
    orgCtx,
  )

  // ── Get weekly off days ──────────────────────────────────────────────────
  // Weekly-off days come exclusively from rosters (not shifts).
  // Shifts carry timing rules only; weekly_off_days on shifts is deprecated.
  const weeklyOffDays = getWeeklyOffDays(
    [],   // shift weekly_off_days deprecated — roster is the sole source
    orgCtx.emp_roster_weekly_off,
    orgCtx.site_default_roster_weekly_off,
  )

  // ── Helper: is a date a weekly off? ──────────────────────────────────────
  function isWeeklyOff(dateStr: string): boolean {
    const dow = new Date(`${dateStr}T12:00:00.000Z`).getUTCDay()
    return weeklyOffDays.includes(dow)
  }

  const requestedDates = expandDateRange(fromDate, toDate)
  const requestedSet   = new Set(requestedDates)

  // ── Step 1: Check for blocked collisions ────────────────────────────────
  for (const d of requestedDates) {
    if (holidaySet.has(d) && policy.collision_on_holiday === 'block') {
      return {
        requested_dates:  requestedDates,
        charged_dates:    [],
        sandwiched_dates: [],
        converted_dates:  [],
        charged_days:     0,
        is_blocked:       true,
        block_reason:     `Leave is not allowed on declared holiday: ${d}`,
        per_day:          requestedDates.map(dt => ({
          date: dt, is_holiday: holidaySet.has(dt), is_weekly_off: isWeeklyOff(dt),
          is_sandwiched: false, collision_type: null, resolution: 'blocked' as const, charged: false,
        })),
      }
    }
    if (isWeeklyOff(d) && policy.collision_on_weekly_off === 'block') {
      return {
        requested_dates:  requestedDates,
        charged_dates:    [],
        sandwiched_dates: [],
        converted_dates:  [],
        charged_days:     0,
        is_blocked:       true,
        block_reason:     `Leave is not allowed on weekly off day: ${d}`,
        per_day:          requestedDates.map(dt => ({
          date: dt, is_holiday: holidaySet.has(dt), is_weekly_off: isWeeklyOff(dt),
          is_sandwiched: false, collision_type: null, resolution: 'blocked' as const, charged: false,
        })),
      }
    }
  }

  // ── Step 2: Determine per-day analysis for base requested dates ───────────
  const perDayMap = new Map<string, DayAnalysis>()

  for (const d of requestedDates) {
    const isHoliday = holidaySet.has(d)
    const isWo      = isWeeklyOff(d)
    let resolution: DayAnalysis['resolution']     = 'normal'
    let charged                                    = true
    let collision_type: DayAnalysis['collision_type'] = null

    if (isHoliday) {
      collision_type = 'holiday'
      if (policy.collision_on_holiday === 'convert_to_holiday') {
        resolution = 'converted'
        charged    = false
      } else {
        resolution = 'included'
      }
    } else if (isWo) {
      collision_type = 'weekly_off'
      if (policy.collision_on_weekly_off === 'convert_to_weekly_off') {
        resolution = 'converted'
        charged    = false
      } else {
        resolution = 'included'
      }
    }

    perDayMap.set(d, {
      date: d, is_holiday: isHoliday, is_weekly_off: isWo,
      is_sandwiched: false, collision_type, resolution, charged,
    })
  }

  // ── Step 3: Sandwich detection ────────────────────────────────────────────
  // Scan backward from fromDate-1 and forward from toDate+1 looking for
  // contiguous blocks of holidays/weekly-offs that are flanked by leave days.

  const sandwichedDates: string[] = []

  if (policy.sandwich_mode !== 'block' && requestedDates.length > 0) {
    // Backward scan: gap days immediately before fromDate
    const before: string[] = []
    let cursor = shiftDate(fromDate, -1)
    let limit  = 7  // safety: max 7 sandwiched gap days
    while (limit-- > 0 && (holidaySet.has(cursor) || isWeeklyOff(cursor)) && !requestedSet.has(cursor)) {
      before.push(cursor)
      cursor = shiftDate(cursor, -1)
    }
    if (before.length > 0) {
      for (const bd of before) {
        sandwichedDates.push(bd)
        const isH = holidaySet.has(bd)
        const isW = isWeeklyOff(bd)
        perDayMap.set(bd, {
          date: bd, is_holiday: isH, is_weekly_off: isW, is_sandwiched: true,
          collision_type: isH ? 'sandwich_holiday' : 'sandwich_weekly_off',
          resolution: policy.sandwich_mode === 'include' ? 'included' : 'excluded',
          charged: policy.sandwich_mode === 'include',
        })
      }
    }

    // Forward scan: gap days immediately after toDate
    const after: string[] = []
    cursor = shiftDate(toDate, 1)
    limit  = 7
    while (limit-- > 0 && (holidaySet.has(cursor) || isWeeklyOff(cursor)) && !requestedSet.has(cursor)) {
      after.push(cursor)
      cursor = shiftDate(cursor, 1)
    }
    if (after.length > 0) {
      for (const ad of after) {
        sandwichedDates.push(ad)
        const isH = holidaySet.has(ad)
        const isW = isWeeklyOff(ad)
        perDayMap.set(ad, {
          date: ad, is_holiday: isH, is_weekly_off: isW, is_sandwiched: true,
          collision_type: isH ? 'sandwich_holiday' : 'sandwich_weekly_off',
          resolution: policy.sandwich_mode === 'include' ? 'included' : 'excluded',
          charged: policy.sandwich_mode === 'include',
        })
      }
    }
  }

  // ── Step 4: Build final result ─────────────────────────────────────────────
  const allDays       = [...perDayMap.values()].sort((a, b) => a.date.localeCompare(b.date))
  const chargedDates  = allDays.filter(d => d.charged).map(d => d.date)
  const convertedDates = allDays.filter(d => d.resolution === 'converted').map(d => d.date)

  return {
    requested_dates:  requestedDates,
    charged_dates:    chargedDates,
    sandwiched_dates: sandwichedDates,
    converted_dates:  convertedDates,
    charged_days:     chargedDates.length,
    is_blocked:       false,
    block_reason:     null,
    per_day:          allDays,
  }
}

// ── Audit log writer ────────────────────────────────────────────────────────────

export async function logCollisions(
  supabase:            SupabaseClient,
  tenantId:            string,
  employeeId:          string,
  result:              CollisionResult,
  leaveRequestId?:     string,
  leaveApplicationId?: string,
): Promise<void> {
  const rows = result.per_day
    .filter(d => d.collision_type !== null)
    .map(d => ({
      tenant_id:            tenantId,
      employee_id:          employeeId,
      leave_request_id:     leaveRequestId    ?? null,
      leave_application_id: leaveApplicationId ?? null,
      collision_date:       d.date,
      collision_type:       d.collision_type!,
      resolution:           d.resolution,
      original_status:      d.is_holiday ? 'holiday' : d.is_weekly_off ? 'weekly_off' : null,
      resolved_status:      d.charged ? 'leave'
                          : d.resolution === 'converted'
                            ? (d.is_holiday ? 'holiday' : 'weekly_off')
                            : null,
    }))

  if (rows.length > 0) {
    await supabase.from('leave_collision_log').insert(rows)
  }
}
