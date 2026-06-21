-- ============================================================
-- 284_attendance_raw_logs_dedup.sql
--
-- ATTENDANCE P0-4 — duplicate raw punches inflate hours/OT, and the API-pull
-- ingest path was broken at the schema level.
--
-- attendance_raw_logs (019) had NO unique constraint, so:
--   • POST /attendance/ingest did a plain INSERT — re-POSTing a device batch
--     (network retry / device replay) duplicated raw punches → duplicate sessions
--     → inflated work_hours and overtime (pay-affecting).
--   • The API-pull path (api-sources.ts) builds rows with a `source_id` column
--     and upserts ON CONFLICT (tenant_id, employee_code, timestamp, direction).
--     Neither the column nor the index existed, and device_id was NOT NULL while
--     API rows carry no device — so that path could never insert.
--
-- This migration:
--   1. adds source_id (nullable FK to attendance_api_sources) for API-pull rows,
--   2. makes device_id nullable (API rows have a source, not a device) with a
--      CHECK that a row has at least one origin,
--   3. adds the dedupe unique index that both ingest and api-sources upsert on.
--
-- The unique index is created defensively: if the table already contains
-- duplicate punches (it could, since ingest never deduped), it raises a NOTICE
-- instead of failing the migration — dedupe those rows, then re-run.
-- ============================================================

ALTER TABLE attendance_raw_logs
  ADD COLUMN IF NOT EXISTS source_id UUID REFERENCES attendance_api_sources(id) ON DELETE SET NULL;

-- API-pull rows have a source, not a device — device_id must be nullable.
ALTER TABLE attendance_raw_logs
  ALTER COLUMN device_id DROP NOT NULL;

-- Every row must still have at least one origin (device OR API source).
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.constraint_column_usage
    WHERE  table_name = 'attendance_raw_logs' AND constraint_name = 'chk_raw_logs_origin'
  ) THEN
    ALTER TABLE attendance_raw_logs
      ADD CONSTRAINT chk_raw_logs_origin
      CHECK (device_id IS NOT NULL OR source_id IS NOT NULL) NOT VALID;
  END IF;
END $$;

-- Dedupe unique index — the ON CONFLICT target for both ingest paths.
DO $$
BEGIN
  BEGIN
    CREATE UNIQUE INDEX IF NOT EXISTS uidx_raw_logs_dedup
      ON attendance_raw_logs (tenant_id, employee_code, timestamp, direction);
  EXCEPTION WHEN unique_violation THEN
    RAISE NOTICE 'attendance_raw_logs has duplicate (tenant_id, employee_code, timestamp, direction) rows; dedupe them, then re-run this migration to create uidx_raw_logs_dedup.';
  END;
END $$;
