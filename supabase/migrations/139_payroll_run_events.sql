-- ============================================================
-- 139_payroll_run_events.sql
--
-- Forensic event log for payroll run execution.
--
-- One row per significant event during a payroll run:
--   run_started            — run row created, processing begins
--   run_completed          — all employees processed (with counts)
--   slip_computed          — one employee's slip computed successfully
--   slip_insert_failed     — DB insert failed for one employee
--   validation_failed      — slip payload failed validatePayrollSlipPayload()
--   data_fetch_failed      — compensation or attendance query failed
--   compensation_missing   — employee has no active compensation
--   compensation_invalid   — compensation data has blocking errors
--   dry_run_completed      — dry run finished without DB writes
--
-- Design rules:
--   • Never updated — append-only forensic log.
--   • payload stores computed values (sanitized — no PII beyond employee_id).
--   • error_details stores DB error code/message/hint/details + stack trace.
--   • Non-fatal: write failures must not block the payroll run itself.
--   • Row-level security: hr_admin / super_admin read/write only.
-- ============================================================

CREATE TABLE IF NOT EXISTS payroll_run_events (
  id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     UUID        NOT NULL REFERENCES tenants(id)    ON DELETE CASCADE,
  run_id        UUID        REFERENCES payroll_runs(id)         ON DELETE SET NULL,
  event_type    TEXT        NOT NULL,
  employee_id   UUID        REFERENCES employees(id)            ON DELETE SET NULL,
  month         TEXT,                          -- YYYY-MM (denormalized for direct queries)
  payload       JSONB,                         -- computed slip or summary data
  error_details JSONB,                         -- DB error code, message, hint, details, stack
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Constraint: only known event types are allowed
ALTER TABLE payroll_run_events
  DROP CONSTRAINT IF EXISTS payroll_run_events_type_check;
ALTER TABLE payroll_run_events
  ADD CONSTRAINT payroll_run_events_type_check
  CHECK (event_type IN (
    'run_started',
    'run_completed',
    'slip_computed',
    'slip_insert_failed',
    'validation_failed',
    'data_fetch_failed',
    'compensation_missing',
    'compensation_invalid',
    'dry_run_completed'
  ));

-- Index: forensic queries by run
CREATE INDEX IF NOT EXISTS idx_pre_events_run
  ON payroll_run_events (run_id, created_at DESC)
  WHERE run_id IS NOT NULL;

-- Index: forensic queries by employee
CREATE INDEX IF NOT EXISTS idx_pre_events_employee
  ON payroll_run_events (tenant_id, employee_id, created_at DESC)
  WHERE employee_id IS NOT NULL;

-- Index: failure investigation
CREATE INDEX IF NOT EXISTS idx_pre_events_failures
  ON payroll_run_events (tenant_id, event_type, month)
  WHERE event_type IN ('slip_insert_failed', 'validation_failed', 'data_fetch_failed', 'compensation_invalid');

-- ── RLS ───────────────────────────────────────────────────────────────────────

ALTER TABLE payroll_run_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "pre_events_hr_all" ON payroll_run_events;
CREATE POLICY "pre_events_hr_all" ON payroll_run_events FOR ALL
  USING (
    tenant_id = get_user_tenant_id()
    AND get_user_role() IN ('super_admin', 'hr_admin')
  );

COMMENT ON TABLE payroll_run_events IS
  'Append-only forensic event log for payroll run execution. '
  'One row per significant event (slip computed, insert failed, validation failed, etc.). '
  'Never updated — written once at event time.';
