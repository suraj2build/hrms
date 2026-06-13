-- ============================================================
-- 248_retail_site_dimensions.sql
--
-- R5 (Retail Intelligence Enablement) — add retail/geography dimensions to the
-- sites master so headcount and other workforce KPIs can be disaggregated by
-- site_type, city, region, and zone (SUP.headcount.by_site).
--
-- Per the R0 KPI registry, site-awareness is ADDITIVE: these columns let an
-- existing KPI be grouped by a new axis; they do not define new KPIs.
--
-- All columns are nullable so existing sites and older deployments are
-- unaffected. Idempotent.
-- ============================================================

ALTER TABLE sites
  ADD COLUMN IF NOT EXISTS site_type TEXT,   -- e.g. 'store', 'warehouse', 'office', 'plant'
  ADD COLUMN IF NOT EXISTS city      TEXT,   -- city the site is located in
  ADD COLUMN IF NOT EXISTS region    TEXT,   -- business region (e.g. 'North', 'West')
  ADD COLUMN IF NOT EXISTS zone      TEXT;   -- finer roll-up within a region

-- Indexes to keep GROUP BY region/zone/site_type fast on large tenants.
CREATE INDEX IF NOT EXISTS idx_sites_tenant_region
  ON sites (tenant_id, region);
CREATE INDEX IF NOT EXISTS idx_sites_tenant_zone
  ON sites (tenant_id, zone);
CREATE INDEX IF NOT EXISTS idx_sites_tenant_site_type
  ON sites (tenant_id, site_type);
