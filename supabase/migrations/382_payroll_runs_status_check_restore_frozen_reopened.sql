-- ============================================================
-- 382_payroll_runs_status_check_restore_frozen_reopened.sql
--
-- Bug fix: migration 358 (C6 — add 'queued' status) replaced the whole
-- payroll_runs_status_check constraint with DROP + ADD, but its new list
-- only carried forward the values from migration 140 and forgot the
-- 'frozen' / 'reopened' values that migration 225 had added on top of
-- that same base list. Since 358 was applied after 225, its narrower
-- list is what has been live ever since — silently re-breaking the exact
-- freeze/reopen bug that 225 was written to fix.
--
-- Confirmed impact: POST /payroll/runs/:id/freeze (index.ts, "status:
-- 'frozen'" update) has been rejected by this constraint since 358 was
-- applied. The frontend just showed a generic "Failed to ..." error with
-- no indication the cause was a stale CHECK constraint.
--
-- This migration is the union of every status value ever intentionally
-- allowed: queued (358) + draft/processing/finalized/failed/partial_failed
-- (140) + frozen/reopened (225).
-- ============================================================

ALTER TABLE payroll_runs
  DROP CONSTRAINT IF EXISTS payroll_runs_status_check;

ALTER TABLE payroll_runs
  ADD CONSTRAINT payroll_runs_status_check
  CHECK (status IN (
    'queued', 'draft', 'processing', 'finalized', 'failed', 'partial_failed',
    'frozen', 'reopened'
  ));

NOTIFY pgrst, 'reload schema';
