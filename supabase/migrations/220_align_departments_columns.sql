-- ============================================================
-- 220_align_departments_columns.sql
--
-- Aligns the repo schema with production: some environments' `departments`
-- table carries slug / description / is_active / updated_at columns (with a
-- NOT-NULL slug) that the original migration 003 never defined. The API now
-- always supplies `slug` on insert; this migration makes sure the columns exist
-- on every environment so fresh/repo-only deploys behave identically.
--
-- slug is added NULLABLE here (so existing rows are unaffected); the application
-- always provides a value on insert. Idempotent + additive.
-- ============================================================

ALTER TABLE departments ADD COLUMN IF NOT EXISTS slug        TEXT;
ALTER TABLE departments ADD COLUMN IF NOT EXISTS description TEXT;
ALTER TABLE departments ADD COLUMN IF NOT EXISTS is_active   BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE departments ADD COLUMN IF NOT EXISTS updated_at  TIMESTAMPTZ NOT NULL DEFAULT now();

NOTIFY pgrst, 'reload schema';
