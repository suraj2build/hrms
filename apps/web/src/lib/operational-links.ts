/**
 * operational-links.ts
 *
 * Canonical URL builders for every cross-module operational link in the
 * attendance + leave platform. All navigation helpers live here so the
 * deep-link structure is defined once and maintained in a single place.
 *
 * Usage:
 *   import { forensicsUrl, correctionsUrl, leaveUrl } from '@/lib/operational-links'
 *
 *   <Link to={forensicsUrl(employeeId, date)}>View Timeline</Link>
 *   <Button onClick={() => navigate(correctionsUrl(employeeId, date))}>Open Corrections</Button>
 */

// ── Attendance domain ─────────────────────────────────────────────────────────

/**
 * Per-day forensics timeline for a single employee.
 * Opens AttendanceTimeline with the lookup pre-filled.
 */
export function forensicsUrl(employeeId: string, date: string): string {
  return `/admin/attendance/forensics?employeeId=${encodeURIComponent(employeeId)}&date=${encodeURIComponent(date)}`
}

/**
 * Attendance corrections list filtered to one employee and optionally one date.
 */
export function correctionsUrl(employeeId: string, date?: string): string {
  const params = new URLSearchParams({ employee_id: employeeId })
  if (date) params.set('date', date)
  return `/admin/attendance/corrections?${params}`
}

/**
 * Attendance anomalies filtered to one employee.
 */
export function anomalyDetailUrl(employeeId: string, date?: string): string {
  const params = new URLSearchParams({ employee_id: employeeId, resolved: 'false' })
  if (date) { params.set('from', date); params.set('to', date) }
  return `/admin/attendance/anomalies?${params}`
}

/**
 * Audit log filtered to one employee and date range.
 */
export function auditUrl(employeeId: string, date?: string): string {
  const params = new URLSearchParams({ employee_id: employeeId })
  if (date) { params.set('from', date); params.set('to', date) }
  return `/admin/attendance/audit?${params}`
}

/**
 * Muster roll for the month containing a given date.
 */
export function musterUrl(date: string): string {
  const month = date.slice(0, 7)
  return `/admin/attendance/muster?month=${month}`
}

// ── Shift & Roster domain ─────────────────────────────────────────────────────

/**
 * Roster planner for the month containing a given date,
 * optionally highlighting a specific employee.
 */
export function rosterUrl(date: string, employeeId?: string): string {
  const params = new URLSearchParams({ month: date.slice(0, 7) })
  if (employeeId) params.set('highlight', employeeId)
  return `/admin/roster?${params}`
}

/**
 * Employee shift assignments page, optionally pre-filtered.
 */
export function employeeShiftsUrl(employeeId?: string): string {
  if (employeeId) return `/admin/employee-shifts?employee_id=${encodeURIComponent(employeeId)}`
  return `/admin/employee-shifts`
}

// ── Leave domain ──────────────────────────────────────────────────────────────

/**
 * Leave approval inbox filtered to one employee.
 */
export function leaveRequestsUrl(employeeId?: string, date?: string): string {
  const params = new URLSearchParams({ status: 'pending' })
  if (employeeId) params.set('employee_id', employeeId)
  if (date)       { params.set('from', date); params.set('to', date) }
  return `/admin/approvals/inbox?${params}`
}

/**
 * Leave accrual ledger for one employee.
 */
export function leaveLedgerUrl(employeeId: string): string {
  return `/admin/leave/ledger?employee_id=${encodeURIComponent(employeeId)}`
}

/**
 * Leave policy engine — optionally highlight a specific policy.
 */
export function policyEngineUrl(policyId?: string): string {
  if (policyId) return `/admin/leave/policy-engine?policy=${encodeURIComponent(policyId)}`
  return `/admin/leave/policy-engine`
}

// ── Employee domain ───────────────────────────────────────────────────────────

/**
 * Employee profile page.
 */
export function employeeProfileUrl(employeeId: string): string {
  return `/admin/employees/${encodeURIComponent(employeeId)}`
}

// ── Manager domain ────────────────────────────────────────────────────────────

/**
 * Manager dashboard.
 */
export function managerDashboardUrl(): string {
  return `/admin/manager-dashboard`
}

// ── Observability domain ──────────────────────────────────────────────────────

/**
 * Operational health / observability workspace.
 */
export function operationalHealthUrl(): string {
  return `/admin/operational-health`
}

// ── Contextual link builder ───────────────────────────────────────────────────

/**
 * Returns a set of all operational deep-links relevant to a specific
 * employee + date pair. Used by contextual action menus throughout the app.
 */
export interface OperationalLinks {
  forensics:        string
  corrections:      string
  anomalies:        string
  audit:            string
  muster:           string
  roster:           string
  employeeProfile:  string
  leaveRequests:    string
  leaveLedger:      string
}

export function buildOperationalLinks(employeeId: string, date: string): OperationalLinks {
  return {
    forensics:        forensicsUrl(employeeId, date),
    corrections:      correctionsUrl(employeeId, date),
    anomalies:        anomalyDetailUrl(employeeId, date),
    audit:            auditUrl(employeeId, date),
    muster:           musterUrl(date),
    roster:           rosterUrl(date, employeeId),
    employeeProfile:  employeeProfileUrl(employeeId),
    leaveRequests:    leaveRequestsUrl(employeeId, date),
    leaveLedger:      leaveLedgerUrl(employeeId),
  }
}
