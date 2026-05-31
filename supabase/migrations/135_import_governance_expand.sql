-- 135_import_governance_expand.sql
--
-- Sprint S7 — Enterprise Import Governance Expansion
--
-- 1. Expands import_jobs.master_type CHECK constraint to include:
--      salary_structures, compensation_revisions, document_types,
--      identity_types, relationship_types
--
-- 2. Adds content_checksum to upload_sessions for replay-duplicate detection.
--
-- 3. Adds import_job_id to upload_sessions so attendance uploads can be
--    linked to a master import job record when that pattern is used.

-- ── 1. Expand import_jobs.master_type ─────────────────────────────────────────

ALTER TABLE import_jobs
  DROP CONSTRAINT IF EXISTS import_jobs_master_type_check;

ALTER TABLE import_jobs
  ADD CONSTRAINT import_jobs_master_type_check
  CHECK (master_type IN (
    -- Original (migration 108)
    'employees',
    'shifts',
    'departments',
    'designations',
    'grades',
    'work_locations',
    'cost_centers',
    'salary_components',
    'salary_structures',
    'leave_types',
    'payroll_groups',
    'reimbursement_categories',
    'roster_templates',
    'notification_templates',
    'holiday_calendar',
    -- Added post-108 (migration 130)
    'sites',
    'employee_compensation',
    'leave_opening_balances',
    'shift_assignments',
    'employment_categories',
    'statutory_groups',
    'asset_categories',
    -- Added in S7 (this migration)
    'compensation_revisions',
    'document_types',
    'identity_types',
    'relationship_types'
  ));

-- ── 2. Duplicate-upload detection ────────────────────────────────────────────
-- SHA-256 hex digest of the raw file/CSV content.
-- The upload route computes and stores this; on a re-upload of the same file
-- the route returns a 409-style warning so operators can confirm before replaying.

ALTER TABLE upload_sessions
  ADD COLUMN IF NOT EXISTS content_checksum TEXT;  -- SHA-256 hex of raw upload content

CREATE INDEX IF NOT EXISTS idx_upload_sessions_checksum
  ON upload_sessions (tenant_id, upload_type, content_checksum)
  WHERE content_checksum IS NOT NULL;

-- ── 3. salary_structures.is_default ─────────────────────────────────────────
-- Required by the salary_structures import template to designate a tenant
-- default structure. Only one structure per tenant should be default.
-- A partial unique index enforces this without blocking non-default rows.

ALTER TABLE salary_structures
  ADD COLUMN IF NOT EXISTS is_default BOOLEAN NOT NULL DEFAULT false;

CREATE UNIQUE INDEX IF NOT EXISTS uq_salary_structures_tenant_default
  ON salary_structures (tenant_id)
  WHERE is_default = true;

-- ── 4. Import job back-reference ──────────────────────────────────────────────
-- Allows attendance upload sessions to point to an import_jobs row when the
-- upload triggers a full import lifecycle (future pattern).

ALTER TABLE upload_sessions
  ADD COLUMN IF NOT EXISTS import_job_id UUID REFERENCES import_jobs(id) ON DELETE SET NULL;
