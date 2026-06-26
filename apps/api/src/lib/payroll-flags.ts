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
 * force_finalize) is a workflow change that requires two operators.
 *
 * DEFAULT ON (four-eyes enforced). The person who runs a payroll month cannot
 * finalize it — a different admin must. To temporarily disable (e.g. an
 * emergency single-admin finalize) set PAYROLL_FINALIZE_DUAL_CONTROL to one of
 * the OFF values below. Any other value (or unset) keeps four-eyes enforced.
 *
 * While disabled, finalize still records a maker_checker_log row
 * (status='auto_approved'), so the audit trail is always real.
 */

const OFF_VALUES = new Set(['off', 'false', '0', 'disabled', 'no'])

/** Whether four-eyes (maker≠checker) finalize + super_admin force is enforced. */
export function isPayrollDualControlEnabled(): boolean {
  const raw = process.env['PAYROLL_FINALIZE_DUAL_CONTROL']
  if (raw == null) return true            // default ON — opt-OUT tightening
  return !OFF_VALUES.has(raw.trim().toLowerCase())
}

const ON_VALUES = new Set(['on', 'true', '1', 'enabled', 'yes'])

/**
 * Whether job offers require a four-eyes sign-off before being sent to the
 * candidate. DEFAULT OFF (opt-IN): offers currently send immediately, so making
 * sign-off mandatory must be a deliberate choice. Enable by setting
 * OFFER_SIGNOFF_DUAL_CONTROL to one of the ON values. When enabled, the first
 * send records a pending maker_checker_log row and a DIFFERENT authorised user
 * must call send again to approve and actually dispatch the offer.
 */
export function isOfferSignoffEnabled(): boolean {
  const raw = process.env['OFFER_SIGNOFF_DUAL_CONTROL']
  if (raw == null) return false           // default OFF — opt-IN
  return ON_VALUES.has(raw.trim().toLowerCase())
}
