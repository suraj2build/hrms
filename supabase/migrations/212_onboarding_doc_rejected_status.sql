-- Migration 212: Add 'rejected' to onboarding_documents extraction_status CHECK
-- Required for identity-mismatch document rejection during AI extraction.

ALTER TABLE onboarding_documents
  DROP CONSTRAINT IF EXISTS onboarding_documents_extraction_status_check;

ALTER TABLE onboarding_documents
  ADD CONSTRAINT onboarding_documents_extraction_status_check
  CHECK (extraction_status IN ('pending', 'processing', 'extracted', 'failed', 'skipped', 'rejected'));
