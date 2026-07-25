-- ============================================================
-- 386_payroll_run_events_type_check_true_union.sql
--
-- FIX (CRITICAL, ISSUE-127): migration 381 (shipped 2026-07-24 to add
-- 'computation_failed') copied forward migration 277's value list —
-- but 277 had ALREADY silently dropped 14 values that migrations 145
-- and 146 added (snapshot_created, snapshot_verified,
-- snapshot_integrity_failed, replay_completed, replay_variance_found,
-- ledger_created, ledger_balanced, ledger_posted, ledger_reversed,
-- ledger_integrity_failed, payout_reconciled,
-- payout_reconciliation_failed, accrual_created, accrual_cleared).
-- 381 perpetuated that regression instead of fixing it.
--
-- This migration sets the constraint to the TRUE UNION of every value
-- that has ever appeared in this constraint's history (139, 144, 145,
-- 146, 277, 381), plus 5 values confirmed live in
-- apps/api/src/routes/payroll/index.ts today that were never added to
-- ANY prior version of this constraint (employee_timed_out,
-- payroll_retry_triggered, payroll_run_frozen, slip_timeout_voided,
-- blocker_ignored) — found by grepping every event_type literal
-- actually written by the route file, not just re-deriving from
-- migration history, per the lesson from this exact bug.
--
-- Do NOT repeat the 277/381 mistake: the next person to touch this
-- constraint must diff against the full historical set (this file),
-- not just the version currently live.
-- ============================================================

ALTER TABLE payroll_run_events DROP CONSTRAINT IF EXISTS payroll_run_events_type_check;

ALTER TABLE payroll_run_events ADD CONSTRAINT payroll_run_events_type_check
  CHECK (event_type IN (
    -- base (migration 139)
    'run_started',
    'run_completed',
    'slip_computed',
    'slip_insert_failed',
    'validation_failed',
    'data_fetch_failed',
    'compensation_missing',
    'compensation_invalid',
    'dry_run_completed',
    -- governance (migration 144)
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
    -- snapshot & replay (migration 145)
    'snapshot_created',
    'snapshot_verified',
    'snapshot_integrity_failed',
    'replay_completed',
    'replay_variance_found',
    -- accounting ledger (migration 146)
    'ledger_created',
    'ledger_balanced',
    'ledger_posted',
    'ledger_reversed',
    'ledger_integrity_failed',
    'payout_reconciled',
    'payout_reconciliation_failed',
    'accrual_created',
    'accrual_cleared',
    -- run deletion (migration 277)
    'run_deleted',
    -- computation failure (migration 381)
    'computation_failed',
    -- confirmed live in routes/payroll/index.ts, never previously added
    'employee_timed_out',
    'payroll_retry_triggered',
    'payroll_run_frozen',
    'slip_timeout_voided',
    'blocker_ignored'
  ));
