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
    // Ledger/governance search reads r.data.data → return nested envelope.
    if (q.search) {
      const s = q.search.toLowerCase()
      const matched = fx.demoEmployeeList.filter(e =>
        `${e.first_name} ${e.last_name}`.toLowerCase().includes(s) ||
        e.employee_code.toLowerCase().includes(s)
      ).slice(0, Number(q.limit) || 10)
      return { data: { data: matched, total: matched.length } }
    }
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
  // /employees/:id/assets — needs { assigned, history } shape, not a flat array
  mm = path.match(/^\/employees\/([^/]+)\/assets$/)
  if (mm) return { data: { assigned: [], history: [] } }
  // /employees/:id/onboarding-status
  mm = path.match(/^\/employees\/([^/]+)\/onboarding-status$/)
  if (mm) return { data: null }
  // /employees/:id/user-account
  mm = path.match(/^\/employees\/([^/]+)\/user-account$/)
  if (mm) return { status: 'no-profile', profile: null, auth_user: null, email: null }
  // /employees/:id/org-context
  mm = path.match(/^\/employees\/([^/]+)\/org-context$/)
  if (mm) return { data: { manager: null, reportees: [], skip_levels: [] } }
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
  if (path === '/attendance/regularisation/my') return { data: [], total: 0 }
  // /attendance/stats — flat ops stats (page reads fields directly, NOT via .data)
  if (path === '/attendance/stats') return fx.demoAttendanceOpsStats()
  if (path === '/attendance/pipeline-stats') return fx.demoPipelineStats()
  if (path === '/attendance/process/status') return fx.demoProcessStatus()
  if (path === '/attendance/audit') {
    const rows = fx.demoAttendanceAudit()
    return { data: rows, total: rows.length }
  }
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
  // ledger reads r.data.data → nested envelope
  if (path.startsWith('/attendance/leave/ledger/')) return { data: { data: [] } }
  if (path === '/leave/optional-holidays') return { data: [] }
  // /leave/my-requests — paginated; page reads .pagination.has_more
  if (path === '/leave/my-requests') {
    return fx.demoMyLeaveRequestsPaged(Number(q.page) || 1, Number(q.limit) || 20, q.status)
  }
  if (path === '/leave/governance/session-analytics') return fx.demoSessionAnalytics()
  if (path === '/leave/event-grants') return { data: fx.demoEventGrants() }
  if (path === '/leave/scheduler/reconciliation') return { data: fx.demoReconciliationRuns() }
  if (path === '/leave/lifecycle/all-freezes') return { data: [] }
  if (path === '/leave/lifecycle/held-credits-summary') return { data: [] }
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

  // ── Intelligence ───────────────────────────────────────────────────────────
  if (path === '/intelligence/org/departments') {
    return {
      departments: fx.demoDepartments.map((d, i) => ({
        id: d.id, name: d.name,
        headcount: [8, 5, 4, 6, 3, 7, 2, 5][i % 8],
        joiners_30d: [1, 0, 1, 0, 0, 1, 0, 0][i % 8],
        exits_30d: 0, probation_due: 0,
        summary_text: `${d.name} is operating normally.`,
      })),
    }
  }
  if (path === '/intelligence/org/headcount-trend') {
    const months = ['2026-01','2026-02','2026-03','2026-04','2026-05','2026-06']
    return {
      months: months.map((period, i) => ({
        period, headcount: 18 + i, joiners: i === 0 ? 2 : 1, exits: 0,
      })),
    }
  }
  if (path === '/intelligence/org/attrition-signal') {
    return {
      signal: 'normal',
      by_department: [
        { dept_name: 'Engineering', count: 1 },
        { dept_name: 'Sales', count: 0 },
      ],
      total: 1,
    }
  }
  if (path === '/intelligence/org/headcount-by-site') {
    return {
      by_site: [{ key: 'bengaluru', label: 'Bengaluru', headcount: fx.demoEmployeeList.length, joiners_30d: 2, city: 'Bengaluru', region: 'South', zone: 'South', site_type: 'HQ' }],
      by_region: [{ key: 'south', label: 'South', headcount: fx.demoEmployeeList.length }],
      by_zone: [], by_site_type: [], unassigned: 0,
      total: fx.demoEmployeeList.length, dimensions_configured: true,
    }
  }
  if (path === '/intelligence/workforce-command') {
    return { data: fx.demoWorkforceCommandData() }
  }
  if (path.startsWith('/intelligence/digest/')) {
    const period = path.split('/').pop() ?? 'daily'
    return {
      period,
      summary_text: `${period.charAt(0).toUpperCase() + period.slice(1)} workforce digest: all systems normal at Saar Technologies.`,
      metrics: {
        active_headcount: fx.demoEmployeeList.length,
        attendance_rate: 94,
        pending_approvals: 1,
        payroll_processed: period === 'monthly',
      },
      generated_at: new Date().toISOString(),
      sources: [{ table: 'employees', description: 'Active employee records' }],
    }
  }
  if (path === '/intelligence/action-center') {
    const obs = fx.demoActionObservations()
    return { observations: obs, total: obs.length, generated_at: new Date().toISOString() }
  }
  // /intelligence/employee/:id/360
  mm = path.match(/^\/intelligence\/employee\/([^/]+)\/360$/)
  if (mm) {
    const emp = fx.demoEmployee(mm[1])
    return {
      data: {
        employee: {
          id: emp?.id ?? mm[1], name: emp ? `${emp.first_name} ${emp.last_name}` : 'Demo Employee',
          code: emp?.employee_code ?? 'EMP-001', status: emp?.status ?? 'active',
          joining_date: emp?.joining_date ?? '2023-01-01', tenure_days: 550,
          department_id: emp?.department?.id ?? null,
          designation: emp?.designation?.name ?? 'Employee',
        },
        compliance: { probation_due: false, separation_stage: null, assets_assigned: 0, assets: [] },
        compensation: emp ? { ctc_annual: fx.demoActiveComp(mm[1]).ctc_annual, effective_from: '2025-04-01' } : null,
        leave: { balances: fx.demoLeaveBalances() },
        attendance_signal: 'normal',
        onboarding: null,
        summary: 'Employee is performing well with no open compliance items.',
        generated_at: new Date().toISOString(),
        sources: [{ table: 'employees', description: 'Core employee record' }],
      },
    }
  }
  // /intelligence/onboarding/:id/readiness
  mm = path.match(/^\/intelligence\/onboarding\/([^/]+)\/readiness$/)
  if (mm) {
    return {
      data: {
        session_id: mm[1], candidate_name: 'Candidate',
        readiness_score: 85, readiness_text: 'Ready',
        documents: { total: 0, extracted: 0, failed: 0, rejected: 0, pending: 0 },
        missing_fields: [], validation_errors: [], suggested_actions: [],
        sources: [], generated_at: new Date().toISOString(),
      },
    }
  }
  if (path === '/intelligence/manager-summary') {
    return {
      data: {
        summary: 'Your team is performing well. No urgent items require attention.',
        team_size: 6, new_joiners_this_month: 0, probation_due: 1,
        pending_leave_approvals: 1, generated_at: new Date().toISOString(),
      },
    }
  }
  if (path === '/intelligence/executive-narrative') {
    const month = q.month || new Date().toISOString().slice(0, 7)
    return {
      data: {
        narrative: `Saar Technologies maintained a stable headcount of ${fx.demoEmployeeList.length} employees in ${month}. Attrition remains low and payroll was processed on schedule.`,
        metrics: {
          headcount: fx.demoEmployeeList.length, joiners: 1, exits: 0,
          probation_backlog: 1, net_change: 1, period: month,
        },
        period_start: `${month}-01`,
        period_end: `${month}-30`,
        generated_at: new Date().toISOString(),
      },
    }
  }
  // /intelligence/* catch-all
  if (path.startsWith('/intelligence/')) return { data: {} }

  // ── Reports ────────────────────────────────────────────────────────────────
  if (path === '/reports/headcount') {
    const employees = fx.demoEmployeeList.map(e => ({
      employee_code: e.employee_code, name: `${e.first_name} ${e.last_name}`,
      department: e.department?.name ?? '', employment_type: e.current_job?.employment_type ?? 'permanent',
      joining_date: e.joining_date, status: e.status,
    }))
    return {
      summary: { total_employees: employees.length, active_employees: employees.filter(e => e.status === 'active').length, total_separations: 0 },
      monthly_trend: ['2026-01','2026-02','2026-03','2026-04','2026-05','2026-06'].map((month, i) => ({ month, joiners: i < 2 ? 2 : 1, separations: 0 })),
      department_breakdown: fx.demoDepartments.map(d => ({ department: d.name, count: Math.floor(employees.length / fx.demoDepartments.length) })),
      employment_type_breakdown: [{ employment_type: 'permanent', count: employees.length }],
      employees,
    }
  }
  if (path === '/reports/attendance-summary') {
    const rows = fx.demoEmployeeList.map(e => ({
      employee_code: e.employee_code, name: `${e.first_name} ${e.last_name}`,
      department: e.department?.name ?? '',
      present: 22, absent: 0, late: 1, half_day: 0,
      total_work_hours: 176, total_late_minutes: 12, total_overtime_minutes: 0, leave_days: 0,
    }))
    return {
      from: q.from || new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString().slice(0, 10),
      to: q.to || new Date().toISOString().slice(0, 10),
      totals: { present: rows.length * 22, absent: 0, late: rows.length, half_day: 0, total_work_hours: rows.length * 176, leave_days: 0 },
      rows,
    }
  }
  if (path === '/reports/salary-register') {
    const rows = fx.demoEmployeeList.map(e => {
      const comp = fx.demoActiveComp(e.id)
      return {
        employee_code: e.employee_code, name: `${e.first_name} ${e.last_name}`,
        department: e.department?.name ?? '', employment_type: e.current_job?.employment_type ?? 'permanent',
        ctc_annual: comp.ctc_annual, ctc_monthly: comp.ctc_monthly,
        effective_from: comp.effective_from ?? '2025-04-01', components: {},
      }
    })
    const totals = { employee_count: rows.length, total_ctc_annual: rows.reduce((s, r) => s + r.ctc_annual, 0), total_ctc_monthly: rows.reduce((s, r) => s + r.ctc_monthly, 0) }
    return { month: q.month || new Date().toISOString().slice(0, 7), component_columns: [], totals, rows }
  }
  if (path === '/reports/statutory') {
    const rows = fx.demoEmployeeList.map(e => {
      const comp = fx.demoActiveComp(e.id)
      return {
        employee_code: e.employee_code, name: `${e.first_name} ${e.last_name}`,
        department: e.department?.name ?? '', employment_type: e.current_job?.employment_type ?? 'permanent',
        ctc_monthly: comp.ctc_monthly, ctc_annual: comp.ctc_annual,
        uan: `100${e.id.replace(/\D/g, '').slice(0, 8).padStart(9, '0')}`,
        pf_number: `KA/BN/12345/000/${e.id.replace(/\D/g, '').slice(-4).padStart(4, '0')}`,
        pf_employee_monthly: Math.round(comp.ctc_monthly * 0.12 * 0.5),
        pf_employer_monthly: Math.round(comp.ctc_monthly * 0.12 * 0.5),
        esi_number: null, esi_applicable: false, esi_employee_monthly: 0, esi_employer_monthly: 0,
        pan: 'ALHPXXXXXA', pt_applicable: true, lwf_applicable: true, tax_regime: 'new',
      }
    })
    const totals = {
      employee_count: rows.length, pf_employees: rows.length, esi_employees: 0,
      pt_employees: rows.length, lwf_employees: rows.length,
      total_pf_employee: rows.reduce((s, r) => s + r.pf_employee_monthly, 0),
      total_pf_employer: rows.reduce((s, r) => s + r.pf_employer_monthly, 0),
      total_esi_employee: 0, total_esi_employer: 0,
    }
    return { totals, rows }
  }
  // /reports/* catch-all
  if (path.startsWith('/reports/')) return { data: [], rows: [], totals: {}, summary: {} }

  // ── Datasets ───────────────────────────────────────────────────────────────
  if (path === '/datasets/payroll-cost/anchor') {
    return { month: new Date().toISOString().slice(0, 7) }
  }
  if (path === '/datasets/statutory/exceptions') return fx.demoStatutoryExceptions()
  if (path === '/datasets/statutory') return fx.demoStatutoryData()
  if (path.startsWith('/datasets/')) return { data: {} }

  // ── Compliance / statutory ──────────────────────────────────────────────────
  if (path === '/payroll/compliance/stats') return fx.demoComplianceStats()
  if (path === '/executive/compliance') return fx.demoExecutiveCompliance()
  if (path === '/compliance/calendar') return fx.demoComplianceCalendar()
  if (path === '/compliance/calendar/upcoming') return { data: fx.demoComplianceCalendar().data }
  if (path.startsWith('/compliance/')) return { data: [] }
  if (path.startsWith('/executive/')) return { data: {} }

  // ── Recruitment ────────────────────────────────────────────────────────────
  if (path === '/recruitment/hired') {
    const all = fx.demoHiredPipeline()
    const filter = q.preboarding_status || 'all'
    const rows = filter === 'pending'   ? all.filter(a => !a.pre_joinee_invitation_id)
               : filter === 'initiated' ? all.filter(a => a.pre_joinee_invitation_id)
               : all
    return { data: rows, total: rows.length }
  }
  if (path.startsWith('/recruitment/')) return { data: [] }

  // ── Metrics (prometheus-style text) ────────────────────────────────────────
  if (path === '/metrics') return ''

  // ── Fallthrough — safe defaults ────────────────────────────────────────────
  return isListish(path) ? { data: [] } : { data: {} }
}
