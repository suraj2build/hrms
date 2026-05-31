-- ─────────────────────────────────────────────────────────────────────────────
-- 137_attendance_daily_computed_source.sql
--
-- Problem (confirmed via live DB probe 2026-05-17):
--   The `computed_source` column is missing from attendance_daily in production.
--   Migration 117 created the file but was never pushed to the live database.
--
--   Impact: every call to recomputeRange() (including the fire-and-forget
--   recompute triggered by POST /attendance/upload) fails with:
--     "attendance_daily batch upsert failed: Could not find the 'computed_source'
--      column of 'attendance_daily' in the schema cache"
--   The error is silently swallowed by the fire-and-forget wrapper, so the API
--   returns 200 but attendance_daily is never populated.
--
-- Fix (idempotent — safe to run on any DB state):
--   1. Add computed_source column if not already present.
--   2. Rebuild the status CHECK constraint to include ALL engine-generated
--      status values ('weekly_off', 'leave') in case migration 033 was not
--      fully applied.  Uses DROP IF EXISTS + ADD so it is always idempotent.
--   3. Create the supporting index (IF NOT EXISTS).
--   4. Reload PostgREST schema cache.
-- ─────────────────────────────────────────────────────────────────────────────

-- ── 1. Add computed_source ────────────────────────────────────────────────────

ALTER TABLE attendance_daily
  ADD COLUMN IF NOT EXISTS computed_source TEXT NOT NULL DEFAULT 'engine'
    CHECK (computed_source IN ('engine', 'leave_approval', 'regularization', 'manual'));

COMMENT ON COLUMN attendance_daily.computed_source IS
  'Identifies the subsystem that last wrote this row. '
  'The attendance engine MUST NOT overwrite rows with computed_source IN '
  '(''leave_approval'', ''manual'') — these are protected from engine rewrites. '
  '''regularization'' rows may be re-evaluated by HR but not by the automated engine.';

-- ── 2. Ensure status CHECK includes all engine-generated values ───────────────
-- Drop and recreate so this migration is idempotent regardless of which prior
-- migrations ran.  The full allowed set is the union of all values ever produced
-- by the engine, the leave pipeline, and the original schema.

ALTER TABLE attendance_daily
  DROP CONSTRAINT IF EXISTS attendance_daily_status_check;

ALTER TABLE attendance_daily
  ADD CONSTRAINT attendance_daily_status_check
  CHECK (status IN (
    'present', 'absent', 'half_day', 'late',
    'holiday', 'weekend', 'weekly_off', 'leave'
  ));

-- ── 3. Supporting index ───────────────────────────────────────────────────────

CREATE INDEX IF NOT EXISTS idx_attendance_daily_source
  ON attendance_daily (tenant_id, employee_id, computed_source, date);

-- ── 4. PostgREST schema cache reload ─────────────────────────────────────────

NOTIFY pgrst, 'reload schema';
