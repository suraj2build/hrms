-- Migration 304: restore denormalized department/designation/grade FKs on employees
--
-- Migration 016 moved these onto job_history, but the application (API embeds +
-- frontend) was never migrated — it still reads department/designation/grade
-- directly off `employees` via PostgREST relationships, which 500s with
-- "could not find a relationship" once the FK columns are gone.
--
-- Restore them as denormalized columns sourced from the employee's *current*
-- job_history row, kept in sync by a trigger. This re-establishes the FK
-- relationships PostgREST needs, with no application changes.

ALTER TABLE employees
  ADD COLUMN IF NOT EXISTS department_id  UUID REFERENCES departments(id)  ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS designation_id UUID REFERENCES designations(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS grade_id       UUID REFERENCES grades(id)       ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_employees_department  ON employees (tenant_id, department_id);
CREATE INDEX IF NOT EXISTS idx_employees_designation ON employees (tenant_id, designation_id);
CREATE INDEX IF NOT EXISTS idx_employees_grade       ON employees (tenant_id, grade_id);

-- Backfill from each employee's current job_history row.
UPDATE employees e
SET department_id  = jh.department_id,
    designation_id = jh.designation_id,
    grade_id       = jh.grade_id
FROM job_history jh
WHERE jh.employee_id = e.id
  AND jh.is_current = true;

-- Keep employees in sync whenever the current job_history row changes.
CREATE OR REPLACE FUNCTION sync_employee_job_fields() RETURNS TRIGGER AS $$
BEGIN
  IF NEW.is_current THEN
    UPDATE employees
       SET department_id  = NEW.department_id,
           designation_id = NEW.designation_id,
           grade_id       = NEW.grade_id
     WHERE id = NEW.employee_id;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_sync_employee_job_fields ON job_history;
CREATE TRIGGER trg_sync_employee_job_fields
  AFTER INSERT OR UPDATE OF department_id, designation_id, grade_id, is_current ON job_history
  FOR EACH ROW EXECUTE FUNCTION sync_employee_job_fields();
