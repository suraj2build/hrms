/**
 * attendance/selectors.ts
 *
 * Shared frontend attendance selectors and status semantics.
 *
 * This is the ONLY place in the frontend that defines:
 *   - PAYABLE_STATUSES
 *   - LOP_STATUSES
 *   - computeSummary()
 *   - computePayableDays()
 *   - computeEmployeeSummary()
 *
 * Import from here in every page and component.  Never redeclare locally.
 *
 * Mirrors the backend attendance-read-model.ts status semantics so that
 * client-side aggregations always match server-side ones.
 */

// ── Canonical status sets ─────────────────────────────────────────────────────

/**
 * Statuses where the employee was present / effectively working.
 */
export const PRESENT_STATUSES = new Set<string>(['present', 'late', 'overtime'])

/**
 * Statuses that count as payable for salary computation.
 * half_day is handled specially — it contributes 0.5, not 1.
 */
export const PAYABLE_STATUSES = new Set<string>([
  'present', 'late', 'overtime', 'holiday', 'weekly_off', 'weekend',
])

/**
 * Statuses that are Loss of Pay (deducted from salary).
 * Only unapproved absence — approved leave is never LOP.
 */
export const LOP_STATUSES = new Set<string>(['absent'])

/**
 * Statuses indicating approved leave (not LOP, not payable as regular work).
 */
export const LEAVE_STATUSES = new Set<string>(['leave'])

/**
 * Statuses indicating unresolved punch issues — payroll-critical.
 */
export const PUNCH_EXCEPTION_STATUSES = new Set<string>(['missing_punch', 'no_punch'])

/**
 * Statuses that are forensics-worthy (meaningful to deep-link into timeline).
 */
export const FORENSICS_LINKABLE = new Set<string>([
  'present', 'late', 'absent', 'half_day', 'leave',
  'overtime', 'missing_punch', 'no_punch',
])

// ── Types ─────────────────────────────────────────────────────────────────────

/** Day record as returned by the muster API. */
export interface DayRecord {
  date:         string
  status:       string | null
  work_hours:   number
  late_minutes: number
}

/** Per-employee status count map. */
export type StatusCounts = Record<string, number>

/** Computed summary for an employee. */
export interface EmployeeSummary {
  counts:       StatusCounts
  payable_days: number
  lop_days:     number
  present:      number
  late:         number
  absent:       number
  on_leave:     number
  half_day:     number
  overtime:     number
  missing_punch: number  // missing_punch + no_punch combined
}

// ── Selectors ─────────────────────────────────────────────────────────────────

/**
 * Build a status → count map for an employee's days array.
 * Only counts days where status is non-null.
 */
export function computeSummary(days: DayRecord[]): StatusCounts {
  const counts: StatusCounts = {}
  for (const d of days) {
    if (d.status) counts[d.status] = (counts[d.status] ?? 0) + 1
  }
  return counts
}

/**
 * Compute total payable days for an employee using canonical rules:
 *   - PAYABLE_STATUSES (present/late/overtime/holiday/weekly_off/weekend) = 1.0
 *   - half_day = 0.5
 *   - all others = 0
 */
export function computePayableDays(days: DayRecord[]): number {
  let payable = 0
  for (const d of days) {
    if (!d.status) continue
    if (d.status === 'half_day')            payable += 0.5
    else if (PAYABLE_STATUSES.has(d.status)) payable += 1.0
  }
  return Math.round(payable * 100) / 100
}

/**
 * Compute LOP days for an employee (absent = 1 LOP per day).
 */
export function computeLopDays(days: DayRecord[]): number {
  return days.filter(d => d.status && LOP_STATUSES.has(d.status)).length
}

/**
 * Full per-employee summary with named counts and payroll metrics.
 * Use when you need both payable_days and individual counts without two passes.
 */
export function computeEmployeeSummary(days: DayRecord[]): EmployeeSummary {
  const counts = computeSummary(days)
  return {
    counts,
    payable_days:  computePayableDays(days),
    lop_days:      computeLopDays(days),
    present:       counts['present']       ?? 0,
    late:          counts['late']          ?? 0,
    absent:        counts['absent']        ?? 0,
    on_leave:      counts['leave']         ?? 0,
    half_day:      counts['half_day']      ?? 0,
    overtime:      counts['overtime']      ?? 0,
    missing_punch: (counts['missing_punch'] ?? 0) + (counts['no_punch'] ?? 0),
  }
}

// ── Month totals ──────────────────────────────────────────────────────────────

export interface MonthTotals {
  totalPresent:       number
  totalLate:          number
  totalAbsent:        number
  totalOnLeave:       number
  totalHalfDay:       number
  totalOvertime:      number
  totalMissingPunch:  number
  totalPayableDays:   number
  totalLopDays:       number
  empWithAbsence:     number
  empWithLate:        number
  empWithMissingPunch: number
  empLopRisk:         number   // ≥3 absent days
}

/**
 * Roll up EmployeeSummary[] into tenant-wide month totals.
 * Pass the result of computeEmployeeSummary() for each employee.
 */
export function computeMonthTotals(summaries: EmployeeSummary[]): MonthTotals {
  let totalPresent = 0, totalLate = 0, totalAbsent = 0, totalOnLeave = 0
  let totalHalfDay = 0, totalOvertime = 0, totalMissingPunch = 0
  let totalPayableDays = 0, totalLopDays = 0
  let empWithAbsence = 0, empWithLate = 0, empWithMissing = 0, empLopRisk = 0

  for (const s of summaries) {
    totalPresent      += s.present
    totalLate         += s.late
    totalAbsent       += s.absent
    totalOnLeave      += s.on_leave
    totalHalfDay      += s.half_day
    totalOvertime     += s.overtime
    totalMissingPunch += s.missing_punch
    totalPayableDays  += s.payable_days
    totalLopDays      += s.lop_days

    if (s.absent        > 0) empWithAbsence++
    if (s.late          > 0) empWithLate++
    if (s.missing_punch > 0) empWithMissing++
    if (s.absent        >= 3) empLopRisk++
  }

  return {
    totalPresent,
    totalLate,
    totalAbsent,
    totalOnLeave,
    totalHalfDay,
    totalOvertime,
    totalMissingPunch,
    totalPayableDays: Math.round(totalPayableDays * 100) / 100,
    totalLopDays,
    empWithAbsence,
    empWithLate,
    empWithMissingPunch: empWithMissing,
    empLopRisk,
  }
}

// ── Today snapshot ────────────────────────────────────────────────────────────

export interface TodaySnapshot {
  present:  number
  late:     number
  absent:   number
  on_leave: number
}

/**
 * Compute today's status snapshot for the current month view.
 * Pass allEmployees and today's ISO date string.
 */
export function computeTodaySnapshot(
  employees: Array<{ days: DayRecord[] }>,
  todayStr:  string,
): TodaySnapshot {
  let present = 0, late = 0, absent = 0, on_leave = 0
  for (const emp of employees) {
    const rec = emp.days.find(d => d.date === todayStr)
    if (!rec?.status) continue
    if      (rec.status === 'present') present++
    else if (rec.status === 'late')    late++
    else if (rec.status === 'absent')  absent++
    else if (rec.status === 'leave')   on_leave++
  }
  return { present, late, absent, on_leave }
}

// ── Missing records ───────────────────────────────────────────────────────────

/**
 * Count past working weekdays (Mon–Fri) with no attendance status.
 * Non-zero = unprocessed days that block payroll.
 */
export function countMissingRecords(
  employees: Array<{ days: DayRecord[] }>,
  todayStr:  string,
): number {
  let count = 0
  for (const emp of employees) {
    for (const d of emp.days) {
      if (!d.status && d.date < todayStr) {
        const dow = new Date(`${d.date}T12:00:00.000Z`).getUTCDay()
        if (dow >= 1 && dow <= 5) count++
      }
    }
  }
  return count
}
