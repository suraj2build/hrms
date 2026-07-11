-- 373_import_error_classification.sql
--
-- Add error_category to import_job_errors for retry classification.
--
-- permanent  — validation failures, FK not found, duplicate key.
--              Retrying this row with the same data will always fail.
--              Fix the source data and re-import.
--
-- retryable  — transient infrastructure failures: DB timeout,
--              connection lost, Supabase 503/429.
--              The durable queue can safely retry only these chunks.
--
-- fatal      — job-level failures: manifest mismatch, schema version
--              incompatibility, cross-tenant template reuse.
--              The entire import must be restarted from scratch.

ALTER TABLE import_job_errors
  ADD COLUMN IF NOT EXISTS error_category TEXT
  CHECK (error_category IN ('permanent', 'retryable', 'fatal'));

-- Index for filtering by category in the error report UI
CREATE INDEX IF NOT EXISTS idx_import_job_errors_category
  ON import_job_errors (import_job_id, error_category)
  WHERE error_category IS NOT NULL;
