/**
 * Payroll Readiness Evaluator
 *
 * Evaluates payroll configuration and processing readiness:
 *   Salary structures → Salary components → Bank details → Payroll runs
 *
 * Data sources:
 *   /masters/salary-structures   (or /payroll/salary-structures)
 *   /payroll/salary-components
 *   /payroll/runs                (recent runs)
 */
import type { ReadinessCheck } from '../types'

interface PayrollEvalData {
  salaryStructures:  { id: string; name: string; is_active?: boolean }[]
  salaryComponents:  { id: string; component_type: string }[]
  recentRuns?:       { id: string; status: string; created_at: string }[]
  employeeCount:     number
  employeesWithBank?: number   // if available from employee detail data
}

export function evaluatePayroll(data: PayrollEvalData): ReadinessCheck[] {
  const {
    salaryStructures, salaryComponents, recentRuns,
    employeeCount, employeesWithBank,
  } = data

  const activeStructures = salaryStructures.filter(s => s.is_active !== false)
  const earnings         = salaryComponents.filter(c => c.component_type === 'earning')
  const deductions       = salaryComponents.filter(c => c.component_type === 'deduction')
  const latestRun        = recentRuns?.[0]

  return [
    // ── Salary structures ──────────────────────────────────────────────────────
    {
      id:         'pay-structures',
      label:      'Salary structures configured',
      status:     salaryStructures.length === 0 ? 'error'
                : activeStructures.length === 0 ? 'warning'
                : 'ok',
      severity:   'blocker',
      isBlocking: true,
      value:      salaryStructures.length,
      recommendation: salaryStructures.length === 0
        ? 'No salary structures found. Create at least one structure to run payroll.'
        : activeStructures.length === 0
        ? 'All salary structures are inactive — activate at least one before running payroll.'
        : undefined,
      actionLabel: salaryStructures.length === 0 ? 'Create Structure' : 'View Structures',
      actionPath:  '/admin/masters?tab=salary-structures',
    },

    // ── Salary components ──────────────────────────────────────────────────────
    {
      id:         'pay-components',
      label:      'Salary components configured',
      status:     salaryComponents.length === 0 ? 'error'
                : earnings.length === 0          ? 'warning'
                : 'ok',
      severity:   'blocker',
      isBlocking: true,
      value:      salaryComponents.length,
      detail:     salaryComponents.length > 0
        ? `${earnings.length} earnings · ${deductions.length} deductions`
        : undefined,
      recommendation: salaryComponents.length === 0
        ? 'No salary components (Basic, HRA, etc.) configured. Salary structures need components to compute payroll.'
        : earnings.length === 0
        ? 'No earning components found. At least one earning component (e.g. Basic Salary) is required.'
        : undefined,
      actionLabel: salaryComponents.length === 0 ? 'Add Components' : 'View',
      actionPath:  '/admin/payroll/salary-components',
    },

    // ── Bank details coverage ──────────────────────────────────────────────────
    {
      id:         'pay-bank-details',
      label:      'Employee bank details complete',
      status:     employeesWithBank === undefined ? 'unknown'
                : employeeCount === 0             ? 'unknown'
                : employeesWithBank === employeeCount ? 'ok'
                : employeesWithBank < employeeCount * 0.8 ? 'error'
                : 'warning',
      severity:   'blocker',
      isBlocking: true,
      value:      employeesWithBank !== undefined && employeeCount > 0
        ? `${employeesWithBank} / ${employeeCount}`
        : '—',
      recommendation: employeesWithBank !== undefined && employeesWithBank < employeeCount
        ? `${employeeCount - employeesWithBank} employee${employeeCount - employeesWithBank !== 1 ? 's' : ''} missing bank details — salary disbursement will fail for these employees.`
        : undefined,
      actionLabel: 'Review Bank Details',
      actionPath:  '/employees',
    },

    // ── Recent payroll run ─────────────────────────────────────────────────────
    {
      id:         'pay-recent-run',
      label:      'Payroll runs',
      status:     recentRuns === undefined ? 'unknown'
                : recentRuns.length === 0  ? 'warning'
                : latestRun?.status === 'failed' ? 'error'
                : latestRun?.status === 'completed' ? 'ok'
                : 'warning',
      severity:   'info',
      isBlocking: false,
      value:      recentRuns?.length ?? '—',
      recommendation: recentRuns?.length === 0
        ? 'No payroll runs yet. Complete org, workforce, and attendance setup before running payroll.'
        : latestRun?.status === 'failed'
        ? 'The most recent payroll run failed. Review and resolve before re-running.'
        : undefined,
      actionLabel: 'Payroll Runs',
      actionPath:  '/admin/payroll/runs',
    },
  ]
}
