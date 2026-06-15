-- ============================================================
-- 262_attendance_period_lock_enforcement.sql
--
-- AHI-2: Attendance Period Protection — authoritative backstop.
--
-- The application layer checks attendance_period_locks in a handful
-- of routes (muster upload, regularisation) but NOT in the core write
-- paths: recompute, batch process, WO-credit reconciler, comp-off,
-- overtime. That meant a finalized payroll period could still be
-- silently overwritten — by an API call OR a background scheduler.
--
-- This trigger is the single enforcement point that EVERY write to
-- attendance_daily must pass, regardless of which code path (route,
-- service, or cron job) issued it.
--
-- Scope — it blocks writes ONLY in the terminal PAYROLL_FINALIZED state,
-- the point at which attendance is sealed and must never change again.
-- Earlier states (LOCKED, PAYROLL_PROCESSING) are deliberately allowed
-- at the DB level because the payroll finalize routine itself recomputes
-- stale employees AFTER attendance is locked but BEFORE the slips are
-- sealed (see payroll/index.ts — "recomputing stale employees before
-- lock"). Blocking those states here would break that legitimate path.
--
-- The stricter "any non-OPEN" policy — refusing casual edits the moment
-- attendance is merely closed (LOCKED) — lives in the application layer
-- (period-lock.ts + the route guards), where it returns a clean 409 and
-- does not interfere with the payroll engine's internal recompute.
-- This trigger is the hard floor that even the engine respects: payroll
-- never recomputes a period it has already finalized.
-- ============================================================

CREATE OR REPLACE FUNCTION fn_block_locked_period_attendance_write()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE
  v_state TEXT;
  v_month TEXT;
BEGIN
  -- For DELETE, NEW is null — fall back to OLD.
  v_month := to_char(COALESCE(NEW.date, OLD.date), 'YYYY-MM');

  SELECT state INTO v_state
  FROM   attendance_period_locks
  WHERE  tenant_id    = COALESCE(NEW.tenant_id, OLD.tenant_id)
    AND  period_month = v_month;

  IF FOUND AND v_state = 'PAYROLL_FINALIZED' THEN
    RAISE EXCEPTION
      'PERIOD_FINALIZED: attendance for % is sealed (payroll finalized) and cannot be modified', v_month
      USING ERRCODE = 'check_violation',
            HINT    = 'Reverse the payroll finalization for this period before modifying attendance.';
  END IF;

  RETURN COALESCE(NEW, OLD);
END;
$$;

DROP TRIGGER IF EXISTS trg_block_locked_period_attendance ON attendance_daily;

CREATE TRIGGER trg_block_locked_period_attendance
  BEFORE INSERT OR UPDATE OR DELETE ON attendance_daily
  FOR EACH ROW
  EXECUTE FUNCTION fn_block_locked_period_attendance_write();
