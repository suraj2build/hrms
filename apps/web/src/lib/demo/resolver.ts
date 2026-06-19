/**
 * Demo resolver — maps API endpoints onto fixtures (DEMO MODE only).
 *
 * `resolveDemo(endpoint, method, body)` strips the query string, matches the
 * path against known patterns, and returns the SAME envelope shape the real
 * API returns (mostly `{ data: ... }`).
 *
 * Unmatched endpoints degrade safely:
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
const LIST_HINTS = [
  'list', 'my', 'requests', 'pending', 'history', 'logs', 'events', 'alerts',
  'anomalies', 'corrections', 'balances', 'transactions', 'ledger',
  'templates', 'webhooks', 'incidents', 'integrations', 'scores',
  'verifications', 'duplicates', 'revisions', 'breaches', 'signals',
  'clusters', 'sessions', 'nodes', 'entries', 'heartbeats', 'rows',
  'items', 'records', 'matrices', 'delegations', 'overrides',
  'holidays', 'certifications', 'assets', 'positions', 'states',
  'groups', 'categories', 'sites', 'departments', 'designations', 'grades',
  'cost-centers', 'work-locations', 'rosters', 'rotation-policies',
  'shifts', 'salary-components', 'salary-structures', 'leave-types',
  'documents', 'contracts', 'notifications', 'contributions', 'slips',
  'plans', 'schedule', 'claims', 'reimbursements', 'declarations',
  'advances', 'loans', 'approvals', 'clearances', 'updates',
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
  // /employees/:id/separation
  mm = path.match(/^\/employees\/([^/]+)\/separation$/)
  if (mm) return { data: null }
  // /employees/:id/<subresource> → empty list (job-history, contracts, family, etc.)
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
  if (path === '/masters/shifts' || path === '/shifts') return { data: fx.demoShifts }
  if (path === '/masters/holidays' || path === '/leave/holidays') {
    const year = Number(q.year) || new Date().getFullYear()
    return { data: fx.demoHolidays(year) }
  }
  if (path === '/positions') return { data: [] }
  if (path === '/positions/summary') return { data: {} }
  if (path === '/masters/salary-components') return { data: [] }
  if (path === '/masters/salary-structures') return { data: [] }
  // /masters/employee-shifts/:id/history
  mm = path.match(/^\/masters\/employee-shifts\/([^/]+)\/history$/)
  if (mm) return { data: [] }
  // /masters/:any
  if (path.startsWith('/masters/')) return { data: [] }

  // ── Attendance ─────────────────────────────────────────────────────────────
  if (path === '/attendance/anomalies' || path === '/attendance/anomalies/my') {
    return { data: [], total: 0 }
  }
  if (path === '/attendance/corrections' || path === '/attendance/corrections/my') return { data: [], total: 0 }
  if (path === '/attendance/regularisation/pending') return { data: fx.demoRegularisationPending() }
  if (path === '/attendance/regularisation/my') return { data: [] }
  if (path === '/attendance/stats') return { data: fx.demoExceptionsSummary() }
  if (path === '/attendance/events') return { data: [] }
  if (path === '/attendance/comp-off') return { data: [] }
  if (path === '/attendance/muster/latest-month') {
    const d = new Date()
    return { month: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}` }
  }
  if (path === '/attendance/muster') {
    const month = q.month || new Date().toISOString().slice(0, 7)
    return fx.demoMuster(month)
  }
  // /attendance/workforce-optimization/fairness-balance
  if (path.startsWith('/attendance/workforce-optimization/fairness-balance')) {
    return {
      employees: [],
      avg_ot_fairness: 94.2,
      avg_weekend_fairness: 91.8,
      avg_night_fairness: 88.5,
      violations_count: 0,
    }
  }
  // /attendance/workforce-optimization/ot-distribution
  if (path.startsWith('/attendance/workforce-optimization/ot-distribution')) {
    return { employees: [], total_ot_hours: 0, avg_ot_per_employee: 0 }
  }
  // /attendance/workforce-optimization — any subpath
  if (path.startsWith('/attendance/workforce-optimization/')) {
    return { data: [], employees: [] }
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
  if (path.startsWith('/attendance/leave/ledger/')) return { data: [] }
  if (path === '/leave/optional-holidays') return { data: [] }
  if (path.startsWith('/leave/lifecycle/')) return { data: null }

  // ── Payroll — runs ─────────────────────────────────────────────────────────
  if (path === '/payroll/runs') {
    const runs = fx.demoPayrollRuns()
    return { data: runs, total: runs.length }
  }
  // /payroll/runs/blockers
  if (path === '/payroll/runs/blockers') {
    return {
      month: q.month || new Date().toISOString().slice(0, 7),
      total_employees: fx.demoEmployeeList.length,
      ready: fx.demoEmployeeList.length,
      no_compensation: 0,
      no_attendance: 0,
      open_anomalies: 0,
      blockers: [],
    }
  }
  // /payroll/runs/:id/slips
  mm = path.match(/^\/payroll\/runs\/([^/]+)\/slips$/)
  if (mm) {
    const slips = fx.demoPayrollRunSlips(mm[1])
    const offset = Number(q.offset) || 0
    const limit  = Number(q.limit)  || 20
    const search = (q.search || '').toLowerCase()
    const filtered = search
      ? slips.filter(s =>
          (s.employee_name as string).toLowerCase().includes(search) ||
          (s.employee_code as string).toLowerCase().includes(search)
        )
      : slips
    return { data: filtered.slice(offset, offset + limit), total: filtered.length, limit, offset }
  }
  // /payroll/runs/:id/variance
  mm = path.match(/^\/payroll\/runs\/([^/]+)\/variance$/)
  if (mm) return fx.demoVarianceReport(mm[1])
  // /payroll/runs/:id (detail)
  mm = path.match(/^\/payroll\/runs\/([^/]+)$/)
  if (mm) return { data: fx.demoPayrollRunDetail(mm[1]) }

  // ── Payroll — slips ────────────────────────────────────────────────────────
  if (path === '/payroll/my-slips') return { data: fx.demoMyPayslips() }
  if (path === '/payroll/slips/trend') {
    return { data: fx.demoMyPayslips().map(s => ({ month: s.month, net_pay: s.net_pay, gross_pay: s.gross_pay })) }
  }
  // /payroll/slips/:id
  mm = path.match(/^\/payroll\/slips\/([^/]+)$/)
  if (mm) return { data: fx.demoPayrollSlipDetail(mm[1]) }

  // ── Payroll — compensation & ledger ──────────────────────────────────────
  if (path.startsWith('/payroll/compensation/employee/')) {
    const empId = path.split('/').pop() ?? 'emp-0001'
    return { data: fx.demoActiveComp(empId) }
  }
  if (path.startsWith('/payroll/ledger/')) return { data: [] }
  if (path.startsWith('/payroll/revisions')) return { data: [] }
  if (path.startsWith('/payroll/statutory')) return { data: [] }
  if (path.startsWith('/payroll/reimbursements')) return { data: [] }
  if (path.startsWith('/payroll/ess/my-advances')) return { data: [] }
  if (path.startsWith('/payroll/ess/my-loans')) return { data: [] }
  if (path === '/payroll/variable-pay/my') return { data: [] }

  // ── Benefits ───────────────────────────────────────────────────────────────
  if (path.startsWith('/benefits/')) return { data: [] }

  // ── Compensation revisions ─────────────────────────────────────────────────
  if (path.startsWith('/compensation/revisions/')) return { data: [] }

  // ── ESS ────────────────────────────────────────────────────────────────────
  if (path === '/ess/me/expiry')       return { data: [] }
  if (path === '/ess/me/documents')    return { data: [] }
  if (path === '/ess/me/assets')       return { data: [] }
  if (path === '/ess/me/separation')   return { data: null }
  if (path === '/ess/workforce-notifications') return { data: [] }
  if (path === '/ess/operational-summary') {
    return {
      data: {
        present_today: true,
        check_in: '09:02',
        check_out: null,
        pending_leave_requests: 1,
        pending_regularisations: 0,
        upcoming_holidays: fx.demoHolidays(new Date().getFullYear()).slice(0, 3),
        leave_balance_summary: fx.demoLeaveBalances(),
      },
    }
  }
  if (path === '/ess/workload-balance') {
    return { data: { score: 87, label: 'Balanced', ot_hours_this_month: 4, weekend_shifts: 0 } }
  }
  if (path === '/ess/schedule-fairness') {
    return { data: { fairness_score: 91, label: 'Fair', comparison: 'Above team average' } }
  }
  if (path === '/ess/upcoming-payroll-impact') {
    return {
      data: {
        month: new Date().toISOString().slice(0, 7),
        estimated_net: Math.round(fx.demoCompensation(fx.demoEmployeeList[0] ? 5400000 : 1200000).monthlyCtc * 0.74),
        lop_risk: false,
        anomalies_open: 0,
      },
    }
  }

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

  // ── Helpdesk ───────────────────────────────────────────────────────────────
  if (path.startsWith('/helpdesk/tickets/')) return { data: null }
  if (path === '/helpdesk/tickets') return { data: [] }

  // ── Billing / system ───────────────────────────────────────────────────────
  if (path === '/billing/status') return { data: { status: 'active', plan: 'enterprise' } }
  if (path.startsWith('/system/incidents/')) return { data: null }
  if (path.startsWith('/system/jobs/')) return { data: [] }

  // ── Metrics (prometheus-style text) ────────────────────────────────────────
  if (path === '/metrics') return ''

  // ── Fallthrough — safe defaults ────────────────────────────────────────────
  return isListish(path) ? { data: [] } : { data: {} }
}
