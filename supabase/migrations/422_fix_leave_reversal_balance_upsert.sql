-- ============================================================
-- 422_fix_leave_reversal_balance_upsert.sql
--
-- SYSCERT_AUDIT_2026-08-02.md Medium finding: reverse_leave_request_atomic
-- (286_leave_reverse_approved.sql) silently no-ops the balance-cache
-- restore.
--
-- The original UPDATE employee_leave_balance ... WHERE tenant_id=...
-- AND employee_id=... AND leave_type_id=... AND year=... matches ZERO
-- rows (no error — Postgres never raises on an UPDATE matching nothing)
-- whenever no employee_leave_balance row exists yet for that
-- (employee, leave_type, year) tuple — e.g. the row was never created,
-- was deleted, or belongs to a different year. The function still
-- returns 'reversed': true (the ledger credit-back row was genuinely
-- inserted) even though the actual balance the employee/payroll reads
-- was never restored — a real, silent under-credit with no signal
-- anywhere that it happened.
--
-- Fix: upsert instead of update — INSERT the row (seeded with just the
-- reversed days) if it doesn't exist, or add to the existing balance if
-- it does. Same idempotency guarantee as before (still gated on
-- v_inserted from the ledger insert), just correct when the cache row
-- doesn't yet exist.
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
    -- retried reversal can't double-credit the balance. Upsert (not a plain
    -- UPDATE) so a missing balance row is created instead of the restore
    -- silently affecting zero rows.
    IF v_inserted THEN
      INSERT INTO employee_leave_balance (
        tenant_id, employee_id, leave_type_id, year, balance, updated_at
      ) VALUES (
        p_tenant_id, p_employee_id, p_leave_type_id, p_year, p_days, now()
      )
      ON CONFLICT (tenant_id, employee_id, leave_type_id, year) DO UPDATE
        SET balance    = employee_leave_balance.balance + EXCLUDED.balance,
            updated_at = now();
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

-- Re-apply the same EXECUTE lockdown 421 established — CREATE OR REPLACE
-- does not preserve prior REVOKE/GRANT state across a signature-compatible
-- redefinition in all Postgres versions, so pin it explicitly rather than
-- rely on that.
REVOKE EXECUTE ON FUNCTION reverse_leave_request_atomic(UUID, UUID, UUID, BOOLEAN, UUID, UUID, NUMERIC, INT)
  FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION reverse_leave_request_atomic(UUID, UUID, UUID, BOOLEAN, UUID, UUID, NUMERIC, INT)
  TO service_role;
