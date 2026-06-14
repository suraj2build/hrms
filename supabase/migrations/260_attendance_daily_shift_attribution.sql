-- ============================================================
-- 260_attendance_daily_shift_attribution.sql
--
-- AHI-1: Persist shift attribution snapshot on attendance_daily.
--
-- The attendance engine resolves a shift at compute time but
-- previously discarded it after use. This means the exact shift
-- used to calculate late_minutes / overtime_minutes / work_hours
-- was unrecoverable after the fact — making recomputes non-
-- deterministic and payroll audits impossible.
--
-- These columns capture a snapshot of the resolved shift AT THE
-- MOMENT of computation. Because start_time/end_time are copied
-- (not FK-referenced) the record survives shift edits/deletions.
--
-- resolution_source identifies which layer of the priority chain
-- produced the shift:
--   shift_roster    → date-specific day override
--   rotation_policy → condition-based rule (Mon-Fri, Sat, Sun)
--   standing_shift  → employee_shifts effective as of date
--   site_default    → sites.default_shift_id (deprecated legacy)
-- ============================================================

ALTER TABLE attendance_daily
  ADD COLUMN IF NOT EXISTS expected_shift_id        UUID    REFERENCES shifts(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS shift_start_time         TEXT,
  ADD COLUMN IF NOT EXISTS shift_end_time           TEXT,
  ADD COLUMN IF NOT EXISTS shift_grace_minutes      INT,
  ADD COLUMN IF NOT EXISTS shift_is_night_shift     BOOLEAN,
  ADD COLUMN IF NOT EXISTS shift_duration_minutes   INT,
  ADD COLUMN IF NOT EXISTS resolution_source        TEXT
    CHECK (resolution_source IN ('shift_roster','rotation_policy','standing_shift','site_default')),
  ADD COLUMN IF NOT EXISTS rotation_policy_id       UUID    REFERENCES rotation_policies(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS rotation_condition_type  TEXT;

CREATE INDEX IF NOT EXISTS idx_ad_shift_attribution
  ON attendance_daily (tenant_id, expected_shift_id, date DESC)
  WHERE expected_shift_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_ad_resolution_source
  ON attendance_daily (tenant_id, resolution_source, date DESC)
  WHERE resolution_source IS NOT NULL;
