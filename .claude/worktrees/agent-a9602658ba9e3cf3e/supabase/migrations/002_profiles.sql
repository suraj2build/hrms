CREATE TABLE IF NOT EXISTS profiles (
  id          UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  tenant_id   UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  employee_id UUID,
  role        TEXT NOT NULL DEFAULT 'employee'
              CHECK (role IN ('super_admin','hr_admin','manager','employee')),
  full_name   TEXT,
  avatar_url  TEXT,
  is_active   BOOLEAN NOT NULL DEFAULT true,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_profiles_tenant ON profiles(tenant_id);
CREATE INDEX idx_profiles_role    ON profiles(role);
