-- ============================================================
-- 364_extend_import_jobs.sql
--
-- Extends the existing import_jobs table (migration 108) with
-- the columns needed by the generic enterprise import pipeline.
--
-- Design decisions:
--  1. master_type made nullable — new-style imports (attendance,
--     employee bulk, etc.) use module + import_type instead.
--  2. All new columns are nullable / have defaults for backward
--     compat with the existing master import framework.
--  3. Status CHECK extended with new pipeline statuses while
--     keeping all legacy statuses.
--  4. import_job_rows (migration 108) is left as-is — it is
--     LEGACY for the master import framework (≤5k rows). New
--     high-volume imports use import_job_errors + import_job_chunks.
-- ============================================================

-- ── 1. Relax master_type constraint ──────────────────────────────────────────
-- master_type is no longer required; new imports use module + import_type.
ALTER TABLE import_jobs ALTER COLUMN master_type DROP NOT NULL;

-- ── 2. Extend status CHECK with new pipeline statuses ────────────────────────
ALTER TABLE import_jobs DROP CONSTRAINT IF EXISTS import_jobs_status_check;
ALTER TABLE import_jobs ADD CONSTRAINT import_jobs_status_check CHECK (status IN (
  -- new pipeline statuses
  'uploaded',
  'queued',
  'parsing',
  'validating',
  'processing',
  'partial_failed',
  -- legacy master import statuses (kept for backward compat)
  'pending',
  'validated',
  'importing',
  -- shared terminal statuses
  'completed',
  'failed',
  'cancelled'
));

-- ── 3. Generic module identification ─────────────────────────────────────────
-- module:      high-level domain (attendance, employees, leave_balances, …)
-- import_type: specific sub-type (attendance_daily, employee_master_upsert, …)
ALTER TABLE import_jobs
  ADD COLUMN IF NOT EXISTS module       TEXT,
  ADD COLUMN IF NOT EXISTS import_type  TEXT;

-- ── 4. File metadata ──────────────────────────────────────────────────────────
ALTER TABLE import_jobs
  ADD COLUMN IF NOT EXISTS file_storage_path  TEXT,
  ADD COLUMN IF NOT EXISTS file_size_bytes    BIGINT,
  ADD COLUMN IF NOT EXISTS mime_type          TEXT;

-- ── 5. Fine-grained progress counters ────────────────────────────────────────
-- parsed_rows:    rows streamed and parsed (Phase B)
-- validated_rows: rows that passed all validation (Phase B)
-- processed_rows: rows attempted in Phase C (valid rows attempted for DB write)
-- success_rows:   rows successfully written to the target table
-- (total_rows, failed_rows, skipped_rows already exist in migration 108)
ALTER TABLE import_jobs
  ADD COLUMN IF NOT EXISTS parsed_rows    INT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS validated_rows INT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS processed_rows INT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS success_rows   INT NOT NULL DEFAULT 0;

-- ── 6. Chunk progress ─────────────────────────────────────────────────────────
ALTER TABLE import_jobs
  ADD COLUMN IF NOT EXISTS current_chunk  INT,
  ADD COLUMN IF NOT EXISTS total_chunks   INT;

-- ── 7. Stage label for UI ─────────────────────────────────────────────────────
-- Free-text label surfaced directly in the import progress card.
-- Examples: "Parsing file", "Resolving employee codes", "Writing chunk 42/200"
ALTER TABLE import_jobs
  ADD COLUMN IF NOT EXISTS current_stage  TEXT;

-- ── 8. Extensibility metadata ─────────────────────────────────────────────────
ALTER TABLE import_jobs
  ADD COLUMN IF NOT EXISTS metadata  JSONB NOT NULL DEFAULT '{}'::jsonb;

-- ── 9. Indexes for new columns ────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_import_jobs_module
  ON import_jobs (tenant_id, module, created_at DESC)
  WHERE module IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_import_jobs_status_new
  ON import_jobs (tenant_id, status, created_at DESC);
