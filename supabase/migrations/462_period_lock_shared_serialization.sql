-- ============================================================
-- 462_period_lock_shared_serialization.sql
--
-- SYSTEM_AUDIT_2026-10-14 checkpoint 7, continued — the user correctly
-- rejected checkpoint 7's claim that migration 461 "closes the race."
-- It does not. 461 only moved the lock-check into the SAME transaction
-- as the protected mutation — but that check is still just a plain
-- SELECT against attendance_period_locks, with no lock of its own. It
-- only catches the ONE ordering where the period-lock INSERT/UPDATE in
-- period-locks.ts already committed before the mutation's SELECT runs.
-- It does nothing for the complementary ordering: the mutation's SELECT
-- runs first (correctly observing OPEN, since the lock genuinely hasn't
-- committed yet), the mutation proceeds and commits, and the period-lock
-- write commits microseconds later — a real, uncaught race, not a
-- "well-defined either way" outcome as 461's header claimed. 461's own
-- Part 4 stochastic test actually surfaced this: "all resolved 'approve
-- wins'" was recorded as if that were fine; it is not independently
-- proven to be the INTENDED contract, and nothing serializes the two
-- writers against each other — 461 never inspected the lock-creation
-- writer (period-locks.ts) at all, which remained four plain
-- Supabase-js UPDATE/INSERT calls with no shared mechanism.
--
-- Fix: a single mutual-exclusion primitive both writer classes acquire
-- BEFORE deciding anything — a Postgres advisory lock keyed by
-- (tenant_id, period_month), held for the life of the transaction
-- (pg_advisory_xact_lock, auto-released on commit/rollback). This works
-- even when no attendance_period_locks ROW exists yet for that month
-- (the lock key is independent of row existence — the exact case a
-- FOR UPDATE row lock cannot cover, and the user explicitly asked to be
-- tested). Whichever writer acquires the lock for a given month first
-- forces the other to wait until it commits or rolls back; the waiting
-- writer's own subsequent reads are then guaranteed to see the first
-- writer's committed result (READ COMMITTED semantics), so there is a
-- genuine total order per month, not a best-effort check.
--
-- fn_lock_period_months() is the one place this key is constructed —
-- period-locks.ts's four writer RPCs (NEW this migration) and every
-- mutation RPC from 461 (re-created here to call it) use the identical
-- function, so the key format can never drift between the two sides.
-- Multi-month ranges acquire their locks in ascending sorted order
-- (fn_months_in_range already returns a sorted array; the loop below
-- preserves that order) — a standard lock-ordering discipline so two
-- transactions that each span multiple overlapping months can never
-- deadlock each other by acquiring in different orders. Lock-creation
-- only ever touches one month per call, so it can never be one half of
-- such a cycle; Postgres's own deadlock detector remains the backstop
-- for any case this analysis missed.
-- ============================================================

-- ── Shared primitive: take the advisory lock for every month in the set,
--    in ascending sorted order, before the caller does anything else. ──
CREATE OR REPLACE FUNCTION fn_lock_period_months(p_tenant_id UUID, p_months TEXT[])
RETURNS VOID
LANGUAGE plpgsql
AS $$
DECLARE
  v_month TEXT;
BEGIN
  FOR v_month IN SELECT DISTINCT unnest(p_months) ORDER BY 1
  LOOP
    PERFORM pg_advisory_xact_lock(hashtextextended(p_tenant_id::text || ':period:' || v_month, 0));
  END LOOP;
END;
$$;

-- ============================================================
-- Period-lock WRITER side — routes/attendance/period-locks.ts.
-- Previously four plain Supabase-js UPDATE/INSERT calls (CAS via a
-- folded WHERE clause, but no lock of any kind — the exact asymmetry
-- the user flagged). Each now takes the SAME advisory lock as the
-- mutation-side RPCs below, for the one month it operates on, before
-- touching the table.
-- ============================================================

CREATE OR REPLACE FUNCTION lock_period_atomic(
  p_tenant_id UUID,
  p_month     TEXT,
  p_actor_id  UUID,
  p_reason    TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_now  TIMESTAMPTZ := now();
  v_row  RECORD;
BEGIN
  PERFORM fn_lock_period_months(p_tenant_id, ARRAY[p_month]);

  UPDATE attendance_period_locks
  SET    state       = 'LOCKED',
         locked_by   = p_actor_id,
         locked_at   = v_now,
         lock_reason = p_reason,
         updated_at  = v_now
  WHERE  tenant_id    = p_tenant_id
    AND  period_month = p_month
    AND  state NOT IN ('PAYROLL_PROCESSING', 'PAYROLL_FINALIZED')
  RETURNING id, period_month, state, locked_at, lock_reason
  INTO v_row;

  IF FOUND THEN
    RETURN jsonb_build_object('id', v_row.id, 'period_month', v_row.period_month,
      'state', v_row.state, 'locked_at', v_row.locked_at, 'lock_reason', v_row.lock_reason);
  END IF;

  -- No row updated — either no row exists yet for this month (first-ever
  -- lock, the case the user specifically asked to be tested), or one
  -- exists but is already PAYROLL_PROCESSING/PAYROLL_FINALIZED. Holding
  -- the advisory lock means no concurrent caller for this SAME month can
  -- be racing this insert — a 23505 here can only mean the row already
  -- exists in a disallowed state, not a concurrent first-lock collision.
  BEGIN
    INSERT INTO attendance_period_locks (
      tenant_id, period_month, state, locked_by, locked_at, lock_reason, updated_at
    ) VALUES (
      p_tenant_id, p_month, 'LOCKED', p_actor_id, v_now, p_reason, v_now
    )
    RETURNING id, period_month, state, locked_at, lock_reason
    INTO v_row;
  EXCEPTION WHEN unique_violation THEN
    RAISE EXCEPTION 'CONFLICT: INVALID_TRANSITION: Cannot lock a period that is already in payroll processing or finalized';
  END;

  RETURN jsonb_build_object('id', v_row.id, 'period_month', v_row.period_month,
    'state', v_row.state, 'locked_at', v_row.locked_at, 'lock_reason', v_row.lock_reason);
END;
$$;

REVOKE EXECUTE ON FUNCTION lock_period_atomic(UUID, TEXT, UUID, TEXT) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION lock_period_atomic(UUID, TEXT, UUID, TEXT) TO service_role;

CREATE OR REPLACE FUNCTION unlock_period_atomic(
  p_tenant_id UUID,
  p_month     TEXT,
  p_actor_id  UUID,
  p_reason    TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_now TIMESTAMPTZ := now();
  v_row RECORD;
BEGIN
  PERFORM fn_lock_period_months(p_tenant_id, ARRAY[p_month]);

  UPDATE attendance_period_locks
  SET    state         = 'OPEN',
         unlocked_by   = p_actor_id,
         unlocked_at   = v_now,
         unlock_reason = p_reason,
         updated_at    = v_now
  WHERE  tenant_id    = p_tenant_id
    AND  period_month = p_month
  RETURNING id, period_month, state
  INTO v_row;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'NOT_FOUND: Period lock record not found';
  END IF;

  RETURN jsonb_build_object('id', v_row.id, 'period_month', v_row.period_month, 'state', v_row.state);
END;
$$;

REVOKE EXECUTE ON FUNCTION unlock_period_atomic(UUID, TEXT, UUID, TEXT) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION unlock_period_atomic(UUID, TEXT, UUID, TEXT) TO service_role;

CREATE OR REPLACE FUNCTION start_payroll_processing_atomic(
  p_tenant_id UUID,
  p_month     TEXT,
  p_actor_id  UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_now TIMESTAMPTZ := now();
  v_row RECORD;
BEGIN
  PERFORM fn_lock_period_months(p_tenant_id, ARRAY[p_month]);

  UPDATE attendance_period_locks
  SET    state              = 'PAYROLL_PROCESSING',
         payroll_started_by = p_actor_id,
         payroll_started_at = v_now,
         updated_at         = v_now
  WHERE  tenant_id    = p_tenant_id
    AND  period_month = p_month
    AND  state        = 'LOCKED'
  RETURNING id, period_month, state
  INTO v_row;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'CONFLICT: INVALID_TRANSITION: Period must be LOCKED before starting payroll processing';
  END IF;

  RETURN jsonb_build_object('id', v_row.id, 'period_month', v_row.period_month, 'state', v_row.state);
END;
$$;

REVOKE EXECUTE ON FUNCTION start_payroll_processing_atomic(UUID, TEXT, UUID) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION start_payroll_processing_atomic(UUID, TEXT, UUID) TO service_role;

CREATE OR REPLACE FUNCTION finalize_period_atomic(
  p_tenant_id UUID,
  p_month     TEXT,
  p_actor_id  UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_now TIMESTAMPTZ := now();
  v_row RECORD;
BEGIN
  PERFORM fn_lock_period_months(p_tenant_id, ARRAY[p_month]);

  UPDATE attendance_period_locks
  SET    state        = 'PAYROLL_FINALIZED',
         finalized_by = p_actor_id,
         finalized_at = v_now,
         updated_at   = v_now
  WHERE  tenant_id    = p_tenant_id
    AND  period_month = p_month
    AND  state        = 'PAYROLL_PROCESSING'
  RETURNING id, period_month, state, finalized_at
  INTO v_row;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'CONFLICT: INVALID_TRANSITION: Period must be in PAYROLL_PROCESSING before finalization';
  END IF;

  RETURN jsonb_build_object('id', v_row.id, 'period_month', v_row.period_month,
    'state', v_row.state, 'finalized_at', v_row.finalized_at);
END;
$$;

REVOKE EXECUTE ON FUNCTION finalize_period_atomic(UUID, TEXT, UUID) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION finalize_period_atomic(UUID, TEXT, UUID) TO service_role;

-- ============================================================
-- Mutation side — every RPC from migration 461 re-created to acquire
-- fn_lock_period_months() for its date range/date BEFORE its existing
-- lock-check SELECT (kept — it still produces the specific locked-month
-- error message, and is now genuinely race-free rather than merely
-- "usually right"). Signatures are unchanged from 461.
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

  -- Shared mutual-exclusion lock with the period-lock writer (see
  -- migration header) — acquired BEFORE the check below, so the check
  -- that follows is now guaranteed race-free, not merely usually right.
  PERFORM fn_lock_period_months(p_tenant_id, fn_months_in_range(v_row.from_date, v_row.to_date));

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

  PERFORM fn_lock_period_months(p_tenant_id, fn_months_in_range(v_row.from_date, v_row.to_date));

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
  v_month        TEXT;
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

  v_month := to_char(v_row.date, 'YYYY-MM');
  PERFORM fn_lock_period_months(p_tenant_id, ARRAY[v_month]);

  SELECT period_month INTO v_locked_month
  FROM   attendance_period_locks
  WHERE  tenant_id    = p_tenant_id
    AND  period_month = v_month
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

  PERFORM fn_lock_period_months(p_tenant_id, fn_months_in_range(v_row.from_date, v_row.to_date));

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
  v_month        TEXT;
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

  v_month := to_char(v_row.worked_date, 'YYYY-MM');
  PERFORM fn_lock_period_months(p_tenant_id, ARRAY[v_month]);

  SELECT period_month INTO v_locked_month
  FROM   attendance_period_locks
  WHERE  tenant_id    = p_tenant_id
    AND  period_month = v_month
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
  v_month        TEXT;
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

  v_month := to_char(v_row.attendance_date, 'YYYY-MM');
  PERFORM fn_lock_period_months(p_tenant_id, ARRAY[v_month]);

  SELECT period_month INTO v_locked_month
  FROM   attendance_period_locks
  WHERE  tenant_id    = p_tenant_id
    AND  period_month = v_month
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

  PERFORM fn_lock_period_months(p_tenant_id, fn_months_in_range(v_row.from_date, v_row.to_date));

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
