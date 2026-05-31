/**
 * payroll-constants.ts
 *
 * Shared display maps for payroll ledger event types.
 * Centralised here so MyPayslips, ledger views, and any future payroll page
 * all use the same labels — preventing silent label/badge desync when new
 * event types are added to the backend.
 *
 * To add a new event type:
 *   1. Add the key to EVENT_LABEL
 *   2. Add the key to EVENT_BADGE with the appropriate severity
 */

export const EVENT_LABEL: Record<string, string> = {
  leave_deducted:        'Leave Deducted',
  payable_days_changed:  'Payable Days Changed',
  lop_applied:           'LOP Applied',
  correction_approved:   'Correction Approved',
  attendance_recomputed: 'Attendance Recomputed',
  ot_added:              'Overtime Added',
  policy_changed:        'Policy Changed',
  retro_adjustment:      'Retro Adjustment',
  payroll_computed:      'Payroll Computed',
  payroll_finalized:     'Payroll Finalized',
  anomaly_resolved:      'Anomaly Resolved',
  manual_note:           'HR Note',
}

export const EVENT_BADGE: Record<string, 'destructive' | 'warning' | 'success' | 'secondary' | 'outline'> = {
  leave_deducted:        'warning',
  payable_days_changed:  'warning',
  lop_applied:           'destructive',
  correction_approved:   'success',
  attendance_recomputed: 'secondary',
  ot_added:              'success',
  policy_changed:        'outline',
  retro_adjustment:      'warning',
  payroll_computed:      'secondary',
  payroll_finalized:     'success',
  anomaly_resolved:      'success',
  manual_note:           'outline',
}
