-- ============================================================
-- Migration 173: HRA Governance Settings & Declarations
-- Phase 2 Payroll Tax Governance
-- ============================================================

-- ------------------------------------------------------------
-- TABLE: hra_governance_settings
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS hra_governance_settings (
  id                        UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id                 UUID          NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  financial_year            TEXT          NOT NULL,
  pan_required_threshold    DECIMAL(14,2) NOT NULL DEFAULT 100000,
  max_houses_allowed        INT           NOT NULL DEFAULT 1,
  allow_multiple_landlords  BOOLEAN       NOT NULL DEFAULT false,
  require_landlord_address  BOOLEAN       NOT NULL DEFAULT true,
  require_landlord_pan      BOOLEAN       NOT NULL DEFAULT false,
  max_rent_increase_pct     DECIMAL(5,2)  DEFAULT 20,
  created_at                TIMESTAMPTZ   NOT NULL DEFAULT now(),
  updated_at                TIMESTAMPTZ   NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, financial_year)
);

-- ------------------------------------------------------------
-- TRIGGER: updated_at for hra_governance_settings
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION trg_set_updated_at_hra_governance_settings()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS set_updated_at_hra_governance_settings
  ON hra_governance_settings;

CREATE TRIGGER set_updated_at_hra_governance_settings
  BEFORE UPDATE ON hra_governance_settings
  FOR EACH ROW
  EXECUTE FUNCTION trg_set_updated_at_hra_governance_settings();

-- ------------------------------------------------------------
-- RLS: hra_governance_settings
-- ------------------------------------------------------------
ALTER TABLE hra_governance_settings ENABLE ROW LEVEL SECURITY;

-- SELECT: all tenant users
DROP POLICY IF EXISTS hra_gov_settings_select ON hra_governance_settings;
CREATE POLICY hra_gov_settings_select
  ON hra_governance_settings
  FOR SELECT
  USING (tenant_id = get_user_tenant_id());

-- INSERT: hr_admin/super_admin only
DROP POLICY IF EXISTS hra_gov_settings_insert ON hra_governance_settings;
CREATE POLICY hra_gov_settings_insert
  ON hra_governance_settings
  FOR INSERT
  WITH CHECK (
    tenant_id = get_user_tenant_id()
    AND get_user_role() IN ('hr_admin','super_admin')
  );

-- UPDATE: hr_admin/super_admin only
DROP POLICY IF EXISTS hra_gov_settings_update ON hra_governance_settings;
CREATE POLICY hra_gov_settings_update
  ON hra_governance_settings
  FOR UPDATE
  USING (
    tenant_id = get_user_tenant_id()
    AND get_user_role() IN ('hr_admin','super_admin')
  );

-- DELETE: hr_admin/super_admin only
DROP POLICY IF EXISTS hra_gov_settings_delete ON hra_governance_settings;
CREATE POLICY hra_gov_settings_delete
  ON hra_governance_settings
  FOR DELETE
  USING (
    tenant_id = get_user_tenant_id()
    AND get_user_role() IN ('hr_admin','super_admin')
  );

-- ------------------------------------------------------------
-- TABLE: hra_declarations
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS hra_declarations (
  id                  UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id           UUID          NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  employee_id         UUID          NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  financial_year      TEXT          NOT NULL,
  plan_id             UUID          REFERENCES tax_declaration_plans(id) ON DELETE SET NULL,
  from_month          TEXT          NOT NULL,
  to_month            TEXT          NOT NULL,
  monthly_rent        DECIMAL(14,2) NOT NULL DEFAULT 0,
  landlord_name       TEXT,
  landlord_pan        TEXT,
  landlord_address    TEXT,
  city                TEXT,
  is_metro            BOOLEAN       NOT NULL DEFAULT false,
  proof_document_id   UUID          REFERENCES documents(id) ON DELETE SET NULL,
  pan_verified        BOOLEAN       NOT NULL DEFAULT false,
  status              TEXT          NOT NULL DEFAULT 'draft'
                        CHECK (status IN ('draft','submitted','verified','rejected','superseded')),
  verification_notes  TEXT,
  created_at          TIMESTAMPTZ   NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ   NOT NULL DEFAULT now()
);

-- ------------------------------------------------------------
-- INDEXES on hra_declarations
-- ------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_hra_decl_employee_fy
  ON hra_declarations (tenant_id, employee_id, financial_year);

CREATE INDEX IF NOT EXISTS idx_hra_decl_status
  ON hra_declarations (tenant_id, status);

-- ------------------------------------------------------------
-- TRIGGER: updated_at for hra_declarations
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION trg_set_updated_at_hra_declarations()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS set_updated_at_hra_declarations
  ON hra_declarations;

CREATE TRIGGER set_updated_at_hra_declarations
  BEFORE UPDATE ON hra_declarations
  FOR EACH ROW
  EXECUTE FUNCTION trg_set_updated_at_hra_declarations();

-- ------------------------------------------------------------
-- RLS: hra_declarations
-- ------------------------------------------------------------
ALTER TABLE hra_declarations ENABLE ROW LEVEL SECURITY;

-- SELECT: own records OR hr_admin/super_admin
DROP POLICY IF EXISTS hra_decl_select ON hra_declarations;
CREATE POLICY hra_decl_select
  ON hra_declarations
  FOR SELECT
  USING (
    tenant_id = get_user_tenant_id()
    AND (
      get_user_role() IN ('hr_admin','super_admin')
      OR employee_id = (SELECT employee_id FROM profiles WHERE id = auth.uid() LIMIT 1)
    )
  );

-- INSERT: own OR hr_admin/super_admin
DROP POLICY IF EXISTS hra_decl_insert ON hra_declarations;
CREATE POLICY hra_decl_insert
  ON hra_declarations
  FOR INSERT
  WITH CHECK (
    tenant_id = get_user_tenant_id()
    AND (
      get_user_role() IN ('hr_admin','super_admin')
      OR employee_id = (SELECT employee_id FROM profiles WHERE id = auth.uid() LIMIT 1)
    )
  );

-- UPDATE: own draft/submitted; admins any
DROP POLICY IF EXISTS hra_decl_update ON hra_declarations;
CREATE POLICY hra_decl_update
  ON hra_declarations
  FOR UPDATE
  USING (
    tenant_id = get_user_tenant_id()
    AND (
      get_user_role() IN ('hr_admin','super_admin')
      OR (
        employee_id = (SELECT employee_id FROM profiles WHERE id = auth.uid() LIMIT 1)
        AND status IN ('draft','submitted')
      )
    )
  );

-- DELETE: own draft only; admins any
DROP POLICY IF EXISTS hra_decl_delete ON hra_declarations;
CREATE POLICY hra_decl_delete
  ON hra_declarations
  FOR DELETE
  USING (
    tenant_id = get_user_tenant_id()
    AND (
      get_user_role() IN ('hr_admin','super_admin')
      OR (
        employee_id = (SELECT employee_id FROM profiles WHERE id = auth.uid() LIMIT 1)
        AND status = 'draft'
      )
    )
  );
