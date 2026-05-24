-- ============================================================
-- 057_sites.sql
--
-- Sites Master — a named physical site (building / campus / branch)
-- with its own timezone and holiday grouping.
--
-- Design:
--   · One tenant can have many sites.
--   · Sites are linked to employees (employees.site_id → sites.id).
--   · holidays can be scoped to a site via holiday_calendar.site_id.
--   · NULL site_id on an employee = no site assignment (falls back
--     to location-based or global holiday rules).
-- ============================================================

CREATE TABLE IF NOT EXISTS sites (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   UUID        NOT NULL REFERENCES tenants(id)   ON DELETE CASCADE,
  name        TEXT        NOT NULL,
  location    TEXT,
  timezone    TEXT        NOT NULL DEFAULT 'Asia/Kolkata',
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, name)
);

CREATE INDEX IF NOT EXISTS idx_sites_tenant
  ON sites (tenant_id);

ALTER TABLE sites ENABLE ROW LEVEL SECURITY;

CREATE POLICY "sites_tenant_read" ON sites
  FOR SELECT USING (tenant_id = get_user_tenant_id());

CREATE POLICY "sites_hr_write" ON sites
  FOR ALL USING (get_user_role() IN ('super_admin', 'hr_admin'));
