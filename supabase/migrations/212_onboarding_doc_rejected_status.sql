-- Migration 212: onboarding document rejected status + exception-pass approval columns
-- (a) Add 'rejected' to onboarding_documents extraction_status CHECK
-- (b) Add exception-pass columns to draft_employee_profiles for audit traceability

-- (a) Allow 'rejected' status (identity-mismatch docs)
ALTER TABLE onboarding_documents
  DROP CONSTRAINT IF EXISTS onboarding_documents_extraction_status_check;

ALTER TABLE onboarding_documents
  ADD CONSTRAINT onboarding_documents_extraction_status_check
  CHECK (extraction_status IN ('pending', 'processing', 'extracted', 'failed', 'skipped', 'rejected'));

-- (b) Exception-pass approval tracking on draft profiles
ALTER TABLE draft_employee_profiles
  ADD COLUMN IF NOT EXISTS exception_approved  BOOLEAN     DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS exception_reason    TEXT,
  ADD COLUMN IF NOT EXISTS exception_errors    JSONB       DEFAULT '[]'::jsonb;
