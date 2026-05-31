-- =============================================================
-- 113_punch_logs_csv_source.sql
--
-- Add 'csv_upload' to the attendance_punch_logs source CHECK
-- constraint.
--
-- Background:
--   Migration 043 defined the source constraint as:
--     CHECK (source IN ('device', 'manual', 'mobile', 'web',
--                       'kiosk', 'regularisation'))
--
--   The CSV bulk-upload route (POST /attendance/upload) unconditionally
--   sets source = 'csv_upload', which was never added to the allowed
--   list.  As a result, every CSV upload attempt has been returning
--   HTTP 500 INSERT_FAILED due to a CHECK constraint violation.
--   The feature has never successfully inserted rows.
--
-- This migration:
--   1. Drops the existing inline source constraint (auto-named by PG).
--   2. Re-creates it with 'csv_upload' added to the allowed list.
--
-- Safety:
--   - DDL only.  No data is modified.
--   - Existing rows with other source values are unaffected.
--   - Safe to deploy at any time; no payroll window restriction.
-- =============================================================

ALTER TABLE attendance_punch_logs
  DROP CONSTRAINT IF EXISTS attendance_punch_logs_source_check;

ALTER TABLE attendance_punch_logs
  ADD CONSTRAINT attendance_punch_logs_source_check
  CHECK (source IN (
    'device',
    'manual',
    'mobile',
    'web',
    'kiosk',
    'regularisation',
    'csv_upload'
  ));
