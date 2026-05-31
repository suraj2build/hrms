-- ============================================================
-- 052_attendance_compute_log.sql
--
-- attendance_compute_log stores the inputs, result, and derived
-- reason for every computeDay() invocation.  This enables full
-- traceability: HR can look up "why was this employee marked
-- absent on YYYY-MM-DD?" and see the exact sessions array and
-- shift meta that were used.
--
-- Design: fire-and-forget writes; rows are never deleted
-- automatically.  Retention policy is left to the customer.
-- ============================================================

CREATE TABLE IF NOT EXISTS attendance_compute_log (
  id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    UUID        NOT NULL REFERENCES tenants(id)   ON DELETE CASCADE,
  employee_id  UUID        NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  date         DATE        NOT NULL,

  -- Inputs passed to computeDay()
  inputs       JSONB       NOT NULL DEFAULT '{}',
  -- The DailyRow returned by computeDay()
  result       JSONB       NOT NULL DEFAULT '{}',
  -- Human-readable derivation reason (e.g. "no punches → absent")
  reason       TEXT        NOT NULL DEFAULT '',

  -- Source that triggered the computation
  source       TEXT        NOT NULL DEFAULT 'system'
    CHECK (source IN ('system', 'recompute', 'correction', 'manual')),

  computed_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_compute_log_employee_date
  ON attendance_compute_log (tenant_id, employee_id, date DESC);

CREATE INDEX IF NOT EXISTS idx_compute_log_date
  ON attendance_compute_log (tenant_id, date DESC);

-- RLS: HR read-only; no employee self-view (internal audit trail)
ALTER TABLE attendance_compute_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "clog_hr_read" ON attendance_compute_log FOR SELECT
  USING (get_user_role() IN ('super_admin', 'hr_admin'));

CREATE POLICY "clog_service_insert" ON attendance_compute_log FOR INSERT
  WITH CHECK (tenant_id = get_user_tenant_id());
