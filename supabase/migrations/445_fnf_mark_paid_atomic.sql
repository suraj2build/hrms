-- ═══════════════════════════════════════════════════════════════
-- 445 — Atomic, source-validated F&F mark-paid + recovery write-back
--
-- Follow-up to the 442/401f47c7/14c3c221 F&F recovery work. An independent
-- review found two real gaps in PATCH /separation-ff/mark-paid's prior
-- (JS-side, migration-free) implementation:
--
--   1. Not atomic. Status flip → foreclose loans → adjust loan_schedules →
--      recover advance schedules → insert advance_recoveries ledger rows →
--      flip advance_salary_requests were five-plus independent PostgREST
--      round-trips. A crash/timeout partway left the settlement 'paid' with
--      some balances closed and others not — and there was no transactional
--      boundary preventing a normal payroll run from reading/writing the
--      same loan_schedules/advance_recovery_schedules rows mid-reconciliation.
--   2. No source-drift validation. The write-back used whatever
--      employee_loans.outstanding_balance / pending advance schedule totals
--      happened to be AT MARK-PAID TIME, with no check against the amounts
--      HR actually approved (separation_ff_summary.loan_recovery_amount /
--      advance_recovery_amount). A partial loan repayment or asset return
--      landing between approve and mark-paid would silently pay out a
--      different recovery than what was reviewed and signed off, with no
--      signal to HR that anything had changed.
--
-- This function closes both by doing the entire operation as one
-- SECURITY DEFINER transaction: FOR UPDATE locks the settlement row and
-- every source loan/advance/asset row for the duration (so a concurrent
-- payroll run blocks on the same rows until this commits, rather than
-- racing it), validates current source totals against the approved figures
-- within a small rounding tolerance, and raises (aborting the whole
-- transaction — nothing is left half-applied) if they've drifted.
--
-- A drift abort leaves the settlement 'approved' with nothing changed —
-- see migration's companion route change, which also adds
-- PATCH /separation-ff/reopen (approved → draft, HR-admin only) so a
-- drift-blocked settlement isn't a dead end: HR recomputes, reviews the
-- new figures, and re-approves.
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
  v_ff            RECORD;
  v_loan          RECORD;
  v_advance       RECORD;
  v_sched         RECORD;
  v_loan_total    NUMERIC := 0;
  v_advance_total NUMERIC := 0;
  v_asset_total   NUMERIC := 0;
  v_now           TIMESTAMPTZ := now();
BEGIN
  SELECT id, status, loan_recovery_amount, advance_recovery_amount, asset_recovery_amount
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
  -- recovery-schedule update, a concurrent asset return) can change them
  -- out from under the drift check below between validating and writing.
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

  -- All three source totals match what was approved — safe to write back.
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
    'loan_recovery_applied', v_loan_total, 'advance_recovery_applied', v_advance_total
  );
END;
$$;

ALTER FUNCTION mark_fnf_paid_atomic(UUID, UUID, UUID, NUMERIC) SET search_path = public;

REVOKE EXECUTE ON FUNCTION mark_fnf_paid_atomic(UUID, UUID, UUID, NUMERIC)
  FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION mark_fnf_paid_atomic(UUID, UUID, UUID, NUMERIC)
  TO service_role;
