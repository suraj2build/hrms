-- ============================================================
-- 108_master_import_jobs.sql
-- Universal Master Import Framework
-- Tracks every import operation with full audit trail
-- ============================================================

-- import_jobs: one row per import operation
CREATE TABLE IF NOT EXISTS import_jobs (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       UUID        NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  master_type     TEXT        NOT NULL CHECK (master_type IN (
    'employees', 'shifts', 'departments', 'designations', 'grades',
    'work_locations', 'cost_centers', 'salary_components', 'salary_structures',
    'leave_types', 'payroll_groups', 'reimbursement_categories',
    'roster_templates', 'notification_templates', 'holiday_calendar'
  )),
  mode            TEXT        NOT NULL DEFAULT 'upsert' CHECK (mode IN (
    'create_only', 'update_only', 'upsert', 'validate_only'
  )),
  status          TEXT        NOT NULL DEFAULT 'pending' CHECK (status IN (
    'pending', 'validating', 'validated', 'importing',
    'completed', 'failed', 'cancelled'
  )),
  file_name       TEXT        NOT NULL,
  total_rows      INT         NOT NULL DEFAULT 0,
  valid_rows      INT         NOT NULL DEFAULT 0,
  invalid_rows    INT         NOT NULL DEFAULT 0,
  created_rows    INT         NOT NULL DEFAULT 0,
  updated_rows    INT         NOT NULL DEFAULT 0,
  failed_rows     INT         NOT NULL DEFAULT 0,
  skipped_rows    INT         NOT NULL DEFAULT 0,
  error_summary   JSONB,          -- top-level error categories + counts
  warnings        JSONB,          -- aggregate warnings array
  import_options  JSONB,          -- {skipDuplicates, updateExisting, ...}
  started_at      TIMESTAMPTZ,
  completed_at    TIMESTAMPTZ,
  duration_ms     INT,
  created_by      UUID        REFERENCES profiles(id) ON DELETE SET NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- import_job_rows: row-level results (max ~5000 rows stored)
CREATE TABLE IF NOT EXISTS import_job_rows (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  import_job_id   UUID        NOT NULL REFERENCES import_jobs(id) ON DELETE CASCADE,
  tenant_id       UUID        NOT NULL,
  row_number      INT         NOT NULL,
  row_data        JSONB       NOT NULL,           -- original row values
  normalized_data JSONB,                          -- post-normalization values
  status          TEXT        NOT NULL CHECK (status IN (
    'valid', 'invalid', 'created', 'updated', 'failed', 'skipped', 'duplicate'
  )),
  errors          JSONB,      -- [{field: "email", message: "Invalid email format"}]
  warnings        JSONB,      -- [{field: "joining_date", message: "Future date"}]
  record_id       UUID,       -- UUID of created/updated record
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_import_jobs_tenant        ON import_jobs (tenant_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_import_jobs_status        ON import_jobs (tenant_id, status);
CREATE INDEX IF NOT EXISTS idx_import_jobs_master_type   ON import_jobs (tenant_id, master_type, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_import_job_rows_job       ON import_job_rows (import_job_id, row_number);
CREATE INDEX IF NOT EXISTS idx_import_job_rows_status    ON import_job_rows (import_job_id, status);

ALTER TABLE import_jobs     ENABLE ROW LEVEL SECURITY;
ALTER TABLE import_job_rows ENABLE ROW LEVEL SECURITY;

CREATE POLICY "ij_tenant_read"  ON import_jobs     FOR SELECT USING (tenant_id = get_user_tenant_id());
CREATE POLICY "ij_hr_write"     ON import_jobs     FOR ALL    USING (get_user_role() IN ('super_admin', 'hr_admin'));
CREATE POLICY "ijr_tenant_read" ON import_job_rows FOR SELECT USING (tenant_id = get_user_tenant_id());
CREATE POLICY "ijr_hr_write"    ON import_job_rows FOR ALL    USING (get_user_role() IN ('super_admin', 'hr_admin'));
