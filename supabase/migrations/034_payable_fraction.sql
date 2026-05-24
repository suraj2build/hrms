-- ============================================================
-- 034_payable_fraction.sql
-- Add payroll-ready flags to attendance_daily.
--
-- is_payable:   whether the day counts as a paid day
-- day_fraction: the fraction of a day for payroll calculation
--               (0.0 = not payable, 0.5 = half day, 1.0 = full day)
--
-- Computation rules (applied in attendance-processor.ts):
--   present    → true,  1.0
--   late       → true,  1.0  (late penalty handled separately)
--   half_day   → true,  0.5
--   holiday    → true,  1.0  (public holiday — employee is paid)
--   weekend    → true,  1.0  (scheduled rest day)
--   weekly_off → true,  1.0  (scheduled off day)
--   leave (paid)   → true,  1.0  (set during leave approval)
--   leave (unpaid) → false, 0.0  (set during leave approval)
--   absent     → false, 0.0
--
-- No backfill — existing rows keep defaults until re-processed.
-- ============================================================

ALTER TABLE attendance_daily
  ADD COLUMN IF NOT EXISTS is_payable   BOOLEAN      NOT NULL DEFAULT false;

ALTER TABLE attendance_daily
  ADD COLUMN IF NOT EXISTS day_fraction DECIMAL(3,1) NOT NULL DEFAULT 0;
