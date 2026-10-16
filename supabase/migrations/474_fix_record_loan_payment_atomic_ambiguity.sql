-- SYSTEM_AUDIT_2026-10-14 checkpoint 17 — payroll audit, loans.ts.
--
-- Found while building record_loan_payment_manual_atomic (migration 473),
-- which calls this function: record_loan_payment_atomic (migration 396)
-- has NEVER actually worked. Its own `RETURNS TABLE (outstanding_balance
-- NUMERIC, status TEXT)` declares OUT parameters with those exact names,
-- which Postgres treats as PL/pgSQL variables in scope for the entire
-- function body — colliding with employee_loans' own `outstanding_balance`
-- and `status` columns referenced inside its own UPDATE statement. Every
-- real call raises:
--   ERROR: column reference "outstanding_balance" is ambiguous
--   DETAIL: It could refer to either a PL/pgSQL variable or a table column.
--
-- This is not specific to the new manual-payment path — it is the same
-- function runs.ts's automatic payroll-finalize loan-balance sweep has
-- called on every run since migration 396 shipped (`apps/api/src/routes/
-- payroll/runs.ts`, the "Loan outstanding balance sweep" block). That call
-- site treats rpcErr as non-fatal (`if (!rpcErr && rpcResult) { ... }`,
-- silently skipping the paid_amount marker on error) — so this has been
-- silently failing on every finalized payroll run with a loan EMI due,
-- meaning employee_loans.outstanding_balance has never actually been
-- decremented by the automatic sweep. The audit's own earlier note
-- crediting migration 396 with closing a lost-update race was wrong: the
-- "fixed" function could not run at all.
--
-- Fixed by qualifying the table-column reads with an explicit alias, which
-- disambiguates them from the same-named OUT variables. The left-hand side
-- of each SET clause is unambiguous either way (it must be the table
-- column), so only the right-hand-side reads and the RETURNING list needed
-- qualifying.

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
  UPDATE employee_loans el
  SET    outstanding_balance = GREATEST(0, ROUND(el.outstanding_balance - p_principal_paid, 2)),
         status = CASE
                     WHEN GREATEST(0, ROUND(el.outstanding_balance - p_principal_paid, 2)) <= 0 THEN 'completed'
                     ELSE el.status
                   END,
         updated_at = now()
  WHERE  el.id        = p_loan_id
    AND  el.tenant_id = p_tenant_id
  RETURNING el.outstanding_balance, el.status;
END;
$$;
