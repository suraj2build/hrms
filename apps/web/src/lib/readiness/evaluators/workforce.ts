/**
 * Workforce Readiness Evaluator
 *
 * Evaluates employee onboarding, compensation coverage, and basic
 * workforce completeness from the employee list endpoint.
 *
 * Data sources:
 *   /employees  — full employee list (shared cache)
 */
import type { ReadinessCheck } from '../types'

interface WorkforceEmployee {
  id:             string
  status?:        string
  work_location?: { id: string } | null
  joining_date?:  string | null
  department?:    { id: string; name: string } | null
  designation?:   { id: string; name: string } | null
}

interface WorkforceStructures {
  salaryStructures: { id: string }[]
}

export function evaluateWorkforce(
  employees:   WorkforceEmployee[],
  structures?: WorkforceStructures,
): ReadinessCheck[] {
  const total      = employees.length
  const active     = employees.filter(e => e.status === 'active').length
  const inactive   = employees.filter(e => e.status === 'inactive').length
  const onNotice   = employees.filter(e => e.status === 'on_notice').length
  const noLocation = employees.filter(e => e.status === 'active' && !e.work_location?.id).length
  const noDept     = employees.filter(e => e.status === 'active' && !e.department?.id).length
  const noDesig    = employees.filter(e => e.status === 'active' && !e.designation?.id).length

  return [
    // ── Employee count ─────────────────────────────────────────────────────────
    {
      id:         'wf-employees',
      label:      'Employees onboarded',
      status:     total === 0 ? 'error' : active < 1 ? 'warning' : 'ok',
      severity:   'blocker',
      isBlocking: true,
      value:      total,
      recommendation: total === 0
        ? 'No employees found. Import or add employees before running payroll or attendance operations.'
        : active === 0
        ? 'All employees are inactive or separated. At least one active employee is needed for operations.'
        : undefined,
      actionLabel: total === 0 ? 'Add Employees' : 'View Directory',
      actionPath:  '/employees',
      detail:      total > 0
        ? `${active} active · ${onNotice} on notice · ${inactive} inactive`
        : undefined,
    },

    // ── Active employee headcount ──────────────────────────────────────────────
    {
      id:         'wf-active-headcount',
      label:      'Active employee headcount',
      status:     active > 0 ? 'ok' : total > 0 ? 'warning' : 'unknown',
      severity:   'warning',
      isBlocking: false,
      value:      active,
      recommendation: active === 0 && total > 0
        ? 'No active employees. Payroll, attendance, and leave operations require active employees.'
        : undefined,
      actionPath:  '/employees',
    },

    // ── Work location assignment ───────────────────────────────────────────────
    {
      id:         'wf-location-assignment',
      label:      'Employees assigned to work locations',
      status:     active === 0 ? 'unknown'
                : noLocation === 0 ? 'ok'
                : noLocation > active * 0.3 ? 'warning'
                : 'warning',
      severity:   'warning',
      isBlocking: false,
      value:      active === 0 ? 0 : `${active - noLocation} / ${active}`,
      recommendation: noLocation > 0
        ? `${noLocation} active employee${noLocation !== 1 ? 's' : ''} not assigned to a work location — attendance cannot be computed for them.`
        : undefined,
      actionLabel: noLocation > 0 ? 'Review Employees' : undefined,
      actionPath:  '/admin/employees',
    },

    // ── Department assignment ──────────────────────────────────────────────────
    {
      id:         'wf-dept-assignment',
      label:      'Employees assigned to departments',
      status:     active === 0 ? 'unknown'
                : noDept === 0 ? 'ok'
                : noDept > active * 0.3 ? 'warning'
                : 'warning',
      severity:   'info',
      isBlocking: false,
      value:      active === 0 ? 0 : `${active - noDept} / ${active}`,
      recommendation: noDept > 0
        ? `${noDept} active employee${noDept !== 1 ? 's' : ''} not assigned to a department — department hierarchy and reports will be incomplete.`
        : undefined,
      actionLabel: noDept > 0 ? 'Review Employees' : undefined,
      actionPath:  '/employees',
    },

    // ── Designation assignment ─────────────────────────────────────────────────
    {
      id:         'wf-desig-assignment',
      label:      'Employees have designations',
      status:     active === 0 ? 'unknown'
                : noDesig === 0 ? 'ok'
                : 'warning',
      severity:   'info',
      isBlocking: false,
      value:      active === 0 ? 0 : `${active - noDesig} / ${active}`,
      recommendation: noDesig > 0
        ? `${noDesig} active employee${noDesig !== 1 ? 's' : ''} without designation — affects org chart and job-level reporting.`
        : undefined,
      actionPath: '/employees',
    },

    // ── Salary structures ──────────────────────────────────────────────────────
    {
      id:         'wf-salary-structures',
      label:      'Salary structures configured',
      status:     structures === undefined ? 'unknown'
                : structures.salaryStructures.length === 0 ? 'error'
                : 'ok',
      severity:   'blocker',
      isBlocking: true,
      value:      structures?.salaryStructures.length ?? '—',
      recommendation: structures?.salaryStructures.length === 0
        ? 'No salary structures found. At least one salary structure is required before payroll can run.'
        : undefined,
      actionLabel: (structures?.salaryStructures.length ?? 0) === 0 ? 'Create Structure' : 'View Structures',
      actionPath:  '/admin/masters/salary-structures',
      dependsOn:   'payroll',
    },
  ]
}
