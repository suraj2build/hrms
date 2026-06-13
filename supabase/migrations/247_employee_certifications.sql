-- Migration 247: Employee Certifications, Licenses & Professional Credentials
-- Program 2 — Certification Governance

CREATE TABLE IF NOT EXISTS employee_certifications (
  id             uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id      uuid        NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  employee_id    uuid        NOT NULL REFERENCES employees(id) ON DELETE CASCADE,

  cert_name      text        NOT NULL,
  cert_type      text        NOT NULL DEFAULT 'certification'
                             CHECK (cert_type IN ('certification','license','credential','membership')),
  issuing_body   text,
  cert_number    text,

  issue_date     date,
  expiry_date    date,

  status         text        NOT NULL DEFAULT 'active'
                             CHECK (status IN ('active','expired','revoked','pending')),

  document_url   text,
  notes          text,

  created_by     uuid        REFERENCES auth.users(id),
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),

  -- prevent exact duplicates for the same employee + cert number
  UNIQUE NULLS NOT DISTINCT (tenant_id, employee_id, cert_name, cert_number)
);

CREATE INDEX IF NOT EXISTS idx_emp_certs_tenant_emp
  ON employee_certifications (tenant_id, employee_id);

CREATE INDEX IF NOT EXISTS idx_emp_certs_expiry
  ON employee_certifications (tenant_id, expiry_date)
  WHERE status = 'active' AND expiry_date IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_emp_certs_status
  ON employee_certifications (tenant_id, status);

-- Auto-update updated_at
CREATE OR REPLACE FUNCTION trg_touch_emp_certs()
  RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$$;

CREATE TRIGGER trg_emp_certs_updated
  BEFORE UPDATE ON employee_certifications
  FOR EACH ROW EXECUTE FUNCTION trg_touch_emp_certs();

-- RLS
ALTER TABLE employee_certifications ENABLE ROW LEVEL SECURITY;

CREATE POLICY ec_hr_all ON employee_certifications
  FOR ALL TO authenticated
  USING (
    tenant_id = get_user_tenant_id()
    AND (
      get_user_role() IN ('super_admin','hr_admin')
      OR employee_id = get_user_employee_id()
    )
  );
