-- Fresh audit finding (payroll/statutory pass): POST /payroll/loans/
-- record-payment updated employee_loans.outstanding_balance via a plain
-- read-then-write (SELECT outstanding_balance, compute new value in
-- application code, UPDATE) — a classic lost-update race. Two concurrent
-- (or accidentally duplicate) record-payment calls for the same loan both
-- read the same outstanding_balance, both compute
-- outstanding_balance - principal_paid independently, and the second write
-- overwrites the first: two loan_payments audit rows get inserted, but
-- outstanding_balance only reflects one deduction — the balance
-- under-states what the payment records claim was actually paid.
--
-- Unlike checked_deduct_leave_balance (migration 269), this has no
-- insufficient-balance rejection case — a loan payment can legitimately
-- overpay the last installment (foreclosure), so the deduction always
-- proceeds and is simply floored at 0. The fix is purely about doing the
-- read-modify-write atomically in one UPDATE, not about a balance check.

CREATE OR REPLACE FUNCTION record_loan_payment_atomic(
  p_tenant_id      UUID,
  p_loan_id        UUID,
  p_principal_paid NUMERIC
) RETURNS TABLE (
  outstanding_balance NUMERIC,
  status               TEXT
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  RETURN QUERY
  UPDATE employee_loans
  SET    outstanding_balance = GREATEST(0, ROUND(outstanding_balance - p_principal_paid, 2)),
         status = CASE
                     WHEN GREATEST(0, ROUND(outstanding_balance - p_principal_paid, 2)) <= 0 THEN 'completed'
                     ELSE status
                   END,
         updated_at = now()
  WHERE  id        = p_loan_id
    AND  tenant_id = p_tenant_id
  RETURNING employee_loans.outstanding_balance, employee_loans.status;
END;
$$;
