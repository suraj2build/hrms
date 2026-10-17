-- SYSTEM_AUDIT_2026-10-14 checkpoint 17 — payroll audit, loans.ts.
--
-- POST /payroll/loans/record-payment (the manual, HR-admin-triggered loan
-- payment recorder — distinct from the automatic payroll-finalize sweep in
-- runs.ts, which never inserts into loan_payments at all) had the same bug
-- class just found and fixed in advances.ts's /recover:
--
-- 1. loan_payments.payment_month is NOT NULL with no default, but the
--    route's zod schema never accepted it and the INSERT never supplied
--    it — every real call to this endpoint failed with a guaranteed
--    Postgres NOT NULL violation. The endpoint was unconditionally broken
--    for its one real job.
-- 2. Even once that insert succeeds, the 3-step sequence (insert
--    loan_payments -> separately CAS loan_schedules to 'paid' -> separately
--    call record_loan_payment_atomic for outstanding_balance) has no
--    idempotency guard on the insert itself. Unlike loan_schedules' own CAS
--    (which correctly no-ops on a second call once the schedule already
--    reads 'paid'), nothing stops a retry — after a transient failure in
--    step 2 or step 3 — from inserting a SECOND loan_payments row for the
--    same schedule and applying a SECOND outstanding_balance deduction.
--    Both partial-failure paths were already disclosed via req.log.error
--    ("payment row was inserted but schedule/balance was NOT updated") but
--    never fixed — exactly the "retry can duplicate effects" risk the
--    audit's standing instruction requires closing, not merely logging.
--
-- Fixed by fusing insert + schedule CAS + balance update into one atomic
-- transaction. When schedule_id is supplied, the schedule's CAS to 'paid'
-- is the idempotency gate: a schedule that is no longer 'pending' raises
-- ALREADY_PAID and nothing else is written — no duplicate payment row, no
-- double balance deduction, safe to retry. Ad-hoc payments (no schedule_id
-- — a manual/prepayment/foreclosure top-up not tied to one installment)
-- have no natural dedup key, matching the pre-existing ad-hoc-recovery case
-- in record_advance_recovery_atomic (migration 472).

CREATE OR REPLACE FUNCTION record_loan_payment_manual_atomic(
  p_tenant_id      UUID,
  p_loan_id        UUID,
  p_schedule_id    UUID,
  p_payroll_run_id UUID,
  p_amount         NUMERIC,
  p_principal_paid NUMERIC,
  p_interest_paid  NUMERIC,
  p_payment_type   TEXT,
  p_notes          TEXT,
  p_actor_id       UUID
) RETURNS JSONB
LANGUAGE plpgsql
AS $$
DECLARE
  v_loan           RECORD;
  v_payment_month  TEXT;
  v_payment_id     UUID;
  v_loan_after      RECORD;
BEGIN
  SELECT employee_id INTO v_loan
  FROM employee_loans
  WHERE id = p_loan_id AND tenant_id = p_tenant_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'NOT_FOUND: Loan not found';
  END IF;

  IF p_schedule_id IS NOT NULL THEN
    UPDATE loan_schedules
    SET status = 'paid', paid_amount = p_amount, paid_at = now(),
        payroll_run_id = COALESCE(p_payroll_run_id, payroll_run_id)
    WHERE id = p_schedule_id AND tenant_id = p_tenant_id
      AND loan_id = p_loan_id AND status = 'pending'
    RETURNING due_month INTO v_payment_month;

    IF v_payment_month IS NULL THEN
      RAISE EXCEPTION 'ALREADY_PAID: This installment has already been recorded as paid';
    END IF;
  ELSE
    -- Ad-hoc payment not tied to a specific installment (e.g. a manual
    -- top-up or foreclosure payment) — recorded against the current
    -- calendar month, matching the schedule-driven case's own
    -- payment_month semantics (a YYYY-MM string).
    v_payment_month := to_char(now(), 'YYYY-MM');
  END IF;

  INSERT INTO loan_payments (
    tenant_id, loan_id, schedule_id, employee_id, payroll_run_id,
    payment_month, amount, principal_paid, interest_paid, payment_type,
    notes, created_by
  ) VALUES (
    p_tenant_id, p_loan_id, p_schedule_id, v_loan.employee_id, p_payroll_run_id,
    v_payment_month, p_amount, p_principal_paid, p_interest_paid, p_payment_type,
    p_notes, p_actor_id
  )
  RETURNING id INTO v_payment_id;

  SELECT outstanding_balance, status INTO v_loan_after
  FROM record_loan_payment_atomic(p_tenant_id, p_loan_id, p_principal_paid);

  RETURN jsonb_build_object(
    'payment_id', v_payment_id,
    'payment_month', v_payment_month,
    'outstanding_balance', v_loan_after.outstanding_balance,
    'loan_status', v_loan_after.status
  );
END;
$$;
