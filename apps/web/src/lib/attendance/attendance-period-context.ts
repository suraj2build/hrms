/**
 * attendance-period-context.ts
 *
 * Single temporal authority for all attendance pages.
 *
 * Attendance data is never "today" — the active period is the latest month
 * for which data actually exists (which may be months behind the real
 * calendar month when clocks are running ahead or data is historical).
 *
 * Rules:
 *   - realMonth  = current calendar month (YYYY-MM from `now`)
 *   - activeMonth = latest month with attendance data (passed in from server)
 *   - viewMonth  = the month currently displayed by the page (controlled by nav)
 *   - isHistorical = activeMonth !== realMonth
 *   - isCurrentMonth = viewMonth === realMonth
 *
 * Usage:
 *   const ctx = getAttendancePeriodContext({ activeMonth: 'YYYY-MM', viewDate: '2025-05-15' })
 *   // ctx.displayLabel  → "May 2025"
 *   // ctx.isHistorical  → true when data is behind the calendar
 *   // ctx.bannerMessage → non-null when we're showing a historical period
 */

export interface AttendancePeriodContext {
  /** The month with the latest attendance data — YYYY-MM */
  activeMonth:    string
  /** The month currently in view on the page — YYYY-MM */
  viewMonth:      string
  /** The real calendar month right now — YYYY-MM */
  realMonth:      string
  /** true when activeMonth !== realMonth */
  isHistorical:   boolean
  /** true when viewMonth === realMonth */
  isCurrentMonth: boolean
  /** Human-readable label for the active month, e.g. "May 2025" */
  displayLabel:   string
  /** Non-null message to show in an info banner when viewing a historical period */
  bannerMessage:  string | null
}

interface PeriodContextInput {
  /** Latest month with data from server — YYYY-MM */
  activeMonth: string
  /** A date string within the currently-viewed month — YYYY-MM-DD or YYYY-MM */
  viewDate:    string
  /** Override for "now" (for testing). Defaults to new Date(). */
  now?:        Date
}

/** Format a YYYY-MM string as a short month name + year, e.g. "May 2025" */
export function formatMonthLabel(yyyyMM: string): string {
  const [y, m] = yyyyMM.split('-').map(Number)
  return new Date(y, m - 1, 1).toLocaleString('default', { month: 'long', year: 'numeric' })
}

/** Format a YYYY-MM string as a short month name + year, e.g. "May '25" */
export function formatMonthShort(yyyyMM: string): string {
  const [y, m] = yyyyMM.split('-').map(Number)
  return new Date(y, m - 1, 1).toLocaleString('default', { month: 'short', year: 'numeric' })
}

/**
 * Derive the full period context from server-supplied data.
 *
 * @param activeMonth - Latest month with data (YYYY-MM)
 * @param viewDate    - YYYY-MM-DD or YYYY-MM of the page's current view
 * @param now         - Override current time (defaults to new Date())
 */
export function getAttendancePeriodContext({
  activeMonth,
  viewDate,
  now = new Date(),
}: PeriodContextInput): AttendancePeriodContext {
  // realMonth: the current calendar month
  const realYear  = now.getFullYear()
  const realMon   = now.getMonth() + 1
  const realMonth = `${realYear}-${String(realMon).padStart(2, '0')}`

  // viewMonth: extract YYYY-MM from whatever format was passed
  const viewMonth = viewDate.length >= 7 ? viewDate.slice(0, 7) : activeMonth

  const isHistorical   = activeMonth !== realMonth
  const isCurrentMonth = viewMonth === realMonth

  const displayLabel = formatMonthLabel(activeMonth)

  let bannerMessage: string | null = null
  if (isHistorical) {
    bannerMessage = `Showing attendance data for ${displayLabel} — no data recorded for the current calendar month yet.`
  }

  return {
    activeMonth,
    viewMonth,
    realMonth,
    isHistorical,
    isCurrentMonth,
    displayLabel,
    bannerMessage,
  }
}
