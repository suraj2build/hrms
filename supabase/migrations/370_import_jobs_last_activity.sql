-- 370_import_jobs_last_activity.sql
--
-- Add last_activity_at to import_jobs for heartbeat tracking.
-- The chunk executor stamps this column after every chunk so a watchdog
-- process (or the frontend) can detect stuck imports and surface them.
-- Complements current_chunk / total_chunks added in migration 364.

ALTER TABLE import_jobs
  ADD COLUMN IF NOT EXISTS last_activity_at TIMESTAMPTZ;

-- Index for watchdog queries: find jobs active in the last N minutes
CREATE INDEX IF NOT EXISTS idx_import_jobs_last_activity
  ON import_jobs (tenant_id, last_activity_at DESC)
  WHERE last_activity_at IS NOT NULL;
