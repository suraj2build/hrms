-- 134_employee_compensations_nullable_structure.sql
--
-- Makes employee_compensations.salary_structure_id nullable.
--
-- Root cause:
--   The compensation import falls back to null when:
--     (a) the CSV's salary_structure_code is not found, AND
--     (b) no tenant-default salary structure exists.
--   The NOT NULL constraint then causes:
--     "null value in column "salary_structure_id" ... violates not-null constraint"
--
-- Design rationale:
--   salary_structure_id is a payroll-calculation concern (how to split CTC into
--   components). It is NOT required to record that an employee has a given CTC.
--   Tenants that have not yet configured salary structures should still be able
--   to import employee compensation data.  The payroll engine already handles
--   a missing structure gracefully (falls back to flat CTC).

ALTER TABLE employee_compensations
  ALTER COLUMN salary_structure_id DROP NOT NULL;
