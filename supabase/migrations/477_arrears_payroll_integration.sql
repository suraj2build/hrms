-- SYSTEM_AUDIT_2026-10-14 — arrears sibling of migration 476's variable-pay
-- integration. arrear_payouts (migration 103) already existed —
-- "per-employee payout line within a batch... can be split across payout
-- months if needed" — with its own payroll_run_id/status columns, but
-- nothing anywhere ever inserted into it: the whole table was dead
-- plumbing. This migration starts using it as the per-employee disbursement
-- line the payroll engine actually reads (apps/api/src/routes/payroll/
-- runs.ts's fetchArrearsPayout), generated when a batch is approved, with
-- the same assign/finalize/revert shape as migration 476/447.

-- ─────────────────────────────────────────────────────────────────────────────
-- approve_arrears_batch_atomic — replaces the plain status-CAS the route
-- used to do directly. Requires an explicit target payout_month (the
-- "explicit target payroll period" this whole integration is about) —
-- arrear_batches.payout_month was nullable and optional at creation, so a
-- batch could previously reach 'approved' with no disbursement month at
-- all. p_payout_month lets the approve call supply one if the batch
-- doesn't already have one; if neither is set, this raises rather than
-- silently leaving the batch unpayable.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION approve_arrears_batch_atomic(
  p_tenant_id    UUID,
  p_batch_id     UUID,
  p_actor_id     UUID,
  p_payout_month TEXT DEFAULT NULL
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_batch RECORD;
  v_month TEXT;
  v_count INT;
BEGIN
  SELECT id, status, payout_month INTO v_batch
  FROM arrear_batches
  WHERE id = p_batch_id AND tenant_id = p_tenant_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'NOT_FOUND: Arrear batch not found';
  END IF;
  IF v_batch.status <> 'calculated' THEN
    RAISE EXCEPTION 'INVALID_STATUS: Only calculated batches can be approved (current: %)', v_batch.status;
  END IF;

  v_month := COALESCE(p_payout_month, v_batch.payout_month);
  IF v_month IS NULL THEN
    RAISE EXCEPTION 'NO_PAYOUT_MONTH: This batch has no payout_month set — supply one when approving so the batch has an explicit target payroll period';
  END IF;

  UPDATE arrear_batches
  SET    status = 'approved', approved_by = p_actor_id, approved_at = now(),
         payout_month = v_month, updated_at = now()
  WHERE  id = p_batch_id AND tenant_id = p_tenant_id AND status = 'calculated';

  -- One payout line per arrear record, generated once at approval — a
  -- re-approval can't happen (status is no longer 'calculated' after this),
  -- so there is no double-generation path to guard against here.
  INSERT INTO arrear_payouts (tenant_id, batch_id, record_id, employee_id, payout_month, amount, status)
  SELECT tenant_id, batch_id, id, employee_id, v_month, arrear_amount, 'pending'
  FROM arrear_records
  WHERE batch_id = p_batch_id AND tenant_id = p_tenant_id;
  GET DIAGNOSTICS v_count = ROW_COUNT;

  RETURN jsonb_build_object('batch_id', p_batch_id, 'status', 'approved', 'payout_month', v_month, 'payouts_created', v_count);
END;
$$;

ALTER FUNCTION approve_arrears_batch_atomic(UUID, UUID, UUID, TEXT) SET search_path = public;
REVOKE EXECUTE ON FUNCTION approve_arrears_batch_atomic(UUID, UUID, UUID, TEXT) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION approve_arrears_batch_atomic(UUID, UUID, UUID, TEXT) TO service_role;

-- ─────────────────────────────────────────────────────────────────────────────
-- assign_arrears_batch_to_run_atomic — HR picks a draft run for an
-- APPROVED batch. Mirrors assign_variable_pay_batch_to_run_atomic exactly.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION assign_arrears_batch_to_run_atomic(
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
  FROM   arrear_batches
  WHERE  id = p_batch_id AND tenant_id = p_tenant_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'NOT_FOUND: Arrear batch not found';
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

  UPDATE arrear_batches
  SET    processed_payroll_run_id = p_payroll_run_id
  WHERE  id = p_batch_id AND tenant_id = p_tenant_id AND status = 'approved' AND processed_payroll_run_id IS NULL;

  UPDATE arrear_payouts
  SET    payroll_run_id = p_payroll_run_id
  WHERE  batch_id = p_batch_id AND tenant_id = p_tenant_id AND status = 'pending' AND payroll_run_id IS NULL;
  GET DIAGNOSTICS v_count = ROW_COUNT;

  RETURN jsonb_build_object('batch_id', v_batch.id, 'status', 'approved', 'payroll_run_id', p_payroll_run_id, 'payouts_assigned', v_count,
    'note', 'Assigned, not yet paid — re-run (or run) payroll for this month so the payslips reflect it, then finalize to mark processed.');
END;
$$;

ALTER FUNCTION assign_arrears_batch_to_run_atomic(UUID, UUID, UUID) SET search_path = public;
REVOKE EXECUTE ON FUNCTION assign_arrears_batch_to_run_atomic(UUID, UUID, UUID) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION assign_arrears_batch_to_run_atomic(UUID, UUID, UUID) TO service_role;

-- ─────────────────────────────────────────────────────────────────────────────
-- fn_finalize_arrears_for_run / fn_revert_arrears_for_rollback — mirror the
-- variable-pay siblings in migration 476 exactly.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION fn_finalize_arrears_for_run(
  p_tenant_id UUID,
  p_run_id    UUID
) RETURNS INT
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_count INT;
BEGIN
  UPDATE arrear_payouts
  SET    status = 'processed'
  WHERE  tenant_id = p_tenant_id AND payroll_run_id = p_run_id AND status = 'pending';
  GET DIAGNOSTICS v_count = ROW_COUNT;

  UPDATE arrear_batches
  SET    status = 'processed', updated_at = now()
  WHERE  tenant_id = p_tenant_id AND processed_payroll_run_id = p_run_id AND status = 'approved';

  RETURN v_count;
END;
$$;

ALTER FUNCTION fn_finalize_arrears_for_run(UUID, UUID) SET search_path = public;
REVOKE EXECUTE ON FUNCTION fn_finalize_arrears_for_run(UUID, UUID) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION fn_finalize_arrears_for_run(UUID, UUID) TO service_role;

CREATE OR REPLACE FUNCTION fn_revert_arrears_for_rollback(
  p_tenant_id UUID,
  p_run_id    UUID
) RETURNS INT
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_count INT;
BEGIN
  UPDATE arrear_payouts
  SET    status = 'pending'
  WHERE  tenant_id = p_tenant_id AND payroll_run_id = p_run_id AND status = 'processed';
  GET DIAGNOSTICS v_count = ROW_COUNT;

  UPDATE arrear_batches
  SET    status = 'approved', updated_at = now()
  WHERE  tenant_id = p_tenant_id AND processed_payroll_run_id = p_run_id AND status = 'processed';

  RETURN v_count;
END;
$$;

ALTER FUNCTION fn_revert_arrears_for_rollback(UUID, UUID) SET search_path = public;
REVOKE EXECUTE ON FUNCTION fn_revert_arrears_for_rollback(UUID, UUID) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION fn_revert_arrears_for_rollback(UUID, UUID) TO service_role;
