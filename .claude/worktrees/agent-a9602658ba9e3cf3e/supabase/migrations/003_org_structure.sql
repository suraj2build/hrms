-- Departments (self-referential hierarchy)
CREATE TABLE IF NOT EXISTS departments (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name        TEXT NOT NULL,
  code        TEXT,
  parent_id   UUID REFERENCES departments(id) ON DELETE SET NULL,
  head_id     UUID,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_departments_tenant    ON departments(tenant_id);
CREATE INDEX idx_departments_parent    ON departments(parent_id);

-- Designations (job titles)
CREATE TABLE IF NOT EXISTS designations (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name          TEXT NOT NULL,
  level         INT,
  department_id UUID REFERENCES departments(id) ON DELETE SET NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_designations_tenant ON designations(tenant_id);

-- Grades / pay bands
CREATE TABLE IF NOT EXISTS grades (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name        TEXT NOT NULL,
  code        TEXT,
  min_salary  NUMERIC(12,2),
  max_salary  NUMERIC(12,2),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_grades_tenant ON grades(tenant_id);
