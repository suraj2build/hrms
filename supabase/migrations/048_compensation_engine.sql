-- ============================================================
-- 048_compensation_engine.sql
-- Adds NLC / PF flags to salary_components, PF flags to
-- employee_bank_statutory, and a tenant-level
-- compensation_policies table.
-- ============================================================

-- ── salary_components: NLC / PF component flags ───────────────────────────────

-- is_basic: exactly ONE earning component per structure should be true.
--   Used by the CompensationEngine as the "anchor" for pct_of_basic
--   calculations and NLC Basic-wage threshold.
ALTER TABLE salary_components
  ADD COLUMN IF NOT EXISTS is_basic    BOOLEAN NOT NULL DEFAULT false;

-- affects_pf: component is included in the PF wage base.
--   Typical: only Basic. Some employers include DA too.
ALTER TABLE salary_components
  ADD COLUMN IF NOT EXISTS affects_pf  BOOLEAN NOT NULL DEFAULT false;

-- affects_nlc: component counts toward the NLC "wage" definition
--   (Basic + DA >= 50 % of gross). Basic always counts via is_basic.
--   Mark DA (if separate) with affects_nlc = true.
ALTER TABLE salary_components
  ADD COLUMN IF NOT EXISTS affects_nlc BOOLEAN NOT NULL DEFAULT false;

-- ── employee_bank_statutory: PF opt-in per employee ──────────────────────────

ALTER TABLE employee_bank_statutory
  ADD COLUMN IF NOT EXISTS pf_enabled BOOLEAN NOT NULL DEFAULT false;

-- pf_capped = true  → PF base capped at policy.pf_cap_amount (₹15,000/month).
-- pf_capped = false → PF base = actual basic (no cap).
ALTER TABLE employee_bank_statutory
  ADD COLUMN IF NOT EXISTS pf_capped  BOOLEAN NOT NULL DEFAULT true;

-- ── compensation_policies (one row per tenant) ────────────────────────────────

CREATE TABLE IF NOT EXISTS compensation_policies (
  id                UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         UUID          NOT NULL UNIQUE REFERENCES tenants(id) ON DELETE CASCADE,

  -- NLC (New Labour Code): Basic + DA >= 50 % of Gross
  nlc_enabled       BOOLEAN       NOT NULL DEFAULT true,

  -- PF (Provident Fund) policy defaults
  pf_enabled        BOOLEAN       NOT NULL DEFAULT true,
  pf_employee_rate  DECIMAL(5,2)  NOT NULL DEFAULT 12.0
    CONSTRAINT pf_emp_rate_range  CHECK (pf_employee_rate  BETWEEN 0 AND 30),
  pf_employer_rate  DECIMAL(5,2)  NOT NULL DEFAULT 12.0
    CONSTRAINT pf_er_rate_range   CHECK (pf_employer_rate  BETWEEN 0 AND 30),
  -- Monthly wage ceiling for PF (₹15,000 = statutory default under EPF Act)
  pf_cap_amount     DECIMAL(10,2) NOT NULL DEFAULT 15000.00
    CONSTRAINT pf_cap_positive    CHECK (pf_cap_amount > 0),

  created_at        TIMESTAMPTZ   NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ   NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_comp_policy_tenant
  ON compensation_policies (tenant_id);

-- ── RLS ───────────────────────────────────────────────────────────────────────

ALTER TABLE compensation_policies ENABLE ROW LEVEL SECURITY;

CREATE POLICY "cp_tenant_read" ON compensation_policies
  FOR SELECT USING (tenant_id = get_user_tenant_id());

CREATE POLICY "cp_hr_write" ON compensation_policies
  FOR ALL USING (get_user_role() IN ('super_admin', 'hr_admin'));
