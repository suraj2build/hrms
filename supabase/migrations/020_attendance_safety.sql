-- ─────────────────────────────────────────────────────────────────────────────
-- 020_attendance_safety.sql
--
-- Step 1: Add `processed` flag to attendance_raw_logs
--   - Processor only picks up unprocessed rows (WHERE processed = false)
--   - Matched rows are marked processed = true after successful processing
--   - Skipped/unmatched rows stay processed = false → retried on next run
--
-- Step 2: Add `is_complete` flag to attendance_logs
--   - true  → paired IN/OUT session (normal)
--   - false → IN with no OUT punch (still in session / device missed OUT)
-- ─────────────────────────────────────────────────────────────────────────────

-- ── Step 1: processed flag ────────────────────────────────────────────────────
ALTER TABLE attendance_raw_logs
  ADD COLUMN IF NOT EXISTS processed BOOLEAN NOT NULL DEFAULT FALSE;

-- Partial index — processor queries only unprocessed rows
CREATE INDEX IF NOT EXISTS idx_raw_logs_unprocessed
  ON attendance_raw_logs (tenant_id, timestamp)
  WHERE processed = FALSE;

-- ── Step 2: is_complete flag ──────────────────────────────────────────────────
ALTER TABLE attendance_logs
  ADD COLUMN IF NOT EXISTS is_complete BOOLEAN NOT NULL DEFAULT TRUE;

-- Index for querying incomplete sessions (e.g. still-active employees)
CREATE INDEX IF NOT EXISTS idx_attendance_logs_incomplete
  ON attendance_logs (tenant_id, employee_id)
  WHERE is_complete = FALSE;
