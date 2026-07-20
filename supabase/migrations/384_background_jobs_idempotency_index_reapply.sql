-- ============================================================
-- 384_background_jobs_idempotency_index_reapply.sql
--
-- Re-apply migration 377 defensively. Live evidence (enqueue_background_job
-- itself, from migration 383, throwing "there is no unique or exclusion
-- constraint matching the ON CONFLICT specification" against its own
-- correctly-scoped `ON CONFLICT (idempotency_key) WHERE status IN
-- ('pending','running') AND idempotency_key IS NOT NULL`) proves the
-- partial index idx_bg_jobs_idempotency_key_active does not actually exist
-- in production, despite migration 377 being present in this repo — i.e.
-- 377 was never applied (or was rolled back) against the live database.
--
-- This migration is idempotent and safe to run regardless of the current
-- state: drops the old full-table UNIQUE constraint if it's still present,
-- and creates the partial index if it's missing.
-- ============================================================

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'background_jobs_idempotency_key_key'
      AND conrelid = 'background_jobs'::regclass
  ) THEN
    ALTER TABLE background_jobs DROP CONSTRAINT background_jobs_idempotency_key_key;
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS idx_bg_jobs_idempotency_key_active
  ON background_jobs (idempotency_key)
  WHERE status IN ('pending', 'running') AND idempotency_key IS NOT NULL;

COMMENT ON INDEX idx_bg_jobs_idempotency_key_active IS
  'Prevents duplicate active (pending/running) jobs for the same idempotency key. '
  'Completed/failed/dead jobs are excluded so the same key can be re-enqueued after '
  'the previous job reaches a terminal state (supports payroll re-runs).';

NOTIFY pgrst, 'reload schema';
