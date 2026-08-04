-- ============================================================
-- 425_leave_approval_overlap_recheck.sql
--
-- Fresh-audit F9 — leave-request overlap check is a self-documented TOCTOU
-- gap at insert time (leave-request-service.ts's own comment: "This is the
-- ONLY guard against overlapping requests: leave_requests has no
-- UNIQUE/EXCLUDE constraint backstopping it at the DB level"). Two
-- concurrent submissions can both pass the application-layer overlap check
-- and land as two overlapping PENDING rows. approve_leave_request_atomic()
-- (migration 282) then approves each independently — it locks only the one
-- target row FOR UPDATE, so two concurrent approve calls for two different,
-- date-overlapping PENDING requests never contend on the same lock and both
-- succeed, double-crediting/-consuming the same calendar days.
--
-- Fix: two layers, both inside the existing atomic RPC —
--   1. A per-(tenant,employee) advisory transaction lock serializes ALL
--      concurrent approve_leave_request_atomic() calls for the same
--      employee, so no two approvals for one employee ever run truly
--      concurrently.
--   2. After acquiring that lock (and the existing row lock), re-check for
--      any OTHER row for the same employee already APPROVED whose date
--      range overlaps this request's — reject with CONFLICT if found.
--      Only APPROVED siblings matter here: PENDING siblings don't consume
--      balance or block dates, so their presence doesn't create a conflict
--      by itself (approving one first is what does).
--
-- Together this closes the two-concurrent-approvals race without touching
-- the leave_requests schema or requiring btree_gist: the advisory lock
-- guarantees the second approval attempt for an overlapping range always
-- observes the first's committed APPROVED row before deciding.
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
  v_row       RECORD;
  v_result    JSONB;
  v_updated   INT;
  v_conflict  UUID;
BEGIN
  -- Serialize all concurrent approval attempts for this employee — closes the
  -- two-different-overlapping-PENDING-requests race described above. Released
  -- automatically at transaction end (commit or rollback).
  PERFORM pg_advisory_xact_lock(hashtextextended(p_tenant_id::text || ':' || p_employee_id::text, 0));

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

  -- Overlap re-check (F9): now that we hold the per-employee advisory lock, any
  -- sibling APPROVED request already committed is visible here. A sibling that
  -- is still PENDING is not itself a conflict — it becomes one only once/if it
  -- is approved, at which point ITS OWN call to this function will run this
  -- same check and see this request's now-committed APPROVED row instead.
  SELECT lr.id INTO v_conflict
  FROM   leave_requests lr
  WHERE  lr.tenant_id   = p_tenant_id
    AND  lr.employee_id = p_employee_id
    AND  lr.id          <> p_request_id
    AND  lr.status       = 'APPROVED'
    AND  lr.from_date   <= v_row.to_date
    AND  lr.to_date     >= v_row.from_date
  LIMIT 1;

  IF v_conflict IS NOT NULL THEN
    RAISE EXCEPTION 'CONFLICT: This request overlaps with an already-approved leave request';
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

ALTER FUNCTION approve_leave_request_atomic(UUID, UUID, UUID, TIMESTAMPTZ, BOOLEAN, UUID, UUID, NUMERIC, INT)
  SET search_path = public;
