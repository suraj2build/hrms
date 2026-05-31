CREATE TABLE IF NOT EXISTS employees (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  employee_code     TEXT NOT NULL,
  -- Basic
  first_name        TEXT NOT NULL,
  last_name         TEXT NOT NULL,
  email             TEXT NOT NULL,
  phone             TEXT,
  gender            TEXT CHECK (gender IN ('male','female','other')),
  dob               DATE,
  blood_group       TEXT,
  nationality       TEXT NOT NULL DEFAULT 'Indian',
  -- Official
  joining_date      DATE NOT NULL,
  confirmation_date DATE,
  employment_type   TEXT NOT NULL DEFAULT 'permanent'
                    CHECK (employment_type IN ('permanent','contract','intern','probation')),
  status            TEXT NOT NULL DEFAULT 'active'
                    CHECK (status IN ('active','inactive','on_notice','separated')),
  department_id     UUID REFERENCES departments(id)  ON DELETE SET NULL,
  designation_id    UUID REFERENCES designations(id) ON DELETE SET NULL,
  grade_id          UUID REFERENCES grades(id)       ON DELETE SET NULL,
  manager_id        UUID REFERENCES employees(id)    ON DELETE SET NULL,
  work_location     TEXT,
  -- Personal (JSONB for flexibility)
  address           JSONB,
  emergency_contact JSONB,
  -- India statutory
  pan_number        TEXT,
  aadhaar_last4     TEXT,
  uan_number        TEXT,
  esi_number        TEXT,
  bank_details      JSONB,
  -- Meta
  profile_photo     TEXT,
  created_by        UUID REFERENCES profiles(id) ON DELETE SET NULL,
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),

  UNIQUE (tenant_id, employee_code),
  UNIQUE (tenant_id, email)
);

CREATE INDEX idx_employees_tenant     ON employees(tenant_id);
CREATE INDEX idx_employees_status     ON employees(tenant_id, status);
CREATE INDEX idx_employees_dept       ON employees(department_id);
CREATE INDEX idx_employees_manager    ON employees(manager_id);
CREATE INDEX idx_employees_joining    ON employees(joining_date);

-- Auto-update updated_at
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER employees_updated_at
  BEFORE UPDATE ON employees
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();
