-- 374_import_job_metrics.sql
--
-- Per-chunk operational metrics for the enterprise import platform.
--
-- One row is inserted after every chunk completes. Provides the raw
-- data for throughput trending, outlier detection, and SLA monitoring.
--
-- Use cases:
--   • Find the slowest chunk in a large import (peak_chunk_ms)
--   • Detect throughput degradation over time (rows_per_second trend)
--   • Count retry storms (retry_count per chunk)
--   • Estimate time-to-completion for future imports of similar size
--
-- Distinct from import_job_chunks (which tracks chunk STATE) —
-- this table tracks chunk PERFORMANCE without bloating the state table.

CREATE TABLE IF NOT EXISTS import_job_metrics (
  id                UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  import_job_id     UUID        NOT NULL REFERENCES import_jobs(id) ON DELETE CASCADE,
  tenant_id         UUID        NOT NULL,
  chunk_no          INT         NOT NULL,
  chunk_duration_ms INT,                      -- wall-clock: from chunk start to DB update
  db_write_ms       INT,                      -- time inside processChunk (DB writes only)
  rows_per_second   NUMERIC(10, 2),
  success_count     INT         NOT NULL DEFAULT 0,
  failure_count     INT         NOT NULL DEFAULT 0,
  retry_count       INT         NOT NULL DEFAULT 0,
  recorded_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_import_job_metrics_job
  ON import_job_metrics (import_job_id, chunk_no);

ALTER TABLE import_job_metrics ENABLE ROW LEVEL SECURITY;

CREATE POLICY "ijm_tenant_read"
  ON import_job_metrics FOR SELECT
  USING (tenant_id = get_user_tenant_id());

CREATE POLICY "ijm_hr_write"
  ON import_job_metrics FOR ALL
  USING (get_user_role() IN ('super_admin', 'hr_admin'));
