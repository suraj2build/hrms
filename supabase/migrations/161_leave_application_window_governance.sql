/**
 * Migration 161 — Leave Application Window Governance
 *
 * Adds configurable application-timing governance to both the engine-aware
 * leave_policy_rules table and the legacy leave_policies table.
 *
 * Fields:
 *   allow_past_dated_leave          — employee may apply for dates before today
 *   maximum_past_days               — how many calendar days back is permitted (0 = today only)
 *   allow_current_period_leave      — employee may apply leave for the current calendar month
 *   allow_future_leave              — employee may apply for future dates
 *   maximum_future_days             — how far ahead is permitted (NULL = unlimited)
 *   future_application_requires_approval — future leave always needs explicit manager sign-off
 *   same_day_application_mode       — allowed | restricted | manager_override_only
 *
 * Design notes:
 *   • "Past" means from_date < today (local calendar date).
 *   • "Same-day" means from_date == today.
 *   • maximum_past_days = 7 means the employee can apply for dates up to 7 calendar
 *     days ago.  maximum_past_days = 0 with allow_past_dated_leave = false means
 *     no retrospective leave is possible.
 *   • maximum_future_days = NULL means no upper cap on future applications.
 *   • Both tables receive identical columns so the legacy and engine paths behave
 *     consistently.
 */

-- ── leave_policy_rules ─────────────────────────────────────────────────────────

ALTER TABLE leave_policy_rules
  ADD COLUMN IF NOT EXISTS allow_past_dated_leave           BOOLEAN      NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS maximum_past_days                INT          NOT NULL DEFAULT 0
    CHECK (maximum_past_days >= 0),
  ADD COLUMN IF NOT EXISTS allow_current_period_leave       BOOLEAN      NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS allow_future_leave               BOOLEAN      NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS maximum_future_days              INT                   -- NULL = unlimited
    CHECK (maximum_future_days IS NULL OR maximum_future_days >= 0),
  ADD COLUMN IF NOT EXISTS future_application_requires_approval BOOLEAN   NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS same_day_application_mode        TEXT         NOT NULL DEFAULT 'allowed'
    CHECK (same_day_application_mode IN ('allowed', 'restricted', 'manager_override_only'));

COMMENT ON COLUMN leave_policy_rules.allow_past_dated_leave IS
  'When true, employees may submit leave requests for dates before today (retrospective leave).';
COMMENT ON COLUMN leave_policy_rules.maximum_past_days IS
  'Maximum calendar days in the past an employee may apply for (0 = today is the earliest).
   Only relevant when allow_past_dated_leave = true.';
COMMENT ON COLUMN leave_policy_rules.allow_current_period_leave IS
  'When false, leave requests for the current calendar month are blocked.';
COMMENT ON COLUMN leave_policy_rules.allow_future_leave IS
  'When false, employees cannot apply for leave on any future date.';
COMMENT ON COLUMN leave_policy_rules.maximum_future_days IS
  'Maximum calendar days ahead an employee may apply for. NULL = no limit.
   Only relevant when allow_future_leave = true.';
COMMENT ON COLUMN leave_policy_rules.future_application_requires_approval IS
  'When true, any leave request for a future date is flagged as requiring explicit
   manager approval (cannot auto-approve even if approval workflow is bypassed).';
COMMENT ON COLUMN leave_policy_rules.same_day_application_mode IS
  'allowed = same-day leave is unrestricted.
   restricted = same-day leave is blocked outright.
   manager_override_only = same-day is blocked for the employee but a manager can
   apply leave on their behalf via the approval / correction flow.';

-- ── leave_policies (legacy parity) ────────────────────────────────────────────

ALTER TABLE leave_policies
  ADD COLUMN IF NOT EXISTS allow_past_dated_leave               BOOLEAN  NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS maximum_past_days                    INT      NOT NULL DEFAULT 0
    CHECK (maximum_past_days >= 0),
  ADD COLUMN IF NOT EXISTS allow_current_period_leave           BOOLEAN  NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS allow_future_leave                   BOOLEAN  NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS maximum_future_days                  INT              -- NULL = unlimited
    CHECK (maximum_future_days IS NULL OR maximum_future_days >= 0),
  ADD COLUMN IF NOT EXISTS future_application_requires_approval BOOLEAN  NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS same_day_application_mode            TEXT     NOT NULL DEFAULT 'allowed'
    CHECK (same_day_application_mode IN ('allowed', 'restricted', 'manager_override_only'));

-- ── leave_requests — flag for manager-override same-day requests ──────────────
-- Stores whether this request was submitted under manager_override_only mode so
-- approvers can see the context without querying the policy again.

ALTER TABLE leave_requests
  ADD COLUMN IF NOT EXISTS requires_manager_override BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS application_window_note   TEXT;

COMMENT ON COLUMN leave_requests.requires_manager_override IS
  'Set true when the leave type policy has same_day_application_mode = manager_override_only
   and the employee submitted a same-day request. Signals to managers that extra scrutiny
   is expected on this approval.';
COMMENT ON COLUMN leave_requests.application_window_note IS
  'Human-readable governance note captured at submission time (e.g. "Retroactive — 3 days past").';
