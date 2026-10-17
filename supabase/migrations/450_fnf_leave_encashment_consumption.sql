-- ═══════════════════════════════════════════════════════════════
-- 450 — F&F leave-encashment payment must CONSUME the balance, not just
-- check it for drift
--
-- A review found that migration 448's SOURCE_DRIFT check, while real and
-- correctly closing the approve→mark-paid race, only protects against a
-- balance change that happened BEFORE this payment. It does nothing to
-- stop a balance consumption AFTER this payment succeeds: mark_fnf_paid_
-- atomic reads and validates employee_leave_balance but never writes to
-- it. After F&F pays an employee for N days of accumulated leave, their
-- employee_leave_balance row still shows the full, un-consumed N days.
--
-- Confirmed exploitable, not theoretical: standalone leave encashment
-- (accrual-engine.ts's processEncashment) deducts the balance at ITS OWN
-- approval time via checked_deduct_leave_balance — a plain balance check,
-- with no knowledge of F&F or separation status at all. There is no
-- employment-status guard anywhere on POST /leave/encashment/:id/approve.
-- So: an employee submits a standalone encashment request while still
-- active (pending, balance untouched) → resigns → F&F is computed and
-- paid out for those same leave days (balance still shows them available,
-- since F&F never consumed it) → HR later approves the old pending
-- standalone request → checked_deduct_leave_balance succeeds because the
-- balance was never reduced by the F&F payment → the same days are paid
-- out twice, through two completely different code paths, with no drift
-- check anywhere catching it (there's nothing to "drift" against — the
-- balance genuinely never changed between F&F's compute and its payment;
-- the double-pay happens strictly AFTER F&F already paid).
--
-- Fix: once mark_fnf_paid_atomic's existing drift checks pass (nothing
-- changed underneath this payment), it now ALSO consumes
-- (decrements) the exact employee_leave_balance rows named in
-- leave_encashment_basis by leave_encashment_days, inside the SAME
-- transaction and under the SAME FOR UPDATE locks migration 448 already
-- takes on those rows. A greedy per-row consumption (locked rows, visited
-- in a deterministic order) handles the case where more than one
-- encashable leave type contributed to the total. A
-- leave_balance_ledger row is written for audit, mirroring the existing
-- pattern reverse_leave_encashment_atomic already uses.
--
-- This is what makes "successful payment" actually equivalent to
-- "entitlement spent": the SAME row-level FOR UPDATE lock that serializes
-- this transaction against a concurrent standalone-encashment approval's
-- own update to employee_leave_balance now also means that if the
-- standalone approval's UPDATE/RPC call starts AFTER this transaction
-- commits, it sees the POST-consumption (reduced or zero) balance and is
-- naturally blocked by checked_deduct_leave_balance's own existing
-- `WHERE balance >= p_days` guard — no new check needed on that side.
-- ═══════════════════════════════════════════════════════════════

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
  v_ff               RECORD;
  v_loan             RECORD;
  v_advance          RECORD;
  v_sched            RECORD;
  v_elb              RECORD;
  v_loan_total       NUMERIC := 0;
  v_advance_total    NUMERIC := 0;
  v_asset_total      NUMERIC := 0;
  v_leave_days       NUMERIC := 0;
  v_basis_count      INT := 0;
  v_remaining_days   NUMERIC := 0;
  v_consume_here     NUMERIC;
  v_now              TIMESTAMPTZ := now();
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
  -- only when there's actually an encashment amount to protect. Locked
  -- here (FOR UPDATE OF elb) BEFORE the drift check, and that same lock is
  -- what this migration's consumption step below relies on being held
  -- continuously through to the write-back — nothing releases it in
  -- between.
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

  -- Consume the leave-encashment entitlement now that payment is confirmed
  -- safe (migration 450) — greedy, deterministic order across the locked
  -- basis rows. This is what makes a SECOND attempt to pay for the same
  -- days (concurrent or sequential, via F&F or via standalone encashment)
  -- see a reduced/zero balance instead of the same untouched one.
  IF COALESCE(v_ff.leave_encashment_days, 0) > p_tolerance AND v_basis_count > 0 THEN
    v_remaining_days := v_ff.leave_encashment_days;
    FOR v_elb IN
      SELECT elb.id, elb.leave_type_id, elb.year, elb.balance
      FROM employee_leave_balance elb
      JOIN jsonb_to_recordset(v_ff.leave_encashment_basis) AS basis(leave_type_id UUID, year INT)
        ON elb.leave_type_id = basis.leave_type_id AND elb.year = basis.year
      WHERE elb.employee_id = p_employee_id AND elb.tenant_id = p_tenant_id
      ORDER BY elb.leave_type_id
    LOOP
      EXIT WHEN v_remaining_days <= p_tolerance;
      v_consume_here := LEAST(GREATEST(v_elb.balance, 0), v_remaining_days);
      IF v_consume_here > 0 THEN
        UPDATE employee_leave_balance
        SET    balance = balance - v_consume_here, updated_at = v_now
        WHERE  id = v_elb.id AND tenant_id = p_tenant_id;

        INSERT INTO leave_balance_ledger (
          tenant_id, employee_id, leave_type_id, year, txn_type,
          delta, balance_after, notes, created_by
        ) VALUES (
          p_tenant_id, p_employee_id, v_elb.leave_type_id, v_elb.year, 'encashment',
          -v_consume_here, v_elb.balance - v_consume_here,
          'F&F settlement leave encashment payout (separation_ff_summary.id=' || v_ff.id || ')',
          p_user_id
        );

        v_remaining_days := v_remaining_days - v_consume_here;
      END IF;
    END LOOP;
  END IF;

  UPDATE separation_ff_summary
  SET    status = 'paid', paid_by = p_user_id, paid_at = v_now,
         updated_by = p_user_id, updated_at = v_now
  WHERE  id = v_ff.id AND tenant_id = p_tenant_id;

  RETURN jsonb_build_object(
    'id', v_ff.id, 'status', 'paid', 'paid_at', v_now,
    'loan_recovery_applied', v_loan_total, 'advance_recovery_applied', v_advance_total,
    'leave_encashment_days_verified', v_leave_days,
    'leave_encashment_days_consumed', COALESCE(v_ff.leave_encashment_days, 0)
  );
END;
$$;

ALTER FUNCTION mark_fnf_paid_atomic(UUID, UUID, UUID, NUMERIC) SET search_path = public;

REVOKE EXECUTE ON FUNCTION mark_fnf_paid_atomic(UUID, UUID, UUID, NUMERIC)
  FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION mark_fnf_paid_atomic(UUID, UUID, UUID, NUMERIC)
  TO service_role;
