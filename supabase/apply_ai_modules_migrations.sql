-- ============================================================================
-- apply_ai_modules_migrations.sql
--
-- Idempotent bundle for AI Modules migrations 323–334.
-- Run once in the Supabase SQL Editor to bring production up to date.
--
-- Bundled migrations (in order):
--   323_absconding_case_management
--   324_helpdesk_enhancements
--   325_policy_kb
--   326_mood_pulse
--   327_surveys
--   328_policy_rag
--   329_succession_planning
--   330_succession_enhancements
--   331_survey_intelligence
--   332_helpdesk_absconding_enhancements
--   334_formal_awards
--
-- Safety: fully idempotent — uses IF NOT EXISTS / OR REPLACE / ON CONFLICT DO NOTHING.
-- NO data is ever deleted or truncated.
-- ============================================================================

BEGIN;

-- ─────────────────────────────────────────────────────────────────────────────
-- 323: Absconding Case Management
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS absconding_cases (
  id                      UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id               UUID        NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  employee_id             UUID        NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  status                  TEXT        NOT NULL DEFAULT 'flagged'
    CHECK (status IN ('flagged','wl1_sent','wl2_sent','termination_pending','terminated','resolved','closed')),
  first_ua_date           DATE        NOT NULL,
  last_ua_date            DATE,
  ua_days_count           INT         NOT NULL DEFAULT 1,
  flagged_at              DATE,
  wl1_sent_at             TIMESTAMPTZ,
  wl1_letter_id           UUID,
  wl2_sent_at             TIMESTAMPTZ,
  wl2_letter_id           UUID,
  termination_letter_id   UUID,
  employee_response       TEXT,
  employee_response_at    TIMESTAMPTZ,
  response_channel        TEXT CHECK (response_channel IN ('email','whatsapp','in_person','letter','phone')),
  chro_approval_required  BOOLEAN     NOT NULL DEFAULT FALSE,
  chro_approved_by        UUID        REFERENCES profiles(id),
  chro_approved_at        TIMESTAMPTZ,
  chro_remarks            TEXT,
  resolved_reason         TEXT,
  separation_id           UUID,
  assigned_to             UUID        REFERENCES profiles(id),
  notes                   TEXT,
  created_by              UUID        NOT NULL REFERENCES profiles(id),
  created_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at              TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS absconding_communications (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  case_id     UUID        NOT NULL REFERENCES absconding_cases(id) ON DELETE CASCADE,
  tenant_id   UUID        NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  comm_type   TEXT        NOT NULL CHECK (comm_type IN (
                'letter_generated','email_sent','whatsapp_sent',
                'call_attempted','employee_response','hr_note','system_event'
              )),
  direction   TEXT        NOT NULL CHECK (direction IN ('outbound','inbound','internal')),
  subject     TEXT,
  body        TEXT,
  channel     TEXT,
  sent_by     UUID        REFERENCES profiles(id),
  letter_id   UUID,
  metadata    JSONB       NOT NULL DEFAULT '{}',
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_absconding_cases_tenant       ON absconding_cases(tenant_id, status);
CREATE INDEX IF NOT EXISTS idx_absconding_cases_employee     ON absconding_cases(tenant_id, employee_id);
CREATE INDEX IF NOT EXISTS idx_absconding_comms_case         ON absconding_communications(case_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_absconding_comms_tenant       ON absconding_communications(tenant_id, case_id);

ALTER TABLE absconding_cases           ENABLE ROW LEVEL SECURITY;
ALTER TABLE absconding_communications  ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "absconding_cases_admin"  ON absconding_cases;
CREATE POLICY "absconding_cases_admin"  ON absconding_cases  FOR ALL
  USING (tenant_id = get_user_tenant_id() AND get_user_role() IN ('super_admin','hr_admin'));

DROP POLICY IF EXISTS "absconding_comms_admin"  ON absconding_communications;
CREATE POLICY "absconding_comms_admin"  ON absconding_communications FOR ALL
  USING (tenant_id = get_user_tenant_id() AND get_user_role() IN ('super_admin','hr_admin'));

-- ─────────────────────────────────────────────────────────────────────────────
-- 324: Helpdesk Enhancements (idempotent column adds)
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE helpdesk_tickets
  ADD COLUMN IF NOT EXISTS csat_rating       SMALLINT CHECK (csat_rating BETWEEN 1 AND 5),
  ADD COLUMN IF NOT EXISTS csat_comment      TEXT,
  ADD COLUMN IF NOT EXISTS csat_submitted_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS merged_into       UUID REFERENCES helpdesk_tickets(id) ON DELETE SET NULL;

CREATE TABLE IF NOT EXISTS helpdesk_sla_policies (
  id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id        UUID        NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  priority         TEXT        NOT NULL,
  response_hours   INTEGER     NOT NULL DEFAULT 24,
  resolution_hours INTEGER     NOT NULL DEFAULT 48,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, priority)
);

ALTER TABLE helpdesk_sla_policies ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "helpdesk_sla_admin" ON helpdesk_sla_policies;
CREATE POLICY "helpdesk_sla_admin" ON helpdesk_sla_policies FOR ALL
  USING (tenant_id = get_user_tenant_id() AND get_user_role() IN ('super_admin','hr_admin'));

-- ─────────────────────────────────────────────────────────────────────────────
-- 325: HR Policy Knowledge Base
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS hr_policies (
  id                       UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id                UUID        NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  title                    TEXT        NOT NULL,
  category                 TEXT        NOT NULL DEFAULT 'other'
    CHECK (category IN ('leave','compensation','conduct','recruitment','learning','health','it','other')),
  description              TEXT,
  content                  TEXT,
  file_url                 TEXT,
  status                   TEXT        NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft','published','archived')),
  version                  SMALLINT    NOT NULL DEFAULT 1,
  requires_acknowledgement BOOLEAN     NOT NULL DEFAULT false,
  effective_from           DATE,
  published_at             TIMESTAMPTZ,
  published_by             UUID        REFERENCES profiles(id) ON DELETE SET NULL,
  created_by               UUID        REFERENCES profiles(id) ON DELETE SET NULL,
  created_at               TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at               TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_hr_policies_tenant_status    ON hr_policies(tenant_id, status);
CREATE INDEX IF NOT EXISTS idx_hr_policies_tenant_published ON hr_policies(tenant_id, category) WHERE status = 'published';

CREATE TABLE IF NOT EXISTS policy_acknowledgements (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       UUID        NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  policy_id       UUID        NOT NULL REFERENCES hr_policies(id) ON DELETE CASCADE,
  employee_id     UUID        NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  acknowledged_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, policy_id, employee_id)
);

CREATE INDEX IF NOT EXISTS idx_policy_acks_policy   ON policy_acknowledgements(tenant_id, policy_id);
CREATE INDEX IF NOT EXISTS idx_policy_acks_employee ON policy_acknowledgements(tenant_id, employee_id);

CREATE OR REPLACE FUNCTION update_hr_policies_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$$;

DROP TRIGGER IF EXISTS trg_hr_policies_updated_at ON hr_policies;
CREATE TRIGGER trg_hr_policies_updated_at
  BEFORE UPDATE ON hr_policies FOR EACH ROW EXECUTE FUNCTION update_hr_policies_updated_at();

ALTER TABLE hr_policies              ENABLE ROW LEVEL SECURITY;
ALTER TABLE policy_acknowledgements  ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "hr_policies_admin_all" ON hr_policies;
CREATE POLICY "hr_policies_admin_all" ON hr_policies FOR ALL
  USING (tenant_id = get_user_tenant_id() AND get_user_role() IN ('super_admin','hr_admin'));

DROP POLICY IF EXISTS "hr_policies_employee_read" ON hr_policies;
CREATE POLICY "hr_policies_employee_read" ON hr_policies FOR SELECT
  USING (tenant_id = get_user_tenant_id() AND status = 'published');

DROP POLICY IF EXISTS "policy_acks_admin" ON policy_acknowledgements;
CREATE POLICY "policy_acks_admin" ON policy_acknowledgements FOR ALL
  USING (tenant_id = get_user_tenant_id() AND get_user_role() IN ('super_admin','hr_admin'));

DROP POLICY IF EXISTS "policy_acks_employee" ON policy_acknowledgements;
CREATE POLICY "policy_acks_employee" ON policy_acknowledgements FOR SELECT
  USING (tenant_id = get_user_tenant_id());

DROP POLICY IF EXISTS "policy_acks_employee_insert" ON policy_acknowledgements;
CREATE POLICY "policy_acks_employee_insert" ON policy_acknowledgements FOR INSERT
  WITH CHECK (tenant_id = get_user_tenant_id());

-- ─────────────────────────────────────────────────────────────────────────────
-- 326: Mood & Pulse
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS mood_checkins (
  id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    UUID        NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  employee_id  UUID        NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  checkin_date DATE        NOT NULL DEFAULT CURRENT_DATE,
  mood         SMALLINT    NOT NULL CHECK (mood BETWEEN 1 AND 5),
  note         TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, employee_id, checkin_date)
);

CREATE TABLE IF NOT EXISTS pulse_questions (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   UUID        NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  question    TEXT        NOT NULL,
  options     JSONB,
  status      TEXT        NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft','active','closed')),
  starts_at   TIMESTAMPTZ,
  ends_at     TIMESTAMPTZ,
  created_by  UUID        REFERENCES profiles(id) ON DELETE SET NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS pulse_responses (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   UUID        NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  question_id UUID        NOT NULL REFERENCES pulse_questions(id) ON DELETE CASCADE,
  employee_id UUID        NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  response    TEXT        NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, question_id, employee_id)
);

ALTER TABLE mood_checkins ADD COLUMN IF NOT EXISTS sentiment_label TEXT CHECK (sentiment_label IN ('positive','neutral','negative'));

CREATE INDEX IF NOT EXISTS idx_mood_checkins_tenant   ON mood_checkins(tenant_id, checkin_date);
CREATE INDEX IF NOT EXISTS idx_mood_checkins_employee ON mood_checkins(tenant_id, employee_id);
CREATE INDEX IF NOT EXISTS idx_pulse_questions_tenant ON pulse_questions(tenant_id, status);

ALTER TABLE mood_checkins   ENABLE ROW LEVEL SECURITY;
ALTER TABLE pulse_questions ENABLE ROW LEVEL SECURITY;
ALTER TABLE pulse_responses ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "mood_checkins_own"     ON mood_checkins;
CREATE POLICY "mood_checkins_own"     ON mood_checkins    FOR ALL USING (tenant_id = get_user_tenant_id());
DROP POLICY IF EXISTS "pulse_q_admin_all"     ON pulse_questions;
CREATE POLICY "pulse_q_admin_all"     ON pulse_questions FOR ALL USING (tenant_id = get_user_tenant_id() AND get_user_role() IN ('super_admin','hr_admin'));
DROP POLICY IF EXISTS "pulse_q_employee_read" ON pulse_questions;
CREATE POLICY "pulse_q_employee_read" ON pulse_questions FOR SELECT USING (tenant_id = get_user_tenant_id() AND status = 'active');
DROP POLICY IF EXISTS "pulse_resp_tenant_all" ON pulse_responses;
CREATE POLICY "pulse_resp_tenant_all" ON pulse_responses FOR ALL USING (tenant_id = get_user_tenant_id());

-- Mood store monthly view
CREATE OR REPLACE VIEW mood_store_monthly AS
SELECT
  mc.tenant_id,
  e.work_location_id,
  date_trunc('month', mc.checkin_date::timestamptz) AS score_month,
  ROUND(AVG(mc.mood)::numeric * 20, 1) AS avg_score_100,
  COUNT(*)::int AS response_count
FROM mood_checkins mc
JOIN employees e ON e.id = mc.employee_id
WHERE e.work_location_id IS NOT NULL
GROUP BY mc.tenant_id, e.work_location_id, date_trunc('month', mc.checkin_date::timestamptz);

-- ─────────────────────────────────────────────────────────────────────────────
-- 327: Surveys
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS surveys (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   UUID        NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  title       TEXT        NOT NULL,
  description TEXT,
  status      TEXT        NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft','active','closed')),
  survey_type TEXT        NOT NULL DEFAULT 'general'
    CHECK (survey_type IN ('general','onboarding_d30','onboarding_d60','onboarding_d90',
                           'manager_effectiveness','feedback_360','annual_engagement',
                           'exit_intent','post_transfer','post_appraisal')),
  is_anonymous      BOOLEAN NOT NULL DEFAULT false,
  auto_trigger_days INTEGER,
  trigger_event     TEXT,
  due_date    DATE,
  created_by  UUID        REFERENCES profiles(id) ON DELETE SET NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS survey_questions (
  id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     UUID        NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  survey_id     UUID        NOT NULL REFERENCES surveys(id) ON DELETE CASCADE,
  order_idx     INTEGER     NOT NULL DEFAULT 0,
  question_text TEXT        NOT NULL,
  question_type TEXT        NOT NULL DEFAULT 'text'
    CHECK (question_type IN ('text','rating','single','multi')),
  options       JSONB,
  required      BOOLEAN     NOT NULL DEFAULT true
);

CREATE TABLE IF NOT EXISTS survey_assignments (
  id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     UUID        NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  survey_id     UUID        NOT NULL REFERENCES surveys(id) ON DELETE CASCADE,
  employee_id   UUID        NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  respondent_type TEXT      NOT NULL DEFAULT 'self'
    CHECK (respondent_type IN ('self','peer','manager','direct_report')),
  assigned_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at  TIMESTAMPTZ,
  UNIQUE (survey_id, employee_id, respondent_type)
);

CREATE TABLE IF NOT EXISTS survey_responses (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   UUID        NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  survey_id   UUID        NOT NULL REFERENCES surveys(id) ON DELETE CASCADE,
  assignment_id UUID      NOT NULL REFERENCES survey_assignments(id) ON DELETE CASCADE,
  question_id UUID        NOT NULL REFERENCES survey_questions(id) ON DELETE CASCADE,
  response    JSONB,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE surveys           ADD COLUMN IF NOT EXISTS survey_type   TEXT NOT NULL DEFAULT 'general';
ALTER TABLE surveys           ADD COLUMN IF NOT EXISTS is_anonymous   BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE surveys           ADD COLUMN IF NOT EXISTS auto_trigger_days INTEGER;
ALTER TABLE surveys           ADD COLUMN IF NOT EXISTS trigger_event  TEXT;
ALTER TABLE survey_assignments ADD COLUMN IF NOT EXISTS respondent_type TEXT NOT NULL DEFAULT 'self'
  CHECK (respondent_type IN ('self','peer','manager','direct_report'));

-- Fix unique constraint: drop old (survey_id, employee_id) and replace with
-- (survey_id, employee_id, respondent_type) to support 360° multi-rater surveys
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'survey_assignments_survey_id_employee_id_key'
  ) THEN
    ALTER TABLE survey_assignments DROP CONSTRAINT survey_assignments_survey_id_employee_id_key;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'survey_assignments_survey_employee_respondent_key'
  ) THEN
    ALTER TABLE survey_assignments
      ADD CONSTRAINT survey_assignments_survey_employee_respondent_key
      UNIQUE (survey_id, employee_id, respondent_type);
  END IF;
END;
$$;

CREATE INDEX IF NOT EXISTS idx_surveys_tenant          ON surveys(tenant_id, status);
CREATE INDEX IF NOT EXISTS idx_survey_questions_survey ON survey_questions(survey_id);
CREATE INDEX IF NOT EXISTS idx_survey_assignments      ON survey_assignments(tenant_id, survey_id, employee_id);

ALTER TABLE surveys            ENABLE ROW LEVEL SECURITY;
ALTER TABLE survey_questions   ENABLE ROW LEVEL SECURITY;
ALTER TABLE survey_assignments ENABLE ROW LEVEL SECURITY;
ALTER TABLE survey_responses   ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "surveys_admin"      ON surveys;
CREATE POLICY "surveys_admin"      ON surveys      FOR ALL USING (tenant_id = get_user_tenant_id() AND get_user_role() IN ('super_admin','hr_admin'));
DROP POLICY IF EXISTS "surveys_read"       ON surveys;
CREATE POLICY "surveys_read"       ON surveys      FOR SELECT USING (tenant_id = get_user_tenant_id());
DROP POLICY IF EXISTS "survey_questions_read" ON survey_questions;
CREATE POLICY "survey_questions_read" ON survey_questions FOR SELECT USING (tenant_id = get_user_tenant_id());
DROP POLICY IF EXISTS "survey_assignments_own" ON survey_assignments;
CREATE POLICY "survey_assignments_own" ON survey_assignments FOR ALL USING (tenant_id = get_user_tenant_id());
DROP POLICY IF EXISTS "survey_responses_own"  ON survey_responses;
CREATE POLICY "survey_responses_own"  ON survey_responses  FOR ALL USING (tenant_id = get_user_tenant_id());

-- Survey templates (from 331)
CREATE TABLE IF NOT EXISTS survey_templates (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  survey_type TEXT        NOT NULL UNIQUE,
  name        TEXT        NOT NULL,
  description TEXT,
  questions   JSONB       NOT NULL DEFAULT '[]',
  is_system   BOOLEAN     NOT NULL DEFAULT true,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE survey_templates ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "survey_templates_read" ON survey_templates;
CREATE POLICY "survey_templates_read" ON survey_templates FOR SELECT USING (true);

INSERT INTO survey_templates (survey_type, name, description, questions) VALUES
('onboarding_d30','Onboarding Pulse – Day 30','Capture new joiner experience at 30 days','[{"order_idx":1,"question_text":"How would you rate your overall joining experience so far?","question_type":"rating","required":true},{"order_idx":2,"question_text":"How clear are you about your role and responsibilities?","question_type":"rating","required":true},{"order_idx":3,"question_text":"How supported do you feel by your reporting manager?","question_type":"rating","required":true},{"order_idx":4,"question_text":"What is working well in your onboarding so far?","question_type":"text","required":false},{"order_idx":5,"question_text":"What could be improved in the onboarding process?","question_type":"text","required":false}]'::jsonb),
('manager_effectiveness','Manager Effectiveness Survey','Anonymous quarterly upward feedback','[{"order_idx":1,"question_text":"My manager communicates expectations clearly.","question_type":"rating","required":true},{"order_idx":2,"question_text":"My manager treats team members fairly and respectfully.","question_type":"rating","required":true},{"order_idx":3,"question_text":"My manager supports my career development.","question_type":"rating","required":true},{"order_idx":4,"question_text":"What does your manager do particularly well?","question_type":"text","required":false},{"order_idx":5,"question_text":"What is one thing your manager could improve?","question_type":"text","required":false}]'::jsonb),
('annual_engagement','Annual Employee Engagement Survey','Comprehensive engagement survey across 8 dimensions','[{"order_idx":1,"question_text":"I am proud to work at this organisation.","question_type":"rating","required":true},{"order_idx":2,"question_text":"I would recommend this organisation as a great place to work.","question_type":"rating","required":true},{"order_idx":3,"question_text":"I plan to still be working here in 12 months.","question_type":"rating","required":true},{"order_idx":4,"question_text":"My manager supports my development and treats me fairly.","question_type":"rating","required":true},{"order_idx":5,"question_text":"I have opportunities to grow and advance my career here.","question_type":"rating","required":true},{"order_idx":6,"question_text":"I am paid fairly for the work I do.","question_type":"rating","required":true},{"order_idx":7,"question_text":"My contributions are recognised and appreciated.","question_type":"rating","required":true},{"order_idx":8,"question_text":"What aspect of working here do you value most?","question_type":"text","required":false},{"order_idx":9,"question_text":"What is the single biggest improvement that would make this a better place to work?","question_type":"text","required":false}]'::jsonb),
('exit_intent','Exit Intent — Retention Check','Anonymous survey for high attrition-risk employees','[{"order_idx":1,"question_text":"How likely are you to be working here in 6 months?","question_type":"rating","required":true},{"order_idx":2,"question_text":"My manager makes me feel valued and supported.","question_type":"rating","required":true},{"order_idx":3,"question_text":"I can see a clear path for my career growth here.","question_type":"rating","required":true},{"order_idx":4,"question_text":"What single change would most likely make you stay?","question_type":"text","required":false}]'::jsonb),
('post_appraisal','Post-Appraisal Pulse','Capture reaction to appraisal process (sent within 3 days)','[{"order_idx":1,"question_text":"The appraisal process was fair and transparent.","question_type":"rating","required":true},{"order_idx":2,"question_text":"My performance rating accurately reflects my contributions.","question_type":"rating","required":true},{"order_idx":3,"question_text":"My manager communicated my rating and feedback clearly.","question_type":"rating","required":true},{"order_idx":4,"question_text":"Any comments on the appraisal experience?","question_type":"text","required":false}]'::jsonb),
('post_transfer','Post-Transfer Experience','Sent 14 days after a transfer to a new location','[{"order_idx":1,"question_text":"I have settled into my new location well.","question_type":"rating","required":true},{"order_idx":2,"question_text":"My new manager has been supportive during my transition.","question_type":"rating","required":true},{"order_idx":3,"question_text":"I have been well integrated into my new team.","question_type":"rating","required":true},{"order_idx":4,"question_text":"Any concerns about your new location or role?","question_type":"text","required":false}]'::jsonb)
ON CONFLICT (survey_type) DO NOTHING;

-- ─────────────────────────────────────────────────────────────────────────────
-- 328: Policy RAG (FTS on hr_policies)
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE hr_policies
  ADD COLUMN IF NOT EXISTS search_vector tsvector
    GENERATED ALWAYS AS (
      to_tsvector('english',
        coalesce(title, '') || ' ' ||
        coalesce(category, '') || ' ' ||
        coalesce(content, '') || ' ' ||
        coalesce(description, '')
      )
    ) STORED;

CREATE INDEX IF NOT EXISTS idx_hr_policies_search_vector ON hr_policies USING gin(search_vector);

CREATE TABLE IF NOT EXISTS policy_qa_logs (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   UUID        NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  employee_id UUID        REFERENCES employees(id) ON DELETE SET NULL,
  question    TEXT        NOT NULL,
  answer      TEXT,
  sources     JSONB,
  model       TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_policy_qa_logs_tenant ON policy_qa_logs(tenant_id, created_at);
ALTER TABLE policy_qa_logs ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "policy_qa_admin" ON policy_qa_logs;
CREATE POLICY "policy_qa_admin" ON policy_qa_logs FOR ALL USING (tenant_id = get_user_tenant_id() AND get_user_role() IN ('super_admin','hr_admin'));
DROP POLICY IF EXISTS "policy_qa_employee_insert" ON policy_qa_logs;
CREATE POLICY "policy_qa_employee_insert" ON policy_qa_logs FOR INSERT WITH CHECK (tenant_id = get_user_tenant_id());

CREATE OR REPLACE FUNCTION search_policies(
  p_tenant_id UUID,
  p_query     TEXT,
  p_limit     INT DEFAULT 5
)
RETURNS TABLE (
  id          UUID,
  title       TEXT,
  category    TEXT,
  description TEXT,
  content     TEXT,
  snippet     TEXT,
  rank        REAL
)
LANGUAGE sql STABLE SECURITY DEFINER AS $$
  SELECT
    id,
    title,
    category,
    description,
    content,
    ts_headline(
      'english',
      coalesce(content, description, ''),
      websearch_to_tsquery('english', p_query),
      'MaxWords=60, MinWords=20, StartSel=«, StopSel=»'
    ) AS snippet,
    ts_rank(search_vector, websearch_to_tsquery('english', p_query)) AS rank
  FROM hr_policies
  WHERE tenant_id = p_tenant_id
    AND status    = 'published'
    AND search_vector @@ websearch_to_tsquery('english', p_query)
  ORDER BY rank DESC
  LIMIT p_limit;
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 329: Succession Planning
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS succession_plans (
  id             UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id      UUID        NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  position_title TEXT        NOT NULL,
  department     TEXT,
  incumbent_id   UUID        REFERENCES employees(id) ON DELETE SET NULL,
  risk_level     TEXT        NOT NULL DEFAULT 'medium'
    CHECK (risk_level IN ('low','medium','high','critical')),
  notes          TEXT,
  status         TEXT        NOT NULL DEFAULT 'active'
    CHECK (status IN ('active','archived')),
  created_by     UUID        REFERENCES profiles(id) ON DELETE SET NULL,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS succession_candidates (
  id                    UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id             UUID        NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  plan_id               UUID        NOT NULL REFERENCES succession_plans(id) ON DELETE CASCADE,
  employee_id           UUID        NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  readiness_level       TEXT        NOT NULL DEFAULT 'ready_3_5_years'
    CHECK (readiness_level IN ('ready_now','ready_1_2_years','ready_3_5_years')),
  readiness_score       SMALLINT    CHECK (readiness_score BETWEEN 0 AND 100),
  strengths             TEXT,
  gaps                  TEXT,
  development_plan      TEXT,
  notes                 TEXT,
  nine_box_performance  SMALLINT    CHECK (nine_box_performance BETWEEN 1 AND 3),
  nine_box_potential    SMALLINT    CHECK (nine_box_potential   BETWEEN 1 AND 3),
  score_performance     SMALLINT    CHECK (score_performance    BETWEEN 0 AND 10),
  score_skill_gap       SMALLINT    CHECK (score_skill_gap      BETWEEN 0 AND 10),
  score_leadership      SMALLINT    CHECK (score_leadership     BETWEEN 0 AND 10),
  score_mobility        SMALLINT    CHECK (score_mobility       BETWEEN 0 AND 10),
  score_tenure          SMALLINT    CHECK (score_tenure         BETWEEN 0 AND 10),
  score_attrition_risk  SMALLINT    CHECK (score_attrition_risk BETWEEN 0 AND 10),
  attrition_risk_flag   BOOLEAN     NOT NULL DEFAULT false,
  nominated_by          UUID        REFERENCES profiles(id) ON DELETE SET NULL,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (plan_id, employee_id)
);

CREATE TABLE IF NOT EXISTS succession_idp_actions (
  id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    UUID        NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  candidate_id UUID        NOT NULL REFERENCES succession_candidates(id) ON DELETE CASCADE,
  action_type  TEXT        NOT NULL DEFAULT 'course'
    CHECK (action_type IN ('course','assignment','mentoring','certification','coaching')),
  description  TEXT        NOT NULL,
  target_date  DATE,
  completed_at TIMESTAMPTZ,
  created_by   UUID        REFERENCES profiles(id) ON DELETE SET NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_succession_plans_tenant      ON succession_plans(tenant_id, status);
CREATE INDEX IF NOT EXISTS idx_succession_candidates_plan   ON succession_candidates(tenant_id, plan_id);
CREATE INDEX IF NOT EXISTS idx_succession_candidates_employee ON succession_candidates(tenant_id, employee_id);
CREATE INDEX IF NOT EXISTS idx_succession_idp_candidate     ON succession_idp_actions(tenant_id, candidate_id);

ALTER TABLE succession_plans        ENABLE ROW LEVEL SECURITY;
ALTER TABLE succession_candidates   ENABLE ROW LEVEL SECURITY;
ALTER TABLE succession_idp_actions  ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "succession_plans_admin"      ON succession_plans;
CREATE POLICY "succession_plans_admin"      ON succession_plans      FOR ALL USING (tenant_id = get_user_tenant_id() AND get_user_role() IN ('super_admin','hr_admin'));
DROP POLICY IF EXISTS "succession_candidates_admin" ON succession_candidates;
CREATE POLICY "succession_candidates_admin" ON succession_candidates FOR ALL USING (tenant_id = get_user_tenant_id() AND get_user_role() IN ('super_admin','hr_admin'));
DROP POLICY IF EXISTS "succession_idp_admin"        ON succession_idp_actions;
CREATE POLICY "succession_idp_admin"        ON succession_idp_actions FOR ALL USING (tenant_id = get_user_tenant_id() AND get_user_role() IN ('super_admin','hr_admin'));

-- ─────────────────────────────────────────────────────────────────────────────
-- 332: Helpdesk AI routing + satisfaction + absconding auto-escalation
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE helpdesk_tickets
  ADD COLUMN IF NOT EXISTS satisfaction_rating   SMALLINT CHECK (satisfaction_rating BETWEEN 1 AND 5),
  ADD COLUMN IF NOT EXISTS satisfaction_comment  TEXT,
  ADD COLUMN IF NOT EXISTS satisfaction_rated_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS ai_suggested_category TEXT,
  ADD COLUMN IF NOT EXISTS ai_routing_confidence SMALLINT CHECK (ai_routing_confidence BETWEEN 0 AND 100);

CREATE TABLE IF NOT EXISTS helpdesk_category_sla (
  id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id        UUID        NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  category         TEXT        NOT NULL,
  response_hours   INTEGER     NOT NULL DEFAULT 24,
  resolution_hours INTEGER     NOT NULL DEFAULT 48,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, category)
);

ALTER TABLE helpdesk_category_sla ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "helpdesk_category_sla_admin" ON helpdesk_category_sla;
CREATE POLICY "helpdesk_category_sla_admin" ON helpdesk_category_sla FOR ALL
  USING (tenant_id = get_user_tenant_id() AND get_user_role() IN ('super_admin','hr_admin'));

INSERT INTO helpdesk_category_sla (tenant_id, category, response_hours, resolution_hours)
SELECT t.id, cat.category, cat.resp, cat.resol
FROM tenants t
CROSS JOIN (VALUES
  ('it_support', 8, 16),
  ('hr_query',  24, 48),
  ('payroll',   24, 48),
  ('general',   48, 96),
  ('grievance', 120, 240)
) AS cat(category, resp, resol)
ON CONFLICT (tenant_id, category) DO NOTHING;

-- ─────────────────────────────────────────────────────────────────────────────
-- 334: Formal Awards (R&R)
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS formal_awards (
  id                   UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id            UUID        NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name                 TEXT        NOT NULL,
  description          TEXT,
  frequency            TEXT        NOT NULL DEFAULT 'monthly'
    CHECK (frequency IN ('monthly','quarterly','annual','ad_hoc')),
  award_type           TEXT        NOT NULL DEFAULT 'custom'
    CHECK (award_type IN ('employee_of_month','spot_award','long_service','peer_choice','store_of_month','custom')),
  monetary_value       NUMERIC(10,2),
  monetary_description TEXT,
  eligible_group       TEXT,
  is_active            BOOLEAN     NOT NULL DEFAULT true,
  requires_nomination  BOOLEAN     NOT NULL DEFAULT true,
  auto_long_service    BOOLEAN     NOT NULL DEFAULT false,
  milestone_years      INTEGER[],
  created_by           UUID        REFERENCES profiles(id) ON DELETE SET NULL,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, name)
);

CREATE TABLE IF NOT EXISTS award_rounds (
  id                 UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id          UUID        NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  award_id           UUID        NOT NULL REFERENCES formal_awards(id) ON DELETE CASCADE,
  period_label       TEXT        NOT NULL,
  period_start       DATE,
  period_end         DATE,
  status             TEXT        NOT NULL DEFAULT 'open'
    CHECK (status IN ('open','review','closed','cancelled')),
  winner_employee_id UUID        REFERENCES employees(id) ON DELETE SET NULL,
  winner_notes       TEXT,
  declared_at        TIMESTAMPTZ,
  declared_by        UUID        REFERENCES profiles(id) ON DELETE SET NULL,
  created_by         UUID        REFERENCES profiles(id) ON DELETE SET NULL,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS award_nominations (
  id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     UUID        NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  round_id      UUID        NOT NULL REFERENCES award_rounds(id) ON DELETE CASCADE,
  nominee_id    UUID        NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  nominated_by  UUID        REFERENCES profiles(id) ON DELETE SET NULL,
  justification TEXT,
  status        TEXT        NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending','shortlisted','winner','not_selected')),
  reviewed_at   TIMESTAMPTZ,
  reviewed_by   UUID        REFERENCES profiles(id) ON DELETE SET NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (round_id, nominee_id)
);

CREATE TABLE IF NOT EXISTS spot_awards (
  id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id        UUID        NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  from_employee_id UUID        NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  to_employee_id   UUID        NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  award_name       TEXT        NOT NULL,
  message          TEXT,
  monetary_value   NUMERIC(10,2),
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_formal_awards_tenant    ON formal_awards(tenant_id, is_active);
CREATE INDEX IF NOT EXISTS idx_award_rounds_award      ON award_rounds(tenant_id, award_id, status);
CREATE INDEX IF NOT EXISTS idx_award_nominations_round ON award_nominations(tenant_id, round_id, status);
CREATE INDEX IF NOT EXISTS idx_spot_awards_tenant      ON spot_awards(tenant_id, created_at);

CREATE OR REPLACE FUNCTION update_formal_awards_ts() RETURNS TRIGGER LANGUAGE plpgsql AS $$ BEGIN NEW.updated_at = now(); RETURN NEW; END; $$;
DROP TRIGGER IF EXISTS trg_formal_awards_ts  ON formal_awards;  CREATE TRIGGER trg_formal_awards_ts  BEFORE UPDATE ON formal_awards  FOR EACH ROW EXECUTE FUNCTION update_formal_awards_ts();
DROP TRIGGER IF EXISTS trg_award_rounds_ts   ON award_rounds;   CREATE TRIGGER trg_award_rounds_ts   BEFORE UPDATE ON award_rounds   FOR EACH ROW EXECUTE FUNCTION update_formal_awards_ts();

ALTER TABLE formal_awards      ENABLE ROW LEVEL SECURITY;
ALTER TABLE award_rounds       ENABLE ROW LEVEL SECURITY;
ALTER TABLE award_nominations  ENABLE ROW LEVEL SECURITY;
ALTER TABLE spot_awards        ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "formal_awards_admin"     ON formal_awards;
CREATE POLICY "formal_awards_admin"     ON formal_awards     FOR ALL USING (tenant_id = get_user_tenant_id() AND get_user_role() IN ('super_admin','hr_admin'));
DROP POLICY IF EXISTS "award_rounds_admin"      ON award_rounds;
CREATE POLICY "award_rounds_admin"      ON award_rounds      FOR ALL USING (tenant_id = get_user_tenant_id() AND get_user_role() IN ('super_admin','hr_admin'));
DROP POLICY IF EXISTS "award_nominations_admin" ON award_nominations;
CREATE POLICY "award_nominations_admin" ON award_nominations FOR ALL USING (tenant_id = get_user_tenant_id() AND get_user_role() IN ('super_admin','hr_admin'));
DROP POLICY IF EXISTS "spot_awards_read"        ON spot_awards;
CREATE POLICY "spot_awards_read"        ON spot_awards       FOR SELECT USING (tenant_id = get_user_tenant_id());
DROP POLICY IF EXISTS "spot_awards_insert"      ON spot_awards;
CREATE POLICY "spot_awards_insert"      ON spot_awards       FOR INSERT WITH CHECK (tenant_id = get_user_tenant_id());

INSERT INTO formal_awards (tenant_id, name, description, frequency, award_type, monetary_value, monetary_description, eligible_group, requires_nomination)
SELECT t.id, a.name, a.description, a.frequency::text, a.award_type::text, a.monetary_value, a.monetary_description, a.eligible_group, true
FROM tenants t
CROSS JOIN (VALUES
  ('Star Employee of the Month',   'Best performing employee each month',        'monthly', 'employee_of_month', 500::numeric,  'Gift voucher (Rs.500)',         'All store employees'),
  ('Store of the Month',           'Best performing store each month',           'monthly', 'store_of_month',    NULL::numeric, 'Trophy + Announcement',         'All stores'),
  ('Long Service Award – 1 Year',  'Recognising 1 year of service',             'annual',  'long_service',      1000::numeric, 'Certificate + Rs.1,000 voucher','All employees'),
  ('Long Service Award – 3 Years', 'Recognising 3 years of committed service',  'annual',  'long_service',      3000::numeric, 'Certificate + Rs.3,000 voucher','All employees'),
  ('Long Service Award – 5 Years', 'Recognising 5 years of exceptional loyalty','annual',  'long_service',      5000::numeric, 'Certificate + Rs.5,000 voucher','All employees')
) AS a(name, description, frequency, award_type, monetary_value, monetary_description, eligible_group)
ON CONFLICT (tenant_id, name) DO NOTHING;

-- ─────────────────────────────────────────────────────────────────────────────
-- Reload PostgREST schema cache
-- ─────────────────────────────────────────────────────────────────────────────
NOTIFY pgrst, 'reload schema';

COMMIT;
