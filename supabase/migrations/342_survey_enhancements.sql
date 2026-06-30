-- Migration 342: Survey Enhancements
-- Adds D60/D90 templates, survey_response_analysis, 360° tables,
-- and expands the Annual Engagement Survey to 35 questions.

-- ── Onboarding D60 + D90 templates ───────────────────────────────────────────
INSERT INTO survey_templates (survey_type, name, description, questions, is_system) VALUES
('onboarding_d60', 'Onboarding Pulse – Day 60', 'Settling-in check at 60 days', '[
  {"order_idx":1,"question_text":"How clearly do you understand your key performance expectations?","question_type":"rating","required":true},
  {"order_idx":2,"question_text":"How well have you settled into your team?","question_type":"rating","required":true},
  {"order_idx":3,"question_text":"How adequate was the training you have received so far?","question_type":"rating","required":true},
  {"order_idx":4,"question_text":"How effectively does your manager communicate with you?","question_type":"rating","required":true},
  {"order_idx":5,"question_text":"How aligned do you feel with Citykart values and culture?","question_type":"rating","required":true},
  {"order_idx":6,"question_text":"What is one thing that would improve your experience at work right now?","question_type":"text","required":false}
]'::jsonb, true),
('onboarding_d90', 'Onboarding Pulse – Day 90', 'Three-month experience check', '[
  {"order_idx":1,"question_text":"Do you feel you are contributing meaningfully in your role?","question_type":"rating","required":true},
  {"order_idx":2,"question_text":"How likely are you to recommend Citykart as a great place to work?","question_type":"rating","required":true},
  {"order_idx":3,"question_text":"How supported do you feel in achieving your targets?","question_type":"rating","required":true},
  {"order_idx":4,"question_text":"How clear is your career growth path at Citykart?","question_type":"rating","required":true},
  {"order_idx":5,"question_text":"How satisfied are you with the recognition you receive for good work?","question_type":"rating","required":true},
  {"order_idx":6,"question_text":"What is working well for you at Citykart?","question_type":"text","required":false},
  {"order_idx":7,"question_text":"What is one thing Citykart could do better to support you?","question_type":"text","required":false}
]'::jsonb, true)
ON CONFLICT (survey_type) DO NOTHING;

-- ── Expand Annual Engagement Survey to 35 questions ──────────────────────────
UPDATE survey_templates
SET questions = '[
  {"order_idx":1,"question_text":"I am proud to work at Citykart.","question_type":"rating","required":true,"dimension":"pride"},
  {"order_idx":2,"question_text":"I feel a strong sense of belonging at Citykart.","question_type":"rating","required":true,"dimension":"pride"},
  {"order_idx":3,"question_text":"I would be sad to leave Citykart even if offered similar pay elsewhere.","question_type":"rating","required":true,"dimension":"pride"},
  {"order_idx":4,"question_text":"Citykart lives up to its values in the way it treats employees.","question_type":"rating","required":true,"dimension":"pride"},
  {"order_idx":5,"question_text":"I would recommend Citykart as a great place to work.","question_type":"rating","required":true,"dimension":"advocacy"},
  {"order_idx":6,"question_text":"Senior leaders communicate openly and honestly.","question_type":"rating","required":true,"dimension":"advocacy"},
  {"order_idx":7,"question_text":"I trust the leadership of this organisation.","question_type":"rating","required":true,"dimension":"advocacy"},
  {"order_idx":8,"question_text":"I plan to still be working at Citykart in 12 months.","question_type":"rating","required":true,"dimension":"commitment"},
  {"order_idx":9,"question_text":"I understand how my work contributes to Citykart goals.","question_type":"rating","required":true,"dimension":"commitment"},
  {"order_idx":10,"question_text":"I am motivated to go above and beyond in my role.","question_type":"rating","required":true,"dimension":"commitment"},
  {"order_idx":11,"question_text":"The work I do is meaningful to me.","question_type":"rating","required":true,"dimension":"commitment"},
  {"order_idx":12,"question_text":"My manager supports my development and treats me fairly.","question_type":"rating","required":true,"dimension":"manager"},
  {"order_idx":13,"question_text":"My manager gives me useful feedback on my performance.","question_type":"rating","required":true,"dimension":"manager"},
  {"order_idx":14,"question_text":"My manager recognises and appreciates good work.","question_type":"rating","required":true,"dimension":"manager"},
  {"order_idx":15,"question_text":"My manager handles conflicts and challenges effectively.","question_type":"rating","required":true,"dimension":"manager"},
  {"order_idx":16,"question_text":"I feel comfortable raising concerns with my manager.","question_type":"rating","required":true,"dimension":"manager"},
  {"order_idx":17,"question_text":"I have opportunities to grow and advance my career at Citykart.","question_type":"rating","required":true,"dimension":"growth"},
  {"order_idx":18,"question_text":"I have received adequate training to do my job well.","question_type":"rating","required":true,"dimension":"growth"},
  {"order_idx":19,"question_text":"My skills and abilities are being fully utilised here.","question_type":"rating","required":true,"dimension":"growth"},
  {"order_idx":20,"question_text":"Citykart invests in developing its people.","question_type":"rating","required":true,"dimension":"growth"},
  {"order_idx":21,"question_text":"I am paid fairly for the work I do.","question_type":"rating","required":true,"dimension":"compensation"},
  {"order_idx":22,"question_text":"The benefits offered by Citykart meet my needs.","question_type":"rating","required":true,"dimension":"compensation"},
  {"order_idx":23,"question_text":"The total rewards package makes me feel valued.","question_type":"rating","required":true,"dimension":"compensation"},
  {"order_idx":24,"question_text":"My work environment is safe, clean, and comfortable.","question_type":"rating","required":true,"dimension":"work_conditions"},
  {"order_idx":25,"question_text":"I have the tools and resources I need to do my job well.","question_type":"rating","required":true,"dimension":"work_conditions"},
  {"order_idx":26,"question_text":"My workload is manageable.","question_type":"rating","required":true,"dimension":"work_conditions"},
  {"order_idx":27,"question_text":"I am able to maintain a healthy work-life balance.","question_type":"rating","required":true,"dimension":"work_conditions"},
  {"order_idx":28,"question_text":"My contributions are recognised and appreciated at Citykart.","question_type":"rating","required":true,"dimension":"recognition"},
  {"order_idx":29,"question_text":"When I do good work, my manager acknowledges it.","question_type":"rating","required":true,"dimension":"recognition"},
  {"order_idx":30,"question_text":"Citykart celebrates team and individual success.","question_type":"rating","required":true,"dimension":"recognition"},
  {"order_idx":31,"question_text":"I feel the performance evaluation process here is fair.","question_type":"rating","required":true,"dimension":"recognition"},
  {"order_idx":32,"question_text":"What aspect of working at Citykart do you value most?","question_type":"text","required":false,"dimension":"general"},
  {"order_idx":33,"question_text":"What is the single biggest improvement that would make Citykart a better place to work?","question_type":"text","required":false,"dimension":"general"},
  {"order_idx":34,"question_text":"Do you feel Citykart cares about your wellbeing? Please share your thoughts.","question_type":"text","required":false,"dimension":"general"},
  {"order_idx":35,"question_text":"Any other comments or suggestions for HR or leadership?","question_type":"text","required":false,"dimension":"general"}
]'::jsonb
WHERE survey_type = 'annual_engagement';

-- ── Survey response analysis table ────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS survey_response_analysis (
  id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  response_id  UUID        NOT NULL UNIQUE,  -- survey_responses.id
  sentiment    TEXT        NOT NULL CHECK (sentiment IN ('positive','neutral','negative')),
  themes       TEXT[]      NOT NULL DEFAULT '{}',
  urgency      TEXT        NOT NULL CHECK (urgency IN ('low','medium','high')),
  analyzed_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE survey_response_analysis ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "sra_admin_all" ON survey_response_analysis;
CREATE POLICY "sra_admin_all" ON survey_response_analysis FOR ALL
  USING (EXISTS (
    SELECT 1 FROM survey_responses sr
    JOIN survey_assignments sa ON sa.id = sr.assignment_id
    JOIN surveys s ON s.id = sa.survey_id
    WHERE sr.id = survey_response_analysis.response_id
      AND s.tenant_id = get_user_tenant_id()
  ));

-- ── 360° Feedback tables ──────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS feedback_360_rounds (
  id             UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id      UUID        NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  survey_id      UUID        NOT NULL REFERENCES surveys(id) ON DELETE CASCADE,
  nominee_id     UUID        NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  peers_required INT         NOT NULL DEFAULT 3,
  status         TEXT        NOT NULL DEFAULT 'nomination_open'
                             CHECK (status IN ('nomination_open','approved','surveys_sent','closed')),
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (survey_id, nominee_id)
);

CREATE TABLE IF NOT EXISTS feedback_360_nominators (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  round_id    UUID        NOT NULL REFERENCES feedback_360_rounds(id) ON DELETE CASCADE,
  employee_id UUID        NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  type        TEXT        NOT NULL CHECK (type IN ('peer','manager','direct_report')),
  UNIQUE (round_id, employee_id)
);

ALTER TABLE feedback_360_rounds     ENABLE ROW LEVEL SECURITY;
ALTER TABLE feedback_360_nominators ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "f360_rounds_tenant" ON feedback_360_rounds;
CREATE POLICY "f360_rounds_tenant" ON feedback_360_rounds FOR ALL
  USING (tenant_id = get_user_tenant_id());

DROP POLICY IF EXISTS "f360_nominators_tenant" ON feedback_360_nominators;
CREATE POLICY "f360_nominators_tenant" ON feedback_360_nominators FOR ALL
  USING (EXISTS (
    SELECT 1 FROM feedback_360_rounds r
    WHERE r.id = feedback_360_nominators.round_id
      AND r.tenant_id = get_user_tenant_id()
  ));

-- ── Add survey_type to surveys enum if needed ─────────────────────────────────
-- (360 type is seeded via survey_templates; the surveys.survey_type constraint
--  already includes 'feedback_360' from migration 331)
