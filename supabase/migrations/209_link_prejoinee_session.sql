-- 209_link_prejoinee_session.sql
-- Link a pre-joinee invitation to the AI-onboarding review session created when
-- the candidate submits their pre-join form, so HR can extract/validate/approve
-- the same candidate from the existing onboarding review queue.

ALTER TABLE pre_joinee_invitations
  ADD COLUMN IF NOT EXISTS session_id UUID
  REFERENCES onboarding_sessions(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_pre_joinee_invitations_session
  ON pre_joinee_invitations (session_id);
