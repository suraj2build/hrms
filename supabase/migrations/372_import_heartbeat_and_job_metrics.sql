-- 372_import_heartbeat_and_job_metrics.sql
--
-- Adds heartbeat tracking and job-level throughput metrics to import_jobs.
--
-- heartbeat_at  — stamped every ~5 seconds INSIDE chunk processing (not
--                 just after each chunk like last_activity_at). Operators
--                 can query: "any import whose heartbeat is > 60s stale
--                 but status is still 'importing'" to surface hung workers.
--
-- peak_chunk_ms — wall-clock time of the slowest chunk in this job.
--                 Identifies which chunk caused a timeout.
--
-- avg_rows_per_sec — overall throughput for the completed job.
--                    Allows trending analysis: is the DB getting slower?

ALTER TABLE import_jobs
  ADD COLUMN IF NOT EXISTS heartbeat_at      TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS peak_chunk_ms     INT,
  ADD COLUMN IF NOT EXISTS avg_rows_per_sec  NUMERIC(10, 2);

-- Watchdog index: find imports that stopped heartbeating but are still active
CREATE INDEX IF NOT EXISTS idx_import_jobs_heartbeat
  ON import_jobs (tenant_id, heartbeat_at DESC)
  WHERE heartbeat_at IS NOT NULL AND status = 'importing';
