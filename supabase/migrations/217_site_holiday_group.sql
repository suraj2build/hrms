-- ============================================================
-- 217_site_holiday_group.sql
--
-- Holiday Group applicability — link each SITE to a holiday group so employees
-- resolve regional/festival holidays via their site's group.
--
-- The group infrastructure already exists (migration 147):
--   · roster_holiday_groups            — the groups (regional calendars)
--   · holiday_calendar.holiday_group_id — a holiday's group (NULL = all-India)
--   · rosters.holiday_group_id          — roster-level linkage
--
-- This adds the SITE → group link. Resolution rule (engine):
--   a holiday applies to an employee when it is global
--   (no site_id / location_id / holiday_group_id) OR its site_id matches OR its
--   location_id matches OR its holiday_group_id matches the employee's site's
--   holiday_group_id.
--
-- Additive. NULL = site has no group → observes all-India holidays only.
-- ============================================================

ALTER TABLE sites
  ADD COLUMN IF NOT EXISTS holiday_group_id UUID
    REFERENCES roster_holiday_groups(id) ON DELETE SET NULL;

COMMENT ON COLUMN sites.holiday_group_id IS
  'Holiday group this site observes (roster_holiday_groups). NULL = all-India '
  'holidays only. Drives group-scoped holiday applicability in the engines.';

CREATE INDEX IF NOT EXISTS idx_sites_holiday_group ON sites (holiday_group_id);
