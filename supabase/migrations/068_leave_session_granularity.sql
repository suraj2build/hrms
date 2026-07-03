-- ============================================================
-- 068_leave_session_granularity.sql
--
-- Adds session-level granularity to leave requests.
--
-- Phase 3 of Attendance + Leave Enterprise Maturity Program:
-- Half-Day + Hourly Leave Engine.
--
-- Changes:
--   1. leave_requests.session column:
--        'full_day'   — existing full-day leave (default, backward compat)
--        'first_half' — morning session only (AM)
--        'second_half'— afternoon session only (PM)
--        'hourly'     — permission/short leave in hours
--
--   2. leave_requests.hours_requested:
--        Non-null only when session = 'hourly'.
--        Stored as DECIMAL(4,2) — supports 0.25 hour (15-min) increments.
--
--   3. leave_requests.half_day is retained but will be derived from
--        session != 'full_day' going forward. Existing rows stay valid.
--
--   4. leave_applications.session — same extension for the legacy table.
--
--   5. leave_types.allow_half_day, allow_hourly — flags controlling
--        which sessions a leave type permits.
--
-- ============================================================

-- ── 1. leave_requests: add session + hours_requested ───────────────────────

ALTER TABLE leave_requests
  ADD COLUMN IF NOT EXISTS session TEXT NOT NULL DEFAULT 'full_day'
    CHECK (session IN ('full_day', 'first_half', 'second_half', 'hourly'));

ALTER TABLE leave_requests
  ADD COLUMN IF NOT EXISTS hours_requested DECIMAL(4,2)
    CHECK (hours_requested IS NULL OR (hours_requested > 0 AND hours_requested <= 24));

-- When session = 'hourly', hours_requested must be set
ALTER TABLE leave_requests
  DROP CONSTRAINT IF EXISTS lr_hourly_needs_hours;

ALTER TABLE leave_requests
  ADD CONSTRAINT lr_hourly_needs_hours
    CHECK (
      (session = 'hourly' AND hours_requested IS NOT NULL)
      OR session != 'hourly'
    );

-- ── 2. leave_applications: add session (legacy table) ───────────────────────

ALTER TABLE leave_applications
  ADD COLUMN IF NOT EXISTS session TEXT NOT NULL DEFAULT 'full_day'
    CHECK (session IN ('full_day', 'first_half', 'second_half', 'hourly'));

ALTER TABLE leave_applications
  ADD COLUMN IF NOT EXISTS hours_requested DECIMAL(4,2)
    CHECK (hours_requested IS NULL OR (hours_requested > 0 AND hours_requested <= 24));

-- ── 3. leave_types: add granularity flags ───────────────────────────────────

ALTER TABLE leave_types
  ADD COLUMN IF NOT EXISTS allow_half_day BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE leave_types
  ADD COLUMN IF NOT EXISTS allow_hourly BOOLEAN NOT NULL DEFAULT false;

-- max_hours_per_day: for hourly leave types, the maximum hours per application
ALTER TABLE leave_types
  ADD COLUMN IF NOT EXISTS max_hours_per_day DECIMAL(4,2)
    CHECK (max_hours_per_day IS NULL OR (max_hours_per_day > 0 AND max_hours_per_day <= 24));

-- max_hourly_applications_per_month: optional frequency cap
ALTER TABLE leave_types
  ADD COLUMN IF NOT EXISTS max_hourly_per_month INT
    CHECK (max_hourly_per_month IS NULL OR max_hourly_per_month > 0);

-- ── 4. Migrate existing half_day rows ────────────────────────────────────────
-- Existing leave_requests with half_day = true → session = 'first_half'
-- (first_half is the conservative default; can be updated by HR)
UPDATE leave_requests
  SET session = 'first_half'
  WHERE half_day = true AND session = 'full_day';

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'leave_applications' AND column_name = 'half_day'
  ) THEN
    UPDATE leave_applications
      SET session = 'first_half'
      WHERE half_day = true AND session = 'full_day';
  END IF;
END;
$$;

-- ── 5. Comments ──────────────────────────────────────────────────────────────

COMMENT ON COLUMN leave_requests.session IS
  'Leave granularity: full_day | first_half | second_half | hourly.
   For full_day: computed_days holds the count.
   For first_half / second_half: computed_days = 0.5.
   For hourly: hours_requested holds the hours; computed_days = hours / shift_hours.';

COMMENT ON COLUMN leave_requests.hours_requested IS
  'Hours of leave requested (only set when session = ''hourly'').
   Supports 15-min increments via DECIMAL(4,2).';

COMMENT ON COLUMN leave_types.allow_half_day IS
  'When true, employees can apply for first_half / second_half sessions of this leave type.';

COMMENT ON COLUMN leave_types.allow_hourly IS
  'When true, employees can apply for hourly leave of this leave type.';
