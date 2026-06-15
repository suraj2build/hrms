-- ============================================================
-- 267_job_history_org_snapshot.sql
--
-- MDI / C8-M1: Snapshot org-attribute NAMES onto job_history at write time.
--
-- job_history (the system of record for an employee's grade/designation/
-- department/etc. over time) stored only foreign-key ids. Editing or merging a
-- master (e.g. renaming grade "L3"→"L5", or changing its CTC band) therefore
-- retroactively rewrote what every historical job row claimed — point-in-time
-- auditability was impossible.
--
-- A trigger snapshots the master's display name onto the row when the row is
-- written. The snapshot is then immutable: a later rename of the master does
-- NOT change it. On UPDATE the name is re-snapshotted ONLY when the underlying
-- id is repointed (a genuine reassignment), never on an unrelated edit.
--
-- Forward-fixing: existing rows keep NULL snapshot names (use the live FK as
-- before). Backfilling historical names and snapshotting org attributes onto
-- payroll slips are follow-ups.
-- ============================================================

ALTER TABLE job_history
  ADD COLUMN IF NOT EXISTS department_name    TEXT,
  ADD COLUMN IF NOT EXISTS designation_name   TEXT,
  ADD COLUMN IF NOT EXISTS grade_name         TEXT,
  ADD COLUMN IF NOT EXISTS work_location_name TEXT,
  ADD COLUMN IF NOT EXISTS cost_center_name   TEXT,
  ADD COLUMN IF NOT EXISTS shift_name         TEXT;

CREATE OR REPLACE FUNCTION fn_snapshot_job_history_names()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'INSERT' OR NEW.department_id IS DISTINCT FROM OLD.department_id THEN
    NEW.department_name := (SELECT name FROM departments WHERE id = NEW.department_id);
  END IF;
  IF TG_OP = 'INSERT' OR NEW.designation_id IS DISTINCT FROM OLD.designation_id THEN
    NEW.designation_name := (SELECT name FROM designations WHERE id = NEW.designation_id);
  END IF;
  IF TG_OP = 'INSERT' OR NEW.grade_id IS DISTINCT FROM OLD.grade_id THEN
    NEW.grade_name := (SELECT name FROM grades WHERE id = NEW.grade_id);
  END IF;
  IF TG_OP = 'INSERT' OR NEW.work_location_id IS DISTINCT FROM OLD.work_location_id THEN
    NEW.work_location_name := (SELECT name FROM work_locations WHERE id = NEW.work_location_id);
  END IF;
  IF TG_OP = 'INSERT' OR NEW.cost_center_id IS DISTINCT FROM OLD.cost_center_id THEN
    NEW.cost_center_name := (SELECT name FROM cost_centers WHERE id = NEW.cost_center_id);
  END IF;
  IF TG_OP = 'INSERT' OR NEW.shift_id IS DISTINCT FROM OLD.shift_id THEN
    NEW.shift_name := (SELECT name FROM shifts WHERE id = NEW.shift_id);
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_snapshot_job_history_names ON job_history;
CREATE TRIGGER trg_snapshot_job_history_names
  BEFORE INSERT OR UPDATE ON job_history
  FOR EACH ROW
  EXECUTE FUNCTION fn_snapshot_job_history_names();
