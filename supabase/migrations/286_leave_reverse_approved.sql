-- ============================================================
-- 286_leave_reverse_approved.sql
--
-- LEAVE P1-1 — no balance-restore path when an APPROVED leave_requests is
-- cancelled. The canonical table only supported cancelling PENDING requests, so
-- undoing an approved leave had no supported flow: HR edited the DB by hand,
-- which reconciliation then flagged as drift, and the employee's deducted days
-- were silently lost.
--
-- This RPC reverses an APPROVED request atomically — mirroring the legacy
-- leave_applications cancel path and the approve RPC (282):
--   • status APPROVED → CANCELLED
--   • idempotent 'reversal' ledger row (credit-back), keyed by source_request_id
--   • cache balance restored ONLY when the reversal row was actually inserted,
--     so a retried reversal never double-credits.
--
-- Idempotent (CREATE OR REPLACE). The attendance_daily cleanup + recompute is
-- done by the caller (non-fatal), exactly as the approve path does.
-- ============================================================

CREATE OR REPLACE FUNCTION reverse_leave_request_atomic(
  p_tenant_id     UUID,
  p_request_id    UUID,
  p_actor_id      UUID,
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
  v_row      RECORD;
  v_inserted BOOLEAN := false;
BEGIN
  SELECT lr.id, lr.status, lr.from_date, lr.to_date, lr.employee_id, lr.leave_type_id
  INTO   v_row
  FROM   leave_requests lr
  WHERE  lr.id = p_request_id AND lr.tenant_id = p_tenant_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'NOT_FOUND: Leave request not found';
  END IF;

  IF v_row.status <> 'APPROVED' THEN
    RAISE EXCEPTION 'CONFLICT: Only an APPROVED request can be reversed (current: %)', v_row.status;
  END IF;

  UPDATE leave_requests
  SET    status = 'CANCELLED', updated_at = now()
  WHERE  id = p_request_id AND tenant_id = p_tenant_id;

  IF p_is_paid THEN
    -- Idempotent credit-back row. One reversal per request (271 composite key).
    INSERT INTO leave_accrual_ledger (
      tenant_id, employee_id, leave_type_id, year, accrual_type,
      days, accrued_on, is_expired, notes, source_request_id
    ) VALUES (
      p_tenant_id, p_employee_id, p_leave_type_id, p_year, 'reversal',
      ABS(p_days), now()::date, false,
      'Leave reversal — cancelled approved ' || v_row.from_date || '…' || v_row.to_date, p_request_id
    )
    ON CONFLICT (tenant_id, accrual_type, source_request_id) DO NOTHING;

    GET DIAGNOSTICS v_inserted = ROW_COUNT;   -- 1 if inserted, 0 if duplicate

    -- Restore the cache only when the ledger reversal was newly written, so a
    -- retried reversal can't double-credit the balance.
    IF v_inserted THEN
      UPDATE employee_leave_balance
      SET    balance    = balance + p_days,
             updated_at = now()
      WHERE  tenant_id     = p_tenant_id
        AND  employee_id   = p_employee_id
        AND  leave_type_id = p_leave_type_id
        AND  year          = p_year;
    END IF;
  END IF;

  RETURN jsonb_build_object(
    'id',        p_request_id,
    'status',    'CANCELLED',
    'from_date', v_row.from_date,
    'to_date',   v_row.to_date,
    'reversed',  v_inserted
  );
END;
$$;
