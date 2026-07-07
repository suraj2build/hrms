-- ============================================================
-- 366_import_job_chunks.sql
--
-- Chunk-level execution tracking for the enterprise import pipeline.
--
-- Purpose:
--   Enables Phase C resumability: a failed import can retry only
--   the chunks that did not complete, skipping already-committed
--   work. Chunks are idempotent because import upserts use
--   ON CONFLICT DO NOTHING on natural keys.
--
-- Chunk checkpoint semantics (locked here for Pass 2a):
--   completed → safely checkpointed; skip on retry
--   failed    → visible in chunk table; retry allowed
--   pending   → not yet attempted in this run
--   processing → currently executing (or crashed mid-chunk)
--
-- Retry flow in Phase C:
--   1. Worker streams source file sequentially.
--   2. For each chunk_no encountered, check status in this table.
--   3. If 'completed' → skip the row range (continue streaming).
--   4. If 'pending' or 'failed' → execute bulk upsert for this chunk.
-- ============================================================

CREATE TABLE IF NOT EXISTS import_job_chunks (
  id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  import_job_id    UUID        NOT NULL REFERENCES import_jobs(id) ON DELETE CASCADE,
  tenant_id        UUID        NOT NULL,
  chunk_no         INT         NOT NULL,   -- 1-indexed, sequential
  start_row        INT         NOT NULL,   -- first data row in this chunk (1-indexed, excludes header)
  end_row          INT         NOT NULL,   -- last data row in this chunk (inclusive)
  status           TEXT        NOT NULL DEFAULT 'pending' CHECK (status IN (
    'pending', 'processing', 'completed', 'failed'
  )),
  attempt          INT         NOT NULL DEFAULT 0,
  success_count    INT         NOT NULL DEFAULT 0,
  failure_count    INT         NOT NULL DEFAULT 0,
  -- Fatal chunk-level error (e.g. DB connection lost mid-upsert).
  -- Row-level failures within a chunk go to import_job_errors.
  error_summary    TEXT,
  started_at       TIMESTAMPTZ,
  completed_at     TIMESTAMPTZ,

  UNIQUE (import_job_id, chunk_no)
);

CREATE INDEX IF NOT EXISTS idx_import_job_chunks_job
  ON import_job_chunks (import_job_id, chunk_no);

CREATE INDEX IF NOT EXISTS idx_import_job_chunks_status
  ON import_job_chunks (import_job_id, status);

ALTER TABLE import_job_chunks ENABLE ROW LEVEL SECURITY;

CREATE POLICY "ijc_tenant_read"
  ON import_job_chunks FOR SELECT
  USING (tenant_id = get_user_tenant_id());

CREATE POLICY "ijc_hr_write"
  ON import_job_chunks FOR ALL
  USING (get_user_role() IN ('super_admin', 'hr_admin'));
