-- Migration 299: Configurable separation clearance departments
--
-- Replaces the hard-coded 5-department CHECK with a tenant-configurable list of
-- clearance departments. Existing values (it/finance/manager/admin/hr) remain
-- valid; the API seeds these defaults on first use.

ALTER TABLE separation_clearances DROP CONSTRAINT IF EXISTS separation_clearances_department_check;

CREATE TABLE IF NOT EXISTS clearance_departments (
  id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     UUID        NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  code          TEXT        NOT NULL,
  label         TEXT        NOT NULL,
  display_order INT         NOT NULL DEFAULT 0,
  is_active     BOOLEAN     NOT NULL DEFAULT true,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, code)
);

ALTER TABLE clearance_departments ENABLE ROW LEVEL SECURITY;
CREATE POLICY "clr_dept_hr_all" ON clearance_departments FOR ALL    USING (get_user_role() IN ('super_admin','hr_admin'));
CREATE POLICY "clr_dept_self"   ON clearance_departments FOR SELECT USING (tenant_id = get_user_tenant_id());
