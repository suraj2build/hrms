-- SYSTEM_AUDIT_2026-10-14 — found while verifying the repaired
-- record_loan_payment_atomic (migration 474) through an actual payroll
-- finalize with an injected failure, per explicit instruction: "A failed
-- recovery must not be silently treated as completed."
--
-- runs.ts's finalize route marked a loan EMI's loan_schedules row 'paid'
-- in one bulk statement, then SEPARATELY (a different query, a different
-- round trip) called record_loan_payment_atomic to decrement the loan's
-- outstanding_balance, marking paid_amount only on success. This was
-- designed to be retry-safe (paid_amount IS NULL is the "balance not yet
-- applied" signal) -- but nothing ever retries it: the sweep that reads
-- that signal is scoped to THIS run's id and month, which is fixed
-- forever once finalized, and the existing manual recovery endpoint
-- (POST /payroll/loans/record-payment, checkpoint 17) requires
-- status='pending' to act, which a 'paid' row no longer satisfies either.
-- A real injected-failure test
-- (scripts/db/verify-loan-finalize-injected-failure.mjs) confirmed this
-- exactly: the schedule ends up permanently stuck at status='paid' with
-- paid_amount NULL and outstanding_balance never decremented -- not
-- money lost (the loan ledger simply never advances for that
-- installment), but genuinely unrecoverable through any existing path.
--
-- Fixed by fusing the schedule mark-paid step and the balance-decrement
-- step into one atomic transaction, called once per recovered schedule
-- (replacing the previous bulk-UPDATE-then-separate-sweep shape). A
-- failure now leaves the schedule at status='pending' -- untouched,
-- still reachable by the existing manual recovery endpoint, instead of a
-- row that LOOKS done but silently isn't.

CREATE OR REPLACE FUNCTION finalize_loan_emi_atomic(
  p_tenant_id      UUID,
  p_schedule_id    UUID,
  p_loan_id        UUID,
  p_principal_paid NUMERIC,
  p_payroll_run_id UUID
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_schedule_due_month TEXT;
  v_loan_after         RECORD;
BEGIN
  UPDATE loan_schedules
  SET    status = 'paid', payroll_run_id = p_payroll_run_id, paid_at = now(), paid_amount = p_principal_paid
  WHERE  id = p_schedule_id AND tenant_id = p_tenant_id AND loan_id = p_loan_id AND status = 'pending'
  RETURNING due_month INTO v_schedule_due_month;

  IF v_schedule_due_month IS NULL THEN
    RAISE EXCEPTION 'ALREADY_PROCESSED: This loan schedule is no longer pending — nothing to finalize';
  END IF;

  SELECT outstanding_balance, status INTO v_loan_after
  FROM record_loan_payment_atomic(p_tenant_id, p_loan_id, p_principal_paid);

  RETURN jsonb_build_object(
    'schedule_id', p_schedule_id,
    'outstanding_balance', v_loan_after.outstanding_balance,
    'loan_status', v_loan_after.status
  );
END;
$$;

ALTER FUNCTION finalize_loan_emi_atomic(UUID, UUID, UUID, NUMERIC, UUID) SET search_path = public;
REVOKE EXECUTE ON FUNCTION finalize_loan_emi_atomic(UUID, UUID, UUID, NUMERIC, UUID) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION finalize_loan_emi_atomic(UUID, UUID, UUID, NUMERIC, UUID) TO service_role;
