-- Migration 292: Pre-Joinee "request re-upload" (changes_requested) state
--
-- Adds a non-terminal lifecycle state so HR can bounce a submitted pre-onboarding
-- back to the candidate to revise/re-upload specific documents, instead of a hard
-- reject. The candidate's portal re-opens (pre-filled with their prior data) and
-- they resubmit, returning the invitation to 'submitted' for review.
--
--   pending → submitted → changes_requested → submitted → approved/rejected

ALTER TABLE pre_joinee_invitations DROP CONSTRAINT IF EXISTS pre_joinee_invitations_status_check;
ALTER TABLE pre_joinee_invitations
  ADD CONSTRAINT pre_joinee_invitations_status_check
  CHECK (status IN ('pending', 'submitted', 'approved', 'rejected', 'expired', 'changes_requested'));

-- Per-document re-upload requests: [{ document_type, reason }]
ALTER TABLE pre_joinee_invitations
  ADD COLUMN IF NOT EXISTS requested_changes JSONB NOT NULL DEFAULT '[]'::jsonb;
