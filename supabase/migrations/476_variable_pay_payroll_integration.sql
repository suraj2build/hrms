-- SYSTEM_AUDIT_2026-10-14 — closing the "arrears/variable-pay/adjustments
-- never reach a payslip" gap (checkpoint 18/19/20's HIGH SEVERITY finding).
--
-- variable_payouts/variable_payout_batches already had payroll_run_id /
-- processed_payroll_run_id / is_taxable / a 'processed' terminal status —
-- the schema anticipated this wiring from the start (migration 102); the
-- application layer never used it. This migration adds the G12-pattern
-- atomic functions (assign / finalize / revert) that make an approved
-- batch's payout actually reach the target month's payslip, survive any
-- number of regenerations of that run, and only become truly "processed"
-- once the run is actually finalized — mirroring
-- assign_leave_encashment_to_payroll_run_atomic / fn_finalize_leave_
-- encashments_for_run / fn_revert_leave_encashments_for_rollback
-- (migration 447) exactly, including the lock order (request/batch row
-- first, then the run row) and the same error-code vocabulary.

-- ─────────────────────────────────────────────────────────────────────────────
-- assign_variable_pay_batch_to_run_atomic — HR picks a draft run for an
-- APPROVED batch. Sets processed_payroll_run_id on the batch and
-- payroll_run_id on every one of its 'approved' per-employee payout rows;
-- status stays 'approved' on both (not yet paid). No slip mutation here —
-- nothing to lose on regeneration, because nothing is written to
-- payroll_slips at this step.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION assign_variable_pay_batch_to_run_atomic(
  p_tenant_id      UUID,
  p_batch_id       UUID,
  p_payroll_run_id UUID
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_batch RECORD;
  v_run   RECORD;
  v_count INT;
BEGIN
  SELECT id, status, payout_month, processed_payroll_run_id
  INTO   v_batch
  FROM   variable_payout_batches
  WHERE  id = p_batch_id AND tenant_id = p_tenant_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'NOT_FOUND: Variable pay batch not found';
  END IF;
  IF v_batch.status <> 'approved' THEN
    RAISE EXCEPTION 'ALREADY_DECIDED: This batch is no longer in approved status (current: %)', v_batch.status;
  END IF;
  IF v_batch.processed_payroll_run_id IS NOT NULL THEN
    RAISE EXCEPTION 'ALREADY_ASSIGNED: This batch is already assigned to a payroll run';
  END IF;

  SELECT id, status, month INTO v_run
  FROM payroll_runs
  WHERE id = p_payroll_run_id AND tenant_id = p_tenant_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'RUN_NOT_FOUND: Payroll run not found';
  END IF;
  IF v_run.status NOT IN ('draft', 'partial_failed') THEN
    RAISE EXCEPTION 'RUN_NOT_DRAFT: Payroll run is % — pick a draft run', v_run.status;
  END IF;
  IF v_run.month <> v_batch.payout_month THEN
    RAISE EXCEPTION 'MONTH_MISMATCH: This batch is scheduled for % but the chosen run is for % — pick a run for the batch''s own payout month', v_batch.payout_month, v_run.month;
  END IF;

  UPDATE variable_payout_batches
  SET    processed_payroll_run_id = p_payroll_run_id
  WHERE  id = p_batch_id AND tenant_id = p_tenant_id AND status = 'approved' AND processed_payroll_run_id IS NULL;

  UPDATE variable_payouts
  SET    payroll_run_id = p_payroll_run_id
  WHERE  batch_id = p_batch_id AND tenant_id = p_tenant_id AND status = 'approved' AND payroll_run_id IS NULL;
  GET DIAGNOSTICS v_count = ROW_COUNT;

  RETURN jsonb_build_object('batch_id', v_batch.id, 'status', 'approved', 'payroll_run_id', p_payroll_run_id, 'payouts_assigned', v_count,
    'note', 'Assigned, not yet paid — re-run (or run) payroll for this month so the payslips reflect it, then finalize to mark processed.');
END;
$$;

ALTER FUNCTION assign_variable_pay_batch_to_run_atomic(UUID, UUID, UUID) SET search_path = public;
REVOKE EXECUTE ON FUNCTION assign_variable_pay_batch_to_run_atomic(UUID, UUID, UUID) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION assign_variable_pay_batch_to_run_atomic(UUID, UUID, UUID) TO service_role;

-- ─────────────────────────────────────────────────────────────────────────────
-- fn_finalize_variable_pay_for_run — called by POST /payroll/runs/:id/finalize
-- AFTER slips are confirmed finalized.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION fn_finalize_variable_pay_for_run(
  p_tenant_id UUID,
  p_run_id    UUID
) RETURNS INT
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_count INT;
BEGIN
  UPDATE variable_payouts
  SET    status = 'processed'
  WHERE  tenant_id = p_tenant_id AND payroll_run_id = p_run_id AND status = 'approved';
  GET DIAGNOSTICS v_count = ROW_COUNT;

  UPDATE variable_payout_batches
  SET    status = 'processed', updated_at = now()
  WHERE  tenant_id = p_tenant_id AND processed_payroll_run_id = p_run_id AND status = 'approved';

  RETURN v_count;
END;
$$;

ALTER FUNCTION fn_finalize_variable_pay_for_run(UUID, UUID) SET search_path = public;
REVOKE EXECUTE ON FUNCTION fn_finalize_variable_pay_for_run(UUID, UUID) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION fn_finalize_variable_pay_for_run(UUID, UUID) TO service_role;

-- ─────────────────────────────────────────────────────────────────────────────
-- fn_revert_variable_pay_for_rollback — called by POST /payroll/runs/:id/rollback
-- (folded into rollback_payroll_run_atomic below), AFTER the run is reset
-- to draft and its slips deleted. payroll_run_id is intentionally NOT
-- cleared — still assigned to this run, the next regeneration picks it up
-- again, exactly like leave encashment's own revert.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION fn_revert_variable_pay_for_rollback(
  p_tenant_id UUID,
  p_run_id    UUID
) RETURNS INT
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_count INT;
BEGIN
  UPDATE variable_payouts
  SET    status = 'approved'
  WHERE  tenant_id = p_tenant_id AND payroll_run_id = p_run_id AND status = 'processed';
  GET DIAGNOSTICS v_count = ROW_COUNT;

  UPDATE variable_payout_batches
  SET    status = 'approved', updated_at = now()
  WHERE  tenant_id = p_tenant_id AND processed_payroll_run_id = p_run_id AND status = 'processed';

  RETURN v_count;
END;
$$;

ALTER FUNCTION fn_revert_variable_pay_for_rollback(UUID, UUID) SET search_path = public;
REVOKE EXECUTE ON FUNCTION fn_revert_variable_pay_for_rollback(UUID, UUID) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION fn_revert_variable_pay_for_rollback(UUID, UUID) TO service_role;
