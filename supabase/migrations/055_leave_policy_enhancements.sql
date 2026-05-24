-- ============================================================
-- 055_leave_policy_enhancements.sql
--
-- Adds three sets of improvements to the leave policy engine
-- (migration 054):
--
--   A. Effective date windows on assignments and rules (Step 2)
--      – effective_from / effective_to let policies be scheduled
--        in advance or retired without deletion.
--
--   B. Eligibility guard columns on rules (Step 4)
--      – eligibility_min_tenure_days: employee must have been
--        employed at least this many days to be eligible.
--      – eligibility_employment_types: restrict to specific
--        employment types (empty array = no restriction).
--
--   C. Comp Off (CO) request table (Step 6)
--      – comp_off_requests tracks detection and approval of
--        compensatory-off entitlements for work done on
--        weekly-off or holiday days.
-- ============================================================

-- ──────────────────────────────────────────────────────────────────────────────
-- A. Effective date windows
-- ──────────────────────────────────────────────────────────────────────────────

-- leave_policy_assignments: window during which the assignment is active
ALTER TABLE leave_policy_assignments
  ADD COLUMN IF NOT EXISTS effective_from DATE,
  ADD COLUMN IF NOT EXISTS effective_to   DATE;

-- Constraint: when both are set, from must be ≤ to
ALTER TABLE leave_policy_assignments
  DROP CONSTRAINT IF EXISTS chk_assignment_effective_dates;

ALTER TABLE leave_policy_assignments
  ADD CONSTRAINT chk_assignment_effective_dates
    CHECK (effective_from IS NULL OR effective_to IS NULL OR effective_from <= effective_to);

-- leave_policy_rules: individual rule can be date-windowed inside a policy
ALTER TABLE leave_policy_rules
  ADD COLUMN IF NOT EXISTS effective_from DATE,
  ADD COLUMN IF NOT EXISTS effective_to   DATE;

ALTER TABLE leave_policy_rules
  DROP CONSTRAINT IF EXISTS chk_rule_effective_dates;

ALTER TABLE leave_policy_rules
  ADD CONSTRAINT chk_rule_effective_dates
    CHECK (effective_from IS NULL OR effective_to IS NULL OR effective_from <= effective_to);

-- ──────────────────────────────────────────────────────────────────────────────
-- B. Eligibility guard columns on leave_policy_rules
-- ──────────────────────────────────────────────────────────────────────────────

-- Minimum employment tenure (days from joining_date) required for eligibility.
-- NULL (or 0) = no tenure gate.
ALTER TABLE leave_policy_rules
  ADD COLUMN IF NOT EXISTS eligibility_min_tenure_days INT NOT NULL DEFAULT 0;

-- Employment types allowed to use this leave type under this policy.
-- Empty array = all types allowed.
-- Values mirror employees.employment_type: permanent, contract, intern, probation, consultant
ALTER TABLE leave_policy_rules
  ADD COLUMN IF NOT EXISTS eligibility_employment_types TEXT[] NOT NULL DEFAULT '{}';

-- ──────────────────────────────────────────────────────────────────────────────
-- C. Comp Off requests table
-- ──────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS comp_off_requests (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       UUID        NOT NULL REFERENCES tenants(id)     ON DELETE CASCADE,
  employee_id     UUID        NOT NULL REFERENCES employees(id)   ON DELETE CASCADE,

  -- The date the employee worked (must be a weekly-off or holiday date)
  worked_date     DATE        NOT NULL,

  -- Detected from attendance_daily flags
  worked_reason   TEXT        NOT NULL DEFAULT 'weekly_off'
    CHECK (worked_reason IN ('weekly_off', 'holiday')),

  -- The leave_type designated as "Comp Off" leave — links to leave_types
  leave_type_id   UUID        NULL REFERENCES leave_types(id)     ON DELETE SET NULL,

  -- How many CO days to credit on approval (usually 1.0; 0.5 for half-day workers)
  days_to_credit  DECIMAL(4,1) NOT NULL DEFAULT 1.0
    CHECK (days_to_credit > 0),

  -- Status lifecycle: pending → approved | rejected
  status          TEXT        NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'approved', 'rejected')),

  -- Filled on approval / rejection
  reviewed_by     UUID        NULL REFERENCES profiles(id)        ON DELETE SET NULL,
  reviewed_at     TIMESTAMPTZ NULL,

  -- Notes from HR / manager
  notes           TEXT,

  -- Track who/when created
  created_by      UUID        NULL REFERENCES profiles(id)        ON DELETE SET NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),

  -- Prevent duplicate CO requests for the same employee on the same worked date
  UNIQUE (tenant_id, employee_id, worked_date)
);

CREATE INDEX IF NOT EXISTS idx_comp_off_employee_date
  ON comp_off_requests (tenant_id, employee_id, worked_date DESC);

CREATE INDEX IF NOT EXISTS idx_comp_off_status
  ON comp_off_requests (tenant_id, status);

-- updated_at trigger (reuse existing pattern)
CREATE OR REPLACE FUNCTION update_comp_off_timestamp()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_comp_off_updated_at ON comp_off_requests;
CREATE TRIGGER trg_comp_off_updated_at
  BEFORE UPDATE ON comp_off_requests
  FOR EACH ROW EXECUTE FUNCTION update_comp_off_timestamp();

-- Row-Level Security
ALTER TABLE comp_off_requests ENABLE ROW LEVEL SECURITY;

-- All authenticated users can read CO requests in their tenant
CREATE POLICY "co_tenant_read"
  ON comp_off_requests FOR SELECT
  USING (tenant_id = get_user_tenant_id());

-- Employees can insert their own (for self-service) and HR can insert for anyone
CREATE POLICY "co_employee_insert"
  ON comp_off_requests FOR INSERT
  WITH CHECK (tenant_id = get_user_tenant_id());

-- HR/admins can do everything (approve, reject, delete)
CREATE POLICY "co_hr_write"
  ON comp_off_requests FOR ALL
  USING (get_user_role() IN ('super_admin', 'hr_admin', 'manager'));
