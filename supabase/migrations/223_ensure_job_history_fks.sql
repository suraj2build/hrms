-- ============================================================
-- 223_ensure_job_history_fks.sql
--
-- Fixes: GET /employees/:id/job-history returning 500, which breaks the Job Info
-- / workforce display and makes Organisation Assignment edits look like they did
-- not save.
--
-- Root cause: PostgREST embeds (departments, designations, grades, work_locations,
-- cost_centers, shifts, manager) require the foreign-key columns + constraints to
-- exist. On drifted environments one of them is missing, so the whole query fails.
--
-- This migration idempotently ensures every FK column exists AND has its foreign
-- key constraint, so the embeds resolve. Additive + safe to run repeatedly.
-- ============================================================

-- 1. Ensure the columns exist (creates column + FK together when absent).
ALTER TABLE job_history ADD COLUMN IF NOT EXISTS department_id    UUID REFERENCES departments(id)    ON DELETE SET NULL;
ALTER TABLE job_history ADD COLUMN IF NOT EXISTS designation_id   UUID REFERENCES designations(id)   ON DELETE SET NULL;
ALTER TABLE job_history ADD COLUMN IF NOT EXISTS grade_id         UUID REFERENCES grades(id)         ON DELETE SET NULL;
ALTER TABLE job_history ADD COLUMN IF NOT EXISTS work_location_id UUID REFERENCES work_locations(id) ON DELETE SET NULL;
ALTER TABLE job_history ADD COLUMN IF NOT EXISTS cost_center_id   UUID REFERENCES cost_centers(id)   ON DELETE SET NULL;
ALTER TABLE job_history ADD COLUMN IF NOT EXISTS shift_id         UUID REFERENCES shifts(id)         ON DELETE SET NULL;
ALTER TABLE job_history ADD COLUMN IF NOT EXISTS manager_id       UUID REFERENCES employees(id)      ON DELETE SET NULL;

-- 2. For columns that already existed WITHOUT a FK constraint, add the FK so
--    PostgREST can resolve the embed. Guarded by column-level FK existence.
DO $$
DECLARE
  rec RECORD;
BEGIN
  FOR rec IN
    SELECT * FROM (VALUES
      ('department_id',    'departments',    'job_history_department_id_fkey'),
      ('designation_id',   'designations',   'job_history_designation_id_fkey'),
      ('grade_id',         'grades',         'job_history_grade_id_fkey'),
      ('work_location_id', 'work_locations', 'job_history_work_location_id_fkey'),
      ('cost_center_id',   'cost_centers',   'job_history_cost_center_id_fkey'),
      ('shift_id',         'shifts',         'job_history_shift_id_fkey'),
      ('manager_id',       'employees',      'job_history_manager_id_fkey')
    ) AS t(col, ref_table, fk_name)
  LOOP
    IF NOT EXISTS (
      SELECT 1
      FROM information_schema.table_constraints tc
      JOIN information_schema.key_column_usage kcu
        ON tc.constraint_name = kcu.constraint_name
       AND tc.table_schema    = kcu.table_schema
      WHERE tc.table_name      = 'job_history'
        AND tc.constraint_type = 'FOREIGN KEY'
        AND kcu.column_name    = rec.col
    ) THEN
      EXECUTE format(
        'ALTER TABLE job_history ADD CONSTRAINT %I FOREIGN KEY (%I) REFERENCES %I(id) ON DELETE SET NULL',
        rec.fk_name, rec.col, rec.ref_table
      );
    END IF;
  END LOOP;
END $$;

NOTIFY pgrst, 'reload schema';
