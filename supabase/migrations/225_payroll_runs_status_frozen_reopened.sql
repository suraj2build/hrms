-- 225_payroll_runs_status_frozen_reopened.sql
-- The payroll run lifecycle is Draft → Processing → Finalized → Frozen → Reopened
-- (see PayrollRuns + freeze/unfreeze flows), and the frontend PayrollRun.status
-- type includes 'frozen' and 'reopened'. But payroll_runs_status_check (migration
-- 140) only allowed draft/processing/finalized/failed/partial_failed — so setting
-- status='frozen' (on freeze) or 'reopened' was rejected by the CHECK constraint,
-- leaving the Run Console showing 'finalized' for frozen periods.
--
-- Extend the constraint to include 'frozen' and 'reopened'. Widening only — no
-- existing rows are affected.

ALTER TABLE payroll_runs DROP CONSTRAINT IF EXISTS payroll_runs_status_check;

ALTER TABLE payroll_runs
  ADD CONSTRAINT payroll_runs_status_check
  CHECK (status IN ('draft', 'processing', 'finalized', 'failed', 'partial_failed', 'frozen', 'reopened'));

NOTIFY pgrst, 'reload schema';
