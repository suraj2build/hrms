-- ============================================================
-- 062_employee_org_assignments.sql
--
-- Historical site/roster assignments per employee with
-- effective dating.  Engines resolve site + roster based on
-- the target date, falling back to employees.site_id /
-- employees.roster_id when no history row exists.
-- ============================================================

CREATE TABLE IF NOT EXISTS employee_org_assignments (
  id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     UUID        NOT NULL REFERENCES tenants(id)   ON DELETE CASCADE,
  employee_id   UUID        NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  site_id       UUID        NULL REFERENCES sites(id)   ON DELETE SET NULL,
  roster_id     UUID        NULL REFERENCES rosters(id) ON DELETE SET NULL,
  effective_from DATE       NOT NULL,
  effective_to  DATE        NULL,          -- NULL = still current
  is_current    BOOLEAN     NOT NULL DEFAULT false,
  reason        TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_eoa_employee_date
  ON employee_org_assignments (tenant_id, employee_id, effective_from DESC);

CREATE UNIQUE INDEX IF NOT EXISTS idx_eoa_one_current
  ON employee_org_assignments (tenant_id, employee_id)
  WHERE is_current = true;

ALTER TABLE employee_org_assignments ENABLE ROW LEVEL SECURITY;

CREATE POLICY "eoa_tenant_read" ON employee_org_assignments FOR SELECT
  USING (tenant_id = get_user_tenant_id());
CREATE POLICY "eoa_hr_write" ON employee_org_assignments FOR ALL
  USING (get_user_role() IN ('super_admin', 'hr_admin'));
