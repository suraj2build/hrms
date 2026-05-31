-- ─────────────────────────────────────────────────────────────────────────────
-- 136_grades_schema_align.sql
--
-- Aligns the `grades` table with the API route, importer, and frontend template.
--
-- Problem:
--   The grades route (routes/masters/grades.ts), the import engine
--   (lib/import-engine/importer.ts), and the frontend MASTER_CONFIGS all use:
--     ctc_min_annual, ctc_max_annual, description, level_order, is_active
--   None of those columns exist in the current grades table, causing:
--     "Could not find the 'ctc_max_annual' column of 'grades' in the schema cache"
--
-- Strategy (safe for any DB state):
--   · Use ADD COLUMN IF NOT EXISTS for the three new metadata columns.
--   · Use a DO $$ block with information_schema checks for the CTC columns:
--     – If the legacy min_salary / max_salary columns exist, add the new ctc_*
--       columns, copy any data across, then drop the legacy columns.
--     – If they don't exist (DB was already on the newer schema), just add the
--       ctc_* columns with IF NOT EXISTS — no-op if already present.
--   · Signal PostgREST to reload its schema cache.
-- ─────────────────────────────────────────────────────────────────────────────

DO $$
BEGIN
  -- ── ctc_min_annual ─────────────────────────────────────────────────────────
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'grades' AND column_name = 'min_salary'
  ) THEN
    -- Legacy column present: add new column, copy data, drop old one
    ALTER TABLE grades ADD COLUMN IF NOT EXISTS ctc_min_annual NUMERIC(14,2);
    UPDATE grades SET ctc_min_annual = min_salary WHERE ctc_min_annual IS NULL;
    ALTER TABLE grades DROP COLUMN min_salary;
  ELSE
    -- No legacy column: just ensure the new column exists
    ALTER TABLE grades ADD COLUMN IF NOT EXISTS ctc_min_annual NUMERIC(14,2);
  END IF;

  -- ── ctc_max_annual ─────────────────────────────────────────────────────────
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'grades' AND column_name = 'max_salary'
  ) THEN
    ALTER TABLE grades ADD COLUMN IF NOT EXISTS ctc_max_annual NUMERIC(14,2);
    UPDATE grades SET ctc_max_annual = max_salary WHERE ctc_max_annual IS NULL;
    ALTER TABLE grades DROP COLUMN max_salary;
  ELSE
    ALTER TABLE grades ADD COLUMN IF NOT EXISTS ctc_max_annual NUMERIC(14,2);
  END IF;
END $$;

-- ── New metadata columns (safe regardless of DB state) ─────────────────────

ALTER TABLE grades
  ADD COLUMN IF NOT EXISTS description TEXT;

ALTER TABLE grades
  ADD COLUMN IF NOT EXISTS level_order INTEGER NOT NULL DEFAULT 0;

ALTER TABLE grades
  ADD COLUMN IF NOT EXISTS is_active BOOLEAN NOT NULL DEFAULT true;

-- ── PostgREST schema cache reload ─────────────────────────────────────────────
NOTIFY pgrst, 'reload schema';
