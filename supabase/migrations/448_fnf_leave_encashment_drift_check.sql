-- ═══════════════════════════════════════════════════════════════
-- 448 — F&F-vs-standalone-encashment concurrency: close the approve→mark-paid
-- window
--
-- A review found that mark_fnf_paid_atomic (445) validates loan/advance/
-- asset totals for drift (its SOURCE_DRIFT check) but has no equivalent
-- check for leave-encashment-balance drift. Re-reading the approve route
-- (PATCH /employees/:id/separation-ff/approve, separation-workflow.ts)
-- found the compute→approve window is ALREADY closed: its staleness check
-- recomputes leave_encashment_amount fresh and raises STALE_CALCULATION if
-- it differs from what's stored — a standalone-encashment approval landing
-- between compute and approve is caught there. The genuinely unclosed
-- window is approve→mark-paid: a standalone-encashment approval landing
-- AFTER F&F approval but BEFORE F&F mark-paid could let F&F pay out
-- against a balance that's since been (partly) consumed, with nothing
-- re-checking it at mark-paid time — the same class of gap migration 445
-- already closed for loans/advances/assets, just not for leave encashment.
--
-- Fix: computeFnfSettlement (fnf-settlement-engine.ts) now returns the
-- exact (leave_type_id, year) pairs it read employee_leave_balance for —
-- stored verbatim on separation_ff_summary.leave_encashment_basis by
-- POST /separation-ff/compute. mark_fnf_paid_atomic re-sums
-- employee_leave_balance for EXACTLY those rows (FOR UPDATE, so a
-- concurrent standalone-encashment approval blocks on the same rows until
-- this commits, mirroring the loan/advance/asset locks already taken) and
-- raises SOURCE_DRIFT if the current total differs from what was approved.
-- This avoids re-deriving "which leave types are encashable" and "which
-- leave year applies" in SQL — a second implementation of business rules
-- that already live in fnf-settlement-engine.ts/leave-entitlement-
-- service.ts, which would drift from them over time.
--
-- A settlement with leave_encashment_days <= 0 skips the check — nothing to
-- drift. A settlement with days > 0 but no stored basis (predates this
-- migration, or was entered manually via POST /separation-ff without ever
-- calling /compute — the same case the approve staleness check already
-- exempts via computed_at IS NULL) raises LEAVE_BASIS_MISSING rather than
-- silently skipping the check or guessing at a basis: HR must recompute
-- (establishing a basis) before this settlement can verify itself at
-- mark-paid time.
-- ═══════════════════════════════════════════════════════════════

ALTER TABLE separation_ff_summary
  ADD COLUMN IF NOT EXISTS leave_encashment_basis JSONB;

COMMENT ON COLUMN separation_ff_summary.leave_encashment_basis IS
  'Exact [{leave_type_id, year}, ...] rows computeFnfSettlement read employee_leave_balance for when leave_encashment_amount/days were last computed. NULL means never computed via POST /separation-ff/compute (manual entry) or predates migration 448. Empty array [] means verified zero encashable leave types. Used by mark_fnf_paid_atomic to re-validate against concurrent balance drift.';

CREATE OR REPLACE FUNCTION mark_fnf_paid_atomic(
  p_tenant_id   UUID,
  p_employee_id UUID,
  p_user_id     UUID,
  p_tolerance   NUMERIC DEFAULT 0.01
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_ff            RECORD;
  v_loan          RECORD;
  v_advance       RECORD;
  v_sched         RECORD;
  v_loan_total    NUMERIC := 0;
  v_advance_total NUMERIC := 0;
  v_asset_total   NUMERIC := 0;
  v_leave_days    NUMERIC := 0;
  v_basis_count   INT := 0;
  v_now           TIMESTAMPTZ := now();
BEGIN
  SELECT id, status, loan_recovery_amount, advance_recovery_amount, asset_recovery_amount,
         leave_encashment_days, leave_encashment_basis
  INTO   v_ff
  FROM   separation_ff_summary
  WHERE  employee_id = p_employee_id AND tenant_id = p_tenant_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'NOT_FOUND: F&F record not found';
  END IF;

  IF v_ff.status = 'draft' THEN
    RAISE EXCEPTION 'INVALID_STATE: Cannot mark as paid: F&F must be approved first (current: ''draft'')';
  ELSIF v_ff.status <> 'approved' THEN
    RAISE EXCEPTION 'ALREADY_DECIDED: This F&F settlement is no longer in approved status (current: %)', v_ff.status;
  END IF;

  -- Lock every source row this transaction's validation and write-back
  -- depend on, up front, so nothing (a concurrent payroll run's own EMI/
  -- recovery-schedule update, a concurrent asset return, a concurrent
  -- standalone-encashment approval) can change them out from under the
  -- drift check below between validating and writing.
  PERFORM 1 FROM employee_loans
    WHERE employee_id = p_employee_id AND tenant_id = p_tenant_id AND status IN ('disbursed', 'active')
    FOR UPDATE;
  PERFORM 1 FROM loan_schedules ls
    JOIN employee_loans el ON el.id = ls.loan_id
    WHERE el.employee_id = p_employee_id AND el.tenant_id = p_tenant_id AND ls.tenant_id = p_tenant_id
      AND el.status IN ('disbursed', 'active') AND ls.status = 'pending'
    FOR UPDATE OF ls;
  PERFORM 1 FROM advance_salary_requests
    WHERE employee_id = p_employee_id AND tenant_id = p_tenant_id AND status IN ('disbursed', 'recovering')
    FOR UPDATE;
  PERFORM 1 FROM advance_recovery_schedules ars
    JOIN advance_salary_requests asr ON asr.id = ars.advance_id
    WHERE asr.employee_id = p_employee_id AND asr.tenant_id = p_tenant_id AND ars.tenant_id = p_tenant_id
      AND asr.status IN ('disbursed', 'recovering') AND ars.status = 'pending'
    FOR UPDATE OF ars;
  PERFORM 1 FROM assets
    WHERE assigned_to = p_employee_id AND tenant_id = p_tenant_id AND status = 'assigned'
    FOR UPDATE;

  -- Leave-balance rows named by the exact basis captured at compute time —
  -- only when there's actually an encashment amount to protect.
  IF COALESCE(v_ff.leave_encashment_days, 0) > p_tolerance THEN
    IF v_ff.leave_encashment_basis IS NULL THEN
      RAISE EXCEPTION 'LEAVE_BASIS_MISSING: This settlement has a leave encashment amount but no recorded basis to verify it against (predates this check, or was entered manually without running Compute). Recompute via POST /separation-ff/compute, review, and re-approve before marking as paid.';
    END IF;

    SELECT count(*) INTO v_basis_count FROM jsonb_array_elements(v_ff.leave_encashment_basis);

    IF v_basis_count > 0 THEN
      PERFORM 1 FROM employee_leave_balance elb
        JOIN jsonb_to_recordset(v_ff.leave_encashment_basis) AS basis(leave_type_id UUID, year INT)
          ON elb.leave_type_id = basis.leave_type_id AND elb.year = basis.year
      WHERE elb.employee_id = p_employee_id AND elb.tenant_id = p_tenant_id
      FOR UPDATE OF elb;

      SELECT COALESCE(SUM(GREATEST(elb.balance, 0)), 0) INTO v_leave_days
      FROM employee_leave_balance elb
      JOIN jsonb_to_recordset(v_ff.leave_encashment_basis) AS basis(leave_type_id UUID, year INT)
        ON elb.leave_type_id = basis.leave_type_id AND elb.year = basis.year
      WHERE elb.employee_id = p_employee_id AND elb.tenant_id = p_tenant_id;
    ELSE
      v_leave_days := 0;
    END IF;

    IF ABS(v_leave_days - COALESCE(v_ff.leave_encashment_days, 0)) > p_tolerance THEN
      RAISE EXCEPTION 'SOURCE_DRIFT: Leave encashment balance has changed since this settlement was approved (approved % days, current % days — likely a standalone encashment request approved in between). Reopen, recompute and re-approve before marking as paid.',
        COALESCE(v_ff.leave_encashment_days, 0), v_leave_days;
    END IF;
  END IF;

  SELECT COALESCE(SUM(outstanding_balance), 0) INTO v_loan_total
  FROM employee_loans
  WHERE employee_id = p_employee_id AND tenant_id = p_tenant_id AND status IN ('disbursed', 'active');

  SELECT COALESCE(SUM(ars.scheduled_amount), 0) INTO v_advance_total
  FROM advance_recovery_schedules ars
  JOIN advance_salary_requests asr ON asr.id = ars.advance_id
  WHERE asr.employee_id = p_employee_id AND asr.tenant_id = p_tenant_id AND ars.tenant_id = p_tenant_id
    AND asr.status IN ('disbursed', 'recovering') AND ars.status = 'pending';

  SELECT COALESCE(SUM(purchase_cost), 0) INTO v_asset_total
  FROM assets
  WHERE assigned_to = p_employee_id AND tenant_id = p_tenant_id AND status = 'assigned';

  IF ABS(v_loan_total - COALESCE(v_ff.loan_recovery_amount, 0)) > p_tolerance THEN
    RAISE EXCEPTION 'SOURCE_DRIFT: Outstanding loan balance has changed since this settlement was approved (approved %, current %). Reopen, recompute and re-approve before marking as paid.',
      COALESCE(v_ff.loan_recovery_amount, 0), v_loan_total;
  END IF;

  IF ABS(v_advance_total - COALESCE(v_ff.advance_recovery_amount, 0)) > p_tolerance THEN
    RAISE EXCEPTION 'SOURCE_DRIFT: Outstanding advance recovery schedule has changed since this settlement was approved (approved %, current %). Reopen, recompute and re-approve before marking as paid.',
      COALESCE(v_ff.advance_recovery_amount, 0), v_advance_total;
  END IF;

  IF ABS(v_asset_total - COALESCE(v_ff.asset_recovery_amount, 0)) > p_tolerance THEN
    RAISE EXCEPTION 'SOURCE_DRIFT: Outstanding asset recovery value has changed since this settlement was approved (approved %, current %). Reopen, recompute and re-approve before marking as paid.',
      COALESCE(v_ff.asset_recovery_amount, 0), v_asset_total;
  END IF;

  -- All source totals match what was approved — safe to write back.
  FOR v_loan IN
    SELECT id, outstanding_balance FROM employee_loans
    WHERE employee_id = p_employee_id AND tenant_id = p_tenant_id AND status IN ('disbursed', 'active')
  LOOP
    UPDATE employee_loans
    SET    status = 'foreclosed', foreclosed_at = v_now,
           foreclosure_amount = v_loan.outstanding_balance,
           foreclosure_notes = 'Auto-foreclosed on F&F settlement payment',
           outstanding_balance = 0, updated_at = v_now
    WHERE  id = v_loan.id AND tenant_id = p_tenant_id;

    UPDATE loan_schedules
    SET    status = 'adjusted'
    WHERE  loan_id = v_loan.id AND tenant_id = p_tenant_id AND status = 'pending';
  END LOOP;

  FOR v_advance IN
    SELECT id FROM advance_salary_requests
    WHERE employee_id = p_employee_id AND tenant_id = p_tenant_id AND status IN ('disbursed', 'recovering')
  LOOP
    FOR v_sched IN
      SELECT id, recovery_month, scheduled_amount FROM advance_recovery_schedules
      WHERE advance_id = v_advance.id AND tenant_id = p_tenant_id AND status = 'pending'
    LOOP
      UPDATE advance_recovery_schedules
      SET    status = 'recovered', recovered_at = v_now
      WHERE  id = v_sched.id AND tenant_id = p_tenant_id;

      INSERT INTO advance_recoveries (
        tenant_id, advance_id, schedule_id, employee_id,
        recovery_month, amount, recovery_type, notes, created_by
      ) VALUES (
        p_tenant_id, v_advance.id, v_sched.id, p_employee_id,
        COALESCE(v_sched.recovery_month, to_char(v_now, 'YYYY-MM')), v_sched.scheduled_amount,
        'adjustment', 'Auto-recovered on F&F settlement payment', p_user_id
      );
    END LOOP;

    UPDATE advance_salary_requests
    SET    status = 'fully_recovered', updated_at = v_now
    WHERE  id = v_advance.id AND tenant_id = p_tenant_id AND status IN ('disbursed', 'recovering');
  END LOOP;

  UPDATE separation_ff_summary
  SET    status = 'paid', paid_by = p_user_id, paid_at = v_now,
         updated_by = p_user_id, updated_at = v_now
  WHERE  id = v_ff.id AND tenant_id = p_tenant_id;

  RETURN jsonb_build_object(
    'id', v_ff.id, 'status', 'paid', 'paid_at', v_now,
    'loan_recovery_applied', v_loan_total, 'advance_recovery_applied', v_advance_total,
    'leave_encashment_days_verified', v_leave_days
  );
END;
$$;

ALTER FUNCTION mark_fnf_paid_atomic(UUID, UUID, UUID, NUMERIC) SET search_path = public;

REVOKE EXECUTE ON FUNCTION mark_fnf_paid_atomic(UUID, UUID, UUID, NUMERIC)
  FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION mark_fnf_paid_atomic(UUID, UUID, UUID, NUMERIC)
  TO service_role;
