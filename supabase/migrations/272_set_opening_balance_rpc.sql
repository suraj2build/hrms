-- ============================================================
-- 272_set_opening_balance_rpc.sql
--
-- Opening-balance writer for migration / onboarding (UI + bulk CSV upload).
--
-- Sets an employee's opening leave balance for one leave type + year in a way
-- that keeps the cache (employee_leave_balance) and the authoritative ledger
-- (leave_accrual_ledger) in lockstep — the invariant the whole C6 line protects.
--
-- It REPLACES the single 'opening_balance' ledger row for (tenant, employee,
-- leave_type, year) with p_days, then derives the cache from the ledger via
-- recompute_leave_balance(). For a freshly migrated employee (no other ledger
-- rows) the resulting cache == p_days. Idempotent: re-running with the same
-- p_days yields the same state, so a re-uploaded file never double-credits.
--
-- p_days = 0 clears the opening balance (removes the row, recomputes to 0/other).
-- ============================================================

CREATE OR REPLACE FUNCTION set_opening_balance(
  p_tenant_id     uuid,
  p_employee_id   uuid,
  p_leave_type_id uuid,
  p_days          numeric,
  p_year          int
) RETURNS void LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  DELETE FROM leave_accrual_ledger
   WHERE tenant_id     = p_tenant_id
     AND employee_id   = p_employee_id
     AND leave_type_id = p_leave_type_id
     AND year          = p_year
     AND accrual_type  = 'opening_balance';

  IF p_days <> 0 THEN
    INSERT INTO leave_accrual_ledger
      (tenant_id, employee_id, leave_type_id, year, accrual_type, days, accrued_on, is_expired, notes)
    VALUES
      (p_tenant_id, p_employee_id, p_leave_type_id, p_year, 'opening_balance', p_days, CURRENT_DATE, false, 'Opening balance');
  END IF;

  PERFORM recompute_leave_balance(p_tenant_id, p_employee_id, p_leave_type_id, p_year);
END;
$$;
