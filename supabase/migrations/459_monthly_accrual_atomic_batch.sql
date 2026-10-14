-- ============================================================
-- 459_monthly_accrual_atomic_batch.sql
--
-- SYSTEM_AUDIT_2026-10-14 item 1 (Monthly Leave Accrual transactionality).
--
-- runMonthlyAccrual() (accrual-engine.ts) claims the run atomically
-- (migration 454) but then does the actual crediting as THREE separate
-- PostgREST round trips with no shared transaction:
--   1. a pre-fetch SELECT of employee_leave_balance (no .range() — silently
--      capped at PostgREST's max-rows=1000 for any tenant whose
--      employee-count × leave-type-year rows exceed it; a row the fetch
--      missed is treated as `?? 0`, so a real existing balance is silently
--      OVERWRITTEN to `0 + days` instead of `existing + days` once past
--      that ceiling — the exact CLAUDE.md "never .limit() a complete
--      dataset" failure mode, confirmed here on the one query in this file
--      that was never routed through fetchAllRows()),
--   2. an unconditional upsert of employee_leave_balance computed from that
--      pre-fetch ("currentBalance + days", a client-side read-then-write,
--      not an atomic increment) plus a plain INSERT into
--      leave_balance_ledger with NO idempotency check at all,
--   3. a SEPARATE pre-check-then-insert into leave_accrual_ledger.
-- If the process dies between any of these three, or a second overlapping
-- run resumes a stale 'running' claim, a retry re-derives "currentBalance"
-- from the ALREADY-credited balance and adds `days` again — a real
-- double-credit on employee_leave_balance and an unconditional duplicate
-- row in leave_balance_ledger (leave_accrual_ledger alone was guarded).
-- None of the three steps is safe against a concurrent leave
-- approval/cancellation touching the same employee_leave_balance row
-- between step 1's read and step 2's write (classic lost update).
--
-- Fix: push the whole per-batch credit operation into ONE SQL statement
-- inside a single function call (one transaction, one round trip), using a
-- true atomic increment (`balance = balance + delta`, never a client-
-- computed absolute SET) so Postgres's own row lock — not application code
-- — serializes it against deduct_leave_balance/credit_leave_balance/
-- checked_deduct_leave_balance, and an idempotency check against
-- leave_accrual_ledger's existing unique index INSIDE that same statement
-- so a retry (whether from a crashed process or a reclaimed stale 'running'
-- run) can never re-credit an employee already credited by a prior
-- attempt of the same run. The caller (accrual-engine.ts) now chunks
-- employees into batches and calls this once per chunk — each chunk
-- commits (or rolls back) as one unit, so an interruption between chunks
-- leaves only whole, already-idempotent chunks done and the remainder
-- still to do; nothing is ever torn mid-chunk, and nothing is ever
-- double-credited across chunks or across retries.
-- ============================================================

CREATE OR REPLACE FUNCTION credit_monthly_accrual_batch(
  p_tenant_id       UUID,
  p_leave_type_id   UUID,
  p_year            INT,
  p_period_last_day DATE,
  p_run_period      TEXT,
  p_employee_days   JSONB   -- [{"employee_id": "...", "days": 1.5}, ...]
) RETURNS TABLE(employees_credited INT, total_days NUMERIC)
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_credited INT;
  v_total    NUMERIC;
BEGIN
  WITH input_rows AS (
    SELECT (elem->>'employee_id')::UUID AS employee_id,
           (elem->>'days')::NUMERIC     AS days
    FROM jsonb_array_elements(p_employee_days) elem
  ),
  todo AS (
    -- Idempotency: an employee already credited for this exact
    -- (tenant, leave type, year, 'monthly', period-end-date) by a PRIOR
    -- attempt of this same run (crashed-then-retried, or a reclaimed stale
    -- 'running' claim) is excluded here — this is the one check that makes
    -- re-running this function for the same batch safe to call any number
    -- of times.
    SELECT ir.employee_id, ir.days
    FROM input_rows ir
    WHERE ir.days > 0
      AND NOT EXISTS (
        SELECT 1 FROM leave_accrual_ledger al
        WHERE al.tenant_id     = p_tenant_id
          AND al.employee_id   = ir.employee_id
          AND al.leave_type_id = p_leave_type_id
          AND al.year          = p_year
          AND al.accrual_type  = 'monthly'
          AND al.accrued_on    = p_period_last_day
      )
  ),
  upserted_balance AS (
    -- Atomic increment, never a client-computed absolute SET: Postgres's
    -- own row lock on employee_leave_balance serializes this against any
    -- concurrent deduct_leave_balance/credit_leave_balance/
    -- checked_deduct_leave_balance call touching the same row (leave
    -- approval, cancellation, encashment) — whichever commits second sees
    -- the first's committed value and adds onto it, never overwrites it.
    INSERT INTO employee_leave_balance (tenant_id, employee_id, leave_type_id, year, balance, updated_at)
    SELECT p_tenant_id, t.employee_id, p_leave_type_id, p_year, t.days, now()
    FROM todo t
    ON CONFLICT (tenant_id, employee_id, leave_type_id, year)
    DO UPDATE SET balance    = employee_leave_balance.balance + EXCLUDED.balance,
                  updated_at = now()
    RETURNING employee_id, balance
  ),
  ledger_ins AS (
    INSERT INTO leave_balance_ledger (tenant_id, employee_id, leave_type_id, year, txn_type, delta, balance_after, notes)
    SELECT p_tenant_id, t.employee_id, p_leave_type_id, p_year, 'accrual', t.days, ub.balance,
           'Monthly accrual — ' || p_run_period
    FROM todo t
    JOIN upserted_balance ub ON ub.employee_id = t.employee_id
    RETURNING employee_id
  ),
  accrual_ins AS (
    INSERT INTO leave_accrual_ledger (tenant_id, employee_id, leave_type_id, year, accrual_type, days, accrued_on, is_expired, notes)
    SELECT p_tenant_id, t.employee_id, p_leave_type_id, p_year, 'monthly', t.days, p_period_last_day, false,
           'Monthly accrual — ' || p_run_period
    FROM todo t
    -- Matches the partial unique index's own predicate (uidx_accrual_ledger_
    -- idempotency, migration 387) exactly, so Postgres can use it as the
    -- ON CONFLICT arbiter — the same partial index PostgREST's client-side
    -- upsert(onConflict:) could never target from the old JS pre-check.
    ON CONFLICT (tenant_id, employee_id, leave_type_id, year, accrual_type, accrued_on)
      WHERE accrual_type IN ('monthly','quarterly','yearly','upfront','carry_forward','co_grant','wo_credit','advance_accrual','prorated_accrual')
    DO NOTHING
    RETURNING days
  )
  SELECT count(*)::INT, coalesce(sum(days), 0) INTO v_credited, v_total FROM accrual_ins;

  RETURN QUERY SELECT v_credited, v_total;
END;
$$;

ALTER FUNCTION credit_monthly_accrual_batch(UUID, UUID, INT, DATE, TEXT, JSONB) SET search_path = public;

REVOKE EXECUTE ON FUNCTION credit_monthly_accrual_batch(UUID, UUID, INT, DATE, TEXT, JSONB)
  FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION credit_monthly_accrual_batch(UUID, UUID, INT, DATE, TEXT, JSONB)
  TO service_role;

-- ── Stale 'running' claims become reclaimable ────────────────────────────
-- Previously claimAccrualRun() only reclaimed 'partial'/'failed' runs — a
-- process that crashed after claiming (INSERT ... status='running') but
-- before the finalizing UPDATE left that run stuck in 'running' FOREVER,
-- un-retryable by design. That was safe-but-permanent under the OLD
-- non-idempotent crediting loop (resuming it risked double-crediting
-- whatever the crashed attempt had already written). It is no longer
-- necessary now that crediting goes through credit_monthly_accrual_batch's
-- per-employee idempotency check above: resuming a stale 'running' run
-- just re-skips whoever was already credited and continues with the rest.
-- This column lets the caller distinguish "genuinely in progress right
-- now" from "claimed by a process that is no longer around" using a
-- timeout, without guessing from ran_at alone (ran_at is also stamped on
-- successful completion, so a fixed age threshold on it is the right
-- signal: a 'running' row whose ran_at is old was never finalized).
COMMENT ON COLUMN leave_accrual_runs.ran_at IS
  'Stamped when a run is claimed AND when it finalizes. A ''running'' row whose ran_at is older than the caller''s stale-claim threshold was claimed by a process that crashed before finalizing and is safe to reclaim — see credit_monthly_accrual_batch''s per-employee idempotency check in migration 459.';
