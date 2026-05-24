-- =============================================================
-- 044_punch_logs_unique.sql
--
-- Add a unique constraint on attendance_punch_logs so that the
-- same employee cannot have two punches with the same direction
-- at the exact same timestamp.  This prevents duplicate inserts
-- from concurrent requests (e.g. double-tap on a kiosk button).
--
-- The constraint is a UNIQUE INDEX (rather than a table-level
-- UNIQUE constraint) so that Supabase .upsert({ ignoreDuplicates: true })
-- can target it by column list without needing a named constraint.
-- =============================================================

CREATE UNIQUE INDEX IF NOT EXISTS uidx_punch_logs_dedup
  ON attendance_punch_logs (tenant_id, employee_id, punched_at, direction);

-- Also add an index on punched_at for range queries that the engine
-- uses when fetching the shift-aware punch window.
CREATE INDEX IF NOT EXISTS idx_punch_logs_punched_at
  ON attendance_punch_logs (tenant_id, employee_id, punched_at)
  WHERE punched_at IS NOT NULL;
