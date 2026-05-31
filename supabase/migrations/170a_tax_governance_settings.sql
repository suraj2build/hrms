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
