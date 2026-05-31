-- 131_import_unique_constraints.sql
--
-- Adds missing UNIQUE(tenant_id, code) constraints (and `code` columns where
-- absent) so the Universal Import Engine's upsert path works correctly for
-- all master types defined in TABLE_MAP.
--
-- Root cause:
--   importer.ts `batchInsert` always calls
--     .upsert(batch, { onConflict: `tenant_id,${uniqueColumn}` })
--   PostgreSQL requires a real UNIQUE or exclusion constraint on those columns —
--   a plain index is not enough.  Several early-era tables were created without
--   the required constraints, causing:
--     "there is no unique or exclusion constraint matching the ON CONFLICT specification"
--
-- Tables fixed:
--   departments    — code column exists, UNIQUE constraint missing
--   designations   — code column absent entirely; add + add UNIQUE constraint
--   grades         — code column exists, UNIQUE constraint missing
--   sites          — code column absent entirely; add + add UNIQUE constraint
--   holiday_calendar — UNIQUE(tenant_id, date) missing (only an index existed)
--
-- Tables already correct (verified):
--   work_locations, cost_centers, shifts      — migration 010
--   salary_components, salary_structures      — migration 011
--   leave_types                               — migration 033 (UNIQUE tenant_id,name ✓)
--   payroll_groups, employment_categories,
--   statutory_groups, asset_categories        — migration 113b

-- ── departments ───────────────────────────────────────────────────────────────

-- code column already exists (nullable TEXT), just add the constraint.
-- Existing NULL codes are fine — UNIQUE allows multiple NULLs in Postgres,
-- but NULL codes won't participate in upsert conflict detection.
-- Non-NULL codes must be unique per tenant after this migration.
ALTER TABLE departments
  ADD CONSTRAINT uq_departments_tenant_code
  UNIQUE (tenant_id, code);

-- ── designations ──────────────────────────────────────────────────────────────

-- The original table (migration 003) has no code column at all.
-- Add it as nullable TEXT so existing rows are unaffected.
ALTER TABLE designations
  ADD COLUMN IF NOT EXISTS code TEXT;

ALTER TABLE designations
  ADD CONSTRAINT uq_designations_tenant_code
  UNIQUE (tenant_id, code);

-- ── grades ────────────────────────────────────────────────────────────────────

ALTER TABLE grades
  ADD CONSTRAINT uq_grades_tenant_code
  UNIQUE (tenant_id, code);

-- ── sites ─────────────────────────────────────────────────────────────────────

-- The original table (migration 057) has UNIQUE(tenant_id, name) but no code.
-- The importer expects a code column and onConflict: 'tenant_id,code'.
ALTER TABLE sites
  ADD COLUMN IF NOT EXISTS code TEXT;

ALTER TABLE sites
  ADD CONSTRAINT uq_sites_tenant_code
  UNIQUE (tenant_id, code);

-- ── holiday_calendar ──────────────────────────────────────────────────────────

-- Migration 025 only created an index; Postgres requires a real UNIQUE
-- constraint for ON CONFLICT to work.
-- The existing index idx_holiday_calendar_tenant_date is kept (still useful
-- for fast reads); we just add the constraint alongside it.
ALTER TABLE holiday_calendar
  ADD CONSTRAINT uq_holiday_calendar_tenant_date
  UNIQUE (tenant_id, date);
