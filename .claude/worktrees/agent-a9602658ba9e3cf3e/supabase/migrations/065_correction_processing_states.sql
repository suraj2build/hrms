-- ============================================================
-- 065_correction_processing_states.sql
--
-- Hardens the attendance_corrections workflow with a
-- retry-safe async processing pipeline.
--
-- New lifecycle (replaces the old approved → applied path):
--
--   pending → processing → applied        (happy path)
--   pending → processing → failed         (recompute error, retryable)
--   pending → rejected                    (unchanged)
--
-- The legacy "approved" state is removed.  Rows still in
-- that state are migrated to "applied" so no data is lost.
--
-- New columns:
--   failure_reason        TEXT        — last recompute error message
--   retry_count           INT         — increments on each recompute failure
--   processing_started_at TIMESTAMPTZ — set when status moves to 'processing'
-- ============================================================

-- ── 1. New columns ────────────────────────────────────────────────────────────

ALTER TABLE attendance_corrections
  ADD COLUMN IF NOT EXISTS failure_reason         TEXT        NULL,
  ADD COLUMN IF NOT EXISTS retry_count            INT         NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS processing_started_at  TIMESTAMPTZ NULL;

-- ── 2. Safe data migration ────────────────────────────────────────────────────
-- Any row still in "approved" state was approved before this migration ran.
-- The attendance recompute already fired for these rows so they are effectively
-- applied.  Preserve their applied_at if it was already set; fall back to
-- approved_at or now() so the column is never NULL for applied rows.

UPDATE attendance_corrections
SET
  status     = 'applied',
  applied_at = COALESCE(applied_at, approved_at, now())
WHERE status = 'approved';

-- ── 3. Swap CHECK constraint ──────────────────────────────────────────────────
-- Drop both the old (migration 051) and the intermediate (migration 064) version.

ALTER TABLE attendance_corrections
  DROP CONSTRAINT IF EXISTS attendance_corrections_status_check;

ALTER TABLE attendance_corrections
  ADD CONSTRAINT attendance_corrections_status_check
    CHECK (status IN ('pending', 'processing', 'applied', 'failed', 'rejected'));

-- ── 4. Partial indexes for operational queries ────────────────────────────────

-- Fast lookup of rows that need manual attention
CREATE INDEX IF NOT EXISTS idx_corrections_failed
  ON attendance_corrections (tenant_id, created_at DESC)
  WHERE status = 'failed';

-- Detect stale/hung processing rows (useful for monitoring)
CREATE INDEX IF NOT EXISTS idx_corrections_processing
  ON attendance_corrections (tenant_id, processing_started_at DESC)
  WHERE status = 'processing';
