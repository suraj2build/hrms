-- ================================================================
-- 362_attendance_upload_jobs.sql
--
-- Async job-tracking table for bulk attendance CSV uploads.
--
-- Large CSV files (500 k+ rows) previously caused HTTP timeouts.
-- The upload route now returns 202 immediately with a job_id, then
-- processes the file in the background and writes progress here.
-- The frontend polls GET /attendance/upload/jobs/:id for live status.
-- ================================================================

CREATE TABLE IF NOT EXISTS attendance_upload_jobs (
  id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id        UUID        NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  created_by       UUID        NOT NULL,
  filename         TEXT,
  status           TEXT        NOT NULL DEFAULT 'queued'
                   CHECK (status IN ('queued', 'processing', 'completed', 'failed')),
  total_rows       INT         NOT NULL DEFAULT 0,
  processed_rows   INT         NOT NULL DEFAULT 0,
  success_rows     INT         NOT NULL DEFAULT 0,
  failed_rows      INT         NOT NULL DEFAULT 0,
  skipped_rows     INT         NOT NULL DEFAULT 0,
  -- Capped at 500 entries to avoid JSONB bloat. Each entry: {line, row, error}.
  row_errors       JSONB       NOT NULL DEFAULT '[]'::jsonb,
  error            TEXT,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  started_at       TIMESTAMPTZ,
  completed_at     TIMESTAMPTZ,
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_upload_jobs_tenant_created
  ON attendance_upload_jobs (tenant_id, created_at DESC);

ALTER TABLE attendance_upload_jobs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "upload_jobs_tenant_read" ON attendance_upload_jobs FOR SELECT
  USING (tenant_id = get_user_tenant_id());

CREATE POLICY "upload_jobs_tenant_insert" ON attendance_upload_jobs FOR INSERT
  WITH CHECK (tenant_id = get_user_tenant_id());

CREATE POLICY "upload_jobs_tenant_update" ON attendance_upload_jobs FOR UPDATE
  USING (tenant_id = get_user_tenant_id());
