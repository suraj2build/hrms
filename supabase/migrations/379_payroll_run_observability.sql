-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 379 — Payroll run observability columns
--
-- Adds four columns to payroll_runs that Sprint-2 of the enterprise hardening
-- project writes during live payroll execution:
--
--   started_processing_at  — wall-clock time when executePayrollRun() began
--                            processing (set when the run transitions from
--                            'queued' → 'processing').
--   total_employee_count   — full active employee headcount for the run,
--                            written immediately after the employee list is
--                            fetched (before any per-employee work begins).
--   processed_employee_count — running tally of succeeded + failed employees,
--                              updated every 30 s via the heartbeat interval
--                              and finalised at run completion.
--   run_duration_ms        — total wall-clock duration in milliseconds from
--                            started_processing_at to run completion.
--
-- These columns drive the progress-reporting response on GET /payroll/runs/:id
-- and are included in the run_completed audit event payload for SRE dashboards.
--
-- Rollback:
--   ALTER TABLE payroll_runs
--     DROP COLUMN IF EXISTS started_processing_at,
--     DROP COLUMN IF EXISTS total_employee_count,
--     DROP COLUMN IF EXISTS processed_employee_count,
--     DROP COLUMN IF EXISTS run_duration_ms;
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE payroll_runs
  ADD COLUMN IF NOT EXISTS started_processing_at   timestamptz,
  ADD COLUMN IF NOT EXISTS total_employee_count    int,
  ADD COLUMN IF NOT EXISTS processed_employee_count int NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS run_duration_ms         int;

COMMENT ON COLUMN payroll_runs.started_processing_at IS
  'Wall-clock timestamp when executePayrollRun() began processing employees '
  '(transition from queued → processing). Used to compute run_duration_ms.';

COMMENT ON COLUMN payroll_runs.total_employee_count IS
  'Full active employee headcount at the time the run started. Written before '
  'per-employee computation begins. Supports progress percentage calculations.';

COMMENT ON COLUMN payroll_runs.processed_employee_count IS
  'Running tally of succeeded + failed employees. Updated every ~30 s via the '
  'heartbeat interval and set to the final count at run completion.';

COMMENT ON COLUMN payroll_runs.run_duration_ms IS
  'Total wall-clock time in milliseconds from started_processing_at to run '
  'completion. Populated at run completion only (null while processing).';
