-- ============================================================
-- 026_holiday_location.sql
-- Add location scoping to holiday_calendar.
--
-- location_id IS NULL     → global holiday (all locations)
-- location_id IS NOT NULL → location-specific holiday
-- ============================================================

ALTER TABLE holiday_calendar
  ADD COLUMN IF NOT EXISTS location_id UUID
    REFERENCES work_locations(id) ON DELETE SET NULL;

-- Index for location-specific lookups (partial — only rows that have a location)
CREATE INDEX IF NOT EXISTS idx_holiday_calendar_location
  ON holiday_calendar (tenant_id, location_id, date)
  WHERE location_id IS NOT NULL;

-- Existing idx_holiday_calendar_tenant_date covers the full-table scan
-- (tenant_id, date) used by the processor — no change needed there.
