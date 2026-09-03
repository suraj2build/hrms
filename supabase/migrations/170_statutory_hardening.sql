-- =============================================================================
-- 170_statutory_hardening.sql
-- Targeted Statutory Compliance Hardening — EPF + ESI
--
-- Changes:
--   1. epf_eligibility_overrides: add restrict_pf_to_ceiling
--      Allows individual employees to be ceiling-capped even when the
--      tenant-level is_wage_ceiling_applicable = false.
--      NULL = follow tenant policy  |  true = always cap  |  false = never cap
--
--   2. esi_eligibility_timeline: add continuation_until
--      ESI contribution period continuation.  When set, ESI contributions are
--      forced through the end of the contribution period even if gross wages
--      exceed the ₹21,000 ceiling mid-period.
--      Example: employee enrolled Apr–Sep.  Jul salary = ₹24,000.
--      Set continuation_until = '2024-09-30' → ESI applies through Sep.
--
--   3. payroll_employee_snapshots: add total_working_days
--      Captures the total working days used in the original payroll calculation
--      so the replay engine can reproduce bit-identical results for mid-month
--      joiners and leavers without falling back to the incorrect formula
--      (payable_days + lop_days) or the hardcoded default of 26.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. EPF employee-level ceiling restriction
-- ---------------------------------------------------------------------------

ALTER TABLE epf_eligibility_overrides
    ADD COLUMN IF NOT EXISTS restrict_pf_to_ceiling BOOLEAN DEFAULT NULL;

COMMENT ON COLUMN epf_eligibility_overrides.restrict_pf_to_ceiling IS
  'Employee-level PF ceiling override.
   NULL  = follow tenant policy (is_wage_ceiling_applicable in epf_config).
   true  = always restrict PF wages to statutory ceiling (₹15,000 default)
           even when tenant policy is unrestricted.
   false = never restrict PF wages to ceiling even when tenant policy restricts.
           Typically used for international workers or CXO-level agreements.';

-- ---------------------------------------------------------------------------
-- 2. ESI contribution period continuation
-- ---------------------------------------------------------------------------

ALTER TABLE esi_eligibility_timeline
    ADD COLUMN IF NOT EXISTS continuation_until DATE DEFAULT NULL;

COMMENT ON COLUMN esi_eligibility_timeline.continuation_until IS
  'ESI contribution period continuation end date.
   When set to the last day of the current contribution period (Sep 30 or Mar 31),
   ESI contributions are enforced through that date even if the employee''s gross
   wages subsequently exceed the ₹21,000 wage ceiling.
   Statutory basis: ESIC contribution period rules — once enrolled in a period,
   the employee contributes till period end regardless of wage changes.
   Cleared or set to NULL when the continuation period expires.';

-- ---------------------------------------------------------------------------
-- 3. Payroll snapshot — total_working_days for replay safety
-- ---------------------------------------------------------------------------

ALTER TABLE payroll_employee_snapshots
    ADD COLUMN IF NOT EXISTS total_working_days INTEGER;

COMMENT ON COLUMN payroll_employee_snapshots.total_working_days IS
  'Calendar working days in the payroll month as used in the original run.
   Captured from payroll_slips.total_working_days at snapshot time.
   Used by the replay engine to reproduce bit-identical results.
   Without this, replay falls back to payable_days + lop_days which is wrong
   for mid-month joiners (their payable_days < total_working_days for the month).';

-- ============================================================
-- Merged from 170a_tax_governance_settings.sql (2026-09) — see
-- the note on the 113_punch_logs_csv_source.sql merge for why.
-- ============================================================
-- ============================================================
-- Migration 170: TDS Governance Settings
-- Per-tenant, per-FY configuration for declaration windows,
-- regime governance, proof settings, and component overrides.
-- ============================================================

CREATE TABLE IF NOT EXISTS tds_governance_settings (
  id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id               UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  financial_year          TEXT NOT NULL,

  -- Declaration window dates
  window_open_date        DATE,
  window_close_date       DATE,
  window_grace_date       DATE,   -- soft close; submissions still accepted with warning
  window_lock_date        DATE,   -- hard lock; no further submissions

  -- Regime governance
  default_regime          TEXT NOT NULL DEFAULT 'new'
    CHECK (default_regime IN ('old', 'new')),
  allow_regime_switching  BOOLEAN NOT NULL DEFAULT true,
  regime_lock_date        DATE,   -- after this date, employees cannot switch regime

  -- Proof settings
  proof_mandatory         BOOLEAN NOT NULL DEFAULT false,
  max_proof_size_mb       INT NOT NULL DEFAULT 5,
  allowed_proof_formats   TEXT[] NOT NULL DEFAULT ARRAY['pdf', 'jpg', 'jpeg', 'png'],

  -- Per-component governance overrides stored as a JSON array.
  -- Each element: {
  --   "component_id": "<uuid>",
  --   "is_active": true/false,
  --   "max_limit_override": <number|null>,
  --   "proof_required_override": true/false
  -- }
  component_overrides     JSONB NOT NULL DEFAULT '[]',

  created_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at              TIMESTAMPTZ NOT NULL DEFAULT now(),

  UNIQUE (tenant_id, financial_year)
);

-- ── Indexes ─────────────────────────────────────────────────

CREATE INDEX IF NOT EXISTS idx_tds_gov_settings_tenant
  ON tds_governance_settings (tenant_id);

CREATE INDEX IF NOT EXISTS idx_tds_gov_settings_tenant_fy
  ON tds_governance_settings (tenant_id, financial_year);

-- ── updated_at trigger ──────────────────────────────────────

CREATE OR REPLACE FUNCTION trg_set_updated_at_tds_governance_settings()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS set_updated_at_tds_governance_settings ON tds_governance_settings;
CREATE TRIGGER set_updated_at_tds_governance_settings
  BEFORE UPDATE ON tds_governance_settings
  FOR EACH ROW EXECUTE FUNCTION trg_set_updated_at_tds_governance_settings();

-- ── Row Level Security ──────────────────────────────────────

ALTER TABLE tds_governance_settings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "tds_gov_settings_select" ON tds_governance_settings;
DROP POLICY IF EXISTS "tds_gov_settings_insert" ON tds_governance_settings;
DROP POLICY IF EXISTS "tds_gov_settings_update" ON tds_governance_settings;
DROP POLICY IF EXISTS "tds_gov_settings_delete" ON tds_governance_settings;

-- All tenant users can read their tenant's governance settings
CREATE POLICY "tds_gov_settings_select"
  ON tds_governance_settings FOR SELECT
  USING (tenant_id = get_user_tenant_id());

-- Only hr_admin / super_admin can create settings
CREATE POLICY "tds_gov_settings_insert"
  ON tds_governance_settings FOR INSERT
  WITH CHECK (
    tenant_id = get_user_tenant_id()
    AND get_user_role() IN ('hr_admin', 'super_admin')
  );

-- Only hr_admin / super_admin can update settings
CREATE POLICY "tds_gov_settings_update"
  ON tds_governance_settings FOR UPDATE
  USING (
    tenant_id = get_user_tenant_id()
    AND get_user_role() IN ('hr_admin', 'super_admin')
  )
  WITH CHECK (
    tenant_id = get_user_tenant_id()
    AND get_user_role() IN ('hr_admin', 'super_admin')
  );

-- Only super_admin can delete governance settings
CREATE POLICY "tds_gov_settings_delete"
  ON tds_governance_settings FOR DELETE
  USING (
    tenant_id = get_user_tenant_id()
    AND get_user_role() = 'super_admin'
  );
