-- ============================================================
-- Migration 176: Backfill leave_requests session columns
--
-- Migration 068 added session + hours_requested to leave_requests
-- but the columns are missing from the live database.
-- This migration adds them idempotently.
-- ============================================================

-- ── leave_requests: add missing session + hours_requested ───

ALTER TABLE leave_requests
  ADD COLUMN IF NOT EXISTS session TEXT NOT NULL DEFAULT 'full_day'
    CHECK (session IN ('full_day', 'first_half', 'second_half', 'hourly'));

ALTER TABLE leave_requests
  ADD COLUMN IF NOT EXISTS hours_requested DECIMAL(4,2)
    CHECK (hours_requested IS NULL OR (hours_requested > 0 AND hours_requested <= 24));

-- Constraint: when session = 'hourly', hours_requested must be set
ALTER TABLE leave_requests
  DROP CONSTRAINT IF EXISTS lr_hourly_needs_hours;

ALTER TABLE leave_requests
  ADD CONSTRAINT lr_hourly_needs_hours
    CHECK (
      (session = 'hourly' AND hours_requested IS NOT NULL)
      OR session != 'hourly'
    );

-- Backfill: existing half_day=true rows → session = 'first_half'
UPDATE leave_requests
  SET session = 'first_half'
  WHERE half_day = true AND session = 'full_day';

-- ── leave_applications: add session column (no half_day to backfill) ─

ALTER TABLE leave_applications
  ADD COLUMN IF NOT EXISTS session TEXT NOT NULL DEFAULT 'full_day'
    CHECK (session IN ('full_day', 'first_half', 'second_half', 'hourly'));

ALTER TABLE leave_applications
  ADD COLUMN IF NOT EXISTS hours_requested DECIMAL(4,2)
    CHECK (hours_requested IS NULL OR (hours_requested > 0 AND hours_requested <= 24));

-- ── leave_policies: session column ───────────────────────────

ALTER TABLE leave_policies
  ADD COLUMN IF NOT EXISTS session TEXT DEFAULT 'full_day';

-- ── Comments ─────────────────────────────────────────────────

COMMENT ON COLUMN leave_requests.session IS
  'Leave granularity: full_day | first_half | second_half | hourly.';

COMMENT ON COLUMN leave_requests.hours_requested IS
  'Hours of leave requested (only set when session = ''hourly'').';
