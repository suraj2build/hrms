-- ============================================================
-- 400_import_jobs_active_unique_guard.sql
--
-- POST /import/run enforces "only one active write import per master_type
-- per tenant" with a check-then-insert pattern: SELECT for an existing
-- active job, then INSERT a new one if none is found. Between the SELECT
-- and the INSERT there is no lock, so two concurrent requests (double
-- click, two browser tabs, a client retry racing the original request)
-- can both see zero active jobs and both proceed to create a job and
-- start writing the same master_type data concurrently — silently
-- corrupting/duplicating records instead of being rejected with 409.
--
-- Fix: a partial unique index makes the second concurrent INSERT fail
-- atomically at the database. The route catches the unique-violation
-- (Postgres code 23505) and returns the same 409 IMPORT_ALREADY_RUNNING
-- response it already returns for the SELECT-detected case.
-- ============================================================

CREATE UNIQUE INDEX IF NOT EXISTS idx_import_jobs_one_active_per_master_type
  ON import_jobs (tenant_id, master_type)
  WHERE master_type IS NOT NULL
    AND status IN ('validating', 'importing', 'processing');
