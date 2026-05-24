-- ============================================================
-- 051_attendance_corrections.sql
--
-- attendance_corrections table: employee-submitted punch correction
-- requests that, upon approval, insert punch_log rows and recompute
-- attendance_daily for the affected date.
--
-- Separate from attendance_regularisation (which carries requested
-- timestamps from the employee side).  This table is the canonical
-- "correction" workflow where HR/manager can override any punch.
-- ============================================================

CREATE TABLE IF NOT EXISTS attendance_corrections (
  id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id        UUID        NOT NULL REFERENCES tenants(id)   ON DELETE CASCADE,
  employee_id      UUID        NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  date             DATE        NOT NULL,

  -- The corrected punch timestamps supplied by the employee
  corrected_in     TIMESTAMPTZ NULL,
  corrected_out    TIMESTAMPTZ NULL,

  reason           TEXT        NOT NULL,

  -- Workflow status
  status           TEXT        NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'approved', 'rejected')),

  submitted_by     UUID        NULL REFERENCES profiles(id) ON DELETE SET NULL,
  approved_by      UUID        NULL REFERENCES profiles(id) ON DELETE SET NULL,
  approved_at      TIMESTAMPTZ NULL,
  rejection_reason TEXT        NULL,

  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_corrections_employee_date
  ON attendance_corrections (tenant_id, employee_id, date DESC);

CREATE INDEX IF NOT EXISTS idx_corrections_status
  ON attendance_corrections (tenant_id, status, created_at DESC);

-- updated_at trigger
CREATE OR REPLACE FUNCTION set_corrections_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_corrections_updated_at ON attendance_corrections;
CREATE TRIGGER trg_corrections_updated_at
  BEFORE UPDATE ON attendance_corrections
  FOR EACH ROW EXECUTE FUNCTION set_corrections_updated_at();

-- RLS
ALTER TABLE attendance_corrections ENABLE ROW LEVEL SECURITY;

CREATE POLICY "corr_tenant_read" ON attendance_corrections FOR SELECT
  USING (tenant_id = get_user_tenant_id());

CREATE POLICY "corr_employee_insert" ON attendance_corrections FOR INSERT
  WITH CHECK (tenant_id = get_user_tenant_id());

CREATE POLICY "corr_hr_all" ON attendance_corrections FOR ALL
  USING (get_user_role() IN ('super_admin', 'hr_admin'));
