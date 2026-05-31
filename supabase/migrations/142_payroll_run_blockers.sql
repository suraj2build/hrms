-- ============================================================
-- 142_payroll_run_blockers.sql
--
-- Persistent per-employee payroll blocker records.
--
-- Blockers are created by the payroll run handler whenever an employee
-- fails during computation.  Each blocker maps to a validation rule
-- (payroll_validation_rules.code) so the Resolution Center can surface
-- structured remediation guidance.
--
-- Lifecycle:
--   open     → created at run time; requires operator action
--   resolved → operator marked the underlying issue as fixed
--   ignored  → operator accepted the risk (creates audit trail)
--
-- Severity:
--   critical → blocks retry + finalization until resolved/ignored
--   warning  → surfaces but does not block retry
--   info     → informational only
-- ============================================================

CREATE TABLE IF NOT EXISTS payroll_run_blockers (
  id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id        UUID        NOT NULL,
  run_id           UUID        NOT NULL REFERENCES payroll_runs(id) ON DELETE CASCADE,
  employee_id      UUID        REFERENCES employees(id),
  rule_code        TEXT        NOT NULL,
  severity         TEXT        NOT NULL CHECK (severity IN ('critical', 'warning', 'info')),
  blocking         BOOLEAN     NOT NULL DEFAULT true,
  stage            TEXT        NOT NULL,
  reason           TEXT        NOT NULL,
  message          TEXT        NOT NULL,
  metadata         JSONB,
  status           TEXT        NOT NULL DEFAULT 'open'
                               CHECK (status IN ('open', 'resolved', 'ignored')),
  resolved_by      UUID,
  resolved_at      TIMESTAMPTZ,
  resolution_note  TEXT,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE payroll_run_blockers IS
  'Per-employee blocker records created during payroll runs. '
  'Consumed by the Payroll Resolution Center for guided remediation.';

COMMENT ON COLUMN payroll_run_blockers.rule_code IS
  'FK-by-convention to payroll_validation_rules.code — identifies which rule fired.';

COMMENT ON COLUMN payroll_run_blockers.blocking IS
  'True when this blocker prevents retry/finalization until resolved or ignored.';

-- ── Indexes ───────────────────────────────────────────────────────────────────

CREATE INDEX IF NOT EXISTS payroll_run_blockers_run_id
  ON payroll_run_blockers(run_id);

CREATE INDEX IF NOT EXISTS payroll_run_blockers_tenant_id
  ON payroll_run_blockers(tenant_id);

CREATE INDEX IF NOT EXISTS payroll_run_blockers_employee_id
  ON payroll_run_blockers(employee_id)
  WHERE employee_id IS NOT NULL;

-- Partial index for fast "open blockers" lookups (most common query)
CREATE INDEX IF NOT EXISTS payroll_run_blockers_open
  ON payroll_run_blockers(run_id, severity)
  WHERE status = 'open';

-- ── RLS ───────────────────────────────────────────────────────────────────────

ALTER TABLE payroll_run_blockers ENABLE ROW LEVEL SECURITY;

CREATE POLICY "prb_hr_all" ON payroll_run_blockers FOR ALL
  USING (
    tenant_id = get_user_tenant_id()
    AND get_user_role() IN ('super_admin', 'hr_admin')
  );
