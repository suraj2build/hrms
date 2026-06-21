-- ============================================================
-- 282_leave_approval_strict_ledger.sql
--
-- LEAVE P0-1 — canonical approval drifts ledger vs cache on every approval.
--
-- approve_leave_request_atomic() (migration 042) is the approval path for the
-- canonical `leave_requests` table (system of record since migration 280, used
-- by the modern ESS/manager UI via approval-service.ts). It had two defects the
-- C6 ledger-authority program was meant to close but never reached this RPC:
--
--   1. SILENT CLAMP — it deducted via `GREATEST(0, balance - p_days)`, so a
--      request for more days than the balance silently clamped the cache to 0
--      with no error: the employee over-drew leave and nothing recorded it.
--
--   2. NO LEDGER DEBIT — it mutated only the cache (employee_leave_balance) and
--      wrote no `leave_accrual_ledger` consumption row. So Σ(ledger) ≠ cache
--      after the very first approval — exactly the drift the shadow/reconcile
--      tooling is built to detect.
--
-- The legacy `leave_applications` path (routes/attendance/leave.ts) was already
-- hardened: checked_deduct_leave_balance (269, strict, no clamp) + an idempotent
-- 'consumption' ledger row. This migration brings the canonical RPC up to the
-- same contract, and goes one better by writing the ledger row INSIDE the same
-- transaction as the deduct, so cache and ledger move atomically (or not at all).
--
-- Behaviour change: a paid-leave approval whose balance is insufficient (or has
-- no balance row) now FAILS with INSUFFICIENT_BALANCE instead of silently
-- clamping — matching the leave_applications path. approval-service.ts maps the
-- exception via parseRpcError.
--
-- Idempotent: CREATE OR REPLACE; the ON CONFLICT target is the non-partial
-- composite unique index uidx_accrual_ledger_request (tenant_id, accrual_type,
-- source_request_id) from migration 271, so a retry never double-debits.
-- ============================================================

CREATE OR REPLACE FUNCTION approve_leave_request_atomic(
  p_tenant_id     UUID,
  p_request_id    UUID,
  p_approver_id   UUID,
  p_approved_at   TIMESTAMPTZ,
  p_is_paid       BOOLEAN,
  p_employee_id   UUID,
  p_leave_type_id UUID,
  p_days          NUMERIC,
  p_year          INT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_row     RECORD;
  v_result  JSONB;
  v_updated INT;
BEGIN
  -- Pessimistic lock: serialises concurrent approval attempts on the same row.
  SELECT lr.id, lr.status, lr.employee_id, lr.leave_type_id,
         lr.from_date, lr.to_date, lr.computed_days, lr.half_day
  INTO   v_row
  FROM   leave_requests lr
  WHERE  lr.id        = p_request_id
    AND  lr.tenant_id = p_tenant_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'NOT_FOUND: Leave request not found';
  END IF;

  IF v_row.status <> 'PENDING' THEN
    RAISE EXCEPTION 'CONFLICT: Request is already %', v_row.status;
  END IF;

  -- Approve
  UPDATE leave_requests
  SET    status      = 'APPROVED',
         approved_by = p_approver_id,
         approved_at = p_approved_at,
         updated_at  = p_approved_at
  WHERE  id        = p_request_id
    AND  tenant_id = p_tenant_id;

  -- Balance deduction + ledger debit (paid leaves only), atomic with the above.
  IF p_is_paid THEN
    -- STRICT deduct: only succeeds when balance >= requested days. No clamp.
    UPDATE employee_leave_balance
    SET    balance    = balance - p_days,
           updated_at = p_approved_at
    WHERE  tenant_id     = p_tenant_id
      AND  employee_id   = p_employee_id
      AND  leave_type_id = p_leave_type_id
      AND  year          = p_year
      AND  balance       >= p_days;
    GET DIAGNOSTICS v_updated = ROW_COUNT;

    IF v_updated = 0 THEN
      -- Insufficient balance (or no balance row). Roll back the whole approval.
      RAISE EXCEPTION 'INSUFFICIENT_BALANCE: Insufficient leave balance for this request';
    END IF;

    -- Authoritative signed consumption row. Idempotent on
    -- (tenant_id, accrual_type, source_request_id) so a retry never re-debits.
    INSERT INTO leave_accrual_ledger (
      tenant_id, employee_id, leave_type_id, year, accrual_type,
      days, accrued_on, is_expired, notes, source_request_id
    ) VALUES (
      p_tenant_id, p_employee_id, p_leave_type_id, p_year, 'consumption',
      -ABS(p_days), v_row.from_date, false,
      'Leave consumed ' || v_row.from_date || '…' || v_row.to_date, p_request_id
    )
    ON CONFLICT (tenant_id, accrual_type, source_request_id) DO NOTHING;
  END IF;

  v_result := jsonb_build_object(
    'id',            p_request_id,
    'status',        'APPROVED',
    'employee_id',   v_row.employee_id,
    'leave_type_id', v_row.leave_type_id,
    'from_date',     v_row.from_date,
    'to_date',       v_row.to_date,
    'computed_days', v_row.computed_days,
    'half_day',      v_row.half_day,
    'is_paid',       p_is_paid
  );

  RETURN v_result;
END;
$$;
