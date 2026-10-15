-- ============================================================
-- 463_payroll_finalize_lock_recheck.sql
--
-- SYSTEM_AUDIT_2026-10-14 checkpoint 9 — the user's acceptance criteria
-- for checkpoint 8 named a specific, concrete concern: "Payroll
-- finalization must calculate from the protected state — not persist
-- results calculated before acquiring the lock."
--
-- Confirmed by reading routes/payroll/runs.ts's POST /payroll/runs/:id/
-- finalize in full: it reads attendance_period_locks.state as a gate
-- EXACTLY ONCE, near the top of the handler, via a plain unprotected
-- SELECT — no advisory lock, no re-check. Everything after that point
-- (a potentially long staleness-recompute loop over every employee with
-- a post-run-creation leave approval, then Step 1's slip-finalize write,
-- then Step 2's run-finalize write) runs on the assumption that the gate
-- result from minutes earlier is still true. The same file's own author
-- already recognised this exact class of staleness for a DIFFERENT
-- guard — the comment at Step 1 explicitly re-checks the FREEZE guard
-- "immediately before writing" because "the stale-employee recompute
-- loop above can run long enough for a concurrent POST /freeze... to
-- land in between" — but never applied that same re-check to the
-- attendance-lock gate sitting right next to it. If HR unlocks (or
-- never locked) the period while this finalize call is mid-flight, the
-- run can still finalize on a calculation made while believing the
-- period was closed.
--
-- Fix, scoped to exactly this gap (not a rewrite of the whole finalize
-- flow into one transaction — that flow spans slips, loan/advance
-- schedules, maker-checker, accounting and more, and converting all of
-- it into a single atomic RPC is out of proportion to the specific
-- defect found): a narrow atomic RPC that acquires the SAME per-(tenant,
-- month) advisory lock every other protected writer now acquires
-- (fn_lock_period_months, migration 462), then re-reads
-- attendance_period_locks.state fresh under that lock. Because any
-- concurrent lock/unlock/start-payroll/finalize call on
-- attendance_period_locks (migration 462's lock_period_atomic etc.) must
-- acquire the identical lock before it can mutate that row, this RPC's
-- read is guaranteed either to see a fully-committed state (the other
-- writer already finished) or to force that writer to wait until THIS
-- RPC's tiny transaction ends — the same mutual-exclusion guarantee
-- migration 462 gave the approval RPCs, now extended to this reader.
-- Called immediately before Step 1, alongside the existing freeze
-- re-check (not inside the staleness-recompute loop, and not held open
-- across Step 1/Step 2 — Supabase's client issues each statement as its
-- own transaction, so a lock can only usefully bracket ONE call here;
-- narrowing the window to "right before the write" is the same approach
-- the freeze re-check already uses for the same reason, stated in its
-- own comment).
--
-- Not attempted this round, disclosed rather than silently skipped: this
-- does not re-run the leave-staleness check for approvals that land in
-- the (much narrower) window between the recompute loop finishing and
-- this re-check — only the attendance-lock STATE itself is re-verified.
-- That narrower residual window is a smaller, lower-probability version
-- of a risk the existing recompute loop already mitigates; closing it
-- fully would require porting the recompute loop's slip computation into
-- SQL, out of scope for the concrete defect found.
-- ============================================================
CREATE OR REPLACE FUNCTION recheck_attendance_lock_for_finalize(
  p_tenant_id UUID,
  p_month     TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_state TEXT;
BEGIN
  PERFORM fn_lock_period_months(p_tenant_id, ARRAY[p_month]);

  SELECT state INTO v_state
  FROM   attendance_period_locks
  WHERE  tenant_id    = p_tenant_id
    AND  period_month = p_month;

  IF v_state IS NULL OR v_state = 'OPEN' THEN
    RAISE EXCEPTION 'CONFLICT: ATTENDANCE_REOPENED: Attendance for % is open (it was unlocked, or never locked, since this finalize began). Re-run finalize once the period is locked again.', p_month;
  END IF;

  RETURN jsonb_build_object('period_month', p_month, 'state', v_state);
END;
$$;

REVOKE EXECUTE ON FUNCTION recheck_attendance_lock_for_finalize(UUID, TEXT)
  FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION recheck_attendance_lock_for_finalize(UUID, TEXT)
  TO service_role;
