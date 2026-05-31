-- ============================================================
-- Migration 172: Previous Employment Tax Details
-- Phase 2 Payroll Tax Governance
-- ============================================================

-- ------------------------------------------------------------
-- TABLE: previous_employment_tax_details
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS previous_employment_tax_details (
  id                    UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id             UUID          NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  employee_id           UUID          NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  financial_year        TEXT          NOT NULL,
  employer_name         TEXT          NOT NULL,
  employer_tan          TEXT,
  gross_income          DECIMAL(14,2) NOT NULL DEFAULT 0,
  tds_deducted          DECIMAL(14,2) NOT NULL DEFAULT 0,
  pf_deducted           DECIMAL(14,2) NOT NULL DEFAULT 0,
  ptax_deducted         DECIMAL(14,2) NOT NULL DEFAULT 0,
  from_date             DATE,
  to_date               DATE,
  source_document_id    UUID          REFERENCES documents(id) ON DELETE SET NULL,
  verification_status   TEXT          NOT NULL DEFAULT 'pending'
                          CHECK (verification_status IN ('pending','under_review','verified','rejected')),
  verified_by           UUID          REFERENCES profiles(id) ON DELETE SET NULL,
  verified_at           TIMESTAMPTZ,
  rejection_reason      TEXT,
  remarks               TEXT,
  created_at            TIMESTAMPTZ   NOT NULL DEFAULT now(),
  updated_at            TIMESTAMPTZ   NOT NULL DEFAULT now()
);

-- ------------------------------------------------------------
-- INDEXES
-- ------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_prev_emp_tax_employee_fy
  ON previous_employment_tax_details (tenant_id, employee_id, financial_year);

CREATE INDEX IF NOT EXISTS idx_prev_emp_tax_status
  ON previous_employment_tax_details (tenant_id, verification_status);

-- ------------------------------------------------------------
-- TRIGGER: updated_at
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION trg_set_updated_at_prev_emp_tax()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS set_updated_at_prev_emp_tax
  ON previous_employment_tax_details;

CREATE TRIGGER set_updated_at_prev_emp_tax
  BEFORE UPDATE ON previous_employment_tax_details
  FOR EACH ROW
  EXECUTE FUNCTION trg_set_updated_at_prev_emp_tax();

-- ------------------------------------------------------------
-- ROW LEVEL SECURITY
-- ------------------------------------------------------------
ALTER TABLE previous_employment_tax_details ENABLE ROW LEVEL SECURITY;

-- SELECT: tenant users can read their own records; hr_admin/super_admin can read all tenant records
DROP POLICY IF EXISTS prev_emp_tax_select ON previous_employment_tax_details;
CREATE POLICY prev_emp_tax_select
  ON previous_employment_tax_details
  FOR SELECT
  USING (
    tenant_id = get_user_tenant_id()
    AND (
      get_user_role() IN ('hr_admin','super_admin')
      OR employee_id = (SELECT employee_id FROM profiles WHERE id = auth.uid() LIMIT 1)
    )
  );

-- INSERT: employees can insert own; admins can insert for any
DROP POLICY IF EXISTS prev_emp_tax_insert ON previous_employment_tax_details;
CREATE POLICY prev_emp_tax_insert
  ON previous_employment_tax_details
  FOR INSERT
  WITH CHECK (
    tenant_id = get_user_tenant_id()
    AND (
      get_user_role() IN ('hr_admin','super_admin')
      OR employee_id = (SELECT employee_id FROM profiles WHERE id = auth.uid() LIMIT 1)
    )
  );

-- UPDATE: employees can update own pending/under_review; admins can update any
DROP POLICY IF EXISTS prev_emp_tax_update ON previous_employment_tax_details;
CREATE POLICY prev_emp_tax_update
  ON previous_employment_tax_details
  FOR UPDATE
  USING (
    tenant_id = get_user_tenant_id()
    AND (
      get_user_role() IN ('hr_admin','super_admin')
      OR (
        employee_id = (SELECT employee_id FROM profiles WHERE id = auth.uid() LIMIT 1)
        AND verification_status IN ('pending','under_review')
      )
    )
  );

-- DELETE: employees can delete own pending only; admins can delete any
DROP POLICY IF EXISTS prev_emp_tax_delete ON previous_employment_tax_details;
CREATE POLICY prev_emp_tax_delete
  ON previous_employment_tax_details
  FOR DELETE
  USING (
    tenant_id = get_user_tenant_id()
    AND (
      get_user_role() IN ('hr_admin','super_admin')
      OR (
        employee_id = (SELECT employee_id FROM profiles WHERE id = auth.uid() LIMIT 1)
        AND verification_status = 'pending'
      )
    )
  );
