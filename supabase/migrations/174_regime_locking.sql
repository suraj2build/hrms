-- ============================================================
-- Migration 174: Regime Locking & TDS Monthly Recovery
-- Phase 2 Payroll Tax Governance
-- ============================================================

-- ------------------------------------------------------------
-- ALTER TABLE: tds_governance_settings
-- Add regime locking columns
-- ------------------------------------------------------------
ALTER TABLE tds_governance_settings
  ADD COLUMN IF NOT EXISTS regime_locked_at         TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS locked_by_payroll_run_id UUID,
  ADD COLUMN IF NOT EXISTS lock_reason              TEXT;

-- ------------------------------------------------------------
-- ALTER TABLE: tds_regime_elections
-- Add locking columns (safe guards with IF EXISTS / IF NOT EXISTS)
-- ------------------------------------------------------------
ALTER TABLE IF EXISTS tds_regime_elections
  ADD COLUMN IF NOT EXISTS locked_at   TIMESTAMPTZ;

ALTER TABLE IF EXISTS tds_regime_elections
  ADD COLUMN IF NOT EXISTS locked_by   TEXT;

ALTER TABLE IF EXISTS tds_regime_elections
  ADD COLUMN IF NOT EXISTS lock_reason TEXT;

-- ------------------------------------------------------------
-- TABLE: tds_monthly_recovery
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS tds_monthly_recovery (
  id                      UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id               UUID          NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  employee_id             UUID          NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  financial_year          TEXT          NOT NULL,
  payroll_period          TEXT          NOT NULL,
  projected_annual_tax    DECIMAL(14,2) NOT NULL DEFAULT 0,
  tax_already_deducted    DECIMAL(14,2) NOT NULL DEFAULT 0,
  external_tds            DECIMAL(14,2) NOT NULL DEFAULT 0,
  remaining_tax           DECIMAL(14,2) NOT NULL DEFAULT 0,
  payroll_cycles_remaining INT          NOT NULL DEFAULT 1,
  monthly_recovery        DECIMAL(14,2) NOT NULL DEFAULT 0,
  recovery_strategy       TEXT          NOT NULL DEFAULT 'straight_line'
                            CHECK (recovery_strategy IN ('straight_line','accelerated','deferred')),
  tax_projection_basis    TEXT          NOT NULL DEFAULT 'declaration'
                            CHECK (tax_projection_basis IN ('declaration','actual','estimated')),
  regime                  TEXT          NOT NULL DEFAULT 'new'
                            CHECK (regime IN ('old','new')),
  computation_snapshot    JSONB         NOT NULL DEFAULT '{}',
  payroll_run_id          UUID,
  created_at              TIMESTAMPTZ   NOT NULL DEFAULT now(),
  updated_at              TIMESTAMPTZ   NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, employee_id, financial_year, payroll_period)
);

-- ------------------------------------------------------------
-- INDEXES on tds_monthly_recovery
-- ------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_tds_monthly_recovery_emp_fy
  ON tds_monthly_recovery (tenant_id, employee_id, financial_year);

CREATE INDEX IF NOT EXISTS idx_tds_monthly_recovery_period
  ON tds_monthly_recovery (tenant_id, payroll_period);

-- ------------------------------------------------------------
-- TRIGGER: updated_at for tds_monthly_recovery
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION trg_set_updated_at_tds_monthly_recovery()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS set_updated_at_tds_monthly_recovery
  ON tds_monthly_recovery;

CREATE TRIGGER set_updated_at_tds_monthly_recovery
  BEFORE UPDATE ON tds_monthly_recovery
  FOR EACH ROW
  EXECUTE FUNCTION trg_set_updated_at_tds_monthly_recovery();

-- ------------------------------------------------------------
-- RLS: tds_monthly_recovery
-- ------------------------------------------------------------
ALTER TABLE tds_monthly_recovery ENABLE ROW LEVEL SECURITY;

-- SELECT: own records OR hr_admin/super_admin
DROP POLICY IF EXISTS tds_monthly_recovery_select ON tds_monthly_recovery;
CREATE POLICY tds_monthly_recovery_select
  ON tds_monthly_recovery
  FOR SELECT
  USING (
    tenant_id = get_user_tenant_id()
    AND (
      get_user_role() IN ('hr_admin','super_admin')
      OR employee_id = (SELECT employee_id FROM profiles WHERE id = auth.uid() LIMIT 1)
    )
  );

-- INSERT: hr_admin/super_admin only
DROP POLICY IF EXISTS tds_monthly_recovery_insert ON tds_monthly_recovery;
CREATE POLICY tds_monthly_recovery_insert
  ON tds_monthly_recovery
  FOR INSERT
  WITH CHECK (
    tenant_id = get_user_tenant_id()
    AND get_user_role() IN ('hr_admin','super_admin')
  );

-- UPDATE: hr_admin/super_admin only
DROP POLICY IF EXISTS tds_monthly_recovery_update ON tds_monthly_recovery;
CREATE POLICY tds_monthly_recovery_update
  ON tds_monthly_recovery
  FOR UPDATE
  USING (
    tenant_id = get_user_tenant_id()
    AND get_user_role() IN ('hr_admin','super_admin')
  );

-- DELETE: hr_admin/super_admin only
DROP POLICY IF EXISTS tds_monthly_recovery_delete ON tds_monthly_recovery;
CREATE POLICY tds_monthly_recovery_delete
  ON tds_monthly_recovery
  FOR DELETE
  USING (
    tenant_id = get_user_tenant_id()
    AND get_user_role() IN ('hr_admin','super_admin')
  );
