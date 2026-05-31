-- ============================================================
-- 054_leave_policy_engine.sql
--
-- Policy-driven leave engine — three new tables that sit ON TOP
-- of the existing leave_types + leave_policies infrastructure.
-- The existing tables are NOT altered, guaranteeing full backward
-- compatibility for the entitlement scheduler.
--
-- New tables
-- ──────────
-- leave_policy_masters   — named policy bundles ("Senior Policy", "Intern Policy")
-- leave_policy_rules     — one rule per leave_type inside a named policy
--                          (same fields as leave_policies but scoped to a master)
-- leave_policy_assignments — bind a policy to employee / department /
--                            work_location / default scope
--
-- Resolution priority (highest → lowest)
--   1. employee        — direct assignment on the employee record
--   2. department      — employee's current department
--   3. work_location   — employee's current work location / site
--   4. default         — the one policy marked is_default = true
--   5. legacy          — fall back to leave_policies (old one-per-type table)
--
-- Accrual types extended to include 'quarterly' (in addition to the
-- 'monthly' | 'yearly' | 'upfront' already in leave_policies).
-- ============================================================

-- ── 1. leave_policy_masters ────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS leave_policy_masters (
  id          UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   UUID          NOT NULL REFERENCES tenants(id)   ON DELETE CASCADE,

  name        TEXT          NOT NULL,
  description TEXT,
  is_default  BOOLEAN       NOT NULL DEFAULT false,

  -- Year boundary inherited by all rules in this policy.
  -- Individual rules can override if needed (future: add per-rule year_type).
  year_type   TEXT          NOT NULL DEFAULT 'calendar'
    CHECK (year_type IN ('calendar', 'financial')),

  is_active   BOOLEAN       NOT NULL DEFAULT true,

  created_at  TIMESTAMPTZ   NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ   NOT NULL DEFAULT now(),

  -- A tenant can have at most one policy with a given name
  UNIQUE (tenant_id, name)
);

-- Enforce at most ONE default policy per tenant via partial unique index
CREATE UNIQUE INDEX IF NOT EXISTS idx_leave_policy_masters_one_default
  ON leave_policy_masters (tenant_id)
  WHERE is_default = true;

CREATE INDEX IF NOT EXISTS idx_leave_policy_masters_tenant
  ON leave_policy_masters (tenant_id, is_active);

-- ── 2. leave_policy_rules ──────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS leave_policy_rules (
  id          UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   UUID          NOT NULL REFERENCES tenants(id)      ON DELETE CASCADE,
  policy_id   UUID          NOT NULL REFERENCES leave_policy_masters(id) ON DELETE CASCADE,
  leave_type_id UUID        NOT NULL REFERENCES leave_types(id)  ON DELETE CASCADE,

  -- ── Accrual ──────────────────────────────────────────────────────────────
  -- monthly    : credit 1/12 on the 1st of each month
  -- quarterly  : credit 1/4 on the 1st of each quarter (Jan/Apr/Jul/Oct)
  -- yearly     : credit full entitlement at year-start (prorated if prorate_on_joining)
  -- upfront    : same as yearly but ignores prorate_on_joining
  accrual_type            TEXT          NOT NULL DEFAULT 'yearly'
    CHECK (accrual_type IN ('monthly', 'quarterly', 'yearly', 'upfront')),

  accrual_days_per_year   DECIMAL(5,2)  NOT NULL DEFAULT 0
    CHECK (accrual_days_per_year >= 0 AND accrual_days_per_year <= 365),

  -- Maximum balance the employee can hold at any point; NULL = uncapped
  max_accrual_balance     DECIMAL(5,1)
    CHECK (max_accrual_balance IS NULL OR max_accrual_balance >= 0),

  -- ── Eligibility ──────────────────────────────────────────────────────────
  -- Days from joining_date before the employee can accrue / use this type.
  -- 0 = eligible immediately.
  eligibility_days        INT           NOT NULL DEFAULT 0
    CHECK (eligibility_days >= 0 AND eligibility_days <= 3650),

  prorate_on_joining      BOOLEAN       NOT NULL DEFAULT true,

  -- ── Carry-forward ────────────────────────────────────────────────────────
  carry_forward_enabled   BOOLEAN       NOT NULL DEFAULT false,

  -- Maximum days that may be carried to the next leave year; NULL = unlimited
  carry_forward_max_days  DECIMAL(5,1)
    CHECK (carry_forward_max_days IS NULL OR carry_forward_max_days >= 0),

  -- ── Expiry ───────────────────────────────────────────────────────────────
  -- Days after the credit date when the granted days expire.
  -- NULL = no expiry (typical for EL/CL; use 365 for CO).
  expiry_days             INT
    CHECK (expiry_days IS NULL OR expiry_days > 0),

  -- ── Usage constraints ────────────────────────────────────────────────────
  -- Maximum consecutive days allowed in one leave application.
  -- NULL = no limit.
  max_consecutive_days    INT
    CHECK (max_consecutive_days IS NULL OR max_consecutive_days > 0),

  -- Minimum gap (in days) required between two leaves of the same type.
  min_gap_days            INT           NOT NULL DEFAULT 0
    CHECK (min_gap_days >= 0 AND min_gap_days <= 365),

  -- ── Metadata ─────────────────────────────────────────────────────────────
  created_at  TIMESTAMPTZ   NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ   NOT NULL DEFAULT now(),

  -- One rule per leave_type inside a policy
  UNIQUE (tenant_id, policy_id, leave_type_id)
);

CREATE INDEX IF NOT EXISTS idx_leave_policy_rules_policy
  ON leave_policy_rules (tenant_id, policy_id);

CREATE INDEX IF NOT EXISTS idx_leave_policy_rules_leave_type
  ON leave_policy_rules (tenant_id, leave_type_id);

-- ── 3. leave_policy_assignments ───────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS leave_policy_assignments (
  id          UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   UUID          NOT NULL REFERENCES tenants(id)   ON DELETE CASCADE,
  policy_id   UUID          NOT NULL REFERENCES leave_policy_masters(id) ON DELETE CASCADE,

  -- What kind of entity this assignment covers:
  --   'employee'      → scope_id = employees.id
  --   'department'    → scope_id = departments.id
  --   'work_location' → scope_id = work_locations.id
  --   'default'       → scope_id IS NULL (catches all that have no narrower match)
  scope_type  TEXT          NOT NULL
    CHECK (scope_type IN ('employee', 'department', 'work_location', 'default')),

  -- NULL only when scope_type = 'default'
  scope_id    UUID,

  CONSTRAINT chk_scope_id_null
    CHECK (
      (scope_type = 'default' AND scope_id IS NULL)
      OR
      (scope_type <> 'default' AND scope_id IS NOT NULL)
    ),

  created_at  TIMESTAMPTZ   NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ   NOT NULL DEFAULT now(),

  -- Only one assignment per scope entity (prevents conflicts)
  UNIQUE (tenant_id, scope_type, scope_id)
);

-- Only one 'default' assignment per tenant
CREATE UNIQUE INDEX IF NOT EXISTS idx_leave_policy_assignments_one_default
  ON leave_policy_assignments (tenant_id)
  WHERE scope_type = 'default';

CREATE INDEX IF NOT EXISTS idx_leave_policy_assignments_policy
  ON leave_policy_assignments (tenant_id, policy_id);

-- ── 4. updated_at triggers ────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION update_leave_policy_engine_timestamp()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_leave_policy_masters_updated_at
  BEFORE UPDATE ON leave_policy_masters
  FOR EACH ROW EXECUTE FUNCTION update_leave_policy_engine_timestamp();

CREATE TRIGGER trg_leave_policy_rules_updated_at
  BEFORE UPDATE ON leave_policy_rules
  FOR EACH ROW EXECUTE FUNCTION update_leave_policy_engine_timestamp();

CREATE TRIGGER trg_leave_policy_assignments_updated_at
  BEFORE UPDATE ON leave_policy_assignments
  FOR EACH ROW EXECUTE FUNCTION update_leave_policy_engine_timestamp();

-- ── 5. Row-level security ──────────────────────────────────────────────────────

ALTER TABLE leave_policy_masters     ENABLE ROW LEVEL SECURITY;
ALTER TABLE leave_policy_rules       ENABLE ROW LEVEL SECURITY;
ALTER TABLE leave_policy_assignments ENABLE ROW LEVEL SECURITY;

-- leave_policy_masters
CREATE POLICY "lpm_tenant_read" ON leave_policy_masters FOR SELECT
  USING (tenant_id = get_user_tenant_id());
CREATE POLICY "lpm_hr_write"    ON leave_policy_masters FOR ALL
  USING (get_user_role() IN ('super_admin', 'hr_admin'));

-- leave_policy_rules
CREATE POLICY "lpr_tenant_read" ON leave_policy_rules FOR SELECT
  USING (tenant_id = get_user_tenant_id());
CREATE POLICY "lpr_hr_write"    ON leave_policy_rules FOR ALL
  USING (get_user_role() IN ('super_admin', 'hr_admin'));

-- leave_policy_assignments
CREATE POLICY "lpa_tenant_read" ON leave_policy_assignments FOR SELECT
  USING (tenant_id = get_user_tenant_id());
CREATE POLICY "lpa_hr_write"    ON leave_policy_assignments FOR ALL
  USING (get_user_role() IN ('super_admin', 'hr_admin'));

-- ── 6. Extend leave_policies with expiry_days (backward compat) ──────────────
-- The entitlement service already references expiry_days on LeavePolicy
-- interface; add the column to the legacy table so the type aligns.
ALTER TABLE leave_policies
  ADD COLUMN IF NOT EXISTS expiry_days INT
    CHECK (expiry_days IS NULL OR expiry_days > 0);
