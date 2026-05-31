/**
 * Migration 160 — Leave Policy Session Parity
 *
 * The engine-aware leave_policy_rules table already has allow_cross_session and
 * maximum_sessions_per_day (migration 158). Add the same columns to the legacy
 * leave_policies table so both paths expose identical session governance.
 *
 * Also adds the allow_cross_session flag to leave_types so the legacy validation
 * path in leave-request-service can enforce cross-session restrictions without
 * always doing a policy join.
 */

-- ── leave_policies — add missing session governance columns ──────────────────

ALTER TABLE leave_policies
  ADD COLUMN IF NOT EXISTS allow_cross_session      BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS maximum_sessions_per_day INTEGER NOT NULL DEFAULT 2
    CHECK (maximum_sessions_per_day BETWEEN 1 AND 4);

COMMENT ON COLUMN leave_policies.allow_cross_session IS
  'When true, employees may request multi-day leave with different start/end sessions
   (e.g. start second_half Monday → end first_half Wednesday). When false, start_session
   must equal end_session or both must be full_day.';

COMMENT ON COLUMN leave_policies.maximum_sessions_per_day IS
  'Maximum number of distinct session-based leave segments an employee may request per
   calendar day for this leave type. Range: 1–4.';
