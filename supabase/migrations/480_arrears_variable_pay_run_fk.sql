-- SYSTEM_AUDIT_2026-10-14 — found while wiring arrears/variable-pay into
-- payroll finalize: leave_encashment_requests.payroll_run_id and
-- payroll_adjustments.applied_run_id both already have an
-- ON DELETE SET NULL FK to payroll_runs(id) (confirmed via pg_constraint),
-- so DELETE /payroll/runs/:id (a non-finalized run can always be
-- hard-deleted) automatically un-assigns them. arrear_payouts.
-- payroll_run_id, arrear_batches.processed_payroll_run_id, variable_
-- payouts.payroll_run_id, and variable_payout_batches.
-- processed_payroll_run_id had NO such constraint — deleting a draft run
-- that had an arrears/variable-pay batch assigned to it would leave that
-- batch's assignment permanently dangling (payroll_run_id pointing at a
-- row that no longer exists), with no automatic way to reassign it since
-- assign_arrears_batch_to_run_atomic / assign_variable_pay_batch_to_run_
-- atomic's own ALREADY_ASSIGNED guard only checks "is this non-null", not
-- "does the run it points at still exist".
--
-- Existing data: confirmed via grep (SYSTEM_AUDIT_2026-10-14) that nothing
-- in this codebase ever wrote to any of these four columns before this
-- same audit's migrations 476/477 — so every existing row has NULL here
-- already and the ADD CONSTRAINT below cannot fail on a pre-existing
-- dangling reference. The defensive UPDATEs are a no-op today and only
-- guard against this migration being re-run out of order against a
-- database that already has 476/477 applied with live assignments whose
-- run was since deleted through some other path.

UPDATE arrear_payouts            SET payroll_run_id = NULL           WHERE payroll_run_id IS NOT NULL AND payroll_run_id NOT IN (SELECT id FROM payroll_runs);
UPDATE arrear_batches            SET processed_payroll_run_id = NULL WHERE processed_payroll_run_id IS NOT NULL AND processed_payroll_run_id NOT IN (SELECT id FROM payroll_runs);
UPDATE variable_payouts          SET payroll_run_id = NULL           WHERE payroll_run_id IS NOT NULL AND payroll_run_id NOT IN (SELECT id FROM payroll_runs);
UPDATE variable_payout_batches   SET processed_payroll_run_id = NULL WHERE processed_payroll_run_id IS NOT NULL AND processed_payroll_run_id NOT IN (SELECT id FROM payroll_runs);

ALTER TABLE arrear_payouts
  ADD CONSTRAINT arrear_payouts_payroll_run_id_fkey
  FOREIGN KEY (payroll_run_id) REFERENCES payroll_runs(id) ON DELETE SET NULL;

ALTER TABLE arrear_batches
  ADD CONSTRAINT arrear_batches_processed_payroll_run_id_fkey
  FOREIGN KEY (processed_payroll_run_id) REFERENCES payroll_runs(id) ON DELETE SET NULL;

ALTER TABLE variable_payouts
  ADD CONSTRAINT variable_payouts_payroll_run_id_fkey
  FOREIGN KEY (payroll_run_id) REFERENCES payroll_runs(id) ON DELETE SET NULL;

ALTER TABLE variable_payout_batches
  ADD CONSTRAINT variable_payout_batches_processed_payroll_run_id_fkey
  FOREIGN KEY (processed_payroll_run_id) REFERENCES payroll_runs(id) ON DELETE SET NULL;
