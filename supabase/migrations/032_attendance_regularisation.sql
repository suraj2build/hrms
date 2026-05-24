-- ============================================================
-- 032_attendance_regularisation.sql
-- Attendance correction request table with approval workflow.
--
-- Employees submit correction requests when their punch log
-- is missing or incorrect. HR / managers approve or reject.
-- On approval the attendance_daily row is recomputed in the
-- API handler — raw_logs and attendance_logs are NOT modified.
-- ============================================================

CREATE TABLE IF NOT EXISTS attendance_regularisation (
  id                  UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id           UUID        NOT NULL REFERENCES tenants(id)   ON DELETE CASCADE,
  employee_id         UUID        NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  date                DATE        NOT NULL,
  requested_check_in  TIMESTAMPTZ NULL,
  requested_check_out TIMESTAMPTZ NULL,
  reason              TEXT        NOT NULL,
  status              TEXT        NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending','approved','rejected')),
  approved_by         UUID        NULL      REFERENCES profiles(id) ON DELETE SET NULL,
  approved_at         TIMESTAMPTZ NULL,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Fast lookup: employee's corrections by date (employee view + processor)
CREATE INDEX IF NOT EXISTS idx_regularisation_employee_date
  ON attendance_regularisation (tenant_id, employee_id, date);

-- Fast lookup: pending approvals queue (HR admin view)
CREATE INDEX IF NOT EXISTS idx_regularisation_status
  ON attendance_regularisation (tenant_id, status);

-- ── Row-Level Security ────────────────────────────────────────────────────────

ALTER TABLE attendance_regularisation ENABLE ROW LEVEL SECURITY;

-- Any authenticated user can read rows in their tenant
CREATE POLICY "reg_tenant_read"
  ON attendance_regularisation FOR SELECT
  USING (tenant_id = get_user_tenant_id());

-- Any authenticated user can submit (INSERT) — employee_id validated in API
CREATE POLICY "reg_employee_insert"
  ON attendance_regularisation FOR INSERT
  WITH CHECK (tenant_id = get_user_tenant_id());

-- HR/super_admin can update (approve/reject) and delete
CREATE POLICY "reg_hr_all"
  ON attendance_regularisation FOR ALL
  USING (get_user_role() IN ('super_admin', 'hr_admin'));
