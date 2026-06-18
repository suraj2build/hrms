-- ============================================================
-- 277_payroll_run_deleted_event.sql
--
-- Add 'run_deleted' to payroll_run_events.event_type so that hard-deleting a
-- non-finalized run (e.g. a stray future-month draft created before the
-- future-month guard existed) leaves an accurate forensic audit entry.
-- ============================================================

ALTER TABLE payroll_run_events
  DROP CONSTRAINT IF EXISTS payroll_run_events_type_check;

ALTER TABLE payroll_run_events
  ADD CONSTRAINT payroll_run_events_type_check
  CHECK (event_type IN (
    -- existing
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
    -- new
    'run_deleted'
  ));
