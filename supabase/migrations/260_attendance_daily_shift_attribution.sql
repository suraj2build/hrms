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

-- ============================================================
-- Merged from 260b_employee_shifts_temporal.sql (2026-09) — see
-- the note on the 113_punch_logs_csv_source.sql merge for why.
-- ============================================================
-- ============================================================
-- 260b_employee_shifts_temporal.sql
--
-- AHI-1: Add temporal validity to employee_shifts so historical
-- shift resolution can answer "which shift was in effect on date D?"
--
-- Previously, resolvers queried is_current = true — meaning any
-- shift change retroactively altered ALL past attendance recomputes.
-- With effective_to set by the auto-close trigger, resolvers can
-- now query effective_from <= date AND effective_to >= date
-- (or effective_to IS NULL for the current open record).
--
-- The auto-close trigger is updated to SET effective_to on the
-- closing row so the history is complete going forward.
-- Existing rows are left with effective_to = NULL; the resolver
-- falls back to is_current when effective_to is not set (safe).
-- ============================================================

ALTER TABLE employee_shifts
  ADD COLUMN IF NOT EXISTS effective_to DATE;

CREATE INDEX IF NOT EXISTS idx_emp_shift_temporal
  ON employee_shifts (tenant_id, employee_id, effective_from DESC, effective_to DESC);

-- ── Update auto-close trigger to also set effective_to ─────────────────────────

CREATE OR REPLACE FUNCTION fn_close_previous_employee_shift()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.is_current THEN
    -- Mark previous current row as closed: is_current=false and effective_to=yesterday
    UPDATE employee_shifts
    SET    is_current  = false,
           effective_to = (NEW.effective_from - INTERVAL '1 day')::DATE
    WHERE  tenant_id   = NEW.tenant_id
      AND  employee_id = NEW.employee_id
      AND  id         != NEW.id
      AND  is_current  = true;
  END IF;
  RETURN NEW;
END;
$$;
