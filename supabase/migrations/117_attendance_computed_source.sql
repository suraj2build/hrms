-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 117 — attendance_daily.computed_source ownership column
--
-- Problem:
--   Multiple subsystems (engine, leave-approval, regularisation, manual entry)
--   all upsert attendance_daily with no ownership tracking. A recompute run
--   silently overwrites approved-leave rows, zeroing out the leave adjustment
--   and producing phantom LOP deductions on the next payroll.
--
-- Fix:
--   Add a computed_source column (text, NOT NULL, CHECK constrained).
--   The engine MUST NOT overwrite rows owned by 'leave_approval' or 'manual'.
--   Recompute operations filter to only update 'engine'-owned rows.
--
-- Values:
--   'engine'          — written by the attendance processing engine (default)
--   'leave_approval'  — set by the leave-approval pipeline
--   'regularization'  — set by an HR regularisation action
--   'manual'          — set by a direct HR manual override
--
-- Rollback:
--   ALTER TABLE attendance_daily DROP COLUMN computed_source;
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE attendance_daily
  ADD COLUMN IF NOT EXISTS computed_source text NOT NULL DEFAULT 'engine'
    CHECK (computed_source IN ('engine', 'leave_approval', 'regularization', 'manual'));

COMMENT ON COLUMN attendance_daily.computed_source IS
  'Identifies the subsystem that last wrote this row. '
  'The attendance engine MUST NOT overwrite rows with computed_source IN '
  '(''leave_approval'', ''manual'') — these are protected from engine rewrites. '
  '''regularization'' rows may be re-evaluated by HR but not by the automated engine.';

-- Index to support efficient "find engine-owned rows in date range" queries
-- used by the recompute protection filter.
CREATE INDEX IF NOT EXISTS idx_attendance_daily_source
  ON attendance_daily (tenant_id, employee_id, computed_source, date);

-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 118 (combined) — attendance_processing_lock TTL increase
--
-- Problem:
--   Default lock_ttl_seconds = 900 (15 minutes). Large tenants with many
--   employees can take >15 minutes to process, causing a stale-lock TTL
--   takeover mid-run — corrupting the run by starting a second concurrent job.
--
-- Fix:
--   Increase the default TTL to 3600 seconds (1 hour).
--   Update any existing rows that still have the old 900-second default.
--
-- Rollback:
--   UPDATE attendance_processing_lock SET lock_ttl_seconds = 900
--     WHERE lock_ttl_seconds = 3600;
--   ALTER TABLE attendance_processing_lock
--     ALTER COLUMN lock_ttl_seconds SET DEFAULT 900;
-- ─────────────────────────────────────────────────────────────────────────────

-- Increase the column default for new rows
ALTER TABLE attendance_processing_lock
  ALTER COLUMN lock_ttl_seconds SET DEFAULT 3600;

-- Migrate existing rows that still have the original 900-second default
UPDATE attendance_processing_lock
  SET lock_ttl_seconds = 3600
  WHERE lock_ttl_seconds = 900;

COMMENT ON COLUMN attendance_processing_lock.lock_ttl_seconds IS
  'Seconds before a running lock is considered stale (crashed job). '
  'Default 3600 (1 hour) — large tenants with many employees may take >15 min. '
  'Increase per-tenant if processing regularly exceeds this window.';
