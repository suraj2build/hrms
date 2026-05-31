-- 132_designations_level_text.sql
--
-- Changes designations.level from INT to TEXT.
--
-- Root cause:
--   The import template (and real-world HR usage) uses alphanumeric level labels
--   such as "L3", "M1", "IC4", "Director" — not bare integers.
--   The original column was INT (migration 003), causing
--     "invalid input syntax for type integer: 'L3'"
--   whenever the import engine tried to write a label-style level value.
--
-- The USING clause converts any existing integer values to their text
-- representation so no data is lost (e.g. 3 → '3').

ALTER TABLE designations
  ALTER COLUMN level TYPE TEXT USING level::text;
