-- ============================================================
-- 058_holiday_site.sql
--
-- Step 2: Link holidays to sites.
--
-- Adds `site_id` (nullable) to `holiday_calendar` alongside the
-- existing `location_id` column (added in migration 026).
--
-- Holiday applicability rules (checked in priority order):
--   1. site_id IS NULL AND location_id IS NULL  → global (all employees)
--   2. site_id = employee.site_id               → site-scoped holiday
--   3. location_id = employee.work_location_id  → location-scoped (legacy)
--
-- Backward compatibility: all existing rows keep site_id = NULL,
-- so they remain global or location-scoped exactly as before.
-- ============================================================

ALTER TABLE holiday_calendar
  ADD COLUMN IF NOT EXISTS site_id UUID NULL
    REFERENCES sites(id) ON DELETE SET NULL;

-- Fast lookup for site-specific holidays
CREATE INDEX IF NOT EXISTS idx_holiday_calendar_site
  ON holiday_calendar (tenant_id, site_id, date)
  WHERE site_id IS NOT NULL;
