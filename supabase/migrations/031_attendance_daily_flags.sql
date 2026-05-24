-- ============================================================
-- 031_attendance_daily_flags.sql
-- Add worked_on_weekly_off and worked_on_holiday flags to
-- attendance_daily so payroll can identify extra-day work
-- (e.g. employee punched in on their weekly off day or on a
-- public holiday) independently of the regular status field.
--
-- Both columns default false so existing rows are unaffected.
-- ============================================================

ALTER TABLE attendance_daily
  ADD COLUMN IF NOT EXISTS worked_on_weekly_off BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE attendance_daily
  ADD COLUMN IF NOT EXISTS worked_on_holiday BOOLEAN NOT NULL DEFAULT false;
