/**
 * Demo resolver — maps API endpoints onto fixtures (DEMO MODE only).
 *
 * `resolveDemo(endpoint, method, body)` strips the query string, matches the
 * path against known patterns, and returns the SAME envelope shape the real
 * API returns (mostly `{ data: ... }`).
 *
 * Anything unmatched degrades to a safe default so no page crashes:
 *   - list-ish endpoints → { data: [] }
 *   - everything else    → { data: {} }
 *
 * Writes (POST/PUT/PATCH/DELETE) return an optimistic success envelope.
 *
 * This file is only ever called when DEMO_MODE is true; it is otherwise inert.
 */

import * as fx from './fixtures'

type Json = unknown

// Endpoints whose unmatched default should be a list rather than an object.
// Matched loosely on the path (substring / suffix) — these are the read-mostly
// collection routes scattered across the app.
const LIST_HINTS = [
  'list', 'requests', 'pending', 'history', 'logs', 'events', 'alerts',
  'anomalies', 'corrections', 'balances', 'transactions', 'ledger',
  'templates', 'webhooks', 'incidents', 'integrations', 'scores',
  'verifications', 'duplicates', 'revisions', 'breaches', 'signals',
  'clusters', 'sessions', 'nodes', 'entries', 'heartbeats', 'rows',
  'items', 'records', 'summary', 'matrices', 'delegations', 'overrides',
  'holidays', 'certifications', 'assets', 'positions', 'states', 'clusters',
  'groups', 'categories', 'sites', 'departments', 'designations', 'grades',
  'cost-centers', 'work-locations', 'rosters', 'rotation-policies',
  'shifts', 'salary-components', 'salary-structures', 'leave-types',
]

function isListish(path: string): boolean {
  const last = path.split('/').filter(Boolean).pop() ?? ''
  return LIST_HINTS.some(h => last === h || last.endsWith(h) || path.includes(`/${h}`))
}

/** Parse `?from=..&to=..&month=..&year=..&employee_id=..` style query params. */
function parseQuery(qs: string): Record<string, string> {
  const out: Record<string, string> = {}
  if (!qs) return out
  for (const part of qs.replace(/^\?/, '').split('&')) {
    if (!part) continue
    const [k, v = ''] = part.split('=')
    out[decodeURIComponent(k)] = decodeURIComponent(v)
  }
  return out
}

function ok(data: Json, message = 'Saved (demo)') {
  return { data, message }
}

// ── Main resolver ─────────────────────────────────────────────────────────────

export function resolveDemo(endpoint: string, method: string, _body?: unknown): Json {
  const [rawPath, rawQs] = endpoint.split('?')
  const path = rawPath.replace(/\/+$/, '') || '/'
  const q = parseQuery(rawQs ?? '')
  const m = method.toUpperCase()

  // ── Writes: optimistic success (no persistence in demo) ────────────────────
  if (m === 'POST' || m === 'PUT' || m === 'PATCH' || m === 'DELETE') {
    return ok({ id: `demo-${Date.now()}` })
  }

  // ── Auth / bootstrap ───────────────────────────────────────────────────────
  if (path === '/me') {
    return { profile: fx.demoProfile, tenant: fx.demoTenant }
  }

  // ── Dashboards / analytics ─────────────────────────────────────────────────
  if (path === '/analytics/dashboard') return fx.demoDashboardStats()
  if (path === '/system/operational-health') return { data: fx.demoOperationalHealth() }
  if (path === '/system/scheduler-health') {
    const rows = fx.demoSchedulerRows()
    return { data: rows, stale_count: rows.filter(r => r.is_stale).length, healthy: true }
  }
  if (path === '/attendance/exceptions/summary') return { data: fx.demoExceptionsSummary() }
  if (path === '/attendance/reconciliation/open') {
    const issues = fx.demoReconciliationOpen()
    return { data: issues, total: issues.length }
  }
  if (path === '/system/event-governance/log') {
    const log = fx.demoEventLog()
    return { data: log, total: log.length }
  }
  if (path === '/attendance/process/last') return { run: fx.demoLastRun() }

  // ── Employees ──────────────────────────────────────────────────────────────
  if (path === '/employees') {
    return { data: fx.demoEmployeeList, total: fx.demoEmployeeList.length }
  }
  if (path === '/employees/org-tree') {
    return { data: fx.demoEmployeeList }
  }
  // /employees/:id/full-profile
  let mm = path.match(/^\/employees\/([^/]+)\/full-profile$/)
  if (mm) return fx.demoFullProfile(mm[1])
  // /employees/:id/compensation
  mm = path.match(/^\/employees\/([^/]+)\/compensation$/)
  if (mm) return { data: fx.demoActiveComp(mm[1]) }
  // /employees/:id/<subresource> → empty list (job-history, contracts, family, etc.)
  mm = path.match(/^\/employees\/([^/]+)\/separation$/)
  if (mm) return { data: null }
  mm = path.match(/^\/employees\/([^/]+)\/[^/]+$/)
  if (mm) return { data: [] }
  // /employees/:id (lean)
  mm = path.match(/^\/employees\/([^/]+)$/)
  if (mm) return { data: fx.demoEmployee(mm[1]) }

  // ── Org structure / masters ────────────────────────────────────────────────
  if (path === '/departments') return { data: fx.demoDepartments }
  if (path === '/designations') return { data: fx.demoDesignations }
  if (path === '/grades' || path === '/masters/grades') return { data: fx.demoGrades }
  if (path === '/masters/sites') return { data: fx.demoSites }
  if (path === '/masters/work-locations') return { data: fx.demoWorkLocations }
  if (path === '/masters/cost-centers') return { data: fx.demoCostCenters }
  if (path === '/masters/identity-types') return { data: fx.demoIdentityTypes }
  if (path === '/masters/relationship-types') return { data: fx.demoRelationshipTypes }
  if (path === '/masters/leave-types' || path === '/leave-types') return { data: fx.demoLeaveTypes }
  if (path === '/masters/holidays') {
    const year = Number(q.year) || new Date().getFullYear()
    return { data: fx.demoHolidays(year) }
  }
  if (path === '/positions') return { data: [] }
  if (path === '/positions/summary') return { data: {} }

  // ── Attendance ─────────────────────────────────────────────────────────────
  if (path === '/attendance/anomalies' || path === '/attendance/anomalies/my') {
    return { data: [], total: 0 }
  }
  if (path === '/attendance/corrections') return { data: [], total: 0 }
  if (path === '/attendance/regularisation/pending') return { data: fx.demoRegularisationPending() }
  if (path === '/attendance/regularisation/my') return { data: [] }
  if (path === '/attendance/stats') return { data: fx.demoExceptionsSummary() }
  if (path === '/attendance/events') return { data: [] }
  if (path === '/attendance/muster') {
    const month = q.month || new Date().toISOString().slice(0, 7)
    return fx.demoMuster(month)
  }
  // /attendance/:employeeId?from=&to=
  mm = path.match(/^\/attendance\/([^/]+)$/)
  if (mm) {
    const from = q.from || new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString().slice(0, 10)
    const to = q.to || new Date().toISOString().slice(0, 10)
    return fx.demoAttendanceRange(mm[1], from, to)
  }

  // ── Leave ──────────────────────────────────────────────────────────────────
  if (path === '/attendance/leave/my') return { data: fx.demoMyLeaveRequests() }
  if (path === '/leave-requests') return { data: fx.demoMyLeaveRequests() }
  if (path.startsWith('/attendance/leave/balance')) return { data: fx.demoLeaveBalances() }
  if (path === '/attendance/leave/team-balances') return { data: [] }

  // ── Payroll ────────────────────────────────────────────────────────────────
  if (path === '/payroll/my-slips') return { data: fx.demoMyPayslips() }
  if (path === '/payroll/runs') {
    const runs = fx.demoPayrollRuns()
    return { data: runs, total: runs.length }
  }
  if (path.startsWith('/payroll/revisions')) return { data: [] }
  if (path.startsWith('/payroll/statutory')) return { data: [] }

  // ── ESS ────────────────────────────────────────────────────────────────────
  if (path === '/ess/me/expiry') return { data: [] }

  // ── Manager ────────────────────────────────────────────────────────────────
  if (path === '/manager/dashboard') {
    return {
      data: {
        team_size: 6,
        present_today: 5,
        on_leave_today: 1,
        pending_approvals: 2,
      },
    }
  }
  if (path === '/approvals/pending') return { data: [] }

  // ── Metrics (prometheus-style text) ────────────────────────────────────────
  if (path === '/metrics') return ''

  // ── Fallthrough — safe defaults ────────────────────────────────────────────
  return isListish(path) ? { data: [] } : { data: {} }
}
