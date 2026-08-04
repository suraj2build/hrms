-- ============================================================
-- 427_leave_year_boundary_split.sql
--
-- PEND-103 — leave requests spanning a calendar-year boundary (e.g.
-- Dec 28 - Jan 3) currently deduct/credit the ENTIRE request against a
-- single employee_leave_balance/leave_accrual_ledger year-bucket, keyed
-- off from_date's year only (approve_leave_request_atomic /
-- reverse_leave_request_atomic, migrations 425/422). This produces
-- either a false INSUFFICIENT_BALANCE rejection (the from_date year's
-- bucket alone doesn't cover the full request, even though the true
-- multi-bucket sum would) or a silent single-year over-draw (the other
-- year's bucket is never touched, leaving a phantom unused credit).
--
-- employee_leave_balance is already bucketed
-- UNIQUE(tenant_id, employee_id, leave_type_id, year) — the schema is
-- ready, the write path isn't. This migration removes the one remaining
-- blocker: leave_accrual_ledger's idempotency index only allows ONE
-- consumption/reversal row per source_request_id, regardless of year —
-- splitting a request's deduction across two year-buckets needs two
-- ledger rows, which the current index forbids.
--
-- Fix: widen uidx_accrual_ledger_request (271) to include `year`, so one
-- consumption/reversal row per (request, year) becomes possible instead
-- of per-request only. Idempotency semantics for every other accrual
-- type (co_grant, encashment, monthly/yearly/etc., all sharing this same
-- index) are unaffected — they already carry a `year` value on every
-- row, so adding it to the uniqueness key is a no-op for them.
-- ============================================================

DROP INDEX IF EXISTS uidx_accrual_ledger_request;

CREATE UNIQUE INDEX uidx_accrual_ledger_request
  ON leave_accrual_ledger (tenant_id, accrual_type, source_request_id, year);

-- ============================================================
-- approve_leave_request_atomic — bucket-array rewrite
--
-- p_days/p_year (single pair) replaced with p_buckets JSONB, an array of
-- {"year": int, "days": numeric} objects — one entry per calendar year
-- the request's days actually fall in (computed application-side from
-- leave_requests.duration_breakdown.per_day, see approval-service.ts).
-- A same-year request still produces a single-element array, so this is
-- a strict superset of the prior behavior, not a special case.
--
-- Every bucket's balance UPDATE remains strict (WHERE balance >= days,
-- no clamp) — if ANY bucket's own-year balance is short, the whole
-- transaction rolls back (RAISE EXCEPTION aborts the entire function,
-- undoing every bucket's deduction), preserving the prior all-or-nothing
-- semantics rather than partially deducting some years and not others.
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
  p_year          INT     -- retained only for the response payload's "primary" year (from_date's year); no longer drives balance/ledger writes
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
  v_bucket    RECORD;
BEGIN
  -- Serialize all concurrent approval attempts for this employee — closes the
  -- two-different-overlapping-PENDING-requests race described in 425.
  -- Released automatically at transaction end (commit or rollback).
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

  -- Overlap re-check (F9, 425): now that we hold the per-employee advisory
  -- lock, any sibling APPROVED request already committed is visible here.
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
  -- One iteration per year-bucket; any bucket's insufficient balance aborts
  -- the whole transaction (RAISE EXCEPTION), so no partial multi-year deduction
  -- can ever be left committed.
  IF p_is_paid THEN
    FOR v_bucket IN SELECT * FROM jsonb_to_recordset(p_buckets) AS x(year INT, days NUMERIC)
    LOOP
      -- STRICT deduct: only succeeds when this bucket's own-year balance >= its
      -- share of the requested days. No clamp.
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
        -- Insufficient balance in this year's bucket (or no balance row).
        -- Roll back the whole approval — every bucket, not just this one.
        RAISE EXCEPTION 'INSUFFICIENT_BALANCE: Insufficient leave balance for % (requested % day(s))', v_bucket.year, v_bucket.days;
      END IF;

      -- Authoritative signed consumption row, one per (request, year).
      -- Idempotent on the widened (tenant_id, accrual_type, source_request_id,
      -- year) index so a retry never re-debits any bucket.
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

-- Re-apply the same EXECUTE lockdown 421 established for the old signature —
-- a CREATE OR REPLACE with a changed parameter type (NUMERIC → JSONB) creates
-- a NEW function identity in Postgres, which defaults back to PUBLIC EXECUTE
-- on creation. Without this, the new signature would silently reopen the
-- exact SECURITY DEFINER privilege-escalation gap C9/421 closed.
REVOKE EXECUTE ON FUNCTION approve_leave_request_atomic(UUID, UUID, UUID, TIMESTAMPTZ, BOOLEAN, UUID, UUID, JSONB, INT)
  FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION approve_leave_request_atomic(UUID, UUID, UUID, TIMESTAMPTZ, BOOLEAN, UUID, UUID, JSONB, INT)
  TO service_role;

-- Drop the old 9-arg signature (p_days NUMERIC, p_year INT) — PostgREST/
-- supabase-js resolve overloaded RPC names by argument-name matching, and a
-- stale old-signature function left in place would silently keep matching
-- calls that still pass p_days/p_year, masking any caller not yet migrated
-- to p_buckets instead of failing loudly.
DROP FUNCTION IF EXISTS approve_leave_request_atomic(UUID, UUID, UUID, TIMESTAMPTZ, BOOLEAN, UUID, UUID, NUMERIC, INT);

-- ============================================================
-- reverse_leave_request_atomic — symmetric bucket-array rewrite
--
-- Same p_buckets JSONB parameter. Keeps 422's upsert-not-update fix
-- (a missing employee_leave_balance row is created, not silently
-- no-op'd) per bucket.
-- ============================================================

CREATE OR REPLACE FUNCTION reverse_leave_request_atomic(
  p_tenant_id     UUID,
  p_request_id    UUID,
  p_actor_id      UUID,
  p_is_paid       BOOLEAN,
  p_employee_id   UUID,
  p_leave_type_id UUID,
  p_buckets       JSONB,
  p_year          INT     -- retained only for the response payload; no longer drives balance/ledger writes
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
    FOR v_bucket IN SELECT * FROM jsonb_to_recordset(p_buckets) AS x(year INT, days NUMERIC)
    LOOP
      -- Idempotent credit-back row, one per (request, year).
      INSERT INTO leave_accrual_ledger (
        tenant_id, employee_id, leave_type_id, year, accrual_type,
        days, accrued_on, is_expired, notes, source_request_id
      ) VALUES (
        p_tenant_id, p_employee_id, p_leave_type_id, v_bucket.year, 'reversal',
        ABS(v_bucket.days), now()::date, false,
        'Leave reversal — cancelled approved ' || v_row.from_date || '…' || v_row.to_date, p_request_id
      )
      ON CONFLICT (tenant_id, accrual_type, source_request_id, year) DO NOTHING;

      GET DIAGNOSTICS v_inserted = ROW_COUNT;   -- 1 if inserted, 0 if duplicate for this bucket
      IF v_inserted THEN v_any_inserted := true; END IF;

      -- Restore this bucket's cache only when its ledger reversal row was
      -- newly written, so a retried reversal can't double-credit this year.
      -- Upsert so a missing balance row is created instead of silently
      -- affecting zero rows.
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

-- Re-apply the same EXECUTE lockdown 421/422 established — CREATE OR REPLACE
-- does not preserve prior REVOKE/GRANT state across a signature-compatible
-- redefinition in all Postgres versions, so pin it explicitly.
REVOKE EXECUTE ON FUNCTION reverse_leave_request_atomic(UUID, UUID, UUID, BOOLEAN, UUID, UUID, JSONB, INT)
  FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION reverse_leave_request_atomic(UUID, UUID, UUID, BOOLEAN, UUID, UUID, JSONB, INT)
  TO service_role;

DROP FUNCTION IF EXISTS reverse_leave_request_atomic(UUID, UUID, UUID, BOOLEAN, UUID, UUID, NUMERIC, INT);

-- ============================================================
-- Widen the 5 application-layer onConflict targets that share
-- uidx_accrual_ledger_request (co-grant, consumption, reversal,
-- encashment across leave.ts/comp-off.ts/accrual-engine.ts) to include
-- `year` — see apps/api's matching code change in this same commit.
-- No data migration needed: every existing row in leave_accrual_ledger
-- already carries a non-null `year` value (NOT NULL per 050), so the
-- widened index does not change which existing rows collide with each
-- other — it only allows a NEW row with the same
-- (tenant_id, accrual_type, source_request_id) but a DIFFERENT `year`
-- to coexist, which is exactly the split-bucket case this migration
-- exists to enable.
-- ============================================================
