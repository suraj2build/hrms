-- ============================================================
-- 138_payroll_slip_numeric_days.sql
--
-- Fix schema mismatch: payroll_slips.payable_days and lop_days
-- were declared as INT but the payroll engine computes NUMERIC
-- values (half-days produce 0.5, 1.5, etc. via day_fraction).
--
-- An INT column silently truncates 12.5 → 12, destroying half-day
-- precision and producing incorrect payable/LOP calculations.
--
-- This migration changes both columns to NUMERIC(6,2) to match
-- what fetchAttendanceSummary() actually returns.
-- ============================================================

ALTER TABLE payroll_slips
  ALTER COLUMN payable_days TYPE NUMERIC(6,2) USING payable_days::NUMERIC(6,2),
  ALTER COLUMN lop_days     TYPE NUMERIC(6,2) USING lop_days::NUMERIC(6,2);

COMMENT ON COLUMN payroll_slips.payable_days IS
  'Payable days in the month (NUMERIC — half-days count as 0.5). '
  'Sum of attendance_daily.day_fraction for is_payable rows.';

COMMENT ON COLUMN payroll_slips.lop_days IS
  'Loss-of-Pay days (NUMERIC — half-days count as 0.5). '
  'Sum of (1.0 - day_fraction) for each day in the period.';
