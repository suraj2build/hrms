-- ============================================================
-- 115_employee_code_sequence.sql
--
-- Sequence-based employee code generation.
--
-- Format : <prefix><4-digit zero-padded number>  e.g. SK0001
-- Default prefix: SK  (configurable per tenant via employee_code_sequences)
--
-- Design:
--   • employee_code_sequences holds one row per tenant
--   • generate_employee_code() atomically increments last_number with
--     UPDATE … RETURNING to prevent race conditions
--   • create_employee_with_job() gains optional p_employee_code parameter:
--       - NULL (default) → auto-generate via generate_employee_code()
--       - provided        → use as-is (for legacy / import codes)
-- ============================================================

-- ── 1. Sequence table ────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS employee_code_sequences (
  tenant_id    UUID        NOT NULL PRIMARY KEY REFERENCES tenants(id) ON DELETE CASCADE,
  prefix       TEXT        NOT NULL DEFAULT 'SK',
  last_number  INT         NOT NULL DEFAULT 0,
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE employee_code_sequences ENABLE ROW LEVEL SECURITY;

CREATE POLICY employee_code_sequences_tenant_isolation ON employee_code_sequences
  USING (tenant_id = get_user_tenant_id());

-- ── 2. generate_employee_code() ──────────────────────────────────────────────

CREATE OR REPLACE FUNCTION generate_employee_code(p_tenant_id UUID)
RETURNS TEXT
LANGUAGE plpgsql
AS $$
DECLARE
  v_prefix TEXT;
  v_num    INT;
BEGIN
  -- Ensure a sequence row exists for this tenant (idempotent)
  INSERT INTO employee_code_sequences (tenant_id, prefix, last_number)
  VALUES (p_tenant_id, 'SK', 0)
  ON CONFLICT (tenant_id) DO NOTHING;

  -- Atomic increment — FOR UPDATE prevents concurrent duplicates
  UPDATE employee_code_sequences
  SET    last_number = last_number + 1,
         updated_at  = now()
  WHERE  tenant_id   = p_tenant_id
  RETURNING prefix, last_number INTO v_prefix, v_num;

  RETURN v_prefix || LPAD(v_num::TEXT, 4, '0');
END;
$$;

GRANT EXECUTE ON FUNCTION generate_employee_code(UUID) TO authenticated, service_role;

-- ── 3. Recreate create_employee_with_job with sequence-based code ─────────────
-- Drop all existing overloads first (same pattern as migration 063).

DO $$
DECLARE
  r RECORD;
BEGIN
  FOR r IN
    SELECT oid::regprocedure::text AS sig
    FROM   pg_proc
    WHERE  proname      = 'create_employee_with_job'
      AND  pronamespace = 'public'::regnamespace
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
  p_employment_type   TEXT,                   -- NOT NULL
  -- ── optional params ─────────────────────────────────────
  p_phone             TEXT    DEFAULT NULL,
  p_effective_from    DATE    DEFAULT NULL,   -- falls back to p_joining_date
  p_department_id     UUID    DEFAULT NULL,
  p_designation_id    UUID    DEFAULT NULL,
  p_grade_id          UUID    DEFAULT NULL,
  p_work_location_id  UUID    DEFAULT NULL,
  p_cost_center_id    UUID    DEFAULT NULL,
  p_shift_id          UUID    DEFAULT NULL,
  p_manager_id        UUID    DEFAULT NULL,
  p_reason_for_change TEXT    DEFAULT 'Initial Hire',
  p_site_id           UUID    DEFAULT NULL,
  p_roster_id         UUID    DEFAULT NULL,
  -- ── employee code — NULL = auto-generate ─────────────────
  p_employee_code     TEXT    DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
AS $$
DECLARE
  v_employee_id   UUID;
  v_employee_code TEXT;
BEGIN
  -- ── 1. Validate employment_type ───────────────────────────────────────────
  IF p_employment_type NOT IN ('permanent','contract','intern','probation','consultant') THEN
    RAISE EXCEPTION 'Invalid employment_type: %', p_employment_type
      USING ERRCODE = 'invalid_parameter_value';
  END IF;

  -- ── 2. Resolve employee code ──────────────────────────────────────────────
  IF p_employee_code IS NOT NULL AND trim(p_employee_code) <> '' THEN
    -- Legacy / import: use provided code as-is
    v_employee_code := trim(p_employee_code);
  ELSE
    -- Auto-generate sequence-based code (e.g. SK0001)
    v_employee_code := generate_employee_code(p_tenant_id);
  END IF;

  -- ── 3. Insert lean employee record ───────────────────────────────────────
  INSERT INTO employees (
    tenant_id,    employee_code,
    first_name,   last_name,
    email,        phone,
    joining_date, created_by,
    site_id,      roster_id
  ) VALUES (
    p_tenant_id,    v_employee_code,
    p_first_name,   p_last_name,
    p_email,        p_phone,
    p_joining_date, p_created_by,
    p_site_id,      p_roster_id
  )
  RETURNING id INTO v_employee_id;

  -- ── 4. Insert initial job history ────────────────────────────────────────
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

  -- ── 5. Return employee + job_info with joined master names ────────────────
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

GRANT EXECUTE ON FUNCTION create_employee_with_job TO authenticated, service_role;
