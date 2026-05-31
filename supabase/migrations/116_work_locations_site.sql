-- ============================================================
-- 116_work_locations_site.sql
-- 1. Add optional `code` column to sites (for import reference).
-- 2. Add site_id FK to work_locations.
-- ============================================================

-- ── 1. Sites code column ─────────────────────────────────────
-- Allows sites to be referenced by a short code (e.g. SITE-BLR)
-- in CSV imports and cross-references. NULL for legacy rows.
ALTER TABLE sites
  ADD COLUMN IF NOT EXISTS code TEXT;

-- Unique per tenant so codes can be used as import keys
CREATE UNIQUE INDEX IF NOT EXISTS idx_sites_tenant_code
  ON sites (tenant_id, code)
  WHERE code IS NOT NULL;

COMMENT ON COLUMN sites.code IS
  'Optional short code (e.g. SITE-BLR) used as an import key and cross-reference. '
  'Unique per tenant when set.';

-- ── 2. Work locations → site FK ─────────────────────────────
-- Work locations belong to a site (physical campus/branch).
-- NULL is allowed for legacy rows — existing data is preserved.
-- ON DELETE SET NULL so deleting a site doesn't cascade-delete
-- its work locations; operators can re-assign them.
ALTER TABLE work_locations
  ADD COLUMN IF NOT EXISTS site_id UUID
    REFERENCES sites(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_work_locations_site
  ON work_locations (site_id)
  WHERE site_id IS NOT NULL;

COMMENT ON COLUMN work_locations.site_id IS
  'Optional FK to sites(id). Links a work location to its parent campus/branch. '
  'NULL means unassigned (legacy rows or independent locations).';
