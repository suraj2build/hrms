/**
 * Migration 162 — Leave Type Session Flags
 *
 * Adds coarse session-capability flags to the leave_types table so HR can
 * declare at the type level whether half-day / hourly leave is ever permitted.
 * The leave_policies table already holds the granular policy-level controls
 * (allow_half_day, allow_hourly_leave, max_hours_per_day — migration 158).
 *
 * These type-level flags serve two purposes:
 *   1. Default / fallback when no policy is configured for the type.
 *   2. Quick visual indicator in the Leave Types admin list.
 *
 * Column name alignment:
 *   leave_types uses  allow_hourly  (short form, existing codebase convention)
 *   leave_policies uses allow_hourly_leave  (full form, migration 158)
 *
 * Defaults are conservative (half-day off, hourly off) so existing leave types
 * are unaffected until an admin explicitly enables the flags.
 */

ALTER TABLE leave_types
  ADD COLUMN IF NOT EXISTS allow_half_day    BOOLEAN     NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS allow_hourly      BOOLEAN     NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS max_hours_per_day DECIMAL(4,1)
    CHECK (max_hours_per_day IS NULL OR (max_hours_per_day > 0 AND max_hours_per_day <= 24.0));

COMMENT ON COLUMN leave_types.allow_half_day IS
  'When true, employees may request first-half (AM) or second-half (PM) sessions for this leave type.
   Acts as a type-level default; leave_policies.allow_half_day overrides this when a policy is configured.';

COMMENT ON COLUMN leave_types.allow_hourly IS
  'When true, employees may request leave in hourly increments for this leave type.
   Acts as a type-level default; leave_policies.allow_hourly_leave overrides this when a policy is configured.';

COMMENT ON COLUMN leave_types.max_hours_per_day IS
  'Maximum leave hours per day for hourly leave. NULL = no cap (uses shift hours from policy).
   Acts as a type-level default; leave_policies.max_hours_per_day overrides when a policy is configured.';
