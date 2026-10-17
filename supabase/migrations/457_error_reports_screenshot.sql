-- ============================================================
-- Migration 457: error_reports.screenshot_path — lets a user
-- attach a screenshot to an in-product issue report.
-- ============================================================
--
-- Stores a storage path (employee-files bucket, "<tenantId>/feedback/…"),
-- same pattern as every other file reference in this schema — never a
-- public URL. The owner panel's error-report triage view resolves it to a
-- signed URL on demand.

ALTER TABLE error_reports
  ADD COLUMN IF NOT EXISTS screenshot_path TEXT;

COMMENT ON COLUMN error_reports.screenshot_path IS
  'Storage path (employee-files bucket) of an optional screenshot the '
  'reporter attached. NULL when no screenshot was provided.';
