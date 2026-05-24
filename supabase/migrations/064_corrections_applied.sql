-- ============================================================
-- 064_corrections_applied.sql
--
-- Extends the attendance_corrections workflow to support the
-- full status lifecycle:
--   pending → approved → applied
--   pending → rejected
--
-- Changes:
--   1. Add 'applied' to the status CHECK constraint
--   2. Add applied_at TIMESTAMPTZ NULL column (set when the
--      attendance_daily row is successfully recomputed after
--      approval)
-- ============================================================

-- Drop old CHECK and add new one
ALTER TABLE attendance_corrections
  DROP CONSTRAINT IF EXISTS attendance_corrections_status_check;

ALTER TABLE attendance_corrections
  ADD CONSTRAINT attendance_corrections_status_check
    CHECK (status IN ('pending', 'approved', 'rejected', 'applied'));

-- applied_at: populated by the API after recompute succeeds
ALTER TABLE attendance_corrections
  ADD COLUMN IF NOT EXISTS applied_at TIMESTAMPTZ NULL;

-- Index speeds up queries filtering on the new 'applied' status
CREATE INDEX IF NOT EXISTS idx_corrections_applied
  ON attendance_corrections (tenant_id, applied_at DESC)
  WHERE status = 'applied';
