-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 377 — Partial idempotency index on background_jobs
--
-- Problem: the full-table UNIQUE constraint on idempotency_key blocks re-enqueueing
-- a job after its predecessor has completed or died. For payroll runs this means
-- payroll-run-<tenantId>-<month> can never be enqueued a second time once the
-- first run finishes, leaving the payroll_run row stuck in 'queued' with a ghost
-- job ID that no worker will ever pick up.
--
-- Fix: replace the full UNIQUE constraint with a partial UNIQUE index that only
-- prevents duplicate enqueues while a job is active (pending or running). Completed,
-- failed, and dead jobs no longer block the key, so re-runs can be enqueued freely.
--
-- Rollback:
--   DROP INDEX IF EXISTS idx_bg_jobs_idempotency_key_active;
--   ALTER TABLE background_jobs ADD CONSTRAINT background_jobs_idempotency_key_key UNIQUE (idempotency_key);
-- ─────────────────────────────────────────────────────────────────────────────

-- Drop the full-table unique constraint (created in migration 118).
-- IF NOT EXISTS guard is not available for DROP CONSTRAINT; use DO block.
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

-- Partial unique index: only one pending-or-running job per idempotency key.
-- Completed, failed, and dead jobs do not participate, allowing retriggers.
CREATE UNIQUE INDEX IF NOT EXISTS idx_bg_jobs_idempotency_key_active
  ON background_jobs (idempotency_key)
  WHERE status IN ('pending', 'running') AND idempotency_key IS NOT NULL;

COMMENT ON INDEX idx_bg_jobs_idempotency_key_active IS
  'Prevents duplicate active (pending/running) jobs for the same idempotency key. '
  'Completed/failed/dead jobs are excluded so the same key can be re-enqueued after '
  'the previous job reaches a terminal state (supports payroll re-runs).';
