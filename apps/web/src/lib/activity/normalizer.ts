/**
 * normalizer.ts — Raw API → OperationalActivityEvent converters
 * Phase UX-4
 *
 * Each normalizer casts a loosely-typed API payload into a fully-typed
 * OperationalActivityEvent.  The main export `normalizeActivitySources`
 * merges all sources, deduplicates by id, and sorts by timestamp DESC.
 * `filterEvents` applies every dimension of EventFilters in one pass.
 */

import type {
  OperationalActivityEvent,
  EventFilters,
  EventSeverity,
  EventStatus,
  EventType,
} from './types'

// ── Raw API shapes ────────────────────────────────────────────────────────────
// These mirror the server response fields; all non-id fields are optional so
// the normalizers degrade gracefully when fields are absent or renamed.

interface AnomalyItem {
  id:             string
  employee_id?:   string
  employee_name?: string
  site_id?:       string
  // GET /attendance/anomalies returns `type` + `message` (not
  // `anomaly_type`/`description`) — see apps/api/src/routes/attendance/anomalies.ts.
  type?:          string
  severity?:      string
  message?:       string
  created_at:     string
  resolved?:      boolean
  date?:          string
}

interface CorrectionItem {
  id:             string
  employee_id?:   string
  employee_name?: string
  status?:        string
  reason?:        string
  created_at:     string
  date?:          string
  // GET /attendance/corrections only ever returns the corrected punch times
  // (no "old" value is stored/returned) — see
  // apps/api/src/routes/attendance/corrections.ts.
  corrected_in?:  string
  corrected_out?: string
}

interface RegItem {
  id:                   string
  employee_id?:         string
  employee_name?:       string
  reason?:              string
  created_at:           string
  date?:                string
  regularisation_date?: string
}

interface RevisionItem {
  id:               string
  employee_id?:     string
  employee_name?:   string
  // GET /payroll/revisions never flattens the employee join into
  // employee_name — it comes back nested as `employees: {...}` (see
  // apps/api/src/routes/payroll/compensation-revisions.ts).
  employees?:       { first_name: string; last_name: string; employee_code: string } | null
  status?:          string
  revision_type?:   string
  new_ctc_annual?:  number
  effective_date?:  string
  reason?:          string
  created_at:       string
  before_ctc_annual?: number
}

interface LastRun {
  id:               string
  status:           string
  started_at:       string
  completed_at?:    string | null
  error_message?:   string | null
  processed_count?: number
  duration_ms?:     number | null
}

// ── Internal helpers ──────────────────────────────────────────────────────────

/** Coerce an arbitrary string into a known EventSeverity, defaulting to 'medium'. */
function toSeverity(s?: string): EventSeverity {
  if (s === 'critical') return 'critical'
  if (s === 'high')     return 'high'
  if (s === 'low')      return 'low'
  if (s === 'info')     return 'info'
  return 'medium'
}

// ── Per-source normalizers ────────────────────────────────────────────────────

/** Convert an attendance anomaly record into a normalised event. */
function normalizeAnomaly(a: AnomalyItem): OperationalActivityEvent {
  return {
    id:            a.id,
    type:          'attendance_anomaly',
    severity:      toSeverity(a.severity),
    timestamp:     a.created_at,
    employeeId:    a.employee_id,
    employeeName:  a.employee_name,
    siteId:        a.site_id,
    workspace:     'attendance',
    title:         `Anomaly: ${a.type ?? 'Unknown'} — ${a.employee_name ?? 'Employee'}`,
    description:   a.message,
    status:        a.resolved ? 'resolved' : 'open',
    actionLinks:   [{ label: 'View Anomaly', route: '/admin/attendance/anomalies' }],
  }
}

/** Convert a punch-correction record into a normalised event. */
function normalizeCorrection(c: CorrectionItem): OperationalActivityEvent {
  const isPending = c.status === 'pending'
  const type: EventType      = isPending ? 'approval_pending' : 'approval_approved'
  const status: EventStatus  = isPending ? 'pending'          : 'resolved'
  const severity: EventSeverity = isPending ? 'medium' : 'info'

  return {
    id:           c.id,
    type,
    severity,
    timestamp:    c.created_at,
    employeeId:   c.employee_id,
    employeeName: c.employee_name,
    workspace:    'attendance',
    title:        `Correction ${c.status ?? 'unknown'}: ${c.employee_name ?? 'Unknown'}`,
    description:  c.reason,
    status,
    actionLinks:  [{ label: 'Review Correction', route: '/admin/attendance/corrections' }],
    metadata: {
      corrected_in:  c.corrected_in,
      corrected_out: c.corrected_out,
    },
  }
}

/** Convert a regularisation request into a normalised event. */
function normalizeRegularisation(r: RegItem): OperationalActivityEvent {
  return {
    id:           r.id,
    type:         'approval_pending',
    severity:     'low',
    timestamp:    r.created_at,
    employeeId:   r.employee_id,
    employeeName: r.employee_name,
    workspace:    'attendance',
    title:        `Regularisation pending: ${r.employee_name ?? 'Unknown'}`,
    description:  r.reason,
    status:       'pending',
    actionLinks:  [{ label: 'Approve', route: '/admin/attendance/regularisation' }],
  }
}

/** Convert a compensation-revision record into a normalised event. */
function normalizeRevision(v: RevisionItem): OperationalActivityEvent {
  const isPending  = v.status === 'pending'
  const isApproved = v.status === 'approved'

  const type: EventType = isPending
    ? 'approval_pending'
    : isApproved
      ? 'approval_approved'
      : 'approval_rejected'

  const severity: EventSeverity = isPending ? 'medium' : 'info'

  const hasCTCChange =
    v.before_ctc_annual !== undefined && v.before_ctc_annual !== null &&
    v.new_ctc_annual    !== undefined && v.new_ctc_annual    !== null

  const employeeName = v.employee_name
    ?? (v.employees ? `${v.employees.first_name} ${v.employees.last_name}` : undefined)

  const event: OperationalActivityEvent = {
    id:           v.id,
    type,
    severity,
    timestamp:    v.created_at,
    employeeId:   v.employee_id,
    employeeName,
    workspace:    'payroll',
    title:        `Compensation revision (${v.revision_type ?? 'revision'}): ${employeeName ?? 'Unknown'}`,
    description:  v.reason,
    status:       isPending ? 'pending' : isApproved ? 'resolved' : 'dismissed',
    actionLinks:  [{ label: 'Review Revision', route: '/admin/payroll/revisions' }],
  }

  if (hasCTCChange) {
    event.change = {
      field:     'ctc_annual',
      oldValue:  v.before_ctc_annual,
      newValue:  v.new_ctc_annual,
      changedBy: 'HR Admin',
      changedAt: v.created_at,
    }
  }

  return event
}

/** Convert an attendance-processor last-run record into a normalised event. */
function normalizeLastRun(run: LastRun): OperationalActivityEvent {
  const isFailed = run.status === 'failed' || run.status === 'error'

  return {
    id:          run.id,
    type:        'system_event',
    severity:    isFailed ? 'critical' : 'info',
    timestamp:   run.started_at,
    workspace:   'attendance',
    title:       `Attendance processing ${run.status}: ${run.processed_count ?? 0} employees`,
    description: run.error_message ?? undefined,
    status:      isFailed ? 'open' : 'resolved',
    actionLinks: isFailed
      ? [{ label: 'View Logs', route: '/admin/attendance/audit' }]
      : [],
  }
}

// ── Type-guards for unknown[] inputs ─────────────────────────────────────────

function isAnomalyItem(x: unknown): x is AnomalyItem {
  return typeof x === 'object' && x !== null && typeof (x as Record<string, unknown>).id === 'string'
}

function isCorrectionItem(x: unknown): x is CorrectionItem {
  return typeof x === 'object' && x !== null && typeof (x as Record<string, unknown>).id === 'string'
}

function isRegItem(x: unknown): x is RegItem {
  return typeof x === 'object' && x !== null && typeof (x as Record<string, unknown>).id === 'string'
}

function isRevisionItem(x: unknown): x is RevisionItem {
  return typeof x === 'object' && x !== null && typeof (x as Record<string, unknown>).id === 'string'
}

function isLastRun(x: unknown): x is LastRun {
  return (
    typeof x === 'object' &&
    x !== null &&
    typeof (x as Record<string, unknown>).id === 'string' &&
    typeof (x as Record<string, unknown>).status === 'string' &&
    typeof (x as Record<string, unknown>).started_at === 'string'
  )
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Merge all activity sources into a single, deduplicated, time-sorted event list.
 *
 * Each array element is validated before normalisation; invalid items are silently
 * dropped so a malformed API response never breaks the UI.  The list is deduplicated
 * by `id` (first occurrence wins) then sorted by `timestamp` descending.
 */
export function normalizeActivitySources(sources: {
  anomalies?:       unknown[]
  corrections?:     unknown[]
  regularisations?: unknown[]
  revisions?:       unknown[]
  lastRun?:         unknown | null
}): OperationalActivityEvent[] {
  const events: OperationalActivityEvent[] = [
    ...(sources.anomalies       ?? []).filter(isAnomalyItem).map(normalizeAnomaly),
    ...(sources.corrections     ?? []).filter(isCorrectionItem).map(normalizeCorrection),
    ...(sources.regularisations ?? []).filter(isRegItem).map(normalizeRegularisation),
    ...(sources.revisions       ?? []).filter(isRevisionItem).map(normalizeRevision),
    ...(sources.lastRun != null && isLastRun(sources.lastRun) ? [normalizeLastRun(sources.lastRun)] : []),
  ]

  // Deduplicate by id — keep first occurrence
  const seen = new Set<string>()
  const deduped = events.filter(e => {
    if (seen.has(e.id)) return false
    seen.add(e.id)
    return true
  })

  // Sort by timestamp DESC
  return deduped.sort((a, b) => b.timestamp.localeCompare(a.timestamp))
}

/**
 * Apply all active dimensions of `EventFilters` to an event list in a single pass.
 *
 * Filters are AND-combined; within array-typed filters (severity, workspace, etc.)
 * membership is OR-combined.  Empty arrays are treated as "no filter" for that
 * dimension so callers can pass un-initialised filter objects safely.
 */
export function filterEvents(
  events: OperationalActivityEvent[],
  filters: EventFilters,
): OperationalActivityEvent[] {
  const hasSeverity  = (filters.severity  ?? []).length > 0
  const hasWorkspace = (filters.workspace ?? []).length > 0
  const hasStatus    = (filters.status    ?? []).length > 0
  const hasTypes     = (filters.types     ?? []).length > 0
  const searchLower  = filters.search?.trim().toLowerCase()

  return events.filter(e => {
    if (hasSeverity  && !(filters.severity!.includes(e.severity)))  return false
    if (hasWorkspace && !(filters.workspace!.includes(e.workspace))) return false
    if (hasStatus    && !(filters.status!.includes(e.status)))       return false
    if (hasTypes     && !(filters.types!.includes(e.type)))          return false

    if (filters.employeeId && e.employeeId !== filters.employeeId) return false
    if (filters.siteId     && e.siteId     !== filters.siteId)     return false

    // Tenant-local (not UTC) calendar date — e.timestamp is a UTC timestamptz,
    // and slicing it directly would misfile events near midnight IST into the
    // wrong day when filtering by dateFrom/dateTo (both tenant-local dates).
    const d = new Date(e.timestamp)
    const dateStr = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
    if (filters.dateFrom && dateStr < filters.dateFrom) return false
    if (filters.dateTo   && dateStr > filters.dateTo)   return false

    if (searchLower) {
      const haystack = [e.title, e.description ?? '', e.employeeName ?? '']
        .join(' ')
        .toLowerCase()
      if (!haystack.includes(searchLower)) return false
    }

    return true
  })
}
