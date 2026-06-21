-- ============================================================
-- 283_punch_logs_period_lock_enforcement.sql
--
-- ATTENDANCE P0-1 (DB backstop) — corrections could write source-of-truth
-- punches into a sealed month.
--
-- Migration 262 added fn_block_locked_period_attendance_write() but bound it ONLY
-- to attendance_daily. The corrections path (and any other punch writer) inserts
-- into attendance_punch_logs FIRST, then recomputes attendance_daily. So for a
-- PAYROLL_FINALIZED month the daily write was blocked by 262, but the punch rows
-- still landed in attendance_punch_logs — leaving punch_logs and attendance_daily
-- divergent, and re-surfacing on any later recompute.
--
-- This adds the same hard floor to attendance_punch_logs: no INSERT/UPDATE/DELETE
-- of a punch whose tenant-LOCAL month is PAYROLL_FINALIZED. Like 262 it blocks
-- ONLY the terminal finalized state — the LOCKED / PAYROLL_PROCESSING policy lives
-- in the application layer (period-lock.ts + the corrections route/worker guards),
-- so the payroll engine's legitimate pre-seal recompute is unaffected.
--
-- The punch's period month is derived in the tenant's timezone (punched_at is a
-- UTC instant; the period lock is keyed by the tenant-local YYYY-MM), matching how
-- the rest of the system attributes punches to a day/month.
-- ============================================================

CREATE OR REPLACE FUNCTION fn_block_locked_period_punch_write()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE
  v_state TEXT;
  v_month TEXT;
  v_tz    TEXT;
BEGIN
  SELECT timezone INTO v_tz
  FROM   tenants
  WHERE  id = COALESCE(NEW.tenant_id, OLD.tenant_id);

  -- Tenant-local month of the punch (punched_at is timestamptz / UTC).
  v_month := to_char(
    (COALESCE(NEW.punched_at, OLD.punched_at) AT TIME ZONE COALESCE(v_tz, 'UTC')),
    'YYYY-MM'
  );

  SELECT state INTO v_state
  FROM   attendance_period_locks
  WHERE  tenant_id    = COALESCE(NEW.tenant_id, OLD.tenant_id)
    AND  period_month = v_month;

  IF FOUND AND v_state = 'PAYROLL_FINALIZED' THEN
    RAISE EXCEPTION
      'PERIOD_FINALIZED: attendance for % is sealed (payroll finalized) and punches cannot be modified', v_month
      USING ERRCODE = 'check_violation',
            HINT    = 'Reverse the payroll finalization for this period before modifying punches.';
  END IF;

  RETURN COALESCE(NEW, OLD);
END;
$$;

DROP TRIGGER IF EXISTS trg_block_locked_period_punch ON attendance_punch_logs;

CREATE TRIGGER trg_block_locked_period_punch
  BEFORE INSERT OR UPDATE OR DELETE ON attendance_punch_logs
  FOR EACH ROW
  EXECUTE FUNCTION fn_block_locked_period_punch_write();
