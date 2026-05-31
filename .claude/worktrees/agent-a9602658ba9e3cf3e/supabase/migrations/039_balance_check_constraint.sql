-- ============================================================
-- 039_balance_check_constraint.sql
-- Add a database-level CHECK constraint to employee_leave_balance
-- so the balance column can never go negative.
--
-- The deduct_leave_balance() RPC already uses GREATEST(0, ...) which
-- silently floors at zero, but does NOT reject over-draws.  This
-- constraint acts as the final safety net: any UPDATE that would set
-- balance < 0 raises a constraint-violation error instead.
-- ============================================================

ALTER TABLE employee_leave_balance
  DROP CONSTRAINT IF EXISTS balance_non_negative;

ALTER TABLE employee_leave_balance
  ADD CONSTRAINT balance_non_negative CHECK (balance >= 0);
