-- Migration 178: Add AI confidence columns to draft_employee_profiles
-- Fixes 500 on GET /onboarding/sessions — these columns were referenced in
-- the API code and extraction engine but never added to the schema.
-- Also adds 'draft_ready' to the status CHECK constraint.

-- 1. Add AI/confidence columns
ALTER TABLE draft_employee_profiles
  ADD COLUMN IF NOT EXISTS overall_confidence     DECIMAL(5,4),   -- 0.0–1.0
  ADD COLUMN IF NOT EXISTS missing_critical_fields JSONB,          -- ["first_name", ...]
  ADD COLUMN IF NOT EXISTS conflict_fields         JSONB;          -- ["pan_number", ...]

-- 2. Extend status CHECK to include 'draft_ready'
--    (used by extraction engine after merging fields)
ALTER TABLE draft_employee_profiles
  DROP CONSTRAINT IF EXISTS draft_employee_profiles_status_check;

ALTER TABLE draft_employee_profiles
  ADD CONSTRAINT draft_employee_profiles_status_check
  CHECK (status IN (
    'draft_ready',
    'extraction_complete',
    'hr_review_pending',
    'validation_pending',
    'approval_pending',
    'approved',
    'rejected',
    'employee_created'
  ));
