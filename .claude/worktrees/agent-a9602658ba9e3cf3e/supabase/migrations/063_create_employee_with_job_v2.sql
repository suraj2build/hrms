-- ============================================================
-- 063_create_employee_with_job_v2.sql
--
-- Extend create_employee_with_job() with two optional parameters:
--   p_site_id   — sets employees.site_id on the new employee row
--   p_roster_id — sets employees.roster_id on the new employee row
--
-- Both default to NULL for full backward compatibility.
-- Existing callers that omit these params are unaffected.
-- ============================================================

-- Drop ALL overloads of create_employee_with_job dynamically.
-- This handles any parameter-order variant without needing to enumerate signatures.
DO $$
DECLARE
  r RECORD;
BEGIN
  FOR r IN
    SELECT oid::regprocedure::text AS sig
    FROM   pg_proc
    WHERE  proname        = 'create_employee_with_job'
      AND  pronamespace   = 'public'::regnamespace
  LOOP
    EXECUTE 'DROP FUNCTION IF EXISTS ' || r.sig;
  END LOOP;
END;
$$;

CREATE OR REPLACE FUNCTION create_employee_with_job(
  -- ── tenant / audit ──────────────────────────────────────
  p_tenant_id         UUID,
  p_created_by        UUID,
  -- ── employees table ─────────────────────────────────────
  p_first_name        TEXT,
  p_last_name         TEXT,
  p_email             TEXT,
  p_joining_date      DATE,
  -- ── job_history table ───────────────────────────────────
  p_employment_type   TEXT,                  -- NOT NULL
  -- ── optional params (must all follow required ones) ─────
  p_phone             TEXT    DEFAULT NULL,
  p_effective_from    DATE    DEFAULT NULL,  -- falls back to p_joining_date
  p_department_id     UUID    DEFAULT NULL,
  p_designation_id    UUID    DEFAULT NULL,
  p_grade_id          UUID    DEFAULT NULL,
  p_work_location_id  UUID    DEFAULT NULL,
  p_cost_center_id    UUID    DEFAULT NULL,
  p_shift_id          UUID    DEFAULT NULL,
  p_manager_id        UUID    DEFAULT NULL,
  p_reason_for_change TEXT    DEFAULT 'Initial Hire',
  -- ── NEW: org context ─────────────────────────────────────
  p_site_id           UUID    DEFAULT NULL,
  p_roster_id         UUID    DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
AS $$
DECLARE
  v_employee_id   UUID;
  v_employee_code TEXT;
  v_emp_count     BIGINT;
BEGIN
  -- ── 1. Validate employment_type ────────────────────────────────────────────
  IF p_employment_type NOT IN ('permanent','contract','intern','probation','consultant') THEN
    RAISE EXCEPTION 'Invalid employment_type: %', p_employment_type
      USING ERRCODE = 'invalid_parameter_value';
  END IF;

  -- ── 2. Generate tenant-scoped employee code ────────────────────────────────
  -- COUNT is advisory here; the unique index on employee_code prevents races.
  SELECT COUNT(*) INTO v_emp_count
  FROM employees
  WHERE tenant_id = p_tenant_id;

  v_employee_code := 'EMP-' || LPAD((v_emp_count + 1)::TEXT, 4, '0');

  -- ── 3. Insert lean employee record (now includes site_id + roster_id) ──────
  INSERT INTO employees (
    tenant_id,    employee_code,
    first_name,   last_name,
    email,        phone,
    joining_date, created_by,
    site_id,      roster_id
  ) VALUES (
    p_tenant_id,  v_employee_code,
    p_first_name, p_last_name,
    p_email,      p_phone,
    p_joining_date, p_created_by,
    p_site_id,    p_roster_id
  )
  RETURNING id INTO v_employee_id;

  -- ── 4. Insert initial job history ─────────────────────────────────────────
  INSERT INTO job_history (
    tenant_id,        employee_id,
    department_id,    designation_id,   grade_id,
    work_location_id, cost_center_id,   shift_id,    manager_id,
    employment_type,
    effective_from,
    is_current,
    reason_for_change,
    created_by
  ) VALUES (
    p_tenant_id,      v_employee_id,
    p_department_id,  p_designation_id, p_grade_id,
    p_work_location_id, p_cost_center_id, p_shift_id, p_manager_id,
    p_employment_type,
    COALESCE(p_effective_from, p_joining_date),
    true,
    p_reason_for_change,
    p_created_by
  );

  -- ── 5. Return employee + job_info with joined master names ─────────────────
  RETURN (
    SELECT jsonb_build_object(
      'employee', jsonb_build_object(
        'id',            e.id,
        'employee_code', e.employee_code,
        'first_name',    e.first_name,
        'last_name',     e.last_name,
        'email',         e.email,
        'phone',         e.phone,
        'joining_date',  e.joining_date,
        'status',        e.status,
        'site_id',       e.site_id,
        'roster_id',     e.roster_id,
        'created_at',    e.created_at
      ),
      'job_info', jsonb_build_object(
        'id',              jh.id,
        'employment_type', jh.employment_type,
        'effective_from',  jh.effective_from,
        'is_current',      jh.is_current,
        'department',      CASE WHEN d.id   IS NOT NULL
                             THEN jsonb_build_object('id', d.id,   'name', d.name)
                             ELSE NULL END,
        'designation',     CASE WHEN des.id IS NOT NULL
                             THEN jsonb_build_object('id', des.id, 'name', des.name)
                             ELSE NULL END,
        'grade',           CASE WHEN g.id   IS NOT NULL
                             THEN jsonb_build_object('id', g.id,   'name', g.name, 'code', g.code)
                             ELSE NULL END
      ),
      'site',    CASE WHEN s.id IS NOT NULL
                   THEN jsonb_build_object('id', s.id, 'name', s.name, 'timezone', s.timezone)
                   ELSE NULL END,
      'roster',  CASE WHEN r.id IS NOT NULL
                   THEN jsonb_build_object('id', r.id, 'name', r.name, 'cycle_days', r.cycle_days)
                   ELSE NULL END
    )
    FROM       employees   e
    JOIN       job_history jh  ON jh.employee_id = e.id AND jh.is_current = true
    LEFT JOIN  departments  d   ON jh.department_id  = d.id
    LEFT JOIN  designations des ON jh.designation_id = des.id
    LEFT JOIN  grades       g   ON jh.grade_id       = g.id
    LEFT JOIN  sites        s   ON e.site_id         = s.id
    LEFT JOIN  rosters      r   ON e.roster_id       = r.id
    WHERE e.id = v_employee_id
  );
END;
$$;

-- Preserve existing permissions
GRANT EXECUTE ON FUNCTION create_employee_with_job TO authenticated, service_role;
