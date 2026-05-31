-- Migration 024: Add skipped_codes array to attendance_processing_runs
--
-- Previously only `skipped_count` (INT) was stored.  This column preserves the
-- actual employee_code strings so operators can identify which devices/badges
-- need attention without re-running the processor.
--
-- Old rows default to '{}' — safe, no backfill needed.

ALTER TABLE attendance_processing_runs
  ADD COLUMN IF NOT EXISTS skipped_codes TEXT[] NOT NULL DEFAULT '{}';
