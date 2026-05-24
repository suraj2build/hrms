-- =============================================================
-- 045_tenant_timezone.sql
--
-- Add a timezone column to the tenants table.
--
-- The value must be a valid IANA timezone identifier, e.g.:
--   'Asia/Kolkata', 'America/New_York', 'Europe/London', 'UTC'
--
-- The AttendanceEngine reads this field to:
--   - compute shift-start / shift-end as UTC timestamps
--   - determine the correct punch-fetch window per date
--   - ensure stored attendance_daily.date matches the
--     tenant's local calendar date, not UTC date
--
-- Default is 'UTC' so all existing tenants keep their current
-- behaviour until they update their settings.
-- =============================================================

ALTER TABLE tenants
  ADD COLUMN IF NOT EXISTS timezone TEXT NOT NULL DEFAULT 'UTC';

-- Basic sanity check: the value must look like a TZ identifier
-- (non-empty, no raw UTC offset strings like "+05:30").
-- Full IANA validation is left to the application layer.
ALTER TABLE tenants
  ADD CONSTRAINT tenants_timezone_nonempty CHECK (char_length(timezone) > 0);

COMMENT ON COLUMN tenants.timezone IS
  'IANA timezone identifier (e.g. Asia/Kolkata). '
  'Used by the AttendanceEngine to interpret shift times and '
  'compute date boundaries in the tenant''s local calendar.';
