-- 133_holiday_calendar_holiday_type.sql
--
-- Adds holiday_type column to holiday_calendar.
--
-- Root cause:
--   The import template defines holiday_type (national / restricted / optional)
--   but migration 025 created holiday_calendar without this column, causing:
--     "Could not find the 'holiday_type' column of 'holiday_calendar' in the schema cache"
--
-- Existing rows default to 'national'. The is_optional column (migration 025)
-- is kept for backward compatibility — it maps to holiday_type = 'optional'.

ALTER TABLE holiday_calendar
  ADD COLUMN IF NOT EXISTS holiday_type TEXT NOT NULL DEFAULT 'national'
    CHECK (holiday_type IN ('national', 'restricted', 'optional'));

-- Back-fill: rows previously marked is_optional = true → holiday_type = 'optional'
UPDATE holiday_calendar
  SET holiday_type = 'optional'
  WHERE is_optional = true;
