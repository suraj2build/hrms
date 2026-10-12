-- ============================================================
-- 453_fix_employee_shift_trigger_timing.sql
-- Fix trg_close_previous_employee_shift firing AFTER INSERT.
--
-- Bug: uq_employee_shifts_current is a plain (non-deferrable) partial
-- unique index, so Postgres enforces it as each row is inserted — before
-- an AFTER INSERT trigger ever runs. Migration 028 closed the previous
-- is_current row from an AFTER INSERT trigger, so by the time it fired,
-- the new is_current=true row had already been rejected with
-- "duplicate key value violates unique constraint uq_employee_shifts_current"
-- whenever the employee already had a current row — i.e. on every shift
-- reassignment after the employee's first-ever shift assignment,
-- regardless of whether the new effective_from is before or after the
-- existing row's. Found via live UAT: POST /masters/employee-shifts/assign
-- returned 500 INSERT_FAILED attempting to reassign an employee who
-- already had a shift.
--
-- Fix: re-create the trigger as BEFORE INSERT. The function body is
-- unchanged — it closes any existing is_current row for the employee,
-- which now happens before the new row's insert is checked against the
-- partial unique index.
-- ============================================================

DROP TRIGGER IF EXISTS trg_close_previous_employee_shift ON employee_shifts;

CREATE TRIGGER trg_close_previous_employee_shift
  BEFORE INSERT ON employee_shifts
  FOR EACH ROW EXECUTE FUNCTION fn_close_previous_employee_shift();
