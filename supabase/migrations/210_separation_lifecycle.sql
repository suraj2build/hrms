-- ============================================================================
-- 210_separation_lifecycle.sql
-- Separation Lifecycle Completion: extend employee_separation with lifecycle
-- stage tracking, approval, relieving, and archival columns.
--
-- SSOT: employees.status remains the canonical employee status. This module
-- tracks its OWN lifecycle_stage and does NOT duplicate employee status.
-- Idempotent: safe to re-run.
-- ============================================================================

ALTER TABLE employee_separation
  ADD COLUMN IF NOT EXISTS lifecycle_stage TEXT NOT NULL DEFAULT 'initiated';

ALTER TABLE employee_separation
  ADD COLUMN IF NOT EXISTS approval_status TEXT NOT NULL DEFAULT 'pending';

ALTER TABLE employee_separation
  ADD COLUMN IF NOT EXISTS approved_by UUID REFERENCES profiles(id) ON DELETE SET NULL;

ALTER TABLE employee_separation
  ADD COLUMN IF NOT EXISTS approved_at TIMESTAMPTZ;

ALTER TABLE employee_separation
  ADD COLUMN IF NOT EXISTS relieved_at TIMESTAMPTZ;

-- Nullable link to a generated relieving letter; intentionally no FK to avoid
-- coupling to the documents module.
ALTER TABLE employee_separation
  ADD COLUMN IF NOT EXISTS relieving_letter_id UUID;

ALTER TABLE employee_separation
  ADD COLUMN IF NOT EXISTS archived_at TIMESTAMPTZ;

ALTER TABLE employee_separation
  ADD COLUMN IF NOT EXISTS archived_by UUID REFERENCES profiles(id) ON DELETE SET NULL;

ALTER TABLE employee_separation
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT now();

-- ── CHECK constraints (idempotent) ──────────────────────────────────────────

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'employee_separation_lifecycle_stage_check'
  ) THEN
    ALTER TABLE employee_separation
      ADD CONSTRAINT employee_separation_lifecycle_stage_check
      CHECK (lifecycle_stage IN (
        'initiated','notice_period','clearance','fnf','relieving','relieved','archived'
      ));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'employee_separation_approval_status_check'
  ) THEN
    ALTER TABLE employee_separation
      ADD CONSTRAINT employee_separation_approval_status_check
      CHECK (approval_status IN ('pending','approved','rejected'));
  END IF;
END $$;

-- ── Index ───────────────────────────────────────────────────────────────────

CREATE INDEX IF NOT EXISTS idx_employee_separation_tenant_stage
  ON employee_separation(tenant_id, lifecycle_stage);
