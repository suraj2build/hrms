-- ============================================================
-- 112_sites_default_shift.sql
--
-- Adds default_shift_id to sites so employees at a site inherit a
-- shift (timing rules) from their site when they have no explicit
-- employee-level shift assignment.
--
-- Shift resolution precedence (highest → lowest):
--   1. shift_roster override (date-specific)
--   2. employee_shifts standing assignment
--   3. sites.default_shift_id   ← this column
--
-- Roster (weekly-off) resolution is independent and handled via
-- sites.default_roster_id which already exists (migration 061).
-- ============================================================

ALTER TABLE sites
  ADD COLUMN IF NOT EXISTS default_shift_id UUID NULL
    REFERENCES shifts(id) ON DELETE SET NULL;

COMMENT ON COLUMN sites.default_shift_id IS
  'Fallback shift for employees at this site who have no personal shift assignment (used by the attendance processor as the 3rd-priority shift source).';
