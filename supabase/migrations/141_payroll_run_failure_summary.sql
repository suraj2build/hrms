-- ============================================================
-- 141_payroll_run_failure_summary.sql
--
-- Adds failure_summary JSONB to payroll_runs.
--
-- Populated by POST /payroll/runs when status = failed | partial_failed.
-- Contains a machine-readable breakdown of per-employee failures so the
-- admin UI can surface the dominant failure reason without querying
-- payroll_run_events separately.
--
-- Shape:
--   {
--     "total_failed":     number,
--     "total_employees":  number,
--     "dominant_stage":   string,   -- failure_stage of the largest group
--     "dominant_reason":  string,   -- reason string of the largest group
--     "groups": [
--       {
--         "failure_stage":   string,
--         "reason":          string,
--         "count":           number,
--         "employee_codes":  string[]
--       }, ...
--     ]
--   }
-- ============================================================

ALTER TABLE payroll_runs
  ADD COLUMN IF NOT EXISTS failure_summary JSONB;

COMMENT ON COLUMN payroll_runs.failure_summary IS
  'Structured per-stage failure breakdown when status = failed | partial_failed. '
  'Populated by the payroll run handler. NULL means no failures occurred.';
