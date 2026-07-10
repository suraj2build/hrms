-- 367_attendance_recompute_runs
--
-- Observability table for bulk attendance recompute jobs.
-- Each "Process" button click or upload-triggered recompute writes one row here,
-- updated in-place as workers finish.  HR admins use GET /attendance/recompute/runs
-- to see whether a previous run succeeded, partially failed, or is still running.
--
-- Schema decision: per-employee detail is kept in JSONB error_summary (capped at
-- 100 entries) rather than a child table — the primary use-case is "which employees
-- failed and why?", not a full audit trail per employee per date.

CREATE TABLE IF NOT EXISTS attendance_recompute_runs (
  run_id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id           UUID        NOT NULL,
  triggered_by        UUID,                         -- auth.uid() of the HR admin who clicked Process
  trigger_source      TEXT        NOT NULL DEFAULT 'api',
  from_date           DATE        NOT NULL,
  to_date             DATE        NOT NULL,
  employees_queued    INTEGER     NOT NULL DEFAULT 0,
  employees_succeeded INTEGER     NOT NULL DEFAULT 0,
  employees_failed    INTEGER     NOT NULL DEFAULT 0,
  rows_upserted       INTEGER     NOT NULL DEFAULT 0,
  rows_protected      INTEGER     NOT NULL DEFAULT 0,
  status              TEXT        NOT NULL DEFAULT 'running',
  -- [{employee_id, error}] — first 100 failures
  error_summary       JSONB,
  started_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  finished_at         TIMESTAMPTZ,

  CONSTRAINT fk_recompute_runs_tenant  FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE,
  CONSTRAINT chk_trigger_source        CHECK (trigger_source IN ('process_button','upload_job','single_employee','api')),
  CONSTRAINT chk_run_status            CHECK (status IN ('running','completed','partial','failed'))
);

CREATE INDEX IF NOT EXISTS idx_recompute_runs_tenant_started
  ON attendance_recompute_runs(tenant_id, started_at DESC);

ALTER TABLE attendance_recompute_runs ENABLE ROW LEVEL SECURITY;

-- HR admins and super_admins can read; the backend writes using the service role key
-- (bypasses RLS), so no INSERT/UPDATE policy is needed here.
CREATE POLICY "hr can read recompute runs"
  ON attendance_recompute_runs FOR SELECT
  USING (
    tenant_id = (SELECT tenant_id FROM profiles WHERE id = auth.uid() LIMIT 1)
    AND (SELECT role FROM profiles WHERE id = auth.uid() LIMIT 1) IN ('hr_admin','super_admin','manager')
  );
