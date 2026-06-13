-- ============================================================================
-- 241_onboarding_buddy_assets.sql
-- ONB-05b: Buddy pairing for new joiners.
--   • buddy_employee_id on pre_joinee_invitations (pre-joinee path)
--   • buddy_employee_id on onboarding_sessions   (AI-review path)
-- Idempotent: safe to re-run.
-- ============================================================================

ALTER TABLE pre_joinee_invitations
  ADD COLUMN IF NOT EXISTS buddy_employee_id UUID REFERENCES employees(id) ON DELETE SET NULL;

ALTER TABLE onboarding_sessions
  ADD COLUMN IF NOT EXISTS buddy_employee_id UUID REFERENCES employees(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_pji_buddy   ON pre_joinee_invitations (tenant_id, buddy_employee_id);
CREATE INDEX IF NOT EXISTS idx_obs_buddy   ON onboarding_sessions     (tenant_id, buddy_employee_id);
