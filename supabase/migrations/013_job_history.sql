-- ============================================================
-- 013_job_history.sql
-- Job history table — every job change (promotion, transfer,
-- role change) is a new row. The current job is the row
-- where is_current = true.
--
-- Trigger: on INSERT of a new row with is_current = true,
-- automatically close the previous current row.
-- ============================================================

CREATE TABLE IF NOT EXISTS job_history (
  id                UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         UUID        NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  employee_id       UUID        NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  -- Job attributes — all FK to master tables
  department_id     UUID        REFERENCES departments(id)    ON DELETE SET NULL,
  designation_id    UUID        REFERENCES designations(id)   ON DELETE SET NULL,
  grade_id          UUID        REFERENCES grades(id)         ON DELETE SET NULL,
  work_location_id  UUID        REFERENCES work_locations(id) ON DELETE SET NULL,
  cost_center_id    UUID        REFERENCES cost_centers(id)   ON DELETE SET NULL,
  shift_id          UUID        REFERENCES shifts(id)         ON DELETE SET NULL,
  manager_id        UUID        REFERENCES employees(id)      ON DELETE SET NULL,
  employment_type   TEXT        NOT NULL
    CHECK (employment_type IN ('permanent','contract','intern','probation','consultant')),
  confirmation_date DATE,       -- probation end / confirmation date
  -- History control
  effective_from    DATE        NOT NULL,
  effective_to      DATE,       -- NULL = currently active
  is_current        BOOLEAN     NOT NULL DEFAULT false,
  reason_for_change TEXT,       -- 'Initial Hire', 'Promotion', 'Transfer', 'Role Change', etc.
  -- Metadata
  created_by        UUID        REFERENCES profiles(id) ON DELETE SET NULL,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- Guard: effective_to must be >= effective_from
  CHECK (effective_to IS NULL OR effective_to >= effective_from)
);

-- Partial unique index: only ONE is_current = true row per employee per tenant
CREATE UNIQUE INDEX uidx_job_history_one_current
  ON job_history (tenant_id, employee_id)
  WHERE is_current = true;

-- Indexes for common query patterns
CREATE INDEX idx_jh_employee   ON job_history (tenant_id, employee_id);
CREATE INDEX idx_jh_department ON job_history (tenant_id, department_id);
CREATE INDEX idx_jh_manager    ON job_history (tenant_id, manager_id);
CREATE INDEX idx_jh_current    ON job_history (tenant_id, is_current) WHERE is_current = true;

-- ============================================================
-- TRIGGER: auto-close previous current record on INSERT
-- When a new job_history row is inserted with is_current = true,
-- the trigger finds the previous current row (if any) and:
--   1. Sets is_current = false
--   2. Sets effective_to = NEW.effective_from - 1 day
-- ============================================================
CREATE OR REPLACE FUNCTION fn_close_prev_job_history()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.is_current = true THEN
    UPDATE job_history
    SET
      is_current   = false,
      effective_to = NEW.effective_from - INTERVAL '1 day'
    WHERE
      tenant_id   = NEW.tenant_id
      AND employee_id = NEW.employee_id
      AND is_current  = true
      AND id         != NEW.id;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_close_prev_job_history
  AFTER INSERT ON job_history
  FOR EACH ROW EXECUTE FUNCTION fn_close_prev_job_history();

-- ============================================================
-- ROW LEVEL SECURITY
-- ============================================================
ALTER TABLE job_history ENABLE ROW LEVEL SECURITY;

-- HR admins / super admins: full access
CREATE POLICY "jh_hr_all"       ON job_history FOR ALL
  USING (get_user_role() IN ('super_admin','hr_admin'));

-- Managers: see their own direct reports' history
CREATE POLICY "jh_mgr_read"     ON job_history FOR SELECT
  USING (
    tenant_id = get_user_tenant_id()
    AND get_user_role() = 'manager'
  );

-- Employees: see their own history only
CREATE POLICY "jh_self_read"    ON job_history FOR SELECT
  USING (
    tenant_id   = get_user_tenant_id()
    AND get_user_role() = 'employee'
  );
