/**
 * roster-calendar-engine.ts
 *
 * Enterprise roster & weekly-off resolution engine.
 *
 * Replaces simple weekday[] checks with rule-based computation supporting:
 *   - FIXED_WEEKLY_OFF      — simple weekday list
 *   - ALT_SATURDAY_OFF      — 2nd + 4th Saturday off (configurable)
 *   - FIRST_THIRD_SATURDAY  — 1st + 3rd Saturday off
 *   - ROTATIONAL_OFF        — off-day rotates on a weekly cadence
 *   - CYCLIC_PATTERN        — N work / M off, repeating from a start date
 *   - CUSTOM_CALENDAR       — explicit per-date off list
 *   - Split shifts           — from shift_segments table
 *   - Rotation groups        — Day→Evening→Night cohort shifts
 *   - Holiday groups         — regional/branch/union calendars
 *   - Fatigue & compliance   — consecutive-day / rest-hour checks
 *
 * All public functions are pure or async-pure — no side effects beyond DB reads.
 *
 * ── Backward compatibility ────────────────────────────────────────────────────
 * If no roster_weekly_off_rules exist for a roster, the engine falls back to
 * the legacy roster.pattern_json.weekly_off_days array. Existing rosters with
 * no rules continue to work unchanged.
 */

import type { SupabaseClient } from '@supabase/supabase-js'

// ── Types ──────────────────────────────────────────────────────────────────────

export type RuleType =
  | 'FIXED_WEEKLY_OFF'
  | 'ALT_SATURDAY_OFF'
  | 'FIRST_THIRD_SATURDAY'
  | 'ROTATIONAL_OFF'
  | 'CYCLIC_PATTERN'
  | 'CUSTOM_CALENDAR'

export interface WeeklyOffRule {
  id:             string
  tenant_id:      string
  roster_id:      string
  rule_type:      RuleType
  rule_config:    Record<string, unknown>
  effective_from: string          // YYYY-MM-DD
  effective_to:   string | null
  priority:       number
}

export interface ShiftSegment {
  id:                   string
  shift_id:             string
  segment_order:        number
  start_time:           string   // HH:MM:SS
  end_time:             string   // HH:MM:SS
  minimum_hours:        number
  break_after_minutes:  number
}

export interface RotationGroupConfig {
  shifts:       Array<{ shift_id: string; cohort_index: number }>
  cycle_weeks:  number
  start_date:   string            // YYYY-MM-DD — cycle anchor
  auto_advance?: boolean
}

export interface WeeklyOffStatus {
  is_weekly_off:              boolean
  rule_type?:                 RuleType
  is_alternate_saturday_off:  boolean
  cyclic_position?:           number    // 0-indexed position in CYCLIC_PATTERN cycle
}

export interface ShiftExpectation {
  shift_id:           string | null
  shift_name?:        string
  start_time?:        string
  end_time?:          string
  grace_minutes:      number
  flex_policy?:       Record<string, unknown>
  is_split_shift:     boolean
  segments?:          ShiftSegment[]
  is_rotation:        boolean
  rotation_group_id?: string | null
}

export interface DayResolution {
  date:                       string    // YYYY-MM-DD
  day_of_week:                number    // 0 = Sun … 6 = Sat
  is_working_day:             boolean
  is_weekly_off:              boolean
  is_alternate_saturday_off:  boolean
  is_holiday:                 boolean
  holiday_name?:              string
  weekly_off_rule_type?:      RuleType
  cyclic_position?:           number
  expected_shift_id:          string | null
  expected_shift_name?:       string
  is_split_shift:             boolean
  split_segments?:            ShiftSegment[]
  overtime_eligible:          boolean
  fatigue_risk:               boolean
  fatigue_reason?:            string
  rotation_group_id?:         string | null
  rotation_cohort_index?:     number | null
  saturday_number?:           number    // 1–5 (which Saturday in the month)
  is_last_saturday?:          boolean
}

export interface FatigueCheckResult {
  has_risk:             boolean
  consecutive_days:     number
  max_consecutive:      number
  rest_hours_before:    number | null
  min_rest_hours:       number
  reasons:              string[]
}

// ── Date Helpers ───────────────────────────────────────────────────────────────

/** Parse YYYY-MM-DD into a local Date (no timezone shift). */
function parseDate(s: string): Date {
  const [y, m, d] = s.split('-').map(Number)
  return new Date(y, m - 1, d)
}

/** Format a local Date to YYYY-MM-DD. */
function formatDate(date: Date): string {
  const y = date.getFullYear()
  const m = String(date.getMonth() + 1).padStart(2, '0')
  const d = String(date.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

/** Integer days from date a to date b (positive when b > a). */
function daysBetween(a: Date, b: Date): number {
  return Math.floor((b.getTime() - a.getTime()) / 86_400_000)
}

/** Shift a YYYY-MM-DD string by deltaDays via Date.UTC at UTC-noon — DST-safe,
 *  unlike subtracting raw milliseconds from a local-timezone Date. */
function shiftDateStrUtc(dateStr: string, deltaDays: number): string {
  const [y, m, d] = dateStr.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, d + deltaDays, 12)).toISOString().slice(0, 10)
}

// ── Saturday Helpers ──────────────────────────────────────────────────────────

/**
 * Return which Saturday-of-the-month (1=first, 2=second, …) this date is.
 * Returns null if the date is not a Saturday.
 */
export function getSaturdayNumberInMonth(date: Date): number | null {
  if (date.getDay() !== 6) return null
  return Math.ceil(date.getDate() / 7)
}

/** Return true if this Saturday is the last one in its month. */
export function isLastSaturdayOfMonth(date: Date): boolean {
  if (date.getDay() !== 6) return false
  const nextWeek = new Date(date)
  nextWeek.setDate(date.getDate() + 7)
  return nextWeek.getMonth() !== date.getMonth()
}

// ── Rule Evaluators ───────────────────────────────────────────────────────────

/**
 * computeAlternateSaturday — evaluate ALT_SATURDAY_OFF / FIRST_THIRD_SATURDAY rules.
 *
 * config.weeks may contain integers (1–5) and/or the string 'last'.
 * Examples:
 *   { weekday: 6, weeks: [2, 4] }        → 2nd + 4th Saturdays are off
 *   { weekday: 6, weeks: [1, 3] }        → 1st + 3rd Saturdays are off
 *   { weekday: 6, weeks: ['last'] }      → last Saturday of the month is off
 *   { weekday: 6, weeks: [1,2,3,4,5] }  → all Saturdays are off
 */
export function computeAlternateSaturday(
  date:   Date,
  config: { weekday: number; weeks: Array<number | 'last'> },
): boolean {
  if (date.getDay() !== config.weekday) return false
  const satNum = getSaturdayNumberInMonth(date)

  for (const w of config.weeks) {
    if (w === 'last' && isLastSaturdayOfMonth(date)) return true
    if (typeof w === 'number' && satNum === w) return true
  }
  return false
}

/**
 * resolveRosterPattern — evaluate CYCLIC_PATTERN rules.
 *
 * config: {
 *   cycle_days:    int,       -- total cycle length (e.g. 6)
 *   off_days:      int[],     -- 0-indexed positions within cycle that are off (e.g. [4,5])
 *   working_days?: int[],     -- (optional) 0-indexed positions that are working — unused
 *   cycle_start?:  string,    -- YYYY-MM-DD anchor (defaults to rule effective_from)
 * }
 */
export function resolveRosterPattern(
  date: Date,
  rule: WeeklyOffRule,
): { is_off: boolean; position_in_cycle: number } {
  const config = rule.rule_config as {
    cycle_days:   number
    off_days:     number[]
    cycle_start?: string
  }
  const anchor    = parseDate(config.cycle_start ?? rule.effective_from)
  const cycleDays = Math.max(1, config.cycle_days ?? 7)
  const offset    = daysBetween(anchor, date)
  // Modulo that handles negative offset gracefully
  const pos       = ((offset % cycleDays) + cycleDays) % cycleDays

  return { is_off: (config.off_days ?? []).includes(pos), position_in_cycle: pos }
}

/**
 * ROTATIONAL_OFF — the off-day rotates among multiple schedules on a weekly cadence.
 * config: {
 *   rotation_schedules: [{ weekdays: int[] }, ...],
 *   rotation_weeks:     int,      -- how many weeks per rotation slot
 *   start_date?:        string,   -- YYYY-MM-DD anchor
 * }
 */
function resolveRotationalOff(date: Date, rule: WeeklyOffRule): boolean {
  const config = rule.rule_config as {
    rotation_schedules: Array<{ weekdays: number[] }>
    rotation_weeks:     number
    start_date?:        string
  }
  if (!config.rotation_schedules?.length) return false

  const start      = parseDate(config.start_date ?? rule.effective_from)
  const weekOffset = Math.floor(daysBetween(start, date) / 7)
  const slotLen    = Math.max(1, config.rotation_weeks ?? 1)
  const slot       = Math.floor(weekOffset / slotLen) % config.rotation_schedules.length
  const schedule   = config.rotation_schedules[slot]

  return (schedule?.weekdays ?? []).includes(date.getDay())
}

/**
 * CUSTOM_CALENDAR — explicit list of off dates.
 * config: { off_dates: ['YYYY-MM-DD', ...] }
 */
function resolveCustomCalendar(date: Date, rule: WeeklyOffRule): boolean {
  const config = rule.rule_config as { off_dates?: string[] }
  return (config.off_dates ?? []).includes(formatDate(date))
}

/**
 * evaluateRule — evaluate a single WeeklyOffRule for a given date.
 * Returns true if this rule classifies the date as a weekly off.
 */
export function evaluateRule(rule: WeeklyOffRule, date: Date): boolean {
  const dateStr = formatDate(date)
  if (dateStr < rule.effective_from) return false
  if (rule.effective_to && dateStr > rule.effective_to) return false

  switch (rule.rule_type) {
    case 'FIXED_WEEKLY_OFF': {
      const cfg = rule.rule_config as { weekdays?: number[] }
      return (cfg.weekdays ?? []).includes(date.getDay())
    }
    case 'ALT_SATURDAY_OFF':
    case 'FIRST_THIRD_SATURDAY': {
      const cfg = rule.rule_config as { weekday: number; weeks: Array<number | 'last'> }
      return computeAlternateSaturday(date, cfg)
    }
    case 'CYCLIC_PATTERN':   return resolveRosterPattern(date, rule).is_off
    case 'ROTATIONAL_OFF':   return resolveRotationalOff(date, rule)
    case 'CUSTOM_CALENDAR':  return resolveCustomCalendar(date, rule)
    default:                 return false
  }
}

// ── Weekly-Off Status ─────────────────────────────────────────────────────────

/**
 * computeWeeklyOffStatus — apply all active rules for a roster on a date.
 *
 * Rules are evaluated in descending priority order; first match wins.
 * Falls back to legacyDays (roster.pattern_json.weekly_off_days) only when the
 * roster has NO rules at all. If rules exist but none matched this date, the
 * date is a working day — the legacy array is never consulted as a per-date
 * tiebreaker, since it can't express which specific Saturdays a rule covers.
 */
export function computeWeeklyOffStatus(
  date:        Date,
  rules:       WeeklyOffRule[],
  legacyDays:  number[],
): WeeklyOffStatus {
  const sorted = [...rules].sort((a, b) => b.priority - a.priority)

  for (const rule of sorted) {
    if (!evaluateRule(rule, date)) continue

    const isAltSat = rule.rule_type === 'ALT_SATURDAY_OFF' || rule.rule_type === 'FIRST_THIRD_SATURDAY'
    let cyclicPos: number | undefined
    if (rule.rule_type === 'CYCLIC_PATTERN') {
      cyclicPos = resolveRosterPattern(date, rule).position_in_cycle
    }

    return {
      is_weekly_off:              true,
      rule_type:                  rule.rule_type,
      is_alternate_saturday_off:  isAltSat,
      cyclic_position:            cyclicPos,
    }
  }

  // No rules exist for this roster at all — fall back to the legacy array.
  // If rules DO exist but simply didn't match this date (e.g. an
  // ALT_SATURDAY_OFF rule only fires on the 2nd/4th Saturday), the roster's
  // rule-based configuration is authoritative and this date is a working
  // day — falling through to legacyDays here previously caused every
  // Saturday to resolve as weekly_off regardless of the rule, because
  // rosters saved via the matrix editor also persist a flattened/unioned
  // pattern_json.weekly_off_days (e.g. [0,6]) alongside their rules.
  if (rules.length === 0) {
    const isOff = legacyDays.includes(date.getDay())
    return {
      is_weekly_off:              isOff,
      rule_type:                  isOff ? 'FIXED_WEEKLY_OFF' : undefined,
      is_alternate_saturday_off:  false,
    }
  }
  return { is_weekly_off: false, rule_type: undefined, is_alternate_saturday_off: false }
}

/**
 * resolveIsWeeklyOff — convenience wrapper for the attendance engine.
 * Fetches rules once from the DB, then delegates to computeWeeklyOffStatus.
 */
export async function resolveIsWeeklyOff(
  supabase:    SupabaseClient,
  tenantId:    string,
  rosterId:    string | null,
  legacyDays:  number[],
  dateStr:     string,
): Promise<WeeklyOffStatus> {
  const rules = rosterId
    ? await _fetchWeeklyOffRules(supabase, tenantId, rosterId, dateStr)
    : []
  return computeWeeklyOffStatus(parseDate(dateStr), rules, legacyDays)
}

// ── DB Fetch Helpers ──────────────────────────────────────────────────────────

async function _fetchWeeklyOffRules(
  supabase:  SupabaseClient,
  tenantId:  string,
  rosterId:  string,
  dateStr:   string,
): Promise<WeeklyOffRule[]> {
  const { data, error } = await supabase
    .from('roster_weekly_off_rules')
    .select('*')
    .eq('tenant_id', tenantId)
    .eq('roster_id', rosterId)
    .lte('effective_from', dateStr)
    .or(`effective_to.is.null,effective_to.gte.${dateStr}`)
    .order('priority', { ascending: false })

  // A failed query previously fell through to "no advanced rule", which
  // computeWeeklyOffStatus treats as "fall back to legacy weekly_off_days" —
  // silently reclassifying a rostered weekly-off day as a working day.
  if (error) {
    throw new Error(`_fetchWeeklyOffRules: DB query failed — ${error.message}`)
  }
  return (data ?? []) as WeeklyOffRule[]
}

async function _fetchHoliday(
  supabase: SupabaseClient,
  tenantId: string,
  dateStr:  string,
  groupId:  string | null,
): Promise<{ name: string; is_optional: boolean } | null> {
  let q = supabase
    .from('holiday_calendar')
    .select('name, is_optional')
    .eq('tenant_id', tenantId)
    .eq('date', dateStr)

  q = groupId
    ? q.or(`holiday_group_id.is.null,holiday_group_id.eq.${groupId}`)
    : q.is('holiday_group_id', null)

  const { data, error } = await q.limit(1).maybeSingle()
  // Fresh audit finding: previously discarded — a query error silently fell
  // through to "not a holiday", inflating working-day counts and leave-day
  // charges for that date. Throws, matching attendance-engine.ts's
  // fetchHoliday's established contract for the same bug class.
  if (error) {
    throw new Error(`_fetchHoliday: DB query failed — ${error.message}`)
  }
  return data ?? null
}

async function _fetchRotationMembership(
  supabase:   SupabaseClient,
  tenantId:   string,
  employeeId: string,
  dateStr:    string,
): Promise<{ group_id: string; cohort_index: number; config: RotationGroupConfig } | null> {
  const { data, error } = await supabase
    .from('roster_rotation_members')
    .select(`
      cohort_index,
      rotation_group_id,
      grp:roster_rotation_groups!rotation_group_id(rotation_config, is_active)
    `)
    .eq('tenant_id', tenantId)
    .eq('employee_id', employeeId)
    .lte('effective_from', dateStr)
    .or(`effective_to.is.null,effective_to.gte.${dateStr}`)
    .limit(1)
    .maybeSingle()

  if (error) {
    throw new Error(`_fetchRotationMembership: DB query failed — ${error.message}`)
  }
  if (!data) return null
  const grp = (data as Record<string, unknown>).grp as { rotation_config: RotationGroupConfig; is_active: boolean } | null
  // A deactivated rotation group must not keep driving shift assignment —
  // members should fall back to their standing/site-default shift instead
  // (fresh audit finding: this query previously had no is_active filter at
  // all, so ending a rotation program via is_active=false silently had no
  // effect on already-existing membership rows).
  if (grp && grp.is_active === false) return null
  return {
    group_id:     data.rotation_group_id as string,
    cohort_index: data.cohort_index as number,
    config:       grp?.rotation_config ?? { shifts: [], cycle_weeks: 1, start_date: dateStr },
  }
}

function _resolveRotationShift(
  dateStr:     string,
  cohortIndex: number,
  config:      RotationGroupConfig,
): string | null {
  const { shifts, cycle_weeks, start_date } = config
  if (!shifts?.length || !start_date) return null

  const weekOffset   = Math.floor(daysBetween(parseDate(start_date), parseDate(dateStr)) / 7)
  const cycleLen     = Math.max(1, cycle_weeks ?? 1)
  const cohortShifts = shifts.filter(s => s.cohort_index === cohortIndex)
  if (!cohortShifts.length) return null

  const slotIndex = weekOffset % cycleLen
  return cohortShifts[slotIndex % cohortShifts.length]?.shift_id ?? null
}

interface EmpRosterCtx {
  roster_id:          string | null
  roster_weekly_off:  number[]
  holiday_group_id:   string | null
  fatigue_rules:      Record<string, number> | null
  site_default_shift_id: string | null
}

async function _fetchEmpRosterCtx(
  supabase:   SupabaseClient,
  tenantId:   string,
  employeeId: string,
): Promise<EmpRosterCtx> {
  const { data: emp, error } = await supabase
    .from('employees')
    .select(`
      roster_id, site_id,
      emp_roster:rosters!roster_id(pattern_json, fatigue_rules, holiday_group_id),
      site:sites!site_id(default_shift_id, default_roster_id,
        site_roster:rosters!default_roster_id(pattern_json, fatigue_rules, holiday_group_id))
    `)
    .eq('id', employeeId)
    .eq('tenant_id', tenantId)
    .maybeSingle()

  if (error) {
    throw new Error(`_fetchEmpRosterCtx: DB query failed — ${error.message}`)
  }
  if (!emp) return { roster_id: null, roster_weekly_off: [], holiday_group_id: null, fatigue_rules: null, site_default_shift_id: null }

  type RosterSnap = { pattern_json: { weekly_off_days: number[] }; fatigue_rules: unknown; holiday_group_id: string | null }
  const er  = (emp as Record<string, unknown>).emp_roster  as RosterSnap | null
  const st  = (emp as Record<string, unknown>).site        as { default_shift_id: string | null; default_roster_id: string | null; site_roster: RosterSnap | null } | null
  const eff = er ?? st?.site_roster ?? null

  return {
    roster_id:             (emp as Record<string, unknown>).roster_id as string | null
                           ?? st?.default_roster_id ?? null,
    roster_weekly_off:     eff?.pattern_json?.weekly_off_days ?? [],
    holiday_group_id:      eff?.holiday_group_id ?? null,
    fatigue_rules:         (eff?.fatigue_rules as Record<string, number>) ?? null,
    site_default_shift_id: st?.default_shift_id ?? null,
  }
}

async function _resolveShiftId(
  supabase:         SupabaseClient,
  tenantId:         string,
  employeeId:       string,
  dateStr:          string,
  siteDefaultShift: string | null,
  rotationShiftId:  string | null,
): Promise<string | null> {
  // Priority 1: date-specific shift_roster override
  const { data: override, error: overrideErr } = await supabase
    .from('shift_roster')
    .select('shift_id')
    .eq('tenant_id', tenantId)
    .eq('employee_id', employeeId)
    .eq('date', dateStr)
    .maybeSingle()
  if (overrideErr) throw new Error(`_resolveShiftId: shift_roster query failed — ${overrideErr.message}`)
  if (override?.shift_id) return override.shift_id as string

  // Priority 2: rotation group result
  if (rotationShiftId) return rotationShiftId

  // Priority 3: standing employee shift
  const { data: standing, error: standingErr } = await supabase
    .from('employee_shifts')
    .select('shift_id')
    .eq('tenant_id', tenantId)
    .eq('employee_id', employeeId)
    .eq('is_current', true)
    .maybeSingle()
  if (standingErr) throw new Error(`_resolveShiftId: employee_shifts query failed — ${standingErr.message}`)
  if (standing?.shift_id) return standing.shift_id as string

  // Priority 4: site default
  return siteDefaultShift
}

async function _fetchShiftWithSegments(
  supabase: SupabaseClient,
  tenantId: string,
  shiftId:  string,
): Promise<{
  shift_id:      string
  name:          string
  start_time:    string
  end_time:      string
  grace_minutes: number
  flex_policy:   unknown
  segments:      ShiftSegment[]
} | null> {
  const { data: shift, error: shiftErr } = await supabase
    .from('shifts')
    .select('id, name, start_time, end_time, grace_minutes, flex_policy')
    .eq('id', shiftId)
    .eq('tenant_id', tenantId)
    .maybeSingle()
  if (shiftErr) throw new Error(`_fetchShiftWithSegments: shifts query failed — ${shiftErr.message}`)
  if (!shift) return null

  // shift_segments carries its own tenant_id (migration 147) — without this
  // filter, a segment row inserted under another tenant but pointing at this
  // shift_id (e.g. via an unvalidated FK write elsewhere) would be picked up
  // here, flipping is_split_shift and corrupting this tenant's OT/split-shift
  // computation with a foreign tenant's segment data.
  const { data: segs, error: segsErr } = await supabase
    .from('shift_segments')
    .select('*')
    .eq('shift_id', shiftId)
    .eq('tenant_id', tenantId)
    .order('segment_order')
  if (segsErr) throw new Error(`_fetchShiftWithSegments: shift_segments query failed — ${segsErr.message}`)

  return {
    shift_id:      shift.id as string,
    name:          shift.name as string,
    start_time:    shift.start_time as string,
    end_time:      shift.end_time as string,
    grace_minutes: (shift.grace_minutes as number) ?? 15,
    flex_policy:   shift.flex_policy,
    segments:      (segs ?? []) as ShiftSegment[],
  }
}

// ── Fatigue Check ─────────────────────────────────────────────────────────────

/**
 * checkFatigueRisk — check consecutive-day / rest-hour compliance for an employee.
 * Looks back up to 14 calendar days from dateStr for recent attendance.
 */
export async function checkFatigueRisk(
  supabase:     SupabaseClient,
  tenantId:     string,
  employeeId:   string,
  dateStr:      string,
  fatigueRules: Record<string, number> | null,
): Promise<FatigueCheckResult> {
  const maxConsec   = fatigueRules?.max_consecutive_workdays ?? 6
  const minRest     = fatigueRules?.min_rest_hours           ?? 8

  // F11: shift the 14-day lookback via Date.UTC at UTC-noon (mirrors
  // intelligence-scanner.ts's shiftDateStr) rather than subtracting raw
  // milliseconds from a local-timezone Date — the old form isn't DST-safe on
  // any host whose process TZ observes DST, which could silently shrink/grow
  // the lookback window by a day around a DST transition.
  const lookback    = shiftDateStrUtc(dateStr, -14)

  const { data: rows } = await supabase
    .from('attendance_daily')
    .select('date, status, work_hours, overtime_minutes')
    .eq('tenant_id', tenantId)
    .eq('employee_id', employeeId)
    .gte('date', lookback)
    .lt('date', dateStr)
    .order('date', { ascending: false })

  let consecutive = 0
  for (const r of (rows ?? [])) {
    if (['present', 'late', 'half_day'].includes(r.status as string)) {
      consecutive++
    } else {
      break
    }
  }

  const reasons: string[] = []
  if (consecutive >= maxConsec) {
    reasons.push(`${consecutive} consecutive working days (max ${maxConsec})`)
  }

  // Rest hours check: based on yesterday's total hours
  const yesterday   = (rows ?? [])[0]
  let restHours: number | null = null
  if (yesterday?.work_hours) {
    const totalH = (yesterday.work_hours as number) + ((yesterday.overtime_minutes as number) ?? 0) / 60
    restHours    = 24 - totalH
    if (restHours < minRest) {
      reasons.push(`Only ${restHours.toFixed(1)}h rest before shift (min ${minRest}h)`)
    }
  }

  return {
    has_risk:          reasons.length > 0,
    consecutive_days:  consecutive,
    max_consecutive:   maxConsec,
    rest_hours_before: restHours,
    min_rest_hours:    minRest,
    reasons,
  }
}

// ── Primary Exports ───────────────────────────────────────────────────────────

/**
 * resolveShiftExpectation — return the expected shift for an employee on a given date.
 * Applies the full precedence chain:
 *   shift_roster override → rotation group → standing employee shift → site default
 */
export async function resolveShiftExpectation(
  supabase:   SupabaseClient,
  tenantId:   string,
  employeeId: string,
  dateStr:    string,
): Promise<ShiftExpectation> {
  const ctx      = await _fetchEmpRosterCtx(supabase, tenantId, employeeId)
  const rotation = await _fetchRotationMembership(supabase, tenantId, employeeId, dateStr)
  const rotShift = rotation ? _resolveRotationShift(dateStr, rotation.cohort_index, rotation.config) : null

  const shiftId  = await _resolveShiftId(supabase, tenantId, employeeId, dateStr, ctx.site_default_shift_id, rotShift)

  if (!shiftId) {
    return { shift_id: null, grace_minutes: 15, is_split_shift: false, is_rotation: !!rotation, rotation_group_id: rotation?.group_id ?? null }
  }

  const sd = await _fetchShiftWithSegments(supabase, tenantId, shiftId)
  if (!sd) {
    return { shift_id: shiftId, grace_minutes: 15, is_split_shift: false, is_rotation: !!rotation }
  }

  const isSplit = sd.segments.length > 1
  return {
    shift_id:          shiftId,
    shift_name:        sd.name,
    start_time:        sd.start_time,
    end_time:          sd.end_time,
    grace_minutes:     sd.grace_minutes,
    flex_policy:       sd.flex_policy as Record<string, unknown>,
    is_split_shift:    isSplit,
    segments:          isSplit ? sd.segments : undefined,
    is_rotation:       !!rotation,
    rotation_group_id: rotation?.group_id ?? null,
  }
}

/**
 * resolveRosterDay — full day resolution for a single employee on a given date.
 *
 * This is the single canonical source of truth for attendance expectations.
 * The attendance engine must derive expected_status from this function, not
 * from inline weekday comparisons.
 */
export async function resolveRosterDay(
  supabase:   SupabaseClient,
  tenantId:   string,
  employeeId: string,
  dateStr:    string,
): Promise<DayResolution> {
  const date = parseDate(dateStr)
  const ctx  = await _fetchEmpRosterCtx(supabase, tenantId, employeeId)

  // Weekly-off rules
  const rules     = ctx.roster_id ? await _fetchWeeklyOffRules(supabase, tenantId, ctx.roster_id, dateStr) : []
  const woffStatus = computeWeeklyOffStatus(date, rules, ctx.roster_weekly_off)

  // Holiday
  const holiday   = await _fetchHoliday(supabase, tenantId, dateStr, ctx.holiday_group_id)
  const isHoliday = !!holiday && !holiday.is_optional

  // Rotation + shift
  const rotation  = await _fetchRotationMembership(supabase, tenantId, employeeId, dateStr)
  const rotShift  = rotation ? _resolveRotationShift(dateStr, rotation.cohort_index, rotation.config) : null
  const shiftId   = await _resolveShiftId(supabase, tenantId, employeeId, dateStr, ctx.site_default_shift_id, rotShift)
  const sd        = (woffStatus.is_weekly_off || isHoliday) ? null : (shiftId ? await _fetchShiftWithSegments(supabase, tenantId, shiftId) : null)
  const isSplit   = (sd?.segments.length ?? 0) > 1

  // Fatigue
  const fatigue   = await checkFatigueRisk(supabase, tenantId, employeeId, dateStr, ctx.fatigue_rules)

  // Saturday metadata
  const satNum    = date.getDay() === 6 ? getSaturdayNumberInMonth(date) : null

  return {
    date:                       dateStr,
    day_of_week:                date.getDay(),
    is_working_day:             !woffStatus.is_weekly_off && !isHoliday,
    is_weekly_off:              woffStatus.is_weekly_off,
    is_alternate_saturday_off:  woffStatus.is_alternate_saturday_off,
    is_holiday:                 isHoliday,
    holiday_name:               holiday?.name,
    weekly_off_rule_type:       woffStatus.rule_type,
    cyclic_position:            woffStatus.cyclic_position,
    expected_shift_id:          sd?.shift_id ?? null,
    expected_shift_name:        sd?.name,
    is_split_shift:             isSplit,
    split_segments:             isSplit ? sd!.segments : undefined,
    overtime_eligible:          !woffStatus.is_weekly_off && !isHoliday && !fatigue.has_risk,
    fatigue_risk:               fatigue.has_risk,
    fatigue_reason:             fatigue.reasons.join('; ') || undefined,
    rotation_group_id:          rotation?.group_id ?? null,
    rotation_cohort_index:      rotation?.cohort_index ?? null,
    ...(satNum !== null ? { saturday_number: satNum, is_last_saturday: isLastSaturdayOfMonth(date) } : {}),
  }
}

/**
 * buildEmployeeRosterCalendar — generate DayResolution for every day in a month.
 *
 * Optimised for batch use: holidays, shift overrides, and shift data are all
 * pre-fetched once; per-day fatigue checks are skipped in bulk mode for speed.
 */
export async function buildEmployeeRosterCalendar(
  supabase:   SupabaseClient,
  tenantId:   string,
  employeeId: string,
  month:      string,             // YYYY-MM
): Promise<DayResolution[]> {
  const [y, m]       = month.split('-').map(Number)
  const daysInMonth  = new Date(y, m, 0).getDate()
  const monthStart   = `${month}-01`
  const monthEnd     = `${month}-${String(daysInMonth).padStart(2, '0')}`

  // Pre-fetch context + rules once
  const ctx   = await _fetchEmpRosterCtx(supabase, tenantId, employeeId)
  const rules = ctx.roster_id ? await _fetchWeeklyOffRules(supabase, tenantId, ctx.roster_id, monthStart) : []

  // Pre-fetch all holidays for the month
  let holidayQ = supabase
    .from('holiday_calendar')
    .select('date, name, is_optional')
    .eq('tenant_id', tenantId)
    .gte('date', monthStart)
    .lte('date', monthEnd)

  holidayQ = ctx.holiday_group_id
    ? holidayQ.or(`holiday_group_id.is.null,holiday_group_id.eq.${ctx.holiday_group_id}`)
    : holidayQ.is('holiday_group_id', null)

  const { data: holidays, error: holidayErr } = await holidayQ
  // Fresh audit finding: same unchecked-error bug as _fetchHoliday above —
  // this pre-fetch feeds countRosterWorkingDays (payroll working-days count)
  // and leave-request-service.ts's working-day exclusion logic, so a
  // silently empty holiday map here inflates working-day counts and
  // leave-day charges for the whole month, not just one date.
  if (holidayErr) {
    throw new Error(`buildEmployeeRosterCalendar: holiday query failed — ${holidayErr.message}`)
  }
  const holidayMap = new Map(
    (holidays ?? []).map(h => [h.date as string, { name: h.name as string, is_optional: h.is_optional as boolean }])
  )

  // Pre-fetch shift_roster overrides for the month
  const { data: overrides, error: overridesErr } = await supabase
    .from('shift_roster')
    .select('date, shift_id')
    .eq('tenant_id', tenantId)
    .eq('employee_id', employeeId)
    .gte('date', monthStart)
    .lte('date', monthEnd)
  if (overridesErr) {
    throw new Error(`buildEmployeeRosterCalendar: shift_roster overrides query failed — ${overridesErr.message}`)
  }
  const overrideMap = new Map((overrides ?? []).map(r => [r.date as string, r.shift_id as string]))

  // Pre-fetch standing shift
  const { data: standing, error: standingErr } = await supabase
    .from('employee_shifts')
    .select('shift_id')
    .eq('tenant_id', tenantId)
    .eq('employee_id', employeeId)
    .eq('is_current', true)
    .maybeSingle()
  if (standingErr) {
    throw new Error(`buildEmployeeRosterCalendar: employee_shifts query failed — ${standingErr.message}`)
  }
  const standingShiftId = (standing?.shift_id as string) ?? ctx.site_default_shift_id ?? null

  // Pre-fetch rotation membership
  const rotation = await _fetchRotationMembership(supabase, tenantId, employeeId, monthStart)

  // Shift data cache (avoid repeat fetches)
  const shiftCache = new Map<string, Awaited<ReturnType<typeof _fetchShiftWithSegments>>>()
  async function getShift(id: string | null) {
    if (!id) return null
    if (shiftCache.has(id)) return shiftCache.get(id)!
    const s = await _fetchShiftWithSegments(supabase, tenantId, id)
    shiftCache.set(id, s)
    return s
  }

  const results: DayResolution[] = []

  for (let d = 1; d <= daysInMonth; d++) {
    const dateStr = `${month}-${String(d).padStart(2, '0')}`
    const date    = parseDate(dateStr)

    const woff      = computeWeeklyOffStatus(date, rules, ctx.roster_weekly_off)
    const hEntry    = holidayMap.get(dateStr)
    const isHoliday = !!hEntry && !hEntry.is_optional

    let shiftId: string | null = overrideMap.get(dateStr) ?? null
    if (!shiftId && rotation) {
      shiftId = _resolveRotationShift(dateStr, rotation.cohort_index, rotation.config)
    }
    if (!shiftId) shiftId = standingShiftId

    const sd      = await getShift(woff.is_weekly_off || isHoliday ? null : shiftId)
    const isSplit = (sd?.segments.length ?? 0) > 1
    const satNum  = date.getDay() === 6 ? getSaturdayNumberInMonth(date) : null

    results.push({
      date:                       dateStr,
      day_of_week:                date.getDay(),
      is_working_day:             !woff.is_weekly_off && !isHoliday,
      is_weekly_off:              woff.is_weekly_off,
      is_alternate_saturday_off:  woff.is_alternate_saturday_off,
      is_holiday:                 isHoliday,
      holiday_name:               hEntry?.name,
      weekly_off_rule_type:       woff.rule_type,
      cyclic_position:            woff.cyclic_position,
      expected_shift_id:          sd?.shift_id ?? null,
      expected_shift_name:        sd?.name,
      is_split_shift:             isSplit,
      split_segments:             isSplit ? sd!.segments : undefined,
      overtime_eligible:          !woff.is_weekly_off && !isHoliday,
      fatigue_risk:               false,   // skipped in bulk mode for performance
      rotation_group_id:          rotation?.group_id ?? null,
      rotation_cohort_index:      rotation?.cohort_index ?? null,
      ...(satNum !== null ? { saturday_number: satNum, is_last_saturday: isLastSaturdayOfMonth(date) } : {}),
    })
  }

  return results
}

/**
 * countRosterWorkingDays — count payable working days in a month for an employee.
 * Used by the payroll engine to compute total_working_days accounting for the
 * employee's specific roster pattern rather than a generic calendar.
 */
export async function countRosterWorkingDays(
  supabase:   SupabaseClient,
  tenantId:   string,
  employeeId: string,
  month:      string,
): Promise<number> {
  const calendar = await buildEmployeeRosterCalendar(supabase, tenantId, employeeId, month)
  return calendar.filter(d => d.is_working_day).length
}

// ── Phase 15.1: Validation, Explainability & Test Dataset ─────────────────────

const _DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']

// ── Validation ────────────────────────────────────────────────────────────────

export interface ValidationIssue {
  type:      string
  severity:  'error' | 'warning'
  date?:     string
  message:   string
  detail?:   Record<string, unknown>
}

/**
 * validateRosterCalendar — validate a built DayResolution[] for logical consistency.
 * Returns a list of issues; empty array means calendar is valid.
 *
 * Checks:
 *   - Duplicate dates
 *   - Overlapping split-shift segments
 *   - Negative / out-of-range cyclic positions
 *   - is_alternate_saturday_off on a non-Saturday
 *   - Holiday + is_working_day conflict
 *   - Weekly-off + is_working_day conflict
 *   - Missing saturday_number metadata on Saturdays
 *   - Long working streaks without a fatigue flag (bulk mode skips fatigue)
 */
export function validateRosterCalendar(days: DayResolution[]): ValidationIssue[] {
  const issues: ValidationIssue[] = []

  // ── Duplicate dates ──────────────────────────────────────────────────────
  const seen = new Set<string>()
  for (const d of days) {
    if (seen.has(d.date)) {
      issues.push({ type: 'duplicate_date', severity: 'error', date: d.date, message: `Duplicate date in calendar: ${d.date}` })
    }
    seen.add(d.date)
  }

  for (const d of days) {
    // ── Overlapping split segments ───────────────────────────────────────
    if (d.is_split_shift && d.split_segments && d.split_segments.length > 1) {
      const segs = [...d.split_segments].sort((a, b) => a.segment_order - b.segment_order)
      for (let i = 0; i < segs.length - 1; i++) {
        const a = segs[i]; const b = segs[i + 1]
        if (a.end_time > b.start_time) {
          issues.push({
            type: 'overlapping_split_segments', severity: 'error', date: d.date,
            message: `Split segments overlap on ${d.date}: seg ${a.segment_order} ends ${a.end_time} but seg ${b.segment_order} starts ${b.start_time}`,
            detail: { segment_a: a.id, segment_b: b.id },
          })
        }
      }
    }

    // ── Invalid cyclic position ──────────────────────────────────────────
    if (d.cyclic_position !== undefined && d.cyclic_position < 0) {
      issues.push({ type: 'invalid_cyclic_position', severity: 'error', date: d.date,
        message: `Negative cyclic_position ${d.cyclic_position} on ${d.date}` })
    }

    // ── Alt-Saturday on non-Saturday ─────────────────────────────────────
    if (d.is_alternate_saturday_off && d.day_of_week !== 6) {
      issues.push({ type: 'alt_saturday_non_saturday', severity: 'error', date: d.date,
        message: `is_alternate_saturday_off=true but date ${d.date} is a ${_DAY_NAMES[d.day_of_week]}` })
    }

    // ── Holiday + working conflict ────────────────────────────────────────
    if (d.is_holiday && d.is_working_day) {
      issues.push({ type: 'holiday_working_conflict', severity: 'error', date: d.date,
        message: `Date ${d.date} is both is_holiday=true and is_working_day=true` })
    }

    // ── Weekly-off + working conflict ─────────────────────────────────────
    if (d.is_weekly_off && d.is_working_day) {
      issues.push({ type: 'weekly_off_working_conflict', severity: 'error', date: d.date,
        message: `Date ${d.date} is both is_weekly_off=true and is_working_day=true` })
    }

    // ── Missing Saturday metadata ─────────────────────────────────────────
    if (d.day_of_week === 6 && d.saturday_number === undefined) {
      issues.push({ type: 'missing_saturday_number', severity: 'warning', date: d.date,
        message: `Saturday ${d.date} is missing saturday_number metadata` })
    }
  }

  // ── Long working streaks without fatigue flag ─────────────────────────────
  let streak = 0
  for (const d of days) {
    if (d.is_working_day) {
      streak++
      if (streak > 6 && !d.fatigue_risk) {
        issues.push({ type: 'missing_fatigue_flag', severity: 'warning', date: d.date,
          message: `${streak} consecutive working days but fatigue_risk=false on ${d.date} (fatigue skipped in bulk mode)` })
      }
    } else {
      streak = 0
    }
  }

  return issues
}

// ── Explainability ─────────────────────────────────────────────────────────────

export interface RuleEvaluation {
  rule_id:   string
  rule_type: RuleType
  priority:  number
  matched:   boolean
  in_window: boolean
  reason:    string
}

export interface ExplainResult {
  date:             string
  employee_id:      string
  evaluated_rules:  RuleEvaluation[]
  winning_rule:     (RuleEvaluation & { effective_window: { from: string; to: string | null } }) | null
  fallback_used:    boolean
  fallback_source:  'legacy_weekly_off_days' | 'no_rules_defined' | null
  is_weekly_off:    boolean
  weekly_off_source: 'rule' | 'legacy' | 'none'
  holiday_resolution: {
    checked_group_id: string | null
    found:            boolean
    is_optional:      boolean
    name?:            string
    source?:          'global' | 'group'
  }
  shift_resolution: {
    source:            'shift_roster_override' | 'rotation_group' | 'standing_shift' | 'site_default' | 'none'
    shift_id:          string | null
    shift_name?:       string
    rotation_group_id?: string | null
    cohort_index?:     number | null
    cyclic_position?:  number
  }
  fatigue_computation: {
    consecutive_days:  number
    max_consecutive:   number
    rest_hours_before: number | null
    min_rest_hours:    number
    has_risk:          boolean
    reasons:           string[]
  }
  final_state: {
    is_working_day:    boolean
    is_holiday:        boolean
    is_weekly_off:     boolean
    fatigue_risk:      boolean
    overtime_eligible: boolean
  }
  saturday_info?: {
    saturday_number:  number
    is_last_saturday: boolean
  }
}

/**
 * explainRosterDay — full resolution chain for a single employee/date.
 * Returns every rule evaluated, which one won, shift source, fatigue inputs,
 * holiday path, and the final verdict.  Used by the /roster-simulation/explain
 * endpoint and the frontend Debug Mode.
 */
export async function explainRosterDay(
  supabase:   SupabaseClient,
  tenantId:   string,
  employeeId: string,
  dateStr:    string,
): Promise<ExplainResult> {
  const date = parseDate(dateStr)
  const ctx  = await _fetchEmpRosterCtx(supabase, tenantId, employeeId)

  // ── Rule evaluation ──────────────────────────────────────────────────────
  const allRules = ctx.roster_id
    ? await _fetchWeeklyOffRules(supabase, tenantId, ctx.roster_id, dateStr)
    : []

  const evaluated: RuleEvaluation[] = []
  let winningRuleFull: ExplainResult['winning_rule'] = null

  const sorted = [...allRules].sort((a, b) => b.priority - a.priority)
  for (const rule of sorted) {
    const inWindow = dateStr >= rule.effective_from &&
      (rule.effective_to === null || dateStr <= rule.effective_to)
    const matched  = inWindow && evaluateRule(rule, date)
    evaluated.push({
      rule_id:   rule.id,
      rule_type: rule.rule_type,
      priority:  rule.priority,
      matched,
      in_window: inWindow,
      reason:    !inWindow
        ? `Outside effective window (${rule.effective_from}–${rule.effective_to ?? '∞'})`
        : matched
          ? `Rule matched for ${dateStr}`
          : `Rule did not match ${dateStr}`,
    })
    if (matched && !winningRuleFull) {
      winningRuleFull = {
        rule_id:          rule.id,
        rule_type:        rule.rule_type,
        priority:         rule.priority,
        matched:          true,
        in_window:        true,
        reason:           'Winning rule — first match in priority order',
        effective_window: { from: rule.effective_from, to: rule.effective_to },
      }
    }
  }

  const woffStatus   = computeWeeklyOffStatus(date, allRules, ctx.roster_weekly_off)
  const fallbackUsed = !winningRuleFull && woffStatus.is_weekly_off

  // ── Holiday resolution ───────────────────────────────────────────────────
  const holiday   = await _fetchHoliday(supabase, tenantId, dateStr, ctx.holiday_group_id)
  const isHoliday = !!holiday && !holiday.is_optional

  // ── Shift resolution (with source tracking) ───────────────────────────────
  const rotation = await _fetchRotationMembership(supabase, tenantId, employeeId, dateStr)
  const rotShift = rotation ? _resolveRotationShift(dateStr, rotation.cohort_index, rotation.config) : null

  const { data: overrideRow } = await supabase
    .from('shift_roster').select('shift_id')
    .eq('tenant_id', tenantId).eq('employee_id', employeeId).eq('date', dateStr).maybeSingle()

  const { data: standingRow } = await supabase
    .from('employee_shifts').select('shift_id')
    .eq('tenant_id', tenantId).eq('employee_id', employeeId).eq('is_current', true).maybeSingle()

  type ShiftSrc = ExplainResult['shift_resolution']['source']
  let shiftSrc: ShiftSrc = 'none'
  let resolvedShiftId: string | null = null

  if (overrideRow?.shift_id)       { shiftSrc = 'shift_roster_override'; resolvedShiftId = overrideRow.shift_id as string }
  else if (rotShift)               { shiftSrc = 'rotation_group';        resolvedShiftId = rotShift }
  else if (standingRow?.shift_id)  { shiftSrc = 'standing_shift';        resolvedShiftId = standingRow.shift_id as string }
  else if (ctx.site_default_shift_id) { shiftSrc = 'site_default';       resolvedShiftId = ctx.site_default_shift_id }

  const sd = (!woffStatus.is_weekly_off && !isHoliday && resolvedShiftId)
    ? await _fetchShiftWithSegments(supabase, tenantId, resolvedShiftId)
    : null

  // ── Fatigue computation ──────────────────────────────────────────────────
  const fatigue = await checkFatigueRisk(supabase, tenantId, employeeId, dateStr, ctx.fatigue_rules)

  // ── Saturday info ────────────────────────────────────────────────────────
  const satNum  = date.getDay() === 6 ? getSaturdayNumberInMonth(date) : null

  return {
    date:            dateStr,
    employee_id:     employeeId,
    evaluated_rules: evaluated,
    winning_rule:    winningRuleFull,
    fallback_used:   fallbackUsed,
    fallback_source: fallbackUsed
      ? (allRules.length === 0 ? 'no_rules_defined' : 'legacy_weekly_off_days')
      : null,
    is_weekly_off:    woffStatus.is_weekly_off,
    weekly_off_source: winningRuleFull ? 'rule' : (woffStatus.is_weekly_off ? 'legacy' : 'none'),
    holiday_resolution: {
      checked_group_id: ctx.holiday_group_id,
      found:            !!holiday,
      is_optional:      holiday?.is_optional ?? false,
      name:             holiday?.name,
      source:           holiday ? (ctx.holiday_group_id ? 'group' : 'global') : undefined,
    },
    shift_resolution: {
      source:            shiftSrc,
      shift_id:          sd?.shift_id ?? null,
      shift_name:        sd?.name,
      rotation_group_id: rotation?.group_id ?? null,
      cohort_index:      rotation?.cohort_index ?? null,
      cyclic_position:   woffStatus.cyclic_position,
    },
    fatigue_computation: {
      consecutive_days:  fatigue.consecutive_days,
      max_consecutive:   fatigue.max_consecutive,
      rest_hours_before: fatigue.rest_hours_before,
      min_rest_hours:    fatigue.min_rest_hours,
      has_risk:          fatigue.has_risk,
      reasons:           fatigue.reasons,
    },
    final_state: {
      is_working_day:    !woffStatus.is_weekly_off && !isHoliday,
      is_holiday:        isHoliday,
      is_weekly_off:     woffStatus.is_weekly_off,
      fatigue_risk:      fatigue.has_risk,
      overtime_eligible: !woffStatus.is_weekly_off && !isHoliday && !fatigue.has_risk,
    },
    ...(satNum !== null ? {
      saturday_info: { saturday_number: satNum, is_last_saturday: isLastSaturdayOfMonth(date) },
    } : {}),
  }
}

// ── Test Dataset Generator ─────────────────────────────────────────────────────

export interface TestScenario {
  scenario_id:    string
  name:           string
  description:    string
  test_month:     string
  edge_case_type: string
  sample_rules:   Array<Partial<WeeklyOffRule>>
  expected_facts: Record<string, unknown>
  notes:          string
}

/**
 * generateTestDataset — produce 8 canonical edge-case scenarios for roster QA.
 * No DB access; purely data generation.  Can be POSTed to /roster-weekly-off-rules
 * or consumed directly in the UI to seed test environments.
 */
export function generateTestDataset(): TestScenario[] {
  return [
    {
      scenario_id:    'leap-year-feb',
      name:           'Leap Year February',
      description:    'Feb 2024 has 29 days. Cyclic patterns must not skip day 29.',
      test_month:     '2024-02',
      edge_case_type: 'leap_year',
      sample_rules:   [{
        rule_type:     'CYCLIC_PATTERN',
        rule_config:   { cycle_days: 6, off_days: [4, 5], cycle_start: '2024-01-01' },
        effective_from: '2024-01-01', effective_to: null, priority: 10,
      }],
      expected_facts: { total_days: 29, '2024-02-29_resolved': true },
      notes: 'daysBetween(Jan1,Feb29) = 59; 59%6 = 5 → off',
    },
    {
      scenario_id:    'five-saturday-month',
      name:           '5-Saturday Month',
      description:    'Oct 2026 has 5 Saturdays. ALT_SATURDAY_OFF weeks:[2,4] must NOT mark 5th Saturday off.',
      test_month:     '2026-10',
      edge_case_type: 'five_saturdays',
      sample_rules:   [{
        rule_type:     'ALT_SATURDAY_OFF',
        rule_config:   { weekday: 6, weeks: [2, 4] },
        effective_from: '2026-01-01', effective_to: null, priority: 10,
      }],
      expected_facts: { saturday_count: 5, off_saturday_count: 2, '2026-10-31_is_alt_off': false },
      notes: '5th Saturday must remain a working day',
    },
    {
      scenario_id:    'year-crossover',
      name:           'Year Crossover Dec→Jan',
      description:    'Cyclic pattern anchored Jan 1. Dec dates must yield non-negative positions.',
      test_month:     '2026-12',
      edge_case_type: 'year_crossover',
      sample_rules:   [{
        rule_type:     'CYCLIC_PATTERN',
        rule_config:   { cycle_days: 7, off_days: [5, 6], cycle_start: '2026-01-01' },
        effective_from: '2026-01-01', effective_to: null, priority: 10,
      }],
      expected_facts: { all_cyclic_positions_non_negative: true },
      notes: 'Positive-modulo formula: ((offset % N) + N) % N',
    },
    {
      scenario_id:    'mid-month-rule-change',
      name:           'Mid-Month Rule Change',
      description:    'Rule A (Sunday off) valid Jan 1–14; Rule B (Saturday off) Jan 15+. Engine must respect effective_to boundaries.',
      test_month:     '2026-01',
      edge_case_type: 'mid_month_rule_change',
      sample_rules:   [
        { rule_type: 'FIXED_WEEKLY_OFF', rule_config: { weekdays: [0] }, effective_from: '2026-01-01', effective_to: '2026-01-14', priority: 10 },
        { rule_type: 'FIXED_WEEKLY_OFF', rule_config: { weekdays: [6] }, effective_from: '2026-01-15', effective_to: null, priority: 10 },
      ],
      expected_facts: {
        '2026-01-04_is_weekly_off': true,
        '2026-01-11_is_weekly_off': true,
        '2026-01-17_is_weekly_off': true,
        '2026-01-18_is_weekly_off': false,
      },
      notes: 'effective_to is inclusive; Sunday 18th must NOT be off after rule A expires',
    },
    {
      scenario_id:    'overlapping-holidays',
      name:           'Overlapping Holiday Definitions',
      description:    'Global holiday and group holiday on the same date must not double-count (LIMIT 1).',
      test_month:     '2026-08',
      edge_case_type: 'overlapping_holidays',
      sample_rules:   [],
      expected_facts: { max_holidays_per_date: 1 },
      notes: 'Holiday query uses maybeSingle() — guaranteed single result per date',
    },
    {
      scenario_id:    'cross-cycle-join',
      name:           'Employee Joins Mid-Cycle',
      description:    'Employee with rotation_members.effective_from = day 15 must not receive rotation shift for days 1–14.',
      test_month:     '2026-06',
      edge_case_type: 'cross_cycle_join',
      sample_rules:   [],
      expected_facts: { no_shift_before_effective_from: true },
      notes: '_fetchRotationMembership filters .lte(effective_from, dateStr) so pre-join dates return null',
    },
    {
      scenario_id:    'inactive-rotation-group',
      name:           'Inactive Rotation Group',
      description:    'roster_rotation_groups.is_active=false — members must fall back to standing shift, not rotation.',
      test_month:     '2026-09',
      edge_case_type: 'inactive_rotation',
      sample_rules:   [],
      expected_facts: { rotation_shift_assigned: false },
      notes: 'Add is_active filter to _fetchRotationMembership query to enforce this',
    },
    {
      scenario_id:    'last-saturday-rule',
      name:           'Last Saturday ("last" keyword)',
      description:    'weeks:["last"] — only last Saturday is off. Oct 31 2026 is the 5th and last Saturday.',
      test_month:     '2026-10',
      edge_case_type: 'last_saturday',
      sample_rules:   [{
        rule_type:     'ALT_SATURDAY_OFF',
        rule_config:   { weekday: 6, weeks: ['last'] },
        effective_from: '2026-01-01', effective_to: null, priority: 10,
      }],
      expected_facts: { '2026-10-31_is_alt_off': true, off_saturday_count: 1 },
      notes: 'isLastSaturdayOfMonth must return true for 5th Saturday when no 6th Saturday exists',
    },
  ]
}
