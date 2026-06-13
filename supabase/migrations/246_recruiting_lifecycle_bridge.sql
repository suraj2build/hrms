-- Migration 246: Recruiting → Employee Lifecycle Bridge
-- Links recruitment applications to pre-joinee invitations, closing the
-- gap between "hired" status and the preboarding/onboarding pipeline.

-- Add source linkage to pre_joinee_invitations so HR can trace which
-- application triggered each invitation.
ALTER TABLE pre_joinee_invitations
  ADD COLUMN IF NOT EXISTS source_application_id uuid REFERENCES applications(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS source_candidate_id    uuid REFERENCES candidates(id)   ON DELETE SET NULL;

-- Track preboarding initiation on the application side so HR can see
-- at a glance whether a hired candidate has been sent to preboarding.
ALTER TABLE applications
  ADD COLUMN IF NOT EXISTS preboarding_initiated_at  timestamptz,
  ADD COLUMN IF NOT EXISTS pre_joinee_invitation_id  uuid REFERENCES pre_joinee_invitations(id) ON DELETE SET NULL;

-- Index: quick lookup of all applications that have NOT yet had preboarding initiated
CREATE INDEX IF NOT EXISTS idx_applications_hired_no_preboarding
  ON applications (tenant_id, status)
  WHERE status = 'hired' AND pre_joinee_invitation_id IS NULL;

-- Index: reverse lookup — which application does this invitation come from
CREATE INDEX IF NOT EXISTS idx_pre_joinee_source_application
  ON pre_joinee_invitations (source_application_id)
  WHERE source_application_id IS NOT NULL;
