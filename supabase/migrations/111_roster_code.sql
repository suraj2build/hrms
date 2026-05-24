-- ============================================================
-- 111_roster_code.sql
--
-- Adds a short `code` column to the rosters table so rosters can be
-- referenced in CSV imports and employee templates by a stable
-- machine-readable code (e.g. "GEN-5DAY", "ROT-SHIFT-A").
--
-- Uniqueness is per-tenant — two tenants may use the same code.
-- NULL is allowed for existing rows so existing data is preserved.
-- ============================================================

ALTER TABLE rosters
  ADD COLUMN IF NOT EXISTS code TEXT NULL;

-- Unique per tenant (NULLs are excluded from uniqueness checks in PostgreSQL)
CREATE UNIQUE INDEX IF NOT EXISTS uq_rosters_tenant_code
  ON rosters (tenant_id, code)
  WHERE code IS NOT NULL;

COMMENT ON COLUMN rosters.code IS
  'Optional short machine-readable code for CSV import / employee template references (unique within tenant when set).';
