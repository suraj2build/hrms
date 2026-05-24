/**
 * exception-taxonomy.ts
 *
 * Canonical taxonomy for attendance exceptions.
 * Used by the processor, routes, and event bus automation.
 */

export type ExceptionCategory = 'punch' | 'shift' | 'roster' | 'policy' | 'device' | 'geo' | 'integrity' | 'payroll'
export type ExceptionSeverity  = 'low' | 'medium' | 'high' | 'critical'

export interface ExceptionMeta {
  category:                ExceptionCategory
  defaultSeverity:         ExceptionSeverity
  payrollImpacting:        boolean
  requiresInvestigation:   boolean
  confidenceImpact:        number   // 0–1: fraction deducted from confidence score
  slaHours:                number   // hours before SLA breach; 0 = no SLA
  label:                   string
  description:             string
}

// Full taxonomy — every valid exception_type string with its metadata
export const EXCEPTION_TAXONOMY: Record<string, ExceptionMeta> = {
  // ── Punch ─────────────────────────────────────────────────────
  missing_in_punch: {
    category: 'punch', defaultSeverity: 'medium',
    payrollImpacting: true, requiresInvestigation: false,
    confidenceImpact: 0.30, slaHours: 24,
    label: 'Missing In-Punch',
    description: 'No check-in punch recorded for the attendance window.',
  },
  missing_out_punch: {
    category: 'punch', defaultSeverity: 'medium',
    payrollImpacting: true, requiresInvestigation: false,
    confidenceImpact: 0.25, slaHours: 24,
    label: 'Missing Out-Punch',
    description: 'Check-in recorded but no corresponding check-out punch.',
  },
  duplicate_punch: {
    category: 'punch', defaultSeverity: 'low',
    payrollImpacting: false, requiresInvestigation: false,
    confidenceImpact: 0.05, slaHours: 0,
    label: 'Duplicate Punch',
    description: 'Consecutive punches in the same direction (device retry or duplicate tap).',
  },
  unpaired_session: {
    category: 'punch', defaultSeverity: 'medium',
    payrollImpacting: true, requiresInvestigation: false,
    confidenceImpact: 0.20, slaHours: 24,
    label: 'Unpaired Session',
    description: 'A punch session is incomplete — check-in has no matching check-out.',
  },

  // ── Shift ─────────────────────────────────────────────────────
  outside_shift_window: {
    category: 'shift', defaultSeverity: 'medium',
    payrollImpacting: false, requiresInvestigation: false,
    confidenceImpact: 0.10, slaHours: 48,
    label: 'Outside Shift Window',
    description: 'Punches recorded significantly outside the assigned shift window.',
  },
  invalid_shift_resolution: {
    category: 'shift', defaultSeverity: 'high',
    payrollImpacting: true, requiresInvestigation: true,
    confidenceImpact: 0.25, slaHours: 24,
    label: 'Invalid Shift Resolution',
    description: 'The shift assigned to this employee could not be resolved for this date.',
  },
  shift_overlap: {
    category: 'shift', defaultSeverity: 'high',
    payrollImpacting: true, requiresInvestigation: true,
    confidenceImpact: 0.30, slaHours: 12,
    label: 'Shift Overlap',
    description: 'Employee has overlapping shift assignments for this date.',
  },
  crossover_conflict: {
    category: 'shift', defaultSeverity: 'medium',
    payrollImpacting: true, requiresInvestigation: false,
    confidenceImpact: 0.15, slaHours: 48,
    label: 'Crossover Conflict',
    description: 'Night shift crosses midnight into a different calendar date creating a conflict.',
  },

  // ── Roster ────────────────────────────────────────────────────
  no_shift_assigned: {
    category: 'roster', defaultSeverity: 'low',
    payrollImpacting: false, requiresInvestigation: false,
    confidenceImpact: 0.10, slaHours: 72,
    label: 'No Shift Assigned',
    description: 'No shift is assigned to this employee for this date.',
  },
  overlapping_roster: {
    category: 'roster', defaultSeverity: 'high',
    payrollImpacting: true, requiresInvestigation: true,
    confidenceImpact: 0.25, slaHours: 12,
    label: 'Overlapping Roster',
    description: 'Multiple roster entries exist for this employee on this date.',
  },
  invalid_override: {
    category: 'roster', defaultSeverity: 'medium',
    payrollImpacting: false, requiresInvestigation: false,
    confidenceImpact: 0.10, slaHours: 48,
    label: 'Invalid Roster Override',
    description: 'A roster override references a shift that is inactive or deleted.',
  },
  stale_roster: {
    category: 'roster', defaultSeverity: 'low',
    payrollImpacting: false, requiresInvestigation: false,
    confidenceImpact: 0.05, slaHours: 0,
    label: 'Stale Roster',
    description: 'Roster data is more than 7 days old without being refreshed.',
  },

  // ── Policy ────────────────────────────────────────────────────
  grace_collision: {
    category: 'policy', defaultSeverity: 'medium',
    payrollImpacting: false, requiresInvestigation: false,
    confidenceImpact: 0.10, slaHours: 0,
    label: 'Grace Period Collision',
    description: 'Multiple grace policies (late, OT, early exit) apply simultaneously.',
  },
  halfday_collision: {
    category: 'policy', defaultSeverity: 'medium',
    payrollImpacting: true, requiresInvestigation: false,
    confidenceImpact: 0.15, slaHours: 48,
    label: 'Half-Day Policy Collision',
    description: 'Half-day threshold conflicts with another active policy.',
  },
  late_policy_conflict: {
    category: 'policy', defaultSeverity: 'medium',
    payrollImpacting: false, requiresInvestigation: false,
    confidenceImpact: 0.10, slaHours: 0,
    label: 'Late Policy Conflict',
    description: 'Conflicting late policies produce ambiguous results.',
  },
  ot_policy_conflict: {
    category: 'policy', defaultSeverity: 'medium',
    payrollImpacting: true, requiresInvestigation: false,
    confidenceImpact: 0.10, slaHours: 48,
    label: 'OT Policy Conflict',
    description: 'Overtime policy conflicts with attendance outcome.',
  },

  // ── Device ────────────────────────────────────────────────────
  biometric_failure: {
    category: 'device', defaultSeverity: 'high',
    payrollImpacting: true, requiresInvestigation: true,
    confidenceImpact: 0.35, slaHours: 8,
    label: 'Biometric Failure',
    description: 'Biometric device reported a failure during punch.',
  },
  device_offline: {
    category: 'device', defaultSeverity: 'medium',
    payrollImpacting: true, requiresInvestigation: false,
    confidenceImpact: 0.20, slaHours: 12,
    label: 'Device Offline',
    description: 'Attendance device was offline; punches may be missing.',
  },
  sync_delay: {
    category: 'device', defaultSeverity: 'low',
    payrollImpacting: false, requiresInvestigation: false,
    confidenceImpact: 0.05, slaHours: 0,
    label: 'Sync Delay',
    description: 'Punch data arrived with a significant delay from the device.',
  },

  // ── Geo ───────────────────────────────────────────────────────
  outside_geofence: {
    category: 'geo', defaultSeverity: 'medium',
    payrollImpacting: false, requiresInvestigation: false,
    confidenceImpact: 0.15, slaHours: 48,
    label: 'Outside Geofence',
    description: 'Punch location was outside the assigned work location geofence.',
  },
  impossible_travel: {
    category: 'geo', defaultSeverity: 'critical',
    payrollImpacting: true, requiresInvestigation: true,
    confidenceImpact: 0.50, slaHours: 4,
    label: 'Impossible Travel',
    description: 'The time between punches at different locations is physically impossible.',
  },
  remote_mismatch: {
    category: 'geo', defaultSeverity: 'low',
    payrollImpacting: false, requiresInvestigation: false,
    confidenceImpact: 0.10, slaHours: 0,
    label: 'Remote Work Mismatch',
    description: 'Employee punched remotely but is not approved for remote work on this date.',
  },

  // ── Integrity ─────────────────────────────────────────────────
  suspicious_pattern: {
    category: 'integrity', defaultSeverity: 'high',
    payrollImpacting: true, requiresInvestigation: true,
    confidenceImpact: 0.40, slaHours: 8,
    label: 'Suspicious Pattern',
    description: 'Attendance pattern is statistically anomalous (possible manipulation).',
  },
  repeated_manual_override: {
    category: 'integrity', defaultSeverity: 'high',
    payrollImpacting: true, requiresInvestigation: true,
    confidenceImpact: 0.30, slaHours: 12,
    label: 'Repeated Manual Override',
    description: 'Employee has had more than 3 manual attendance overrides in a 30-day window.',
  },
  correction_abuse_pattern: {
    category: 'integrity', defaultSeverity: 'critical',
    payrollImpacting: true, requiresInvestigation: true,
    confidenceImpact: 0.50, slaHours: 4,
    label: 'Correction Abuse Pattern',
    description: 'Employee has requested an unusually high number of attendance corrections.',
  },

  // ── Payroll ───────────────────────────────────────────────────
  unresolved_before_payroll: {
    category: 'payroll', defaultSeverity: 'critical',
    payrollImpacting: true, requiresInvestigation: true,
    confidenceImpact: 0.40, slaHours: 4,
    label: 'Unresolved Before Payroll',
    description: 'This exception is unresolved and the payroll period is closing.',
  },
  retroactive_attendance_change: {
    category: 'payroll', defaultSeverity: 'high',
    payrollImpacting: true, requiresInvestigation: true,
    confidenceImpact: 0.25, slaHours: 12,
    label: 'Retroactive Attendance Change',
    description: 'Attendance was changed after a payroll run completed for this period.',
  },
}

// Helper: get exception meta with fallback
export function getExceptionMeta(type: string): ExceptionMeta {
  return EXCEPTION_TAXONOMY[type] ?? {
    category: 'integrity',
    defaultSeverity: 'medium',
    payrollImpacting: false,
    requiresInvestigation: false,
    confidenceImpact: 0.10,
    slaHours: 48,
    label: type,
    description: 'Unclassified exception.',
  }
}

// Helper: compute SLA due timestamp from creation time
export function computeSlaAt(createdAt: Date, slaHours: number): Date | null {
  if (slaHours <= 0) return null
  const due = new Date(createdAt.getTime())
  due.setHours(due.getHours() + slaHours)
  return due
}
