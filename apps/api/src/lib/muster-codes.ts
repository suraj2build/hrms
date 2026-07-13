/**
 * muster-codes.ts
 *
 * Canonical muster roll attendance codes for CognixHR.
 *
 * These are the DISPLAY codes on the muster roll — separate from the internal
 * `status` values stored in `attendance_daily.status`, which the calculation
 * engine uses unchanged.
 *
 * The `muster_code` column in `attendance_daily` is set by:
 *   1. The attendance processor  — punch-derived codes (P, P_L, A, MIS, NP, HL, WO, PWO, PHL)
 *   2. The leave approval route  — leave codes (CL, EL, SL, ML, PAT, BL, CO, LWP and half-day variants)
 *
 * Payroll uses `day_fraction` as the authoritative input — `muster_code` is
 * purely for display and reporting.
 */

export type MusterCode =
  // Present-category (all payable, no LOP)
  | 'P'        // Present — full day, on time
  | 'P_L'      // Present Late
  | 'OD'       // On Duty (at external / client location)
  | 'WFH'      // Work From Home
  | 'TOUR'     // On Tour / Business Travel
  // Absent-category (not payable, LOP)
  | 'A'        // Absent — unapproved, unrecorded
  | 'MIS'      // Missing Punch — only one biometric swipe for the day
  | 'NP'       // No Punch — no biometric record at all
  | 'LWP'      // Leave Without Pay — approved but unpaid
  // Off-day category
  | 'WO'       // Weekly Off — clean (no punch)
  | 'HL'       // Holiday — clean (no punch)
  | 'PWO'      // Present on Weekly Off — employee worked on their off day
  | 'PHL'      // Present on Holiday — employee worked on a declared holiday
  // Leave category (approved, paid)
  | 'CL'       // Casual Leave
  | 'EL'       // Earned Leave
  | 'SL'       // Sick Leave
  | 'ML'       // Maternity Leave
  | 'PAT'      // Paternity Leave
  | 'BL'       // Bereavement Leave
  | 'CO'       // Compensatory Off
  // Half-day variants (present half + leave/off/absent half)
  | 'HLF'      // Half Day — present for half shift (absent half treated as LOP)
  | 'HLF_LWP'  // Half Present + Half LWP         day_fraction=0.5
  | 'HLF_A'    // Half Present + Half Absent       day_fraction=0.5
  | 'HLF_CL'   // Half Present + Half CL           day_fraction=1.0
  | 'HLF_EL'   // Half Present + Half EL           day_fraction=1.0
  | 'HLF_SL'   // Half Present + Half SL           day_fraction=1.0
  | 'HLF_CO'   // Half Present + Half CO           day_fraction=1.0

export interface MusterCodeDef {
  code:         MusterCode
  label:        string    // Human-readable name shown in legend / tooltip
  day_fraction: number    // 0.0 | 0.5 | 1.0 — mirrors attendance_daily.day_fraction
  is_payable:   boolean   // Does this day count toward salary?
  is_lop:       boolean   // Does this day carry a Loss-of-Pay deduction?
  category:     'present' | 'absent' | 'off' | 'leave' | 'half'
}

export const MUSTER_CODE_DEFS: Record<MusterCode, MusterCodeDef> = {
  // ── Present-category ──────────────────────────────────────────────────────
  P:       { code: 'P',       label: 'Present',                 day_fraction: 1.0, is_payable: true,  is_lop: false, category: 'present' },
  P_L:     { code: 'P_L',    label: 'Present (Late)',           day_fraction: 1.0, is_payable: true,  is_lop: false, category: 'present' },
  OD:      { code: 'OD',     label: 'On Duty',                  day_fraction: 1.0, is_payable: true,  is_lop: false, category: 'present' },
  WFH:     { code: 'WFH',    label: 'Work From Home',           day_fraction: 1.0, is_payable: true,  is_lop: false, category: 'present' },
  TOUR:    { code: 'TOUR',   label: 'On Tour',                  day_fraction: 1.0, is_payable: true,  is_lop: false, category: 'present' },
  // ── Absent-category ───────────────────────────────────────────────────────
  A:       { code: 'A',      label: 'Absent',                   day_fraction: 0.0, is_payable: false, is_lop: true,  category: 'absent'  },
  MIS:     { code: 'MIS',    label: 'Missing Punch',            day_fraction: 0.0, is_payable: false, is_lop: true,  category: 'absent'  },
  NP:      { code: 'NP',     label: 'No Punch',                 day_fraction: 0.0, is_payable: false, is_lop: true,  category: 'absent'  },
  LWP:     { code: 'LWP',    label: 'Leave Without Pay',        day_fraction: 0.0, is_payable: false, is_lop: true,  category: 'absent'  },
  // ── Off-day category ──────────────────────────────────────────────────────
  WO:      { code: 'WO',     label: 'Weekly Off',               day_fraction: 1.0, is_payable: true,  is_lop: false, category: 'off'     },
  HL:      { code: 'HL',     label: 'Holiday',                  day_fraction: 1.0, is_payable: true,  is_lop: false, category: 'off'     },
  PWO:     { code: 'PWO',    label: 'Present on Weekly Off',    day_fraction: 1.0, is_payable: true,  is_lop: false, category: 'present' },
  PHL:     { code: 'PHL',    label: 'Present on Holiday',       day_fraction: 1.0, is_payable: true,  is_lop: false, category: 'present' },
  // ── Leave category ────────────────────────────────────────────────────────
  CL:      { code: 'CL',     label: 'Casual Leave',             day_fraction: 1.0, is_payable: true,  is_lop: false, category: 'leave'   },
  EL:      { code: 'EL',     label: 'Earned Leave',             day_fraction: 1.0, is_payable: true,  is_lop: false, category: 'leave'   },
  SL:      { code: 'SL',     label: 'Sick Leave',               day_fraction: 1.0, is_payable: true,  is_lop: false, category: 'leave'   },
  ML:      { code: 'ML',     label: 'Maternity Leave',          day_fraction: 1.0, is_payable: true,  is_lop: false, category: 'leave'   },
  PAT:     { code: 'PAT',    label: 'Paternity Leave',          day_fraction: 1.0, is_payable: true,  is_lop: false, category: 'leave'   },
  BL:      { code: 'BL',     label: 'Bereavement Leave',        day_fraction: 1.0, is_payable: true,  is_lop: false, category: 'leave'   },
  CO:      { code: 'CO',     label: 'Compensatory Off',         day_fraction: 1.0, is_payable: true,  is_lop: false, category: 'leave'   },
  // ── Half-day variants ─────────────────────────────────────────────────────
  HLF:     { code: 'HLF',    label: 'Half Day',                 day_fraction: 0.5, is_payable: true,  is_lop: false, category: 'half'    },
  HLF_LWP: { code: 'HLF_LWP', label: 'Half Day + LWP',         day_fraction: 0.5, is_payable: true,  is_lop: true,  category: 'half'    },
  HLF_A:   { code: 'HLF_A',  label: 'Half Present + Absent',   day_fraction: 0.5, is_payable: true,  is_lop: true,  category: 'half'    },
  HLF_CL:  { code: 'HLF_CL', label: 'Half Day + CL',           day_fraction: 1.0, is_payable: true,  is_lop: false, category: 'half'    },
  HLF_EL:  { code: 'HLF_EL', label: 'Half Day + EL',           day_fraction: 1.0, is_payable: true,  is_lop: false, category: 'half'    },
  HLF_SL:  { code: 'HLF_SL', label: 'Half Day + SL',           day_fraction: 1.0, is_payable: true,  is_lop: false, category: 'half'    },
  HLF_CO:  { code: 'HLF_CO', label: 'Half Day + CO',           day_fraction: 1.0, is_payable: true,  is_lop: false, category: 'half'    },
}

/**
 * Fallback mapping from internal DB `status` to muster code.
 * The processor uses this; the leave route overrides with the specific type.
 *
 * no_punch = no biometric record → treated as Absent (A), same as unapproved absence.
 * missing_punch = single swipe only → MIS (distinct punch exception).
 */
export const STATUS_TO_MUSTER_CODE: Partial<Record<string, MusterCode>> = {
  present:       'P',
  late:          'P_L',
  absent:        'A',
  half_day:      'HLF',
  holiday:       'HL',
  weekend:       'WO',
  weekly_off:    'WO',
  leave:         'CL',     // generic fallback; leave route sets CL/EL/SL/etc.
  overtime:      'P',
  missing_punch: 'MIS',
  no_punch:      'A',      // no record at all = Absent on muster
}

/**
 * Derive muster_code for a processor daily result, after the priority chain
 * has resolved the final status.  Called by attendance-processor.ts before
 * persisting the row.
 *
 * Note: leave-specific codes (CL, EL, SL, etc.) are NOT set here — the leave
 * approval route writes them directly when an approved leave record exists.
 */
export function deriveMusterCode(
  status:             string,
  workedOnHoliday:    boolean,
  workedOnWeeklyOff:  boolean,
): MusterCode {
  if (workedOnHoliday)   return 'PHL'
  if (workedOnWeeklyOff) return 'PWO'
  return STATUS_TO_MUSTER_CODE[status] ?? 'A'
}

/** Human-readable label for any muster code string (safe — returns code on miss). */
export function musterLabel(code: string): string {
  return (MUSTER_CODE_DEFS as Record<string, MusterCodeDef>)[code]?.label ?? code
}
