-- ============================================================
-- 010_masters_extended.sql
-- Extended master tables: work_locations, cost_centers, shifts,
-- identity_types, relationship_types, document_types
-- ============================================================

-- WORK LOCATIONS
CREATE TABLE IF NOT EXISTS work_locations (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   UUID        NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name        TEXT        NOT NULL,
  code        TEXT,
  address     TEXT,
  city        TEXT,
  state       TEXT,
  country     TEXT        NOT NULL DEFAULT 'India',
  pincode     TEXT,
  is_active   BOOLEAN     NOT NULL DEFAULT true,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, code)
);
CREATE INDEX idx_work_locations_tenant ON work_locations (tenant_id);

-- COST CENTERS
CREATE TABLE IF NOT EXISTS cost_centers (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   UUID        NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name        TEXT        NOT NULL,
  code        TEXT,
  description TEXT,
  is_active   BOOLEAN     NOT NULL DEFAULT true,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, code)
);
CREATE INDEX idx_cost_centers_tenant ON cost_centers (tenant_id);

-- SHIFTS
CREATE TABLE IF NOT EXISTS shifts (
  id             UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id      UUID        NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name           TEXT        NOT NULL,
  code           TEXT,
  start_time     TIME        NOT NULL,
  end_time       TIME        NOT NULL,
  work_hours     NUMERIC(4,2),
  is_night_shift BOOLEAN     NOT NULL DEFAULT false,
  is_active      BOOLEAN     NOT NULL DEFAULT true,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, code)
);
CREATE INDEX idx_shifts_tenant ON shifts (tenant_id);

-- IDENTITY TYPES  (Passport, Driving License, Voter ID, etc.)
CREATE TABLE IF NOT EXISTS identity_types (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   UUID        NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name        TEXT        NOT NULL,
  code        TEXT        NOT NULL,
  description TEXT,
  is_active   BOOLEAN     NOT NULL DEFAULT true,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, code)
);
CREATE INDEX idx_identity_types_tenant ON identity_types (tenant_id);

-- RELATIONSHIP TYPES  (Spouse, Father, Mother, Son, Daughter, etc.)
CREATE TABLE IF NOT EXISTS relationship_types (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   UUID        NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name        TEXT        NOT NULL,
  code        TEXT        NOT NULL,
  is_active   BOOLEAN     NOT NULL DEFAULT true,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, code)
);
CREATE INDEX idx_relationship_types_tenant ON relationship_types (tenant_id);

-- DOCUMENT TYPES  (replaces hardcoded doc_type enum in documents table)
CREATE TABLE IF NOT EXISTS document_types (
  id             UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id      UUID        NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name           TEXT        NOT NULL,
  code           TEXT        NOT NULL,
  description    TEXT,
  is_mandatory   BOOLEAN     NOT NULL DEFAULT false,
  applicable_for TEXT[]      NOT NULL DEFAULT '{}',  -- e.g. ['joining', 'exit', 'identity']
  is_active      BOOLEAN     NOT NULL DEFAULT true,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, code)
);
CREATE INDEX idx_document_types_tenant ON document_types (tenant_id);

-- Add document_type_id FK to documents (keep old doc_type column for backward compat)
ALTER TABLE documents
  ADD COLUMN IF NOT EXISTS document_type_id UUID REFERENCES document_types(id) ON DELETE SET NULL;

-- ============================================================
-- ROW LEVEL SECURITY
-- ============================================================
ALTER TABLE work_locations    ENABLE ROW LEVEL SECURITY;
ALTER TABLE cost_centers      ENABLE ROW LEVEL SECURITY;
ALTER TABLE shifts             ENABLE ROW LEVEL SECURITY;
ALTER TABLE identity_types    ENABLE ROW LEVEL SECURITY;
ALTER TABLE relationship_types ENABLE ROW LEVEL SECURITY;
ALTER TABLE document_types    ENABLE ROW LEVEL SECURITY;

-- work_locations
CREATE POLICY "wl_tenant_read"  ON work_locations FOR SELECT USING (tenant_id = get_user_tenant_id());
CREATE POLICY "wl_hr_write"     ON work_locations FOR ALL    USING (get_user_role() IN ('super_admin','hr_admin'));

-- cost_centers
CREATE POLICY "cc_tenant_read"  ON cost_centers FOR SELECT USING (tenant_id = get_user_tenant_id());
CREATE POLICY "cc_hr_write"     ON cost_centers FOR ALL    USING (get_user_role() IN ('super_admin','hr_admin'));

-- shifts
CREATE POLICY "sh_tenant_read"  ON shifts FOR SELECT USING (tenant_id = get_user_tenant_id());
CREATE POLICY "sh_hr_write"     ON shifts FOR ALL    USING (get_user_role() IN ('super_admin','hr_admin'));

-- identity_types
CREATE POLICY "it_tenant_read"  ON identity_types FOR SELECT USING (tenant_id = get_user_tenant_id());
CREATE POLICY "it_hr_write"     ON identity_types FOR ALL    USING (get_user_role() IN ('super_admin','hr_admin'));

-- relationship_types
CREATE POLICY "rt_tenant_read"  ON relationship_types FOR SELECT USING (tenant_id = get_user_tenant_id());
CREATE POLICY "rt_hr_write"     ON relationship_types FOR ALL    USING (get_user_role() IN ('super_admin','hr_admin'));

-- document_types
CREATE POLICY "dt_tenant_read"  ON document_types FOR SELECT USING (tenant_id = get_user_tenant_id());
CREATE POLICY "dt_hr_write"     ON document_types FOR ALL    USING (get_user_role() IN ('super_admin','hr_admin'));
