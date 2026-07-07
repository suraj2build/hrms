-- ============================================================
-- 365_import_job_errors.sql
--
-- Row-level error capture for the enterprise import pipeline.
--
-- Why not import_job_rows (migration 108)?
--   import_job_rows stores ALL rows (valid + invalid) with full
--   row_data JSONB. At 1M rows that is ~200GB+ of storage — not
--   acceptable. This table stores ONLY failed rows.
--
-- Scale characteristics:
--   - 3,000 errors × ~200 bytes ≈ 600 KB — no concern at any scale.
--   - Append-only during processing; cascade-deleted with the job.
--   - Indexed for paginated UI display and CSV export.
-- ============================================================

CREATE TABLE IF NOT EXISTS import_job_errors (
  id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  import_job_id    UUID        NOT NULL REFERENCES import_jobs(id) ON DELETE CASCADE,
  tenant_id        UUID        NOT NULL,
  row_number       INT         NOT NULL,
  -- Natural key visible to the user (e.g. employee_code, email).
  -- NULL when the key couldn't be parsed from the row.
  row_key          TEXT,
  -- Which stage produced this error:
  --   parse              → CSV parse failure (bad quoting, encoding, etc.)
  --   validation         → structural failure (wrong type, missing required field)
  --   business_validation → domain rule failure (code not found, period locked, etc.)
  --   write              → DB write failure for an otherwise valid row
  error_stage      TEXT        NOT NULL CHECK (error_stage IN (
    'parse', 'validation', 'business_validation', 'write'
  )),
  -- Machine-readable code for client-side grouping and filtering.
  error_code       TEXT,
  error_message    TEXT        NOT NULL,
  -- Original row values for the error CSV export. Stored as a flat
  -- key/value map (column_name → raw_string_value).
  raw_payload      JSONB,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Primary access pattern: all errors for a job (paginated + export)
CREATE INDEX IF NOT EXISTS idx_import_job_errors_job
  ON import_job_errors (import_job_id, row_number);

-- Filter by stage (UI "filter by type" dropdown)
CREATE INDEX IF NOT EXISTS idx_import_job_errors_stage
  ON import_job_errors (import_job_id, error_stage);

ALTER TABLE import_job_errors ENABLE ROW LEVEL SECURITY;

CREATE POLICY "ije_tenant_read"
  ON import_job_errors FOR SELECT
  USING (tenant_id = get_user_tenant_id());

CREATE POLICY "ije_hr_write"
  ON import_job_errors FOR ALL
  USING (get_user_role() IN ('super_admin', 'hr_admin'));
