-- ============================================================
-- 219_ensure_org_code_columns.sql
--
-- Fixes: POST /departments (and /designations, /grades) returning 500
--   "Could not find the 'code' column of 'departments' in the schema cache"
--
-- The API inserts a generated `code` for org-structure rows. On environments
-- where the `code` column is absent (or PostgREST's schema cache is stale after
-- an earlier migration), the insert fails. This migration is idempotent: it
-- ensures the columns exist and forces PostgREST to reload its schema cache.
--
-- Additive only. Safe to run repeatedly.
-- ============================================================

ALTER TABLE departments  ADD COLUMN IF NOT EXISTS code TEXT;
ALTER TABLE designations ADD COLUMN IF NOT EXISTS code TEXT;
ALTER TABLE grades       ADD COLUMN IF NOT EXISTS code TEXT;

-- Reload the PostgREST schema cache so the API sees the columns immediately.
NOTIFY pgrst, 'reload schema';
