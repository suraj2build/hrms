-- Migration 330: Succession Planning Intelligence Enhancements
-- Adds 9-Box Grid positioning, 6-dimension readiness scorecard, IDP actions

ALTER TABLE succession_candidates
  ADD COLUMN IF NOT EXISTS nine_box_performance SMALLINT CHECK (nine_box_performance BETWEEN 1 AND 3),
  ADD COLUMN IF NOT EXISTS nine_box_potential   SMALLINT CHECK (nine_box_potential   BETWEEN 1 AND 3),
  ADD COLUMN IF NOT EXISTS score_performance    SMALLINT CHECK (score_performance    BETWEEN 0 AND 10),
  ADD COLUMN IF NOT EXISTS score_skill_gap      SMALLINT CHECK (score_skill_gap      BETWEEN 0 AND 10),
  ADD COLUMN IF NOT EXISTS score_leadership     SMALLINT CHECK (score_leadership     BETWEEN 0 AND 10),
  ADD COLUMN IF NOT EXISTS score_mobility       SMALLINT CHECK (score_mobility       BETWEEN 0 AND 10),
  ADD COLUMN IF NOT EXISTS score_tenure         SMALLINT CHECK (score_tenure         BETWEEN 0 AND 10),
  ADD COLUMN IF NOT EXISTS score_attrition_risk SMALLINT CHECK (score_attrition_risk BETWEEN 0 AND 10),
  ADD COLUMN IF NOT EXISTS attrition_risk_flag  BOOLEAN NOT NULL DEFAULT false;

CREATE TABLE IF NOT EXISTS succession_idp_actions (
  id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    UUID        NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  candidate_id UUID        NOT NULL REFERENCES succession_candidates(id) ON DELETE CASCADE,
  action_type  TEXT        NOT NULL DEFAULT 'course'
    CHECK (action_type IN ('course', 'assignment', 'mentoring', 'certification', 'coaching')),
  description  TEXT        NOT NULL,
  target_date  DATE,
  completed_at TIMESTAMPTZ,
  created_by   UUID        REFERENCES profiles(id) ON DELETE SET NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_succession_idp_candidate
  ON succession_idp_actions(tenant_id, candidate_id);

ALTER TABLE succession_idp_actions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "succession_idp_admin" ON succession_idp_actions;
CREATE POLICY "succession_idp_admin" ON succession_idp_actions FOR ALL
  USING (tenant_id = get_user_tenant_id()
         AND get_user_role() IN ('super_admin', 'hr_admin'));

CREATE OR REPLACE FUNCTION update_succession_idp_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END; $$;

DROP TRIGGER IF EXISTS trg_succession_idp_updated_at ON succession_idp_actions;
CREATE TRIGGER trg_succession_idp_updated_at
  BEFORE UPDATE ON succession_idp_actions
  FOR EACH ROW EXECUTE FUNCTION update_succession_idp_updated_at();
