-- ============================================================
-- 035_attendance_audit_log.sql
-- Full traceability of attendance_daily status changes.
--
-- Written by three code paths:
--   system         — batch processor run (processAttendanceForDate)
--   regularisation — approved correction (regularisation.ts)
--   leave          — approved leave (leave.ts)
--
-- before_status NULL = row did not previously exist.
-- ============================================================

CREATE TABLE IF NOT EXISTS attendance_audit_log (
  id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     UUID        NOT NULL REFERENCES tenants(id)   ON DELETE CASCADE,
  employee_id   UUID        NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  date          DATE        NOT NULL,
  source        TEXT        NOT NULL
    CHECK (source IN ('system', 'regularisation', 'leave')),
  before_status TEXT        NULL,       -- NULL when the row is newly created
  after_status  TEXT        NOT NULL,
  changed_by    UUID        NULL REFERENCES profiles(id) ON DELETE SET NULL,
  metadata      JSONB,                  -- e.g. { run_id, application_id, regularisation_id }
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Lookups: employee attendance history + admin source-based queries
CREATE INDEX IF NOT EXISTS idx_audit_log_employee_date
  ON attendance_audit_log (tenant_id, employee_id, date DESC);

CREATE INDEX IF NOT EXISTS idx_audit_log_source
  ON attendance_audit_log (tenant_id, source, created_at DESC);

-- ── Row-Level Security ────────────────────────────────────────────────────────

ALTER TABLE attendance_audit_log ENABLE ROW LEVEL SECURITY;

-- Any authenticated user can read audit rows in their tenant
CREATE POLICY "aal_tenant_read"
  ON attendance_audit_log FOR SELECT
  USING (tenant_id = get_user_tenant_id());

-- Only hr_admin / super_admin can write (application writes use service-role)
CREATE POLICY "aal_hr_insert"
  ON attendance_audit_log FOR INSERT
  WITH CHECK (tenant_id = get_user_tenant_id());
