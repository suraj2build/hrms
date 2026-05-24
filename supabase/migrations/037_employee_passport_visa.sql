-- ============================================================
-- 037_employee_passport_visa.sql
-- Passport and Visa records for employees.
-- ============================================================

CREATE TABLE IF NOT EXISTS employee_passport_visa (
  id             UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id      UUID        NOT NULL REFERENCES tenants(id)   ON DELETE CASCADE,
  employee_id    UUID        NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  record_type    TEXT        NOT NULL CHECK (record_type IN ('passport', 'visa')),
  doc_number     TEXT        NOT NULL,
  country        TEXT        NOT NULL,
  issue_date     DATE,
  expiry_date    DATE,
  place_of_issue TEXT,
  visa_type      TEXT,
  storage_path   TEXT,
  notes          TEXT,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_passport_visa_employee
  ON employee_passport_visa (tenant_id, employee_id, record_type);

ALTER TABLE employee_passport_visa ENABLE ROW LEVEL SECURITY;

CREATE POLICY "pv_tenant_read" ON employee_passport_visa
  FOR SELECT USING (tenant_id = get_user_tenant_id());

CREATE POLICY "pv_hr_write" ON employee_passport_visa
  FOR ALL USING (get_user_role() IN ('super_admin', 'hr_admin'));
