-- SYSTEM_AUDIT_2026-10-14 — payroll_adjustments sibling of migrations
-- 476/477. POST /payroll/adjustments/:id/apply previously flipped status
-- straight to the TERMINAL 'applied' state at apply time, writing nothing
-- into any payslip — the exact "approve and nothing happens" defect this
-- audit disclosed, compounded by the fact that even if something HAD
-- consumed applied_run_id, a regeneration of that still-draft run would
-- have no way to know the adjustment needed re-applying (status was
-- already terminal). Restructured to the same assign/finalize/revert
-- shape as leave encashment (447) and migrations 476/477: apply only
-- ASSIGNS applied_run_id, status stays 'approved'; every (re)generation of
-- that run folds the signed delta into the employee's payslip fresh
-- (fetchAdjustmentPayout/applyAdjustmentPayout, runs.ts); only finalizing
-- that run flips status to 'applied'.

-- ─────────────────────────────────────────────────────────────────────────────
-- assign_payroll_adjustment_to_run_atomic — replaces the direct CAS-to-
-- 'applied' POST /payroll/adjustments/:id/apply used to do. Per-adjustment
-- (not per-batch — payroll_adjustments has no batch grouping), otherwise
-- identical shape to assign_arrears_batch_to_run_atomic /
-- assign_variable_pay_batch_to_run_atomic / assign_leave_encashment_to_
-- payroll_run_atomic.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION assign_payroll_adjustment_to_run_atomic(
  p_tenant_id      UUID,
  p_adjustment_id  UUID,
  p_payroll_run_id UUID,
  p_apply_to_month TEXT,
  p_notes          TEXT
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_adj RECORD;
  v_run RECORD;
BEGIN
  SELECT id, status, applied_run_id, employee_id INTO v_adj
  FROM payroll_adjustments
  WHERE id = p_adjustment_id AND tenant_id = p_tenant_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'NOT_FOUND: Adjustment not found';
  END IF;
  IF v_adj.status <> 'approved' THEN
    RAISE EXCEPTION 'INVALID_STATUS: Only approved adjustments can be applied (current: %)', v_adj.status;
  END IF;
  IF v_adj.applied_run_id IS NOT NULL THEN
    RAISE EXCEPTION 'ALREADY_ASSIGNED: This adjustment is already assigned to a payroll run';
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

  UPDATE payroll_adjustments
  SET    applied_run_id = p_payroll_run_id,
         apply_to_month = COALESCE(p_apply_to_month, v_run.month),
         notes          = COALESCE(p_notes, notes)
  WHERE  id = p_adjustment_id AND tenant_id = p_tenant_id AND status = 'approved' AND applied_run_id IS NULL;

  RETURN jsonb_build_object('id', v_adj.id, 'status', 'approved', 'applied_run_id', p_payroll_run_id,
    'note', 'Assigned, not yet applied — re-run (or run) payroll for this month so the payslip reflects it, then finalize to mark applied.');
END;
$$;

ALTER FUNCTION assign_payroll_adjustment_to_run_atomic(UUID, UUID, UUID, TEXT, TEXT) SET search_path = public;
REVOKE EXECUTE ON FUNCTION assign_payroll_adjustment_to_run_atomic(UUID, UUID, UUID, TEXT, TEXT) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION assign_payroll_adjustment_to_run_atomic(UUID, UUID, UUID, TEXT, TEXT) TO service_role;

-- ─────────────────────────────────────────────────────────────────────────────
-- fn_finalize_payroll_adjustments_for_run / fn_revert_payroll_adjustments_
-- for_rollback — mirror the encashment/arrears/variable-pay siblings.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION fn_finalize_payroll_adjustments_for_run(
  p_tenant_id UUID,
  p_run_id    UUID
) RETURNS INT
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_count INT;
BEGIN
  UPDATE payroll_adjustments
  SET    status = 'applied', applied_at = now()
  WHERE  tenant_id = p_tenant_id AND applied_run_id = p_run_id AND status = 'approved';
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;

ALTER FUNCTION fn_finalize_payroll_adjustments_for_run(UUID, UUID) SET search_path = public;
REVOKE EXECUTE ON FUNCTION fn_finalize_payroll_adjustments_for_run(UUID, UUID) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION fn_finalize_payroll_adjustments_for_run(UUID, UUID) TO service_role;

CREATE OR REPLACE FUNCTION fn_revert_payroll_adjustments_for_rollback(
  p_tenant_id UUID,
  p_run_id    UUID
) RETURNS INT
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_count INT;
BEGIN
  UPDATE payroll_adjustments
  SET    status = 'approved', applied_at = NULL
  WHERE  tenant_id = p_tenant_id AND applied_run_id = p_run_id AND status = 'applied';
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;

ALTER FUNCTION fn_revert_payroll_adjustments_for_rollback(UUID, UUID) SET search_path = public;
REVOKE EXECUTE ON FUNCTION fn_revert_payroll_adjustments_for_rollback(UUID, UUID) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION fn_revert_payroll_adjustments_for_rollback(UUID, UUID) TO service_role;
