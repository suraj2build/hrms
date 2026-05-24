-- ============================================================
-- 027_shifts_grace_minutes.sql
-- Add grace_minutes to the shifts master table.
--
-- The shifts table was created in 010_masters_extended.sql.
-- This migration adds the missing grace_minutes column so shift
-- definitions carry their own late-tolerance threshold rather
-- than relying on the hard-coded LATE_GRACE_MINUTES constant
-- in the attendance processor.
-- ============================================================

ALTER TABLE shifts
  ADD COLUMN IF NOT EXISTS grace_minutes INT NOT NULL DEFAULT 15;
