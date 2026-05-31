-- Migration 205: Add cycle_start_day to payroll_groups
--
-- cycle_start_day defines the first day of the attendance period for a payroll group.
-- Combined with cutoff_day it fully describes the attendance window:
--
--   Standard calendar month  → cycle_start_day = 1,  cutoff_day = 31  (1st → last day)
--   Mid-month cycle          → cycle_start_day = 21, cutoff_day = 20  (21st → 20th of next month)
--
-- Default = 1 so all existing groups remain on the calendar-month model.

ALTER TABLE payroll_groups
  ADD COLUMN IF NOT EXISTS cycle_start_day INTEGER NOT NULL DEFAULT 1
    CHECK (cycle_start_day BETWEEN 1 AND 28);

COMMENT ON COLUMN payroll_groups.cycle_start_day IS
  'First day of the attendance period for this group (1–28). '
  'E.g. 1 = calendar month (1st→last), 21 = mid-month cycle (21st→20th of next month).';

-- Fix cutoff_day constraint: was capped at 28, must allow up to 31 (end of month).
-- Drop existing check constraint if present, then add the correct one.
ALTER TABLE payroll_groups
  DROP CONSTRAINT IF EXISTS payroll_groups_cutoff_day_check;

ALTER TABLE payroll_groups
  ADD CONSTRAINT payroll_groups_cutoff_day_check CHECK (cutoff_day BETWEEN 1 AND 31);
