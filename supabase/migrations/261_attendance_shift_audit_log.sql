-- ============================================================
-- 261_attendance_shift_audit_log.sql
--
-- AHI-1: Shift attribution change audit log.
--
-- Written whenever a recompute changes expected_shift_id on an
-- existing attendance_daily row — tracks WHAT changed, WHO
-- triggered it, and WHY. Enables HR to answer:
-- "Did a shift change alter this employee's historical attendance?"
-- ============================================================

CREATE TABLE IF NOT EXISTS attendance_shift_audit_log (
  id                    UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id             UUID        NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  employee_id           UUID        NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  date                  DATE        NOT NULL,

  old_shift_id          UUID        REFERENCES shifts(id) ON DELETE SET NULL,
  old_shift_start_time  TEXT,
  old_resolution_source TEXT,

  new_shift_id          UUID        REFERENCES shifts(id) ON DELETE SET NULL,
  new_shift_start_time  TEXT,
  new_resolution_source TEXT,

  change_reason         TEXT,
  changed_by            UUID        REFERENCES profiles(id) ON DELETE SET NULL,
  changed_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_shift_audit_emp_date
  ON attendance_shift_audit_log (tenant_id, employee_id, date DESC);

CREATE INDEX IF NOT EXISTS idx_shift_audit_date
  ON attendance_shift_audit_log (tenant_id, date DESC);

ALTER TABLE attendance_shift_audit_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "shift_audit_hr_read" ON attendance_shift_audit_log
  FOR SELECT USING (
    tenant_id = get_user_tenant_id()
    AND get_user_role() IN ('super_admin', 'hr_admin')
  );

CREATE POLICY "shift_audit_service_insert" ON attendance_shift_audit_log
  FOR INSERT WITH CHECK (tenant_id = get_user_tenant_id());
