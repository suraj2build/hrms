-- ============================================================
-- 464_payroll_finalize_atomic_seal.sql
--
-- SYSTEM_AUDIT_2026-10-14 checkpoint 10 — the user correctly rejected
-- checkpoint 9's recheck_attendance_lock_for_finalize (migration 463) as
-- an actual fix, not just as "needs tightening": that RPC acquires the
-- shared advisory lock, re-reads attendance_period_locks.state, and
-- RETURNS — which COMMITS its own tiny transaction and releases the
-- lock immediately. The route then makes two SEPARATE, LATER Supabase
-- calls (Step 1: finalize payroll_slips, Step 2: finalize payroll_runs)
-- with no lock held across any of it. A concurrent unlock can land in
-- the gap between the recheck returning and Step 1/Step 2 actually
-- committing — exactly "validation and persistence protected
-- separately," not "together," which is what checkpoint 9 claimed to
-- fix and did not.
--
-- Fix: fuse the lock acquisition, the state re-check, AND the two
-- financial seal writes (Step 1 + Step 2) into ONE PL/pgSQL function,
-- one transaction. The advisory lock is held from the moment this
-- function starts until it returns (commit), so there is no window
-- between "confirmed locked" and "sealed" for a concurrent unlock to
-- land in — any concurrent lock_period_atomic/unlock_period_atomic call
-- for this month is forced to wait until this transaction ends,
-- regardless of how long Step 1/Step 2 take.
--
-- Deliberately NOT folded in (disclosed, not silently expanded):
--   - The freeze guard (payroll_freeze_log) — a different table with no
--     relationship to attendance_period_locks' advisory-lock namespace;
--     not the subject of this round's finding. Its own JS-side re-check
--     immediately before this RPC call is unchanged.
--   - The post-seal side effects (advance/loan schedule updates, G12
--     leave-encashment paid-flip, maker-checker commit, accounting
--     snapshot) — these already run AFTER the seal, already documented
--     as non-fatal/best-effort, and porting them into SQL is
--     disproportionate to the specific defect found (the seal itself
--     racing a concurrent unlock, not these bookkeeping steps).
--
-- Replaces the route's use of migration 463's
-- recheck_attendance_lock_for_finalize + the two separate Step 1/Step 2
-- Supabase-js calls. That RPC is left defined (not dropped) since
-- removing a shipped function is unnecessary churn and its own tests
-- remain valid evidence of the underlying primitive — but
-- routes/payroll/runs.ts no longer calls it.
-- ============================================================
-- Drop first: an earlier draft of this migration declared this function
-- with a 4-parameter signature (no p_check_attendance_lock); since
-- Postgres treats a different parameter list as a different overload,
-- CREATE OR REPLACE alone would leave both versions installed.
DROP FUNCTION IF EXISTS finalize_payroll_run_atomic(UUID, UUID, TEXT, UUID);

CREATE OR REPLACE FUNCTION finalize_payroll_run_atomic(
  p_tenant_id             UUID,
  p_run_id                UUID,
  p_month                 TEXT,
  p_actor_id              UUID,
  p_check_attendance_lock BOOLEAN DEFAULT true
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_state          TEXT;
  v_run_status     TEXT;
  v_slips_finalized INT;
  v_run_row        RECORD;
  v_now            TIMESTAMPTZ := now();
BEGIN
  -- Acquire the SAME per-(tenant, month) advisory lock every protected
  -- mutation RPC and the period-lock writer RPCs take (migration 462) —
  -- held for the remainder of THIS transaction, i.e. through both seal
  -- writes below. Any concurrent lock/unlock call for this month must
  -- wait until this transaction commits or rolls back. Taken even under
  -- force_finalize (p_check_attendance_lock = false): bypassing the
  -- GATE is a deliberate operator override, but two finalize calls still
  -- must not corrupt each other by racing.
  PERFORM fn_lock_period_months(p_tenant_id, ARRAY[p_month]);

  -- Re-verify the attendance-closure gate fresh, now that the lock is
  -- held — this is the authoritative check; the route's own earlier,
  -- unprotected read is only a fast-fail UX optimization. Skipped
  -- entirely when the caller passed force_finalize (mirrors the
  -- pre-existing bypass the JS-side gate already had).
  IF p_check_attendance_lock THEN
    SELECT state INTO v_state
    FROM   attendance_period_locks
    WHERE  tenant_id    = p_tenant_id
      AND  period_month = p_month;

    IF v_state IS NULL OR v_state = 'OPEN' THEN
      RAISE EXCEPTION 'CONFLICT: ATTENDANCE_REOPENED: Attendance for % is open (it was unlocked, or never locked, since this finalize began). Re-run finalize once the period is locked again.', p_month;
    END IF;
  END IF;

  -- Re-verify the run itself is still finalizable — same CAS condition
  -- Step 2 always enforced, now checked before Step 1 runs rather than
  -- only at the Step-2 write, so a losing caller never finalizes slips
  -- for a run someone else already sealed.
  SELECT id, status INTO v_run_row
  FROM   payroll_runs
  WHERE  id = p_run_id AND tenant_id = p_tenant_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'NOT_FOUND: Payroll run not found';
  END IF;

  v_run_status := v_run_row.status;
  IF v_run_status NOT IN ('draft', 'partial_failed') THEN
    RAISE EXCEPTION 'CONFLICT: RUN_STATE_CHANGED: This payroll run was finalized (or otherwise changed) by another request. Current status: %.', v_run_status;
  END IF;

  -- Step 1: finalize draft slips (idempotent — only matches 'draft').
  UPDATE payroll_slips
  SET    status = 'finalized'
  WHERE  run_id     = p_run_id
    AND  tenant_id  = p_tenant_id
    AND  status     = 'draft';
  GET DIAGNOSTICS v_slips_finalized = ROW_COUNT;

  -- Step 2: seal the run. The status filter is still the atomic
  -- compare-and-swap it always was — now simply inside the same
  -- transaction as Step 1 and the lock, instead of a later, separate
  -- call with nothing holding the lock in between.
  UPDATE payroll_runs
  SET    status       = 'finalized',
         finalized_by = p_actor_id,
         finalized_at = v_now
  WHERE  id        = p_run_id
    AND  tenant_id = p_tenant_id
    AND  status IN ('draft', 'partial_failed');

  RETURN jsonb_build_object(
    'run_id',           p_run_id,
    'status',           'finalized',
    'slips_finalized',  v_slips_finalized,
    'finalized_at',     v_now
  );
END;
$$;

REVOKE EXECUTE ON FUNCTION finalize_payroll_run_atomic(UUID, UUID, TEXT, UUID, BOOLEAN)
  FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION finalize_payroll_run_atomic(UUID, UUID, TEXT, UUID, BOOLEAN)
  TO service_role;
