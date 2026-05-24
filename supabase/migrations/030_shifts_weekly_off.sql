-- ============================================================
-- 030_shifts_weekly_off.sql
-- Add weekly_off_days to shifts + extend attendance_daily status.
--
-- weekly_off_days: int array, 0=Sun … 6=Sat
--   []      → no fixed weekly off (shift runs every day)
--   [0]     → Sunday off
--   [0,6]   → Saturday + Sunday off
-- ============================================================

ALTER TABLE shifts
  ADD COLUMN IF NOT EXISTS weekly_off_days INT[] NOT NULL DEFAULT '{}';

-- Extend the status check constraint on attendance_daily to include 'weekly_off'.
-- PostgreSQL auto-names inline CHECK constraints as {table}_{column}_check.
ALTER TABLE attendance_daily
  DROP CONSTRAINT IF EXISTS attendance_daily_status_check;

ALTER TABLE attendance_daily
  ADD CONSTRAINT attendance_daily_status_check
  CHECK (status IN ('present','absent','half_day','late','holiday','weekend','weekly_off'));
