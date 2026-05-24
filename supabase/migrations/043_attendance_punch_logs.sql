-- ============================================================
-- 043_attendance_punch_logs.sql
--
-- Canonical punch log table used by AttendanceEngine.
-- Punches are ingested via POST /attendance/punch (manual/device)
-- or inserted by the regularisation approval flow (source='regularisation').
--
-- The AttendanceEngine reads from this table exclusively when
-- computing per-employee per-date attendance status.
-- ============================================================

CREATE TABLE IF NOT EXISTS attendance_punch_logs (
  id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    UUID        NOT NULL REFERENCES tenants(id)   ON DELETE CASCADE,
  employee_id  UUID        NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  punched_at   TIMESTAMPTZ NOT NULL,
  direction    TEXT        NOT NULL CHECK (direction IN ('IN', 'OUT')),
  source       TEXT        NOT NULL DEFAULT 'manual'
               CHECK (source IN ('device', 'manual', 'mobile', 'web', 'kiosk', 'regularisation')),
  device_id    TEXT,
  notes        TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Fast lookup by employee + time (supports shift-window queries)
CREATE INDEX IF NOT EXISTS idx_punch_logs_employee_time
  ON attendance_punch_logs (tenant_id, employee_id, punched_at);

-- Fast lookup by date range across all employees (for batch recompute)
CREATE INDEX IF NOT EXISTS idx_punch_logs_tenant_time
  ON attendance_punch_logs (tenant_id, punched_at);

ALTER TABLE attendance_punch_logs ENABLE ROW LEVEL SECURITY;

-- All authenticated users in the tenant can read their own punches
CREATE POLICY "pl_tenant_read" ON attendance_punch_logs FOR SELECT
  USING (tenant_id = get_user_tenant_id());

-- Any authenticated tenant user can insert (employee self-punch or device)
CREATE POLICY "pl_authenticated_insert" ON attendance_punch_logs FOR INSERT
  WITH CHECK (tenant_id = get_user_tenant_id());

-- HR admin can update/delete (e.g., remove erroneous punches)
CREATE POLICY "pl_hr_update" ON attendance_punch_logs FOR UPDATE
  USING (get_user_role() IN ('super_admin', 'hr_admin'));

CREATE POLICY "pl_hr_delete" ON attendance_punch_logs FOR DELETE
  USING (get_user_role() IN ('super_admin', 'hr_admin'));
