/**
 * Migration 158 — Leave Session Governance
 *
 * Enterprise Leave Governance Platform — critical architecture completion.
 *
 * Changes:
 *   1. leave_requests        — start_session/end_session, calculated_days, duration_breakdown
 *   2. leave_policy_rules    — session governance fields (half-day, hourly, rounding, etc.)
 *   3. leave_policies        — same governance fields for legacy policies
 *   4. leave_balance_ledger  — unified ledger: new txn_types + reversal chain + payroll fields
 *   5. Indexes               — session overlap, payroll reconciliation, duration queries
 */

-- ── 1. Extend leave_requests with session governance ─────────────────────────

ALTER TABLE leave_requests
  ADD COLUMN IF NOT EXISTS start_session TEXT NOT NULL DEFAULT 'full_day'
    CHECK (start_session IN ('full_day', 'first_half', 'second_half', 'hourly')),
  ADD COLUMN IF NOT EXISTS end_session TEXT NOT NULL DEFAULT 'full_day'
    CHECK (end_session IN ('full_day', 'first_half', 'second_half', 'hourly')),
  ADD COLUMN IF NOT EXISTS calculated_days  DECIMAL(6,3),
  ADD COLUMN IF NOT EXISTS duration_breakdown JSONB NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS fractional_precision DECIMAL(4,2) NOT NULL DEFAULT 0.5,
  ADD COLUMN IF NOT EXISTS requested_hours DECIMAL(5,2),
  ADD COLUMN IF NOT EXISTS engine_version  TEXT NOT NULL DEFAULT 'v1';

COMMENT ON COLUMN leave_requests.start_session IS
  'Session on the start date: full_day=full first day; second_half=employee works morning, leave starts PM; first_half=full first day from AM';
COMMENT ON COLUMN leave_requests.end_session IS
  'Session on the end date: full_day=full last day; first_half=leave ends at noon, employee works PM; second_half=full last day';
COMMENT ON COLUMN leave_requests.calculated_days IS
  'Engine-computed duration (replaces computed_days going forward). Stored to 3 decimal places for hourly precision.';
COMMENT ON COLUMN leave_requests.duration_breakdown IS
  'JSON breakdown: {working_days, holidays, weekoffs, sandwich_days, attendance_overlap, per_day[]}';
COMMENT ON COLUMN leave_requests.engine_version IS
  'Version tag of the duration engine that computed this request. Enables replay/audit.';

-- Backfill: copy legacy session → start_session/end_session, computed_days → calculated_days
-- (Safe: only updates rows where start_session is still the DEFAULT 'full_day')
DO $$
BEGIN
  -- Only backfill if the session column exists (it was added in an earlier migration)
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name='leave_requests' AND column_name='session'
  ) THEN
    UPDATE leave_requests
    SET
      start_session    = COALESCE(session, 'full_day'),
      end_session      = COALESCE(session, 'full_day'),
      calculated_days  = COALESCE(calculated_days, computed_days)
    WHERE calculated_days IS NULL;
  ELSE
    -- No session column: backfill computed_days only
    UPDATE leave_requests
    SET calculated_days = COALESCE(calculated_days, computed_days)
    WHERE calculated_days IS NULL;
  END IF;
END;
$$;

-- ── 2. Session governance fields on leave_policy_rules ───────────────────────

ALTER TABLE leave_policy_rules
  ADD COLUMN IF NOT EXISTS allow_half_day              BOOLEAN      NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS allow_hourly_leave          BOOLEAN      NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS allow_cross_session         BOOLEAN      NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS allow_mixed_sessions        BOOLEAN      NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS minimum_leave_unit          DECIMAL(4,2) NOT NULL DEFAULT 0.5
    CHECK (minimum_leave_unit IN (0.25, 0.5, 1.0)),
  ADD COLUMN IF NOT EXISTS maximum_sessions_per_day    INT          NOT NULL DEFAULT 2
    CHECK (maximum_sessions_per_day BETWEEN 1 AND 4),
  ADD COLUMN IF NOT EXISTS session_calculation_mode    TEXT         NOT NULL DEFAULT 'standard'
    CHECK (session_calculation_mode IN ('standard', 'shift_aware', 'attendance_aware')),
  ADD COLUMN IF NOT EXISTS sandwich_session_handling   TEXT         NOT NULL DEFAULT 'full_day'
    CHECK (sandwich_session_handling IN ('full_day', 'prorate', 'exclude')),
  ADD COLUMN IF NOT EXISTS holiday_session_handling    TEXT         NOT NULL DEFAULT 'skip'
    CHECK (holiday_session_handling IN ('skip', 'include', 'block')),
  ADD COLUMN IF NOT EXISTS weekoff_session_handling    TEXT         NOT NULL DEFAULT 'skip'
    CHECK (weekoff_session_handling IN ('skip', 'include', 'sandwich_only')),
  ADD COLUMN IF NOT EXISTS fractional_rounding_mode    TEXT         NOT NULL DEFAULT 'nearest_0_5'
    CHECK (fractional_rounding_mode IN ('half_up', 'half_down', 'ceil', 'floor', 'nearest_0_5', 'nearest_0_25')),
  ADD COLUMN IF NOT EXISTS maximum_fractional_precision DECIMAL(4,2) NOT NULL DEFAULT 0.5,
  ADD COLUMN IF NOT EXISTS hours_per_shift             DECIMAL(4,1) NOT NULL DEFAULT 8.0
    CHECK (hours_per_shift > 0 AND hours_per_shift <= 24),
  ADD COLUMN IF NOT EXISTS max_hours_per_day           DECIMAL(4,1)
    CHECK (max_hours_per_day IS NULL OR (max_hours_per_day > 0 AND max_hours_per_day <= 24));

COMMENT ON COLUMN leave_policy_rules.allow_half_day IS
  'Whether employees may request only the first or second half of a day.';
COMMENT ON COLUMN leave_policy_rules.allow_hourly_leave IS
  'Whether hourly (fractional-hour) leave is permitted for this leave type.';
COMMENT ON COLUMN leave_policy_rules.allow_cross_session IS
  'Multi-day leave with different start/end sessions (e.g., start second_half → end first_half).';
COMMENT ON COLUMN leave_policy_rules.minimum_leave_unit IS
  'Smallest chargeable unit: 0.25 (quarter-day), 0.5 (half-day), 1.0 (full-day).';
COMMENT ON COLUMN leave_policy_rules.sandwich_session_handling IS
  'How sandwiched non-working days are counted: full_day=1.0, prorate=proportional, exclude=0.';
COMMENT ON COLUMN leave_policy_rules.fractional_rounding_mode IS
  'Rounding rule after duration computation for payroll-safe output.';
COMMENT ON COLUMN leave_policy_rules.hours_per_shift IS
  'Standard shift hours — used as denominator for hourly leave conversion.';

-- ── 3. Same governance fields on legacy leave_policies ───────────────────────

ALTER TABLE leave_policies
  ADD COLUMN IF NOT EXISTS allow_half_day              BOOLEAN      NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS allow_hourly_leave          BOOLEAN      NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS minimum_leave_unit          DECIMAL(4,2) NOT NULL DEFAULT 0.5
    CHECK (minimum_leave_unit IN (0.25, 0.5, 1.0)),
  ADD COLUMN IF NOT EXISTS session_calculation_mode    TEXT         NOT NULL DEFAULT 'standard'
    CHECK (session_calculation_mode IN ('standard', 'shift_aware', 'attendance_aware')),
  ADD COLUMN IF NOT EXISTS holiday_session_handling    TEXT         NOT NULL DEFAULT 'skip'
    CHECK (holiday_session_handling IN ('skip', 'include', 'block')),
  ADD COLUMN IF NOT EXISTS weekoff_session_handling    TEXT         NOT NULL DEFAULT 'skip'
    CHECK (weekoff_session_handling IN ('skip', 'include', 'sandwich_only')),
  ADD COLUMN IF NOT EXISTS fractional_rounding_mode    TEXT         NOT NULL DEFAULT 'nearest_0_5'
    CHECK (fractional_rounding_mode IN ('half_up', 'half_down', 'ceil', 'floor', 'nearest_0_5', 'nearest_0_25')),
  ADD COLUMN IF NOT EXISTS maximum_fractional_precision DECIMAL(4,2) NOT NULL DEFAULT 0.5,
  ADD COLUMN IF NOT EXISTS hours_per_shift             DECIMAL(4,1) NOT NULL DEFAULT 8.0
    CHECK (hours_per_shift > 0 AND hours_per_shift <= 24),
  ADD COLUMN IF NOT EXISTS max_hours_per_day           DECIMAL(4,1)
    CHECK (max_hours_per_day IS NULL OR (max_hours_per_day > 0 AND max_hours_per_day <= 24));

-- ── 4. Unified leave_balance_ledger — new txn_types + reversal chain ─────────

-- Drop old CHECK constraint, re-create with extended txn_type set
DO $$
BEGIN
  -- Attempt to drop; ignore if the constraint name is different in this environment
  ALTER TABLE leave_balance_ledger
    DROP CONSTRAINT IF EXISTS leave_balance_ledger_txn_type_check;
EXCEPTION WHEN others THEN
  NULL; -- constraint may not exist by that name
END;
$$;

-- Recreate the constraint with all enterprise txn types
ALTER TABLE leave_balance_ledger
  ADD CONSTRAINT leave_balance_ledger_txn_type_check
    CHECK (txn_type IN (
      -- Original types:
      'accrual', 'carry_forward', 'manual_credit', 'deduction',
      'encashment', 'expiry', 'opening_balance',
      -- New enterprise types:
      'event_grant',        -- birthday/anniversary event-triggered credit
      'reversal',           -- undo a prior deduction or credit
      'payroll_adjustment', -- LOP reconciliation from payroll engine
      'correction',         -- HR-initiated correction with mandatory reason
      'lop_recovery'        -- negative recovery batch job
    ));

ALTER TABLE leave_balance_ledger
  ADD COLUMN IF NOT EXISTS leave_request_ref   UUID         REFERENCES leave_requests(id)       ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS reversal_of         UUID         REFERENCES leave_balance_ledger(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS is_reversal         BOOLEAN      NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS payroll_period      TEXT,          -- 'YYYY-MM' for payroll reconciliation
  ADD COLUMN IF NOT EXISTS session_snapshot    JSONB        NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS duration_at_entry   DECIMAL(6,3), -- calculated_days at time of deduction
  ADD COLUMN IF NOT EXISTS metadata            JSONB        NOT NULL DEFAULT '{}';

COMMENT ON COLUMN leave_balance_ledger.leave_request_ref IS
  'FK to leave_requests for deduction/reversal entries. Enables ledger → request traceability.';
COMMENT ON COLUMN leave_balance_ledger.reversal_of IS
  'For reversal entries: the original ledger entry being reversed. Creates an audit chain.';
COMMENT ON COLUMN leave_balance_ledger.is_reversal IS
  'True when this entry reverses a prior entry (delta is opposite sign).';
COMMENT ON COLUMN leave_balance_ledger.payroll_period IS
  'Set for payroll_adjustment entries — links to payroll run month (YYYY-MM).';
COMMENT ON COLUMN leave_balance_ledger.session_snapshot IS
  'Snapshot of the leave request session at time of deduction: {start_session, end_session, duration_breakdown}.';
COMMENT ON COLUMN leave_balance_ledger.metadata IS
  'Arbitrary key-value context: approval chain, override reasons, HR notes.';

-- ── 5. Performance indexes ────────────────────────────────────────────────────

-- Session overlap detection (used by collision engine + conflict validator)
CREATE INDEX IF NOT EXISTS idx_lr_session_overlap
  ON leave_requests(tenant_id, employee_id, from_date, to_date)
  WHERE status IN ('PENDING', 'APPROVED');

-- Duration-based reconciliation queries
CREATE INDEX IF NOT EXISTS idx_lr_duration_reconcile
  ON leave_requests(tenant_id, from_date, start_session, end_session)
  WHERE status = 'APPROVED';

-- Payroll period reconciliation on ledger
CREATE INDEX IF NOT EXISTS idx_lbl_payroll_period
  ON leave_balance_ledger(tenant_id, employee_id, payroll_period)
  WHERE payroll_period IS NOT NULL;

-- Reversal chain traversal
CREATE INDEX IF NOT EXISTS idx_lbl_reversal_chain
  ON leave_balance_ledger(reversal_of)
  WHERE reversal_of IS NOT NULL;

-- Leave request ref (for balance → request drill-through)
CREATE INDEX IF NOT EXISTS idx_lbl_request_ref
  ON leave_balance_ledger(leave_request_ref)
  WHERE leave_request_ref IS NOT NULL;

-- ── 6. RLS: new columns inherit existing leave_requests and leave_balance_ledger policies ──
-- No additional policies needed — columns inherit row-level policies from the parent tables.
