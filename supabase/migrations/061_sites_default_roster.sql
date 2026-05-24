-- ============================================================
-- 061_sites_default_roster.sql
--
-- Adds default_roster_id to sites so employees inherit a
-- weekly-off pattern from their site when they have no
-- explicit roster assignment.
-- ============================================================

ALTER TABLE sites
  ADD COLUMN IF NOT EXISTS default_roster_id UUID NULL
    REFERENCES rosters(id) ON DELETE SET NULL;
