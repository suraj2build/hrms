-- SYSTEM_AUDIT_2026-10-14 checkpoint 19 — payroll audit, payout-batches.ts.
--
-- POST /payroll/runs/:id/payout-obligations generates bank-disbursement
-- obligation rows for a finalized run, guarded only by a check-then-insert:
-- read whether any payroll_payout_reconciliation rows already exist for
-- this run_id, and only insert if the count is 0. payroll_payout_
-- reconciliation (migration 146) has no unique constraint tying a row to
-- its run/slip, so two concurrent calls (a network retry, a double-click
-- before the UI disables the button) both pass the same "0 existing" read
-- and both insert a full set — doubling every expected_amount in the bank
-- disbursement reconciliation for that run. This is a real money-safety
-- risk: this table is the one bank-advice generation and payout reads to
-- know what to pay each employee.
--
-- Fixed by adding the DB-level guard the check-then-insert was missing: a
-- unique constraint on (tenant_id, run_id, slip_id). A genuine concurrent
-- double-generation now fails the second call's INSERT outright with a
-- 23505 violation (caught by the route and surfaced as 409) instead of
-- silently duplicating every obligation row. slip_id is nullable for rows
-- not tied to one slip (no case currently produces that from this route,
-- but the schema allows it) — NULL is never equal to NULL under a unique
-- constraint, so such rows are correctly left unconstrained by this index
-- rather than incorrectly collapsed into "only one ever allowed".
CREATE UNIQUE INDEX IF NOT EXISTS uidx_payout_recon_run_slip
  ON payroll_payout_reconciliation (tenant_id, run_id, slip_id)
  WHERE slip_id IS NOT NULL;
