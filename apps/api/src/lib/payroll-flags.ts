/**
 * payroll-flags.ts — runtime feature flags for payroll governance.
 *
 * PI-1 (Payroll Finalization Lockdown) rollout lever.
 *
 * The immutability triggers (migration 263) and the "cannot re-run a finalized
 * month" 409 guard are ALWAYS on — they are the hard floor and do not change the
 * happy path of a first-time finalize.
 *
 * Dual control (distinct maker/checker on finalize, and super_admin-only
 * force_finalize) is a workflow change that requires two operators, so it is
 * gated here and DEFAULT OFF. While off:
 *   • finalize still records a maker_checker_log row (status='auto_approved'),
 *     so the audit trail is real immediately — the previously-decorative table
 *     is now actually written.
 *   • finalize behaves exactly as before (single hr_admin, immediate).
 * Set PAYROLL_FINALIZE_DUAL_CONTROL=on|true|1 to enforce four-eyes finalize.
 */

const ON_VALUES = new Set(['on', 'true', '1', 'enabled', 'yes'])

/** Whether four-eyes (maker≠checker) finalize + super_admin force is enforced. */
export function isPayrollDualControlEnabled(): boolean {
  const raw = process.env['PAYROLL_FINALIZE_DUAL_CONTROL']
  if (raw == null) return false           // default off — opt-in tightening
  return ON_VALUES.has(raw.trim().toLowerCase())
}
