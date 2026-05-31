/**
 * Attendance Readiness Evaluator
 *
 * Evaluates the prerequisites for attendance tracking and payroll processing:
 *   Shifts → Rosters → Employee shift assignments → Attendance data
 *
 * Data sources:
 *   /masters/shifts
 *   /masters/rosters   (or /attendance/rosters)
 */
import type { ReadinessCheck } from '../types'

interface AttendanceEvalData {
  shifts:            { id: string; is_active?: boolean }[]
  rosters:           { id: string; is_active?: boolean }[]
  employeeCount:     number
  assignedEmployees?: number  // employees with active shift assignment
  attendancePeriods?: { id: string; status: string }[]  // recent periods
}

export function evaluateAttendance(data: AttendanceEvalData): ReadinessCheck[] {
  const {
    shifts, rosters, employeeCount,
    assignedEmployees, attendancePeriods,
  } = data

  const activeShifts  = shifts.filter(s => s.is_active !== false)
  const activeRosters = rosters.filter(r => r.is_active !== false)
  const unassigned    = assignedEmployees !== undefined
    ? employeeCount - assignedEmployees
    : undefined
  const latestPeriod  = attendancePeriods?.[0]

  return [
    // ── Shifts ─────────────────────────────────────────────────────────────────
    {
      id:         'att-shifts',
      label:      'Shifts configured',
      status:     shifts.length === 0      ? 'error'
                : activeShifts.length === 0 ? 'warning'
                : 'ok',
      severity:   'blocker',
      isBlocking: true,
      value:      shifts.length,
      recommendation: shifts.length === 0
        ? 'No shifts configured. Create work shifts (timing + grace) before assigning employees to attendance tracking.'
        : activeShifts.length === 0
        ? 'All shifts are inactive. At least one active shift is needed for attendance.'
        : undefined,
      actionLabel: shifts.length === 0 ? 'Create Shift' : 'Manage Shifts',
      actionPath:  '/admin/attendance/shifts',
    },

    // ── Rosters ────────────────────────────────────────────────────────────────
    {
      id:         'att-rosters',
      label:      'Roster templates configured',
      status:     rosters.length === 0       ? 'warning'
                : activeRosters.length === 0  ? 'warning'
                : 'ok',
      severity:   'warning',
      isBlocking: false,
      value:      rosters.length,
      recommendation: rosters.length === 0
        ? 'Roster templates define weekly work patterns. Configure rosters to automate shift scheduling.'
        : undefined,
      actionLabel: 'Manage Rosters',
      actionPath:  '/admin/masters/rosters',
    },

    // ── Employee shift assignments ─────────────────────────────────────────────
    {
      id:         'att-shift-assignments',
      label:      'Employees assigned to shifts',
      status:     assignedEmployees === undefined ? 'unknown'
                : employeeCount === 0             ? 'unknown'
                : unassigned! === 0               ? 'ok'
                : unassigned! > employeeCount * 0.3 ? 'warning'
                : 'warning',
      severity:   'warning',
      isBlocking: false,
      value:      assignedEmployees !== undefined && employeeCount > 0
        ? `${assignedEmployees} / ${employeeCount}`
        : '—',
      recommendation: unassigned !== undefined && unassigned > 0
        ? `${unassigned} employee${unassigned !== 1 ? 's' : ''} not assigned to a shift — attendance cannot be computed for them.`
        : undefined,
      actionLabel: 'Manage Assignments',
      actionPath:  '/admin/attendance/employee-shifts',
      dependsOn:   'workforce',
    },

    // ── Attendance periods ─────────────────────────────────────────────────────
    {
      id:         'att-periods',
      label:      'Attendance processed for current period',
      status:     attendancePeriods === undefined ? 'unknown'
                : attendancePeriods.length === 0   ? 'warning'
                : latestPeriod?.status === 'finalized' ? 'ok'
                : latestPeriod?.status === 'open'       ? 'warning'
                : 'warning',
      severity:   'info',
      isBlocking: false,
      value:      attendancePeriods?.length ?? '—',
      recommendation: attendancePeriods?.length === 0
        ? 'No attendance periods found. Process attendance before running payroll.'
        : latestPeriod?.status !== 'finalized'
        ? 'Current attendance period is not finalized. Finalize before running payroll.'
        : undefined,
      actionLabel: 'Attendance Periods',
      actionPath:  '/admin/attendance/periods',
      dependsOn:   'payroll',
    },
  ]
}
