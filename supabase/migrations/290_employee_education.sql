-- Migration 290: Employee education (1:N)
--
-- Structured education/qualification records for the Employee Master, each with
-- an optional certificate document (stored in the `employee-files` bucket; the
-- storage path is kept here, signed URLs are generated on read).

CREATE TABLE IF NOT EXISTS employee_education (
  id                 UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id          UUID          NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  employee_id        UUID          NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  qualification      TEXT          NOT NULL,           -- e.g. B.Tech, MBA, 12th
  institution        TEXT,                             -- school / college / university
  specialization     TEXT,                             -- stream / major / field of study
  year_of_completion INTEGER,
  grade              TEXT,                             -- percentage / CGPA / division
  document_path      TEXT,                             -- storage path of certificate
  document_name      TEXT,                             -- original file name (for display)
  created_at         TIMESTAMPTZ   NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_emp_education_employee
  ON employee_education (tenant_id, employee_id);

ALTER TABLE employee_education ENABLE ROW LEVEL SECURITY;

-- HR admins / super admins full access; employees may read their own tenant's rows
CREATE POLICY "edu_hr_all" ON employee_education FOR ALL    USING (get_user_role() IN ('super_admin','hr_admin'));
CREATE POLICY "edu_self"   ON employee_education FOR SELECT USING (tenant_id = get_user_tenant_id());
