-- ============================================================
-- 461_period_lock_atomic_enforcement.sql
--
-- SYSTEM_AUDIT_2026-10-14 checkpoint 6, continued — the user correctly
-- identified that checking attendance_period_locks in the application
-- layer (getLockedMonths / isMonthLocked in lib/period-lock.ts), as a
-- SEPARATE query BEFORE the approval's own atomic RPC call, cannot
-- actually prevent a concurrent period-lock from racing the approval: a
-- sequential "insert a locked row, then call approve" test only proves
-- the check reads an existing lock correctly — it says nothing about the
-- window between the JS-side check and the RPC's own mutation, during
-- which another session can lock the period and the approval's RPC,
-- unaware, still commits its balance deduction / status change / ledger
-- write.
--
-- Confirmed by reading the actual RPC bodies: approve_leave_request_atomic,
-- reverse_leave_request_atomic (427) and approve_regularisation_atomic (042)
-- never reference attendance_period_locks at all. The ONLY period-lock
-- enforcement for these three canonical mutations was the JS pre-check —
-- a real, exploitable TOCTOU gap on a payroll-integrity boundary, not a
-- theoretical one. The DB trigger from 262 does not help here either: it
-- deliberately allows LOCKED/PAYROLL_PROCESSING writes to attendance_daily
-- (only PAYROLL_FINALIZED is a hard floor), by design, so it was never
-- meant to be this backstop.
--
-- Fix: move the period-lock check INSIDE each RPC's own transaction,
-- evaluated via a fresh query in the SAME statement/transaction that
-- performs the mutation — not an advisory-lock dance, which isn't needed
-- here. Under Postgres's default READ COMMITTED isolation, a statement's
-- snapshot sees every transaction that committed before THAT statement
-- began. Folding the lock-check into the same transaction as the mutation
-- (immediately before it, no intervening round trip back to the
-- application) means: if the period-lock UPDATE in period-locks.ts
-- committed before this RPC call started, the RPC's own check WILL see
-- it and abort — closing exactly the gap a separate, earlier JS-side
-- check could miss. If the lock is still in-flight (uncommitted) when
-- this RPC's check runs, MVCC correctly treats it as not-yet-authoritative
-- and the approval proceeds — a genuine concurrent race with no
-- well-defined "right" answer, resolved consistently either way, not a
-- corruption. The existing JS-side pre-checks are KEPT as a fast-fail
-- UX optimization (clean 409 without paying for a round trip to the RPC
-- when the period is already known to be locked) — they are no longer
-- the only enforcement.
--
-- Three NEW atomic RPCs are added for the mutations that previously had
-- NO FOR-UPDATE-guarded single transaction at all (each split its status
-- change, balance/ledger write, and lock check across multiple separate
-- JS-level calls): the legacy leave.ts leave_applications approve flow
-- (explicitly flagged this round — this file is live/reachable, not dead
-- code), comp-off's approval claim, and overtime's approval claim.
-- ============================================================

-- ── Shared helper: the set of YYYY-MM months a date range spans ───────────
CREATE OR REPLACE FUNCTION fn_months_in_range(p_from DATE, p_to DATE)
RETURNS TEXT[]
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT array_agg(DISTINCT to_char(d, 'YYYY-MM') ORDER BY to_char(d, 'YYYY-MM'))
  FROM generate_series(p_from, p_to, interval '1 day') AS d;
$$;

-- ============================================================
-- approve_leave_request_atomic — add the in-transaction period-lock check.
-- Signature unchanged (no caller-side TS change needed); only the body
-- gains the check, inserted right after the FOR UPDATE lock + status
-- check and before any mutation.
-- ============================================================
CREATE OR REPLACE FUNCTION approve_leave_request_atomic(
  p_tenant_id     UUID,
  p_request_id    UUID,
  p_approver_id   UUID,
  p_approved_at   TIMESTAMPTZ,
  p_is_paid       BOOLEAN,
  p_employee_id   UUID,
  p_leave_type_id UUID,
  p_buckets       JSONB,
  p_year          INT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_row          RECORD;
  v_result       JSONB;
  v_updated      INT;
  v_conflict     UUID;
  v_bucket       RECORD;
  v_locked_month TEXT;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended(p_tenant_id::text || ':' || p_employee_id::text, 0));

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

  -- Period-lock check, evaluated in THIS transaction, immediately before
  -- any mutation — see migration header. A lock committed by another
  -- session before this statement began is guaranteed visible here.
  SELECT period_month INTO v_locked_month
  FROM   attendance_period_locks
  WHERE  tenant_id     = p_tenant_id
    AND  period_month  = ANY(fn_months_in_range(v_row.from_date, v_row.to_date))
    AND  state         <> 'OPEN'
  ORDER BY period_month
  LIMIT 1;

  IF v_locked_month IS NOT NULL THEN
    RAISE EXCEPTION 'CONFLICT: PERIOD_LOCKED: Cannot approve — the pay period % is locked. Reopen the period before approving this request.', v_locked_month;
  END IF;

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

  UPDATE leave_requests
  SET    status      = 'APPROVED',
         approved_by = p_approver_id,
         approved_at = p_approved_at,
         updated_at  = p_approved_at
  WHERE  id        = p_request_id
    AND  tenant_id = p_tenant_id;

  IF p_is_paid THEN
    FOR v_bucket IN SELECT * FROM jsonb_to_recordset(p_buckets) AS x(year INT, days NUMERIC)
    LOOP
      UPDATE employee_leave_balance
      SET    balance    = balance - v_bucket.days,
             updated_at = p_approved_at
      WHERE  tenant_id     = p_tenant_id
        AND  employee_id   = p_employee_id
        AND  leave_type_id = p_leave_type_id
        AND  year          = v_bucket.year
        AND  balance       >= v_bucket.days;
      GET DIAGNOSTICS v_updated = ROW_COUNT;

      IF v_updated = 0 THEN
        RAISE EXCEPTION 'INSUFFICIENT_BALANCE: Insufficient leave balance for % (requested % day(s))', v_bucket.year, v_bucket.days;
      END IF;

      INSERT INTO leave_accrual_ledger (
        tenant_id, employee_id, leave_type_id, year, accrual_type,
        days, accrued_on, is_expired, notes, source_request_id
      ) VALUES (
        p_tenant_id, p_employee_id, p_leave_type_id, v_bucket.year, 'consumption',
        -ABS(v_bucket.days), v_row.from_date, false,
        'Leave consumed ' || v_row.from_date || '…' || v_row.to_date, p_request_id
      )
      ON CONFLICT (tenant_id, accrual_type, source_request_id, year) DO NOTHING;
    END LOOP;
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

ALTER FUNCTION approve_leave_request_atomic(UUID, UUID, UUID, TIMESTAMPTZ, BOOLEAN, UUID, UUID, JSONB, INT)
  SET search_path = public;
REVOKE EXECUTE ON FUNCTION approve_leave_request_atomic(UUID, UUID, UUID, TIMESTAMPTZ, BOOLEAN, UUID, UUID, JSONB, INT)
  FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION approve_leave_request_atomic(UUID, UUID, UUID, TIMESTAMPTZ, BOOLEAN, UUID, UUID, JSONB, INT)
  TO service_role;

-- ============================================================
-- reverse_leave_request_atomic — same treatment. A reversal mutates
-- attendance_daily (route-level, after this RPC) and credits balance —
-- reversing an approval for a now-locked period is the same class of
-- problem as approving one.
-- ============================================================
CREATE OR REPLACE FUNCTION reverse_leave_request_atomic(
  p_tenant_id     UUID,
  p_request_id    UUID,
  p_actor_id      UUID,
  p_is_paid       BOOLEAN,
  p_employee_id   UUID,
  p_leave_type_id UUID,
  p_buckets       JSONB,
  p_year          INT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_row           RECORD;
  v_bucket        RECORD;
  v_any_inserted  BOOLEAN := false;
  v_inserted      BOOLEAN;
  v_locked_month  TEXT;
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

  SELECT period_month INTO v_locked_month
  FROM   attendance_period_locks
  WHERE  tenant_id     = p_tenant_id
    AND  period_month  = ANY(fn_months_in_range(v_row.from_date, v_row.to_date))
    AND  state         <> 'OPEN'
  ORDER BY period_month
  LIMIT 1;

  IF v_locked_month IS NOT NULL THEN
    RAISE EXCEPTION 'CONFLICT: PERIOD_LOCKED: Cannot reverse — the pay period % is locked. Reopen the period before reversing this approval.', v_locked_month;
  END IF;

  UPDATE leave_requests
  SET    status = 'CANCELLED', updated_at = now()
  WHERE  id = p_request_id AND tenant_id = p_tenant_id;

  IF p_is_paid THEN
    FOR v_bucket IN SELECT * FROM jsonb_to_recordset(p_buckets) AS x(year INT, days NUMERIC)
    LOOP
      INSERT INTO leave_accrual_ledger (
        tenant_id, employee_id, leave_type_id, year, accrual_type,
        days, accrued_on, is_expired, notes, source_request_id
      ) VALUES (
        p_tenant_id, p_employee_id, p_leave_type_id, v_bucket.year, 'reversal',
        ABS(v_bucket.days), now()::date, false,
        'Leave reversal — cancelled approved ' || v_row.from_date || '…' || v_row.to_date, p_request_id
      )
      ON CONFLICT (tenant_id, accrual_type, source_request_id, year) DO NOTHING;

      GET DIAGNOSTICS v_inserted = ROW_COUNT;
      IF v_inserted THEN v_any_inserted := true; END IF;

      IF v_inserted THEN
        INSERT INTO employee_leave_balance (
          tenant_id, employee_id, leave_type_id, year, balance, updated_at
        ) VALUES (
          p_tenant_id, p_employee_id, p_leave_type_id, v_bucket.year, v_bucket.days, now()
        )
        ON CONFLICT (tenant_id, employee_id, leave_type_id, year) DO UPDATE
          SET balance    = employee_leave_balance.balance + EXCLUDED.balance,
              updated_at = now();
      END IF;
    END LOOP;
  END IF;

  RETURN jsonb_build_object(
    'id',        p_request_id,
    'status',    'CANCELLED',
    'from_date', v_row.from_date,
    'to_date',   v_row.to_date,
    'reversed',  v_any_inserted
  );
END;
$$;

REVOKE EXECUTE ON FUNCTION reverse_leave_request_atomic(UUID, UUID, UUID, BOOLEAN, UUID, UUID, JSONB, INT)
  FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION reverse_leave_request_atomic(UUID, UUID, UUID, BOOLEAN, UUID, UUID, JSONB, INT)
  TO service_role;

-- ============================================================
-- approve_regularisation_atomic — same treatment, single-date lock check.
-- Signature unchanged.
-- ============================================================
CREATE OR REPLACE FUNCTION approve_regularisation_atomic(
  p_tenant_id   UUID,
  p_reg_id      UUID,
  p_approver_id UUID,
  p_approved_at TIMESTAMPTZ
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_row          RECORD;
  v_locked_month TEXT;
BEGIN
  SELECT id, status, employee_id, date,
         requested_check_in, requested_check_out
  INTO   v_row
  FROM   attendance_regularisation
  WHERE  id        = p_reg_id
    AND  tenant_id = p_tenant_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'NOT_FOUND: Regularisation request not found';
  END IF;

  IF v_row.status <> 'pending' THEN
    RAISE EXCEPTION 'CONFLICT: Request is already %', v_row.status;
  END IF;

  SELECT period_month INTO v_locked_month
  FROM   attendance_period_locks
  WHERE  tenant_id    = p_tenant_id
    AND  period_month = to_char(v_row.date, 'YYYY-MM')
    AND  state        <> 'OPEN';

  IF v_locked_month IS NOT NULL THEN
    RAISE EXCEPTION 'CONFLICT: PERIOD_LOCKED: Cannot approve — the pay period % is locked. Reopen the period before approving this request.', v_locked_month;
  END IF;

  UPDATE attendance_regularisation
  SET    status      = 'approved',
         approved_by = p_approver_id,
         approved_at = p_approved_at
  WHERE  id        = p_reg_id
    AND  tenant_id = p_tenant_id;

  RETURN jsonb_build_object(
    'id',                  v_row.id,
    'status',              'approved',
    'employee_id',         v_row.employee_id,
    'date',                v_row.date,
    'requested_check_in',  v_row.requested_check_in,
    'requested_check_out', v_row.requested_check_out
  );
END;
$$;

-- ============================================================
-- NEW: approve_legacy_leave_application_atomic — routes/attendance/leave.ts.
--
-- Previously this flow's "approve" was 3 separate round trips with NO
-- shared transaction: validateBalance (read-only, JS) ->
-- checked_deduct_leave_balance (its own RPC/transaction) -> a plain
-- UPDATE ... WHERE status='pending' (a second, separate transaction).
-- Besides the period-lock race, that structure meant a crash between the
-- deduct and the status UPDATE left an orphaned deduction with the
-- application still 'pending' -- a second, narrower gap closed here as a
-- side effect of consolidating into one transaction, not something this
-- migration set out to fix on its own but a direct consequence of doing
-- this correctly.
-- ============================================================
CREATE OR REPLACE FUNCTION approve_legacy_leave_application_atomic(
  p_tenant_id     UUID,
  p_application_id UUID,
  p_approver_id   UUID,
  p_approved_at   TIMESTAMPTZ,
  p_is_paid       BOOLEAN,
  p_working_days  NUMERIC
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_row          RECORD;
  v_locked_month TEXT;
  v_year         INT;
  v_updated      INT;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended(p_tenant_id::text || ':leave_app:' || p_application_id::text, 0));

  SELECT id, status, employee_id, leave_type_id, from_date, to_date, session
  INTO   v_row
  FROM   leave_applications
  WHERE  id        = p_application_id
    AND  tenant_id = p_tenant_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'NOT_FOUND: Application not found';
  END IF;

  IF v_row.status <> 'pending' THEN
    RAISE EXCEPTION 'CONFLICT: Application is already %', v_row.status;
  END IF;

  SELECT period_month INTO v_locked_month
  FROM   attendance_period_locks
  WHERE  tenant_id    = p_tenant_id
    AND  period_month = ANY(fn_months_in_range(v_row.from_date, v_row.to_date))
    AND  state        <> 'OPEN'
  ORDER BY period_month
  LIMIT 1;

  IF v_locked_month IS NOT NULL THEN
    RAISE EXCEPTION 'CONFLICT: PERIOD_LOCKED: Cannot approve — the pay period % is locked. Reopen the period before approving this request.', v_locked_month;
  END IF;

  v_year := EXTRACT(YEAR FROM v_row.from_date)::INT;

  IF p_is_paid THEN
    UPDATE employee_leave_balance
    SET    balance    = balance - p_working_days,
           updated_at = p_approved_at
    WHERE  tenant_id     = p_tenant_id
      AND  employee_id   = v_row.employee_id
      AND  leave_type_id = v_row.leave_type_id
      AND  year          = v_year
      AND  balance       >= p_working_days;
    GET DIAGNOSTICS v_updated = ROW_COUNT;

    IF v_updated = 0 THEN
      RAISE EXCEPTION 'INSUFFICIENT_BALANCE: Insufficient leave balance';
    END IF;

    INSERT INTO leave_accrual_ledger (
      tenant_id, employee_id, leave_type_id, year, accrual_type,
      days, accrued_on, is_expired, notes, source_request_id
    ) VALUES (
      p_tenant_id, v_row.employee_id, v_row.leave_type_id, v_year, 'consumption',
      -ABS(p_working_days), v_row.from_date, false,
      'Leave consumed ' || v_row.from_date || '…' || v_row.to_date, p_application_id
    )
    ON CONFLICT (tenant_id, accrual_type, source_request_id, year) DO NOTHING;
  END IF;

  UPDATE leave_applications
  SET    status       = 'approved',
         approved_by  = p_approver_id,
         approved_at  = p_approved_at,
         working_days = p_working_days
  WHERE  id        = p_application_id
    AND  tenant_id = p_tenant_id;

  RETURN jsonb_build_object(
    'id',            v_row.id,
    'status',        'approved',
    'employee_id',   v_row.employee_id,
    'leave_type_id', v_row.leave_type_id,
    'from_date',     v_row.from_date,
    'to_date',       v_row.to_date,
    'session',       v_row.session,
    'working_days',  p_working_days,
    'is_paid',       p_is_paid
  );
END;
$$;

REVOKE EXECUTE ON FUNCTION approve_legacy_leave_application_atomic(UUID, UUID, UUID, TIMESTAMPTZ, BOOLEAN, NUMERIC)
  FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION approve_legacy_leave_application_atomic(UUID, UUID, UUID, TIMESTAMPTZ, BOOLEAN, NUMERIC)
  TO service_role;

-- ============================================================
-- NEW: approve_comp_off_claim_atomic — routes/attendance/comp-off.ts.
--
-- Wraps only the "claim" step (status pending -> approved) that was
-- previously a single plain UPDATE with isMonthLocked checked by a
-- separate, earlier JS query. The balance credit (leave_accrual_ledger
-- upsert + credit_leave_balance RPC) remains in JS, AFTER this call
-- succeeds — same non-critical-cleanup-after-the-commit-point pattern as
-- every other approval flow in this codebase; the claim itself is the
-- one step that must be transactionally lock-safe.
-- ============================================================
CREATE OR REPLACE FUNCTION approve_comp_off_claim_atomic(
  p_tenant_id  UUID,
  p_co_id      UUID,
  p_reviewer_id UUID,
  p_reviewed_at TIMESTAMPTZ,
  p_notes       TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_row          RECORD;
  v_locked_month TEXT;
BEGIN
  SELECT id, status, employee_id, leave_type_id, worked_date, days_to_credit
  INTO   v_row
  FROM   comp_off_requests
  WHERE  id        = p_co_id
    AND  tenant_id = p_tenant_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'NOT_FOUND: Comp off request not found';
  END IF;

  IF v_row.status <> 'pending' THEN
    RAISE EXCEPTION 'CONFLICT: Request is already %', v_row.status;
  END IF;

  IF v_row.leave_type_id IS NULL THEN
    RAISE EXCEPTION 'NO_LEAVE_TYPE_CONFIGURED: This comp-off request has no leave type to credit';
  END IF;

  SELECT period_month INTO v_locked_month
  FROM   attendance_period_locks
  WHERE  tenant_id    = p_tenant_id
    AND  period_month = to_char(v_row.worked_date, 'YYYY-MM')
    AND  state        <> 'OPEN';

  IF v_locked_month IS NOT NULL THEN
    RAISE EXCEPTION 'CONFLICT: PERIOD_LOCKED: Attendance period % is locked for payroll — no changes allowed.', v_locked_month;
  END IF;

  UPDATE comp_off_requests
  SET    status      = 'approved',
         reviewed_by = p_reviewer_id,
         reviewed_at = p_reviewed_at,
         notes       = p_notes
  WHERE  id        = p_co_id
    AND  tenant_id = p_tenant_id;

  RETURN jsonb_build_object(
    'id',             v_row.id,
    'status',         'approved',
    'employee_id',    v_row.employee_id,
    'leave_type_id',  v_row.leave_type_id,
    'worked_date',    v_row.worked_date,
    'days_to_credit', v_row.days_to_credit
  );
END;
$$;

REVOKE EXECUTE ON FUNCTION approve_comp_off_claim_atomic(UUID, UUID, UUID, TIMESTAMPTZ, TEXT)
  FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION approve_comp_off_claim_atomic(UUID, UUID, UUID, TIMESTAMPTZ, TEXT)
  TO service_role;

-- ============================================================
-- NEW: approve_overtime_claim_atomic — routes/attendance/overtime.ts /
-- lib/ot-engine.ts. Wraps the claim step the same way; the
-- attendance_daily ot_approved_minutes sync stays in JS afterward,
-- non-critical, matching the existing pattern (its own failure today is
-- already only logged, not rolled back).
-- ============================================================
CREATE OR REPLACE FUNCTION approve_overtime_claim_atomic(
  p_tenant_id        UUID,
  p_ot_id            UUID,
  p_approver_id      UUID,
  p_approved_at      TIMESTAMPTZ,
  p_approved_minutes INT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_row          RECORD;
  v_locked_month TEXT;
BEGIN
  SELECT id, status, employee_id, attendance_date, raw_ot_minutes
  INTO   v_row
  FROM   overtime_requests
  WHERE  id        = p_ot_id
    AND  tenant_id = p_tenant_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'NOT_FOUND: OT request not found';
  END IF;

  IF v_row.status <> 'PENDING' THEN
    RAISE EXCEPTION 'CONFLICT: Cannot approve a request with status %', v_row.status;
  END IF;

  SELECT period_month INTO v_locked_month
  FROM   attendance_period_locks
  WHERE  tenant_id    = p_tenant_id
    AND  period_month = to_char(v_row.attendance_date, 'YYYY-MM')
    AND  state        <> 'OPEN';

  IF v_locked_month IS NOT NULL THEN
    RAISE EXCEPTION 'CONFLICT: PERIOD_LOCKED: Attendance period % is locked for payroll — no changes allowed.', v_locked_month;
  END IF;

  UPDATE overtime_requests
  SET    status           = 'APPROVED',
         approved_minutes = COALESCE(p_approved_minutes, v_row.raw_ot_minutes),
         approved_by      = p_approver_id,
         approved_at      = p_approved_at
  WHERE  id        = p_ot_id
    AND  tenant_id = p_tenant_id;

  RETURN jsonb_build_object(
    'id',               v_row.id,
    'status',           'APPROVED',
    'employee_id',      v_row.employee_id,
    'attendance_date',  v_row.attendance_date,
    'approved_minutes', COALESCE(p_approved_minutes, v_row.raw_ot_minutes)
  );
END;
$$;

REVOKE EXECUTE ON FUNCTION approve_overtime_claim_atomic(UUID, UUID, UUID, TIMESTAMPTZ, INT)
  FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION approve_overtime_claim_atomic(UUID, UUID, UUID, TIMESTAMPTZ, INT)
  TO service_role;

-- ============================================================
-- NEW: cancel_legacy_leave_application_atomic — routes/attendance/leave.ts
-- POST /attendance/leave/:id/cancel.
--
-- SYSTEM_AUDIT_2026-10-14 continued audit (steering message after
-- checkpoint 6, item "Inspect every registered apply/edit/approve/
-- reject/cancel endpoint"): the cancel handler had the SAME structural
-- gap as the legacy approve handler did before this migration — status
-- check, period-lock awareness (actually: NONE at all, not even a JS
-- pre-check), status UPDATE, ledger reversal INSERT, and balance credit
-- were four separate round trips with no shared transaction. This
-- function consolidates status-check + period-lock-check + status
-- UPDATE + ledger reversal + balance restore into one transaction,
-- the same pattern as approve_legacy_leave_application_atomic above.
--
-- The "how much to restore" decision (consumption-ledger lookup vs.
-- recompute for a pre-C6 approval) stays in JS, exactly as it does for
-- approve's balance validation — p_days_to_restore is the resolved
-- final number, computed by the route handler before calling this RPC.
-- Likewise the elapsed-range guard (F2 — mirroring
-- reverseApprovedLeaveRequest's `req.from_date < todayLocal` check in
-- approval-service.ts) stays in JS: it is a business-rule read of
-- "today" relative to an already-fetched date, not a race-sensitive
-- mutation precondition, so it does not need to be inside this
-- transaction the way the period-lock check does.
-- ============================================================
CREATE OR REPLACE FUNCTION cancel_legacy_leave_application_atomic(
  p_tenant_id        UUID,
  p_application_id   UUID,
  p_is_paid          BOOLEAN,
  p_days_to_restore  NUMERIC
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_row          RECORD;
  v_locked_month TEXT;
  v_year         INT;
  v_inserted     BOOLEAN := false;
BEGIN
  SELECT id, status, employee_id, leave_type_id, from_date, to_date
  INTO   v_row
  FROM   leave_applications
  WHERE  id        = p_application_id
    AND  tenant_id = p_tenant_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'NOT_FOUND: Application not found';
  END IF;

  IF v_row.status <> 'approved' THEN
    RAISE EXCEPTION 'CONFLICT: Application was already actioned (current status: %)', v_row.status;
  END IF;

  -- Period-lock check, evaluated in THIS transaction immediately before
  -- any mutation — see migration header for why this must not be a
  -- separate earlier JS-side query.
  SELECT period_month INTO v_locked_month
  FROM   attendance_period_locks
  WHERE  tenant_id    = p_tenant_id
    AND  period_month = ANY(fn_months_in_range(v_row.from_date, v_row.to_date))
    AND  state         <> 'OPEN'
  ORDER BY period_month
  LIMIT 1;

  IF v_locked_month IS NOT NULL THEN
    RAISE EXCEPTION 'CONFLICT: PERIOD_LOCKED: Cannot cancel — the pay period % is locked. Reopen the period before cancelling this approved leave.', v_locked_month;
  END IF;

  UPDATE leave_applications
  SET    status = 'cancelled'
  WHERE  id        = p_application_id
    AND  tenant_id = p_tenant_id;

  IF p_is_paid AND p_days_to_restore IS NOT NULL AND p_days_to_restore > 0 THEN
    v_year := EXTRACT(YEAR FROM v_row.from_date)::INT;

    INSERT INTO leave_accrual_ledger (
      tenant_id, employee_id, leave_type_id, year, accrual_type,
      days, accrued_on, is_expired, notes, source_request_id
    ) VALUES (
      p_tenant_id, v_row.employee_id, v_row.leave_type_id, v_year, 'reversal',
      ABS(p_days_to_restore), CURRENT_DATE, false,
      'Leave reversal — cancelled application ' || v_row.from_date || '…' || v_row.to_date, p_application_id
    )
    ON CONFLICT (tenant_id, accrual_type, source_request_id, year) DO NOTHING;
    GET DIAGNOSTICS v_inserted = ROW_COUNT;

    -- Only restore the cache balance if the ledger row was actually new —
    -- mirrors reverse_leave_request_atomic's same guard, so a retried
    -- call (idempotency replay, client retry) can't double-credit.
    IF v_inserted THEN
      INSERT INTO employee_leave_balance (
        tenant_id, employee_id, leave_type_id, year, balance, updated_at
      ) VALUES (
        p_tenant_id, v_row.employee_id, v_row.leave_type_id, v_year, p_days_to_restore, now()
      )
      ON CONFLICT (tenant_id, employee_id, leave_type_id, year) DO UPDATE
        SET balance    = employee_leave_balance.balance + EXCLUDED.balance,
            updated_at = now();
    END IF;
  END IF;

  RETURN jsonb_build_object(
    'id',            v_row.id,
    'status',        'cancelled',
    'employee_id',   v_row.employee_id,
    'leave_type_id', v_row.leave_type_id,
    'from_date',     v_row.from_date,
    'to_date',       v_row.to_date,
    'days_restored', CASE WHEN v_inserted THEN p_days_to_restore ELSE 0 END
  );
END;
$$;

REVOKE EXECUTE ON FUNCTION cancel_legacy_leave_application_atomic(UUID, UUID, BOOLEAN, NUMERIC)
  FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION cancel_legacy_leave_application_atomic(UUID, UUID, BOOLEAN, NUMERIC)
  TO service_role;
