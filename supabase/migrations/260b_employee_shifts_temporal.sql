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
