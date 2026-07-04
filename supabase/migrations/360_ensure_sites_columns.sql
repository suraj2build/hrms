-- =============================================================================
-- Migration 360: ensure site geography columns exist
--
-- Migration 248 added site_type, city, region, zone to the sites table.
-- This migration re-applies those additions with IF NOT EXISTS so deployments
-- that missed migration 248 catch up without error.
-- =============================================================================

ALTER TABLE sites
  ADD COLUMN IF NOT EXISTS site_type TEXT,
  ADD COLUMN IF NOT EXISTS city      TEXT,
  ADD COLUMN IF NOT EXISTS region    TEXT,
  ADD COLUMN IF NOT EXISTS zone      TEXT;

CREATE INDEX IF NOT EXISTS idx_sites_tenant_region
  ON sites (tenant_id, region);
CREATE INDEX IF NOT EXISTS idx_sites_tenant_zone
  ON sites (tenant_id, zone);
CREATE INDEX IF NOT EXISTS idx_sites_tenant_site_type
  ON sites (tenant_id, site_type);
