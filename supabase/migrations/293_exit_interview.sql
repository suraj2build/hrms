-- Migration 293: Structured exit interview (questionnaire + responses + analytics)
--
-- Replaces the bare exit_interview_done flag with a configurable questionnaire:
--   exit_interview_templates → exit_interview_questions → exit_interview_responses
-- The submission header lives on employee_separation so it stays 1:1 with the
-- separation record (status / overall comments / would-recommend / who & when).

CREATE TABLE IF NOT EXISTS exit_interview_templates (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   UUID        NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name        TEXT        NOT NULL,
  is_active   BOOLEAN     NOT NULL DEFAULT true,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS exit_interview_questions (
  id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     UUID        NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  template_id   UUID        NOT NULL REFERENCES exit_interview_templates(id) ON DELETE CASCADE,
  category      TEXT        NOT NULL CHECK (category IN
                  ('job_role','manager','culture','compensation','growth','work_life','reason','other')),
  question_text TEXT        NOT NULL,
  response_type TEXT        NOT NULL CHECK (response_type IN ('rating','text','single_choice','boolean')),
  options       JSONB       NOT NULL DEFAULT '[]'::jsonb,   -- choices for single_choice
  display_order INT         NOT NULL DEFAULT 0,
  is_required   BOOLEAN     NOT NULL DEFAULT false,
  is_active     BOOLEAN     NOT NULL DEFAULT true,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_eiq_template ON exit_interview_questions (tenant_id, template_id);

CREATE TABLE IF NOT EXISTS exit_interview_responses (
  id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     UUID        NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  separation_id UUID        NOT NULL REFERENCES employee_separation(id) ON DELETE CASCADE,
  question_id   UUID        NOT NULL REFERENCES exit_interview_questions(id) ON DELETE CASCADE,
  rating        INT,                                        -- 1..5 for rating questions
  response_text TEXT,
  choice        TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (separation_id, question_id)
);
CREATE INDEX IF NOT EXISTS idx_eir_separation ON exit_interview_responses (tenant_id, separation_id);

-- Submission header (1:1 with the separation record).
ALTER TABLE employee_separation
  ADD COLUMN IF NOT EXISTS exit_interview_template_id      UUID,
  ADD COLUMN IF NOT EXISTS exit_interview_status           TEXT NOT NULL DEFAULT 'not_started'
                          CHECK (exit_interview_status IN ('not_started','draft','submitted')),
  ADD COLUMN IF NOT EXISTS exit_interview_overall_comments TEXT,
  ADD COLUMN IF NOT EXISTS exit_interview_would_recommend  BOOLEAN,
  ADD COLUMN IF NOT EXISTS exit_interview_submitted_by     UUID;

-- ── RLS (mirrors employee_* convention: HR full, tenant read) ────────────────
ALTER TABLE exit_interview_templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE exit_interview_questions ENABLE ROW LEVEL SECURITY;
ALTER TABLE exit_interview_responses ENABLE ROW LEVEL SECURITY;

CREATE POLICY "eit_hr_all" ON exit_interview_templates FOR ALL    USING (get_user_role() IN ('super_admin','hr_admin'));
CREATE POLICY "eit_self"   ON exit_interview_templates FOR SELECT USING (tenant_id = get_user_tenant_id());
CREATE POLICY "eiq_hr_all" ON exit_interview_questions FOR ALL    USING (get_user_role() IN ('super_admin','hr_admin'));
CREATE POLICY "eiq_self"   ON exit_interview_questions FOR SELECT USING (tenant_id = get_user_tenant_id());
CREATE POLICY "eir_hr_all" ON exit_interview_responses FOR ALL    USING (get_user_role() IN ('super_admin','hr_admin'));
CREATE POLICY "eir_self"   ON exit_interview_responses FOR SELECT USING (tenant_id = get_user_tenant_id());
