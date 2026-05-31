-- =============================================================
-- 046_attendance_policy.sql
--
-- Introduce per-tenant (and optionally per-employee) attendance
-- computation policies, replacing the hard-coded constants in
-- the AttendanceEngine.
--
-- Tables:
--   attendance_policies          — policy definitions (one default per tenant)
--   employee_attendance_policies — optional per-employee policy assignment
--
-- The AttendancePolicyService resolves the effective policy for an
-- employee using this priority chain:
--   1. employee_attendance_policies (employee-specific assignment)
--   2. attendance_policies WHERE is_default = true   (tenant default)
--   3. Built-in DEFAULT_POLICY in application code   (hardcoded fallback)
--
-- All numeric fields must be positive where applicable and bounded
-- by DB CHECK constraints.
-- =============================================================

-- ── Main policy table ────────────────────────────────────────
CREATE TABLE IF NOT EXISTS attendance_policies (
  id   UUID  PRIMARY KEY DEFAULT gen_random_uuid(),

  tenant_id  UUID  NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,

  -- Human-readable name (e.g. "Standard Policy", "Field Staff Policy")
  name       TEXT  NOT NULL,

  -- Grace period in minutes before an arrival is counted as late.
  -- Must be in [0, 120].
  grace_minutes          INT  NOT NULL DEFAULT 15
    CONSTRAINT attendance_policies_grace_check CHECK (grace_minutes BETWEEN 0 AND 120),

  -- Maximum late_minutes value stored regardless of actual delay.
  -- Prevents outlier data from distorting payroll calculations.
  -- Must be in [1, 480].
  late_cap_minutes       INT  NOT NULL DEFAULT 240
    CONSTRAINT attendance_policies_late_cap_check CHECK (late_cap_minutes BETWEEN 1 AND 480),

  -- Minimum % of shift duration required to be marked PRESENT.
  -- Must be in [1, 100].  Default 75 means ≥ 75 % → PRESENT.
  present_threshold_pct  INT  NOT NULL DEFAULT 75
    CONSTRAINT attendance_policies_present_pct_check CHECK (present_threshold_pct BETWEEN 1 AND 100),

  -- Minimum % of shift duration required to be marked HALF_DAY.
  -- Must be in [1, present_threshold_pct − 1] but we only enforce the
  -- range [1, 99] here; the application layer ensures half < present.
  half_day_threshold_pct INT  NOT NULL DEFAULT 50
    CONSTRAINT attendance_policies_half_day_pct_check CHECK (half_day_threshold_pct BETWEEN 1 AND 99),

  -- Hours beyond which a day is flagged as "excessive hours" for anomaly
  -- detection.  0 = feature disabled.  Range [0, 24].
  excessive_hours_threshold DECIMAL(4,1) NOT NULL DEFAULT 12.0
    CONSTRAINT attendance_policies_excessive_check CHECK (excessive_hours_threshold BETWEEN 0 AND 24),

  -- When true, this row is the tenant's default policy.
  -- Enforced as unique via partial index below.
  is_default  BOOLEAN  NOT NULL DEFAULT false,

  created_at  TIMESTAMPTZ  NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ  NOT NULL DEFAULT now()
);

-- Enforce exactly ONE default policy per tenant.
-- A partial unique index on (tenant_id) WHERE is_default = true prevents
-- a second default from being inserted without removing the existing one.
CREATE UNIQUE INDEX IF NOT EXISTS uidx_attendance_policy_default
  ON attendance_policies (tenant_id)
  WHERE is_default = true;

CREATE INDEX IF NOT EXISTS idx_attendance_policy_tenant
  ON attendance_policies (tenant_id);

-- ── Per-employee override table ───────────────────────────────
CREATE TABLE IF NOT EXISTS employee_attendance_policies (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  tenant_id   UUID  NOT NULL REFERENCES tenants(id)              ON DELETE CASCADE,
  employee_id UUID  NOT NULL REFERENCES employees(id)            ON DELETE CASCADE,
  policy_id   UUID  NOT NULL REFERENCES attendance_policies(id)  ON DELETE CASCADE,

  -- Optional validity window.  NULL = always active.
  effective_from  DATE  NULL,
  effective_to    DATE  NULL,

  created_at  TIMESTAMPTZ  NOT NULL DEFAULT now(),

  -- At most one active policy assignment per employee at a time.
  -- We don't enforce overlapping date ranges in the DB (rely on app layer),
  -- but we do enforce uniqueness when both dates are null (simple assignment).
  UNIQUE (tenant_id, employee_id)
);

CREATE INDEX IF NOT EXISTS idx_emp_att_policy_employee
  ON employee_attendance_policies (tenant_id, employee_id);

-- ── Row-level security ────────────────────────────────────────

ALTER TABLE attendance_policies           ENABLE ROW LEVEL SECURITY;
ALTER TABLE employee_attendance_policies  ENABLE ROW LEVEL SECURITY;

-- Read: any authenticated user in the same tenant
CREATE POLICY "ap_tenant_read"  ON attendance_policies
  FOR SELECT USING (tenant_id = get_user_tenant_id());

-- Write: hr_admin and super_admin only
CREATE POLICY "ap_hr_write"     ON attendance_policies
  FOR ALL USING (get_user_role() IN ('super_admin', 'hr_admin'));

CREATE POLICY "eap_tenant_read" ON employee_attendance_policies
  FOR SELECT USING (tenant_id = get_user_tenant_id());

CREATE POLICY "eap_hr_write"    ON employee_attendance_policies
  FOR ALL USING (get_user_role() IN ('super_admin', 'hr_admin'));

-- ── Comments ──────────────────────────────────────────────────

COMMENT ON TABLE  attendance_policies IS
  'Named attendance computation policies defining grace period, late cap, '
  'and presence thresholds.  One row may be flagged is_default per tenant.';

COMMENT ON TABLE  employee_attendance_policies IS
  'Maps individual employees to a specific attendance policy, overriding '
  'the tenant default for those employees.';

COMMENT ON COLUMN attendance_policies.grace_minutes IS
  'Minutes after shift start before an arrival is considered late. [0-120]';
COMMENT ON COLUMN attendance_policies.late_cap_minutes IS
  'Maximum late_minutes value stored in attendance_daily. [1-480]';
COMMENT ON COLUMN attendance_policies.present_threshold_pct IS
  'Shift duration percentage required to be marked PRESENT. [1-100]';
COMMENT ON COLUMN attendance_policies.half_day_threshold_pct IS
  'Shift duration percentage required to be marked HALF_DAY. [1-99]';
COMMENT ON COLUMN attendance_policies.excessive_hours_threshold IS
  'Hours/day above which the anomaly engine flags "excessive_hours". 0 = disabled.';
