-- ============================================================
-- 381_payroll_run_events_add_computation_failed.sql
--
-- Bug fix: computeOneEmployee() (apps/api/src/routes/payroll/index.ts) has
-- always written event_type = 'computation_failed' for an employee whose
-- payroll computation throws an unexpected error, but that value was never
-- added to payroll_run_events' CHECK constraint across any of its revisions
-- (139, 144, 145, 146, 277). Every such insert has been silently rejected —
-- logRunEvent() swallows the error and only logs a warning, so the run
-- itself was never affected, but the forensic event for exactly the
-- hardest-to-diagnose failure category (an unhandled exception) never
-- reached the audit trail.
-- ============================================================

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
    'dry_run_completed',
    'run_finalized',
    'run_rolled_back',
    'run_frozen',
    'run_unfrozen',
    'blocker_resolved',
    'approval_submitted',
    'approval_approved',
    'approval_rejected',
    'slip_regenerated',
    'payout_initiated',
    'payout_failed',
    'payout_reversed',
    'override_applied',
    'run_deleted',
    -- new: fixes silent insert failures from computeOneEmployee()'s catch block
    'computation_failed'
  ));
