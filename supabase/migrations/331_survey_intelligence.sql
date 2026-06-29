-- Migration 331: Survey Intelligence — types, lifecycle, 360°, annual engagement

ALTER TABLE surveys
  ADD COLUMN IF NOT EXISTS survey_type TEXT NOT NULL DEFAULT 'general'
    CHECK (survey_type IN ('general','onboarding_d30','onboarding_d60','onboarding_d90',
                           'manager_effectiveness','feedback_360','annual_engagement',
                           'exit_intent','post_transfer','post_appraisal')),
  ADD COLUMN IF NOT EXISTS is_anonymous      BOOLEAN     NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS auto_trigger_days INTEGER,
  ADD COLUMN IF NOT EXISTS trigger_event     TEXT;

ALTER TABLE survey_assignments
  ADD COLUMN IF NOT EXISTS respondent_type TEXT NOT NULL DEFAULT 'self'
    CHECK (respondent_type IN ('self','peer','manager','direct_report'));

CREATE TABLE IF NOT EXISTS survey_templates (
  id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  survey_type   TEXT        NOT NULL UNIQUE,
  name          TEXT        NOT NULL,
  description   TEXT,
  questions     JSONB       NOT NULL DEFAULT '[]',
  is_system     BOOLEAN     NOT NULL DEFAULT true,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

INSERT INTO survey_templates (survey_type, name, description, questions, is_system) VALUES
('onboarding_d30', 'Onboarding Pulse – Day 30', 'Capture new joiner experience at 30 days', '[
  {"order_idx":1,"question_text":"How would you rate your overall joining experience so far?","question_type":"rating","required":true},
  {"order_idx":2,"question_text":"How clear are you about your role and responsibilities?","question_type":"rating","required":true},
  {"order_idx":3,"question_text":"How supported do you feel by your reporting manager?","question_type":"rating","required":true},
  {"order_idx":4,"question_text":"How well were you introduced to your team and key stakeholders?","question_type":"rating","required":true},
  {"order_idx":5,"question_text":"How adequate was the onboarding training you received?","question_type":"rating","required":true},
  {"order_idx":6,"question_text":"What is working well in your onboarding so far?","question_type":"text","required":false},
  {"order_idx":7,"question_text":"What could be improved in the onboarding process?","question_type":"text","required":false}
]'::jsonb, true),
('manager_effectiveness', 'Manager Effectiveness Survey (Quarterly)', 'Anonymous upward feedback on reporting manager', '[
  {"order_idx":1,"question_text":"My manager communicates expectations clearly.","question_type":"rating","required":true},
  {"order_idx":2,"question_text":"My manager treats team members fairly and respectfully.","question_type":"rating","required":true},
  {"order_idx":3,"question_text":"My manager recognises and appreciates good work.","question_type":"rating","required":true},
  {"order_idx":4,"question_text":"My manager supports my career development.","question_type":"rating","required":true},
  {"order_idx":5,"question_text":"My manager handles conflicts and issues effectively.","question_type":"rating","required":true},
  {"order_idx":6,"question_text":"I would recommend my manager to a colleague.","question_type":"rating","required":true},
  {"order_idx":7,"question_text":"What does your manager do particularly well?","question_type":"text","required":false},
  {"order_idx":8,"question_text":"What is one thing your manager could improve?","question_type":"text","required":false}
]'::jsonb, true),
('annual_engagement', 'Annual Employee Engagement Survey', '35-question engagement survey across 8 dimensions', '[
  {"order_idx":1,"question_text":"I am proud to work at this organisation.","question_type":"rating","required":true,"dimension":"pride"},
  {"order_idx":2,"question_text":"I would recommend this organisation as a great place to work.","question_type":"rating","required":true,"dimension":"advocacy"},
  {"order_idx":3,"question_text":"I plan to still be working here in 12 months.","question_type":"rating","required":true,"dimension":"commitment"},
  {"order_idx":4,"question_text":"I feel a strong sense of belonging at this organisation.","question_type":"rating","required":true,"dimension":"pride"},
  {"order_idx":5,"question_text":"My manager supports my development and treats me fairly.","question_type":"rating","required":true,"dimension":"manager"},
  {"order_idx":6,"question_text":"My manager gives me useful feedback on my performance.","question_type":"rating","required":true,"dimension":"manager"},
  {"order_idx":7,"question_text":"I have opportunities to grow and advance my career here.","question_type":"rating","required":true,"dimension":"growth"},
  {"order_idx":8,"question_text":"I have received the training I need to do my job well.","question_type":"rating","required":true,"dimension":"growth"},
  {"order_idx":9,"question_text":"I am paid fairly for the work I do.","question_type":"rating","required":true,"dimension":"compensation"},
  {"order_idx":10,"question_text":"The benefits offered by this organisation meet my needs.","question_type":"rating","required":true,"dimension":"compensation"},
  {"order_idx":11,"question_text":"My work environment is safe, clean, and comfortable.","question_type":"rating","required":true,"dimension":"work_conditions"},
  {"order_idx":12,"question_text":"I have the tools and resources I need to do my job well.","question_type":"rating","required":true,"dimension":"work_conditions"},
  {"order_idx":13,"question_text":"My contributions are recognised and appreciated.","question_type":"rating","required":true,"dimension":"recognition"},
  {"order_idx":14,"question_text":"Senior leaders communicate openly and honestly.","question_type":"rating","required":true,"dimension":"advocacy"},
  {"order_idx":15,"question_text":"I understand how my work contributes to the organisation goals.","question_type":"rating","required":true,"dimension":"commitment"},
  {"order_idx":16,"question_text":"What aspect of working here do you value most?","question_type":"text","required":false,"dimension":"general"},
  {"order_idx":17,"question_text":"What is the single biggest improvement that would make this a better place to work?","question_type":"text","required":false,"dimension":"general"}
]'::jsonb, true),
('exit_intent', 'Exit Intent — Retention Check', 'Anonymous survey for employees flagged as high attrition risk', '[
  {"order_idx":1,"question_text":"How likely are you to be working here in 6 months?","question_type":"rating","required":true},
  {"order_idx":2,"question_text":"My manager makes me feel valued and supported.","question_type":"rating","required":true},
  {"order_idx":3,"question_text":"I can see a clear path for my career growth here.","question_type":"rating","required":true},
  {"order_idx":4,"question_text":"I feel fairly compensated for my contribution.","question_type":"rating","required":true},
  {"order_idx":5,"question_text":"What is the primary factor that might cause you to leave?","question_type":"single","required":true,"options":["Compensation","Growth opportunities","Manager relationship","Work conditions","Personal reasons","Better offer elsewhere","Other"]},
  {"order_idx":6,"question_text":"What single change would most likely make you stay?","question_type":"text","required":false}
]'::jsonb, true),
('post_appraisal', 'Post-Appraisal Pulse', 'Capture employee reaction to appraisal process (sent within 3 days)', '[
  {"order_idx":1,"question_text":"The appraisal process was fair and transparent.","question_type":"rating","required":true},
  {"order_idx":2,"question_text":"My performance rating accurately reflects my contributions.","question_type":"rating","required":true},
  {"order_idx":3,"question_text":"My manager communicated my rating and feedback clearly.","question_type":"rating","required":true},
  {"order_idx":4,"question_text":"The development goals set for me are realistic and helpful.","question_type":"rating","required":true},
  {"order_idx":5,"question_text":"Any comments on the appraisal experience?","question_type":"text","required":false}
]'::jsonb, true),
('post_transfer', 'Post-Transfer Experience', 'Sent 14 days after a transfer to a new location', '[
  {"order_idx":1,"question_text":"I have settled into my new location well.","question_type":"rating","required":true},
  {"order_idx":2,"question_text":"My new manager has been supportive during my transition.","question_type":"rating","required":true},
  {"order_idx":3,"question_text":"I have been well integrated into my new team.","question_type":"rating","required":true},
  {"order_idx":4,"question_text":"The accommodation and logistics of my transfer were handled well.","question_type":"rating","required":true},
  {"order_idx":5,"question_text":"Any concerns about your new location or role?","question_type":"text","required":false}
]'::jsonb, true)
ON CONFLICT (survey_type) DO NOTHING;

ALTER TABLE survey_templates ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "survey_templates_read" ON survey_templates;
CREATE POLICY "survey_templates_read" ON survey_templates FOR SELECT USING (true);
