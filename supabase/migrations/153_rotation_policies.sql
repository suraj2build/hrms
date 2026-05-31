-- ============================================================
-- 153_rotation_policies.sql
--
-- Rotation Policy Governance — the canonical bridge between
-- Roster Policies and Shift Masters.
--
-- A Rotation Policy answers: "given that an employee is working
-- today, which shift should apply?"
--
-- Condition → Shift mapping (V1):
--   weekday_working   → e.g. General Shift (09:00–18:00)
--   saturday_working  → e.g. Saturday Shift (10:00–14:00)
--   sunday_working    → e.g. Sunday Shift   (10:00–13:00)
--   half_day          → e.g. Half Day Shift (09:00–13:00)
--   holiday_working   → e.g. Holiday Shift  (10:00–14:00)
--
-- Priority:
--   1. shift_roster  (date-level override)             — highest
--   2. rotation policy (employee override → site default)
--   3. employee_shifts (standing assignment)            — fallback
--
-- Assignment:
--   employees.rotation_policy_id  — employee-level override
--   sites.default_rotation_policy_id — site-level default
-- ============================================================

-- ── rotation_policies master ──────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS rotation_policies (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   UUID        NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name        TEXT        NOT NULL,
  description TEXT,
  is_active   BOOLEAN     NOT NULL DEFAULT true,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ,
  UNIQUE (tenant_id, name)
);

CREATE INDEX IF NOT EXISTS idx_rotation_policies_tenant
  ON rotation_policies (tenant_id);

CREATE INDEX IF NOT EXISTS idx_rotation_policies_tenant_active
  ON rotation_policies (tenant_id)
  WHERE is_active = true;

-- ── rotation_policy_rules — condition → shift mappings ────────────────────────

CREATE TABLE IF NOT EXISTS rotation_policy_rules (
  id                  UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  rotation_policy_id  UUID        NOT NULL REFERENCES rotation_policies(id) ON DELETE CASCADE,
  tenant_id           UUID        NOT NULL REFERENCES tenants(id)            ON DELETE CASCADE,
  condition_type      TEXT        NOT NULL
    CHECK (condition_type IN (
      'weekday_working',
      'saturday_working',
      'sunday_working',
      'half_day',
      'holiday_working'
    )),
  shift_id            UUID        NOT NULL REFERENCES shifts(id) ON DELETE RESTRICT,
  sort_order          INT         NOT NULL DEFAULT 0,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (rotation_policy_id, condition_type)   -- one shift per condition per policy
);

CREATE INDEX IF NOT EXISTS idx_rotation_policy_rules_policy
  ON rotation_policy_rules (rotation_policy_id);

-- ── Auto-update updated_at on rotation_policies ───────────────────────────────

CREATE OR REPLACE FUNCTION update_rotation_policies_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_rotation_policies_updated_at ON rotation_policies;
CREATE TRIGGER trg_rotation_policies_updated_at
  BEFORE UPDATE ON rotation_policies
  FOR EACH ROW EXECUTE FUNCTION update_rotation_policies_updated_at();

-- ── Row-Level Security ────────────────────────────────────────────────────────

ALTER TABLE rotation_policies      ENABLE ROW LEVEL SECURITY;
ALTER TABLE rotation_policy_rules  ENABLE ROW LEVEL SECURITY;

CREATE POLICY "rotation_policies_tenant_read" ON rotation_policies
  FOR SELECT USING (tenant_id = get_user_tenant_id());

CREATE POLICY "rotation_policies_hr_write" ON rotation_policies
  FOR ALL USING (get_user_role() IN ('super_admin', 'hr_admin'));

CREATE POLICY "rotation_policy_rules_tenant_read" ON rotation_policy_rules
  FOR SELECT USING (tenant_id = get_user_tenant_id());

CREATE POLICY "rotation_policy_rules_hr_write" ON rotation_policy_rules
  FOR ALL USING (get_user_role() IN ('super_admin', 'hr_admin'));

-- ── Add rotation_policy_id to employees (employee-level override) ─────────────

ALTER TABLE employees
  ADD COLUMN IF NOT EXISTS rotation_policy_id UUID
    REFERENCES rotation_policies(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_employees_rotation_policy
  ON employees (tenant_id, rotation_policy_id)
  WHERE rotation_policy_id IS NOT NULL;

-- ── Add default_rotation_policy_id to sites ───────────────────────────────────

ALTER TABLE sites
  ADD COLUMN IF NOT EXISTS default_rotation_policy_id UUID
    REFERENCES rotation_policies(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_sites_default_rotation_policy
  ON sites (tenant_id, default_rotation_policy_id)
  WHERE default_rotation_policy_id IS NOT NULL;
