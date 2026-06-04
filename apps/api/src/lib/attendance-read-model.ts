/**
 * attendance-read-model.ts
 *
 * Canonical attendance read model.
 *
 * Single source of truth for ALL attendance aggregation in the HRIS backend.
 * Every route that needs attendance summaries, payroll metrics, exception counts,
 * or employee day-level data MUST delegate to this module — never build its own
 * aggregation against attendance_daily.
 *
 * Architecture:
 *   attendance_daily  ─── getMonthDailyRows() ──► raw rows (typed, normalized)
 *                                                     │
 *                            ┌────────────────────────┼────────────────────────┐
 *                            ▼                        ▼                        ▼
 *               computeEmployeeSummary()    computeMonthTotals()    getAttendanceExceptions()
 *               per-employee counts         tenant-wide rollups     at-risk employees
 *
 * Status semantics are defined ONCE here and nowhere else.  Any route that
 * previously defined its own PAYABLE_STATUSES or LOP logic must be updated to
 * import from this module.
 *
 * ── Status canonicalization ───────────────────────────────────────────────────
 * All statuses are normalised to lowercase before classification.
 * Use normalizeAttendanceStatus() (attendance-utils.ts) at every API boundary.
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import { normalizeAttendanceStatus } from './attendance-utils.js'

// ── Canonical status sets ─────────────────────────────────────────────────────
// These are the AUTHORITATIVE definitions.  Import them everywhere rather than
// redeclaring locally.

/** Days the employee was working (present or effectively present). */
export const PRESENT_STATUSES = new Set<string>(['present', 'late', 'overtime'])

/**
 * Days that count as payable for salary computation.
 * half_day contributes 0.5 — handled specially in computeEmployeeSummary.
 */
export const PAYABLE_STATUSES = new Set<string>([
  'present', 'late', 'overtime', 'holiday', 'weekly_off', 'weekend',
])

/**
 * Days that are classified as Leave of Pay (deduct from salary).
 * Only unapproved absence counts as LOP — approved leave is protected.
 */
export const LOP_STATUSES = new Set<string>(['absent'])

/**
 * Days where employee is on approved leave (does NOT count as LOP).
 */
export const LEAVE_STATUSES = new Set<string>(['leave'])

/**
 * Days requiring investigation — payroll-critical missing data.
 */
export const PUNCH_EXCEPTION_STATUSES = new Set<string>(['missing_punch', 'no_punch'])

/**
 * Days that are non-working by policy — neither payable nor LOP.
 */
export const NON_WORKING_STATUSES = new Set<string>(['holiday', 'weekly_off', 'weekend'])

// ── Types ─────────────────────────────────────────────────────────────────────

/** A single attendance_daily row with normalized status. */
export interface AttendanceDailyRow {
  employee_id:      string
  date:             string
  status:           string | null
  work_hours:       number
  late_minutes:     number
  overtime_minutes: number
  is_payable:       boolean | null
  day_fraction:     number | null
  computed_source:  string | null
}

/** Per-employee summary for a month. */
export interface EmployeeAttendanceSummary {
  employee_id:    string
  employee_code?: string
  name?:          string
  // Status counts
  present:        number
  late:           number
  absent:         number
  on_leave:       number
  half_day:       number
  holiday:        number
  weekly_off:     number
  overtime:       number
  missing_punch:  number   // missing_punch + no_punch combined
  // Derived metrics
  payable_days:   number   // full days + 0.5 for each half_day
  lop_days:       number   // absent days (LOP)
  total_work_hrs: number
  total_late_min: number
  total_ovt_min:  number
}

/** Tenant-wide monthly totals. */
export interface MonthAttendanceTotals {
  month:              string
  calendar_days:      number
  active_employees:   number
  // Status aggregates across all employees × days
  total_present:      number
  total_late:         number
  total_absent:       number
  total_on_leave:     number
  total_half_day:     number
  total_holiday:      number
  total_weekly_off:   number
  total_overtime:     number
  total_missing_punch: number
  // Payroll metrics
  total_payable_days: number
  total_lop_days:     number
  // Exception indicators
  employees_with_absence:       number
  employees_with_late:          number
  employees_with_missing_punch: number
  employees_lop_risk:           number   // ≥3 absent days
}

// ── Core query ────────────────────────────────────────────────────────────────

/**
 * Fetch all attendance_daily rows for a tenant + month, normalized.
 *
 * This is the single query point — all aggregation functions work on the
 * rows returned here, not by issuing their own queries.
 */
export async function getMonthDailyRows(
  supabase:  SupabaseClient,
  tenantId:  string,
  month:     string,  // YYYY-MM
): Promise<{ rows: AttendanceDailyRow[]; error: string | null }> {
  const [y, m] = month.split('-').map(Number)
  const fromDate = `${month}-01`
  const toDate   = new Date(y, m, 0).toISOString().slice(0, 10)  // last day of month

  const { data, error } = await supabase
    .from('attendance_daily')
    .select('employee_id, date, status, work_hours, late_minutes, overtime_minutes, is_payable, day_fraction, computed_source')
    .eq('tenant_id', tenantId)
    .gte('date', fromDate)
    .lte('date', toDate)

  if (error) return { rows: [], error: error.message }

  const rows: AttendanceDailyRow[] = (data ?? []).map((r: any) => ({
    employee_id:      r.employee_id as string,
    date:             r.date        as string,
    status:           normalizeAttendanceStatus(r.status),
    work_hours:       Number(r.work_hours       ?? 0),
    late_minutes:     Number(r.late_minutes     ?? 0),
    overtime_minutes: Number(r.overtime_minutes ?? 0),
    is_payable:       r.is_payable  as boolean | null,
    day_fraction:     r.day_fraction != null ? Number(r.day_fraction) : null,
    computed_source:  r.computed_source as string | null,
  }))

  return { rows, error: null }
}

// ── Per-employee aggregation ──────────────────────────────────────────────────

/**
 * Compute summary counts and payroll metrics for a single employee
 * from their daily rows.
 *
 * Payable days rule:
 *   - PAYABLE_STATUSES (present/late/overtime/holiday/weekly_off) = 1.0 each
 *   - half_day = 0.5
 *   - all others = 0
 *
 * LOP days rule:
 *   - absent = 1 LOP day each
 *   (missing_punch / no_punch are exceptions — HR resolves them separately)
 */
export function computeEmployeeSummary(
  employeeId: string,
  rows:       AttendanceDailyRow[],
  meta?: { employee_code?: string; name?: string },
): EmployeeAttendanceSummary {
  let present = 0, late = 0, absent = 0, on_leave = 0
  let half_day = 0, holiday = 0, weekly_off = 0, overtime = 0
  let missing_punch = 0
  let payable_days = 0
  let lop_days = 0
  let total_work_hrs = 0, total_late_min = 0, total_ovt_min = 0

  for (const r of rows) {
    const s = r.status
    if (!s) continue

    // Status counters
    if (s === 'present')                            present++
    else if (s === 'late')                          late++
    else if (s === 'absent')                        absent++
    else if (s === 'leave')                         on_leave++
    else if (s === 'half_day')                      half_day++
    else if (s === 'holiday')                       holiday++
    else if (s === 'weekly_off' || s === 'weekend') weekly_off++
    else if (s === 'overtime')                      overtime++
    else if (s === 'missing_punch' || s === 'no_punch') missing_punch++

    // Payable / LOP days — derive from day_fraction to MATCH the payroll engine
    // (payroll-engine.fetchAttendanceSummary uses the same rule), so dashboards
    // and payslips agree. null day_fraction → treated as full present (1.0), same
    // as payroll. This replaces the old status-set logic which diverged from pay
    // (e.g. 'leave' was counted as neither payable nor LOP).
    const frac = r.day_fraction ?? 1.0
    payable_days += frac
    lop_days     += Math.max(0, 1 - frac)

    // Work metrics
    total_work_hrs += r.work_hours
    total_late_min += r.late_minutes
    total_ovt_min  += r.overtime_minutes
  }

  return {
    employee_id: employeeId,
    employee_code: meta?.employee_code,
    name:          meta?.name,
    present, late, absent, on_leave, half_day,
    holiday, weekly_off, overtime, missing_punch,
    payable_days: Math.round(payable_days * 100) / 100,
    lop_days:     Math.round(lop_days * 100) / 100,
    total_work_hrs: Math.round(total_work_hrs * 100) / 100,
    total_late_min,
    total_ovt_min,
  }
}

// ── Month-level rollup ────────────────────────────────────────────────────────

/**
 * Roll up per-employee summaries into tenant-wide monthly totals.
 *
 * Call computeEmployeeSummary() for each employee first, then pass the array here.
 */
export function computeMonthTotals(
  month:     string,
  summaries: EmployeeAttendanceSummary[],
): MonthAttendanceTotals {
  const [y, m] = month.split('-').map(Number)
  const calendarDays = new Date(y, m, 0).getDate()

  let total_present = 0, total_late = 0, total_absent = 0, total_on_leave = 0
  let total_half_day = 0, total_holiday = 0, total_weekly_off = 0, total_overtime = 0
  let total_missing_punch = 0
  let total_payable_days = 0, total_lop_days = 0
  let emp_with_absence = 0, emp_with_late = 0, emp_with_missing = 0, emp_lop_risk = 0

  for (const s of summaries) {
    total_present      += s.present
    total_late         += s.late
    total_absent       += s.absent
    total_on_leave     += s.on_leave
    total_half_day     += s.half_day
    total_holiday      += s.holiday
    total_weekly_off   += s.weekly_off
    total_overtime     += s.overtime
    total_missing_punch += s.missing_punch
    total_payable_days += s.payable_days
    total_lop_days     += s.lop_days

    if (s.absent       > 0) emp_with_absence++
    if (s.late         > 0) emp_with_late++
    if (s.missing_punch > 0) emp_with_missing++
    if (s.absent       >= 3) emp_lop_risk++
  }

  return {
    month,
    calendar_days:      calendarDays,
    active_employees:   summaries.length,
    total_present,
    total_late,
    total_absent,
    total_on_leave,
    total_half_day,
    total_holiday,
    total_weekly_off,
    total_overtime,
    total_missing_punch,
    total_payable_days: Math.round(total_payable_days * 100) / 100,
    total_lop_days,
    employees_with_absence:       emp_with_absence,
    employees_with_late:          emp_with_late,
    employees_with_missing_punch: emp_with_missing,
    employees_lop_risk:           emp_lop_risk,
  }
}

// ── Exception list ────────────────────────────────────────────────────────────

export interface AttendanceException {
  employee_id:    string
  employee_code?: string
  name?:          string
  type:           'absent' | 'late' | 'missing_punch' | 'lop_risk'
  count:          number
  dates:          string[]
}

/**
 * Return a flat list of attendance exceptions for a month.
 * Used by anomaly dashboards, LOP risk views, and payroll continuity checks.
 */
export function getAttendanceExceptions(
  summaries:  EmployeeAttendanceSummary[],
  dailyRows:  AttendanceDailyRow[],
): AttendanceException[] {
  // Build a date lookup: employeeId → date[] for each exception type
  const absentDates   = new Map<string, string[]>()
  const lateDates     = new Map<string, string[]>()
  const missingDates  = new Map<string, string[]>()

  for (const r of dailyRows) {
    if (!r.status) continue
    const push = (map: Map<string, string[]>) => {
      const arr = map.get(r.employee_id) ?? []
      arr.push(r.date)
      map.set(r.employee_id, arr)
    }
    if (r.status === 'absent')                             push(absentDates)
    else if (r.status === 'late')                          push(lateDates)
    else if (r.status === 'missing_punch' || r.status === 'no_punch') push(missingDates)
  }

  const exceptions: AttendanceException[] = []

  for (const s of summaries) {
    if (s.absent >= 3) {
      exceptions.push({
        employee_id: s.employee_id,
        employee_code: s.employee_code,
        name: s.name,
        type: 'lop_risk',
        count: s.absent,
        dates: absentDates.get(s.employee_id) ?? [],
      })
    } else if (s.absent > 0) {
      exceptions.push({
        employee_id: s.employee_id,
        employee_code: s.employee_code,
        name: s.name,
        type: 'absent',
        count: s.absent,
        dates: absentDates.get(s.employee_id) ?? [],
      })
    }
    if (s.late > 0) {
      exceptions.push({
        employee_id: s.employee_id,
        employee_code: s.employee_code,
        name: s.name,
        type: 'late',
        count: s.late,
        dates: lateDates.get(s.employee_id) ?? [],
      })
    }
    if (s.missing_punch > 0) {
      exceptions.push({
        employee_id: s.employee_id,
        employee_code: s.employee_code,
        name: s.name,
        type: 'missing_punch',
        count: s.missing_punch,
        dates: missingDates.get(s.employee_id) ?? [],
      })
    }
  }

  return exceptions
}

// ── Active period summary ─────────────────────────────────────────────────────

/**
 * Summary of the most recent month that has attendance_daily rows.
 *
 * This is the CANONICAL dashboard data source — every attendance widget must
 * derive its displayed counts from this structure, never from date=today queries
 * or inline local reducers.
 */
export interface ActivePeriodSummary {
  /** YYYY-MM of the most recent month with attendance data */
  active_month:    string
  /** true when active_month differs from today's calendar month */
  is_historical:   boolean
  // Status row counts (each = one employee × one calendar day)
  present:         number   // status = 'present' only (late is separate)
  late:            number   // status = 'late'
  absent:          number   // status = 'absent'
  half_day:        number   // status = 'half_day'
  leave:           number   // status = 'leave'
  payable_days:    number   // fractional (half_day = 0.5)
  lop_days:        number   // absent days
  missing_punch:   number   // no_punch + missing_punch
  total_employees: number   // employees with rows in this month
}

/**
 * Determine the most recent month with attendance data and build a full
 * canonical month read-model for it.
 *
 * All aggregation is delegated to buildMonthReadModel() — zero local reducers.
 *
 * @param refDate  Override "today" for testing (YYYY-MM-DD). Defaults to now.
 */
export async function buildActivePeriodSummary(
  supabase:  SupabaseClient,
  tenantId:  string,
  refDate?:  string,
): Promise<ActivePeriodSummary | { error: string }> {
  const today        = refDate ?? new Date().toISOString().slice(0, 10)
  const currentMonth = today.slice(0, 7)

  // Step 1: find the latest date in attendance_daily for this tenant
  const { data: latestRow, error: latestErr } = await supabase
    .from('attendance_daily')
    .select('date')
    .eq('tenant_id', tenantId)
    .order('date', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (latestErr) return { error: latestErr.message }

  const latestDate  = (latestRow as { date: string } | null)?.date ?? null
  const activeMonth = latestDate ? latestDate.slice(0, 7) : currentMonth

  // Step 2: build full month read model via canonical path
  const model = await buildMonthReadModel(supabase, tenantId, activeMonth)
  if ('error' in model) return { error: model.error }

  const t = model.totals

  return {
    active_month:    activeMonth,
    is_historical:   activeMonth !== currentMonth,
    present:         t.total_present,
    late:            t.total_late,
    absent:          t.total_absent,
    half_day:        t.total_half_day,
    leave:           t.total_on_leave,
    payable_days:    t.total_payable_days,
    lop_days:        t.total_lop_days,
    missing_punch:   t.total_missing_punch,
    total_employees: t.active_employees,
  }
}

// ── Convenience: full month build ─────────────────────────────────────────────

interface Employee {
  id:            string
  employee_code: string
  first_name:    string
  last_name:     string
}

/**
 * High-level helper: fetch employees + daily rows for a month, then compute
 * all summaries and totals in one call.
 *
 * Returns null on query error.
 */
export async function buildMonthReadModel(
  supabase:  SupabaseClient,
  tenantId:  string,
  month:     string,
): Promise<{
  summaries: EmployeeAttendanceSummary[]
  totals:    MonthAttendanceTotals
  rows:      AttendanceDailyRow[]
} | { error: string }> {
  // Fetch employees
  const { data: empData, error: empErr } = await supabase
    .from('employees')
    .select('id, employee_code, first_name, last_name')
    .eq('tenant_id', tenantId)
    .eq('status', 'active')
    .order('employee_code')

  if (empErr) return { error: empErr.message }

  const employees = (empData ?? []) as Employee[]

  // Fetch daily rows
  const { rows, error: rowErr } = await getMonthDailyRows(supabase, tenantId, month)
  if (rowErr) return { error: rowErr }

  // Group rows by employee
  const rowsByEmployee = new Map<string, AttendanceDailyRow[]>()
  for (const r of rows) {
    const list = rowsByEmployee.get(r.employee_id) ?? []
    list.push(r)
    rowsByEmployee.set(r.employee_id, list)
  }

  // Compute per-employee summaries
  const summaries = employees.map(emp =>
    computeEmployeeSummary(
      emp.id,
      rowsByEmployee.get(emp.id) ?? [],
      { employee_code: emp.employee_code, name: `${emp.first_name} ${emp.last_name}` },
    )
  )

  const totals = computeMonthTotals(month, summaries)

  return { summaries, totals, rows }
}
