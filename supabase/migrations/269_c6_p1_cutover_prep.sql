-- ============================================================
-- 269_c6_p1_cutover_prep.sql
--
-- C6-P1: Close all CRITICAL and BLOCKING findings from the C6 ledger
-- cutover readiness audit so the platform can safely enter shadow-read
-- validation.
--
-- Changes:
--   1. leave_applications — add 'cancelled' status (cancellation endpoint)
--   2. leave_accrual_ledger — add 'reversal' and 'encashment' accrual types
--   3. Reversal idempotency unique index
--   4. Encashment debit idempotency unique index
--   5. checked_deduct_leave_balance() — replaces the silent-clamp
--      deduct_leave_balance() for leave approval; returns BOOLEAN,
--      only deducts when balance >= requested days.
-- ============================================================

-- ── 1. leave_applications — add 'cancelled' status ────────────────────────────
ALTER TABLE leave_applications
  DROP CONSTRAINT IF EXISTS leave_applications_status_check;
ALTER TABLE leave_applications
  ADD CONSTRAINT leave_applications_status_check
  CHECK (status IN ('pending', 'approved', 'rejected', 'cancelled'));

-- ── 2. leave_accrual_ledger — comprehensive accrual_type superset ─────────────
-- Adds 'reversal' (credit-back when an approved leave is cancelled) and
-- 'encashment' (debit when leave is encashed — mirrors leave_balance_ledger).
ALTER TABLE leave_accrual_ledger
  DROP CONSTRAINT IF EXISTS leave_accrual_ledger_accrual_type_check;
ALTER TABLE leave_accrual_ledger
  ADD CONSTRAINT leave_accrual_ledger_accrual_type_check
  CHECK (accrual_type IN (
    'monthly', 'quarterly', 'yearly', 'upfront', 'carry_forward',
    'co_grant', 'manual', 'adjustment', 'wo_credit',
    'consumption',       -- signed debit when leave is approved/consumed
    'opening_balance',   -- one-time reconciliation to current cached balance
    'reversal',          -- credit-back when a previously approved leave is cancelled
    'encashment'         -- debit when leave days are paid out (encashment approval)
  ));

-- ── 3. Reversal idempotency ────────────────────────────────────────────────────
-- One reversal row per leave application: prevents double-crediting on retry.
-- Uses the same source_request_id FK as the consumption row.
CREATE UNIQUE INDEX IF NOT EXISTS uidx_accrual_ledger_reversal_request
  ON leave_accrual_ledger (tenant_id, source_request_id)
  WHERE accrual_type = 'reversal' AND source_request_id IS NOT NULL;

-- ── 4. Encashment debit idempotency ───────────────────────────────────────────
-- source_request_id holds the leave_encashment_requests.id UUID (different
-- FK domain from leave_applications, no collision risk as UUIDs are globally
-- unique). One debit per approved encashment request.
CREATE UNIQUE INDEX IF NOT EXISTS uidx_accrual_ledger_encashment_request
  ON leave_accrual_ledger (tenant_id, source_request_id)
  WHERE accrual_type = 'encashment' AND source_request_id IS NOT NULL;

-- ── 5. checked_deduct_leave_balance ───────────────────────────────────────────
-- Atomically deducts p_days only when balance >= p_days. Returns TRUE if
-- deduction succeeded, FALSE if balance was insufficient.
--
-- Replaces deduct_leave_balance() (migration 036) in the leave approval path.
-- The old function used GREATEST(0, balance - p_days) which silently clamped
-- to zero when the requested days exceeded the balance, creating permanent
-- divergence between the ledger (which recorded the full debit) and the
-- cache (which clamped). This function is strict: no deduction, no ledger
-- write if the balance check fails.
CREATE OR REPLACE FUNCTION checked_deduct_leave_balance(
  p_tenant_id     UUID,
  p_employee_id   UUID,
  p_leave_type_id UUID,
  p_days          NUMERIC,
  p_year          INT
) RETURNS BOOLEAN LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_updated INT;
BEGIN
  UPDATE employee_leave_balance
  SET    balance    = balance - p_days,
         updated_at = now()
  WHERE  tenant_id     = p_tenant_id
    AND  employee_id   = p_employee_id
    AND  leave_type_id = p_leave_type_id
    AND  year          = p_year
    AND  balance       >= p_days;   -- strict check: no silent clamp
  GET DIAGNOSTICS v_updated = ROW_COUNT;
  RETURN v_updated > 0;
END;
$$;
