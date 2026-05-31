-- ============================================================
-- 033_leave_management.sql
-- Leave type master + leave application table.
-- Also extends attendance_daily.status to include 'leave'.
--
-- leave_types:  tenant-level master (CL, SL, EL, etc.)
-- leave_applications: per-employee requests with approval flow
-- ============================================================

-- ── Leave type master ────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS leave_types (
  id             UUID    PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id      UUID    NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name           TEXT    NOT NULL,          -- e.g. 'CL', 'SL', 'EL'
  is_paid        BOOLEAN NOT NULL DEFAULT true,
  allow_sandwich BOOLEAN NOT NULL DEFAULT false,  -- sandwich rule applies
  is_active      BOOLEAN NOT NULL DEFAULT true,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, name)
);

-- ── Leave applications ───────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS leave_applications (
  id             UUID    PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id      UUID    NOT NULL REFERENCES tenants(id)    ON DELETE CASCADE,
  employee_id    UUID    NOT NULL REFERENCES employees(id)  ON DELETE CASCADE,
  leave_type_id  UUID    NOT NULL REFERENCES leave_types(id) ON DELETE RESTRICT,
  from_date      DATE    NOT NULL,
  to_date        DATE    NOT NULL,
  reason         TEXT,
  status         TEXT    NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending','approved','rejected')),
  approved_by    UUID    NULL      REFERENCES profiles(id)  ON DELETE SET NULL,
  approved_at    TIMESTAMPTZ NULL,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT leave_dates_order CHECK (to_date >= from_date)
);

CREATE INDEX IF NOT EXISTS idx_leave_employee
  ON leave_applications (tenant_id, employee_id, from_date);

CREATE INDEX IF NOT EXISTS idx_leave_status
  ON leave_applications (tenant_id, status);

-- ── Extend attendance_daily status ───────────────────────────────────────────
-- Add 'leave' to the allowed status values.

ALTER TABLE attendance_daily DROP CONSTRAINT IF EXISTS attendance_daily_status_check;

ALTER TABLE attendance_daily ADD CONSTRAINT attendance_daily_status_check
  CHECK (status IN (
    'present', 'absent', 'half_day', 'late',
    'holiday', 'weekend', 'weekly_off', 'leave'
  ));

-- ── Row-Level Security ────────────────────────────────────────────────────────

ALTER TABLE leave_types        ENABLE ROW LEVEL SECURITY;
ALTER TABLE leave_applications ENABLE ROW LEVEL SECURITY;

CREATE POLICY "lt_tenant_read"
  ON leave_types FOR SELECT
  USING (tenant_id = get_user_tenant_id());

CREATE POLICY "lt_hr_write"
  ON leave_types FOR ALL
  USING (get_user_role() IN ('super_admin', 'hr_admin'));

CREATE POLICY "la_tenant_read"
  ON leave_applications FOR SELECT
  USING (tenant_id = get_user_tenant_id());

CREATE POLICY "la_employee_insert"
  ON leave_applications FOR INSERT
  WITH CHECK (tenant_id = get_user_tenant_id());

CREATE POLICY "la_hr_all"
  ON leave_applications FOR ALL
  USING (get_user_role() IN ('super_admin', 'hr_admin'));
