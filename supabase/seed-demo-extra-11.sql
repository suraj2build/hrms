-- ============================================================================
-- seed-demo-extra-11.sql
-- AI Modules demo data: Succession, R&R, Surveys, Policy KB,
--   Absconding, Mood Check-ins, Helpdesk satisfaction
--
-- Idempotent: safe to re-run (ON CONFLICT DO NOTHING everywhere).
-- Tenant : d0000000-0000-0000-0000-000000000001
-- Admin  : d0000000-0000-0000-0000-0000000000a1
-- Employees SAAR001–SAAR012 (e01..e0c)
-- ============================================================================

BEGIN;

DO $$
DECLARE
  tid  UUID := 'd0000000-0000-0000-0000-000000000001';
  adm  UUID := 'd0000000-0000-0000-0000-0000000000a1';
  -- employees
  e01  UUID := 'e0000000-0000-0000-0000-000000000001'; -- Priya Sharma  (HR Mgr)
  e02  UUID := 'e0000000-0000-0000-0000-000000000002'; -- Rahul Verma
  e03  UUID := 'e0000000-0000-0000-0000-000000000003'; -- Deepak Chawla
  e04  UUID := 'e0000000-0000-0000-0000-000000000004'; -- Sneha Sen
  e05  UUID := 'e0000000-0000-0000-0000-000000000005'; -- Arjun Rampal
  e06  UUID := 'e0000000-0000-0000-0000-000000000006'; -- Nandini Gupta
  e07  UUID := 'e0000000-0000-0000-0000-000000000007'; -- Ayesha Ahmed
  e08  UUID := 'e0000000-0000-0000-0000-000000000008'; -- Vikram Singh
  e09  UUID := 'e0000000-0000-0000-0000-000000000009'; -- Kavya Nair
  e10  UUID := 'e0000000-0000-0000-0000-00000000000a'; -- Rohan Mehta
  e11  UUID := 'e0000000-0000-0000-0000-00000000000b'; -- Ananya Iyer
  e12  UUID := 'e0000000-0000-0000-0000-00000000000c'; -- Karan Patel
  -- succession plan IDs
  sp1  UUID := 'f1000000-0000-0000-0000-000000000001'; -- COO
  sp2  UUID := 'f1000000-0000-0000-0000-000000000002'; -- Head of Engineering
  sp3  UUID := 'f1000000-0000-0000-0000-000000000003'; -- Head of Sales
  -- succession candidate IDs
  sc01 UUID := 'f1000000-0000-0000-0000-000000000010';
  sc02 UUID := 'f1000000-0000-0000-0000-000000000011';
  sc03 UUID := 'f1000000-0000-0000-0000-000000000012';
  sc04 UUID := 'f1000000-0000-0000-0000-000000000013';
  sc05 UUID := 'f1000000-0000-0000-0000-000000000014';
  sc06 UUID := 'f1000000-0000-0000-0000-000000000015';
  sc07 UUID := 'f1000000-0000-0000-0000-000000000016';
  sc08 UUID := 'f1000000-0000-0000-0000-000000000017';
  sc09 UUID := 'f1000000-0000-0000-0000-000000000018';
  -- IDP action IDs
  idp1 UUID := 'f1000000-0000-0000-0000-000000000100';
  idp2 UUID := 'f1000000-0000-0000-0000-000000000101';
  idp3 UUID := 'f1000000-0000-0000-0000-000000000102';
  idp4 UUID := 'f1000000-0000-0000-0000-000000000103';
  idp5 UUID := 'f1000000-0000-0000-0000-000000000104';
  idp6 UUID := 'f1000000-0000-0000-0000-000000000105';
  -- award IDs (fetched from formal_awards table seeded by migration 334)
  aw_eom  UUID;
  aw_som  UUID;
  aw_ls1  UUID;
  -- award round IDs
  ar1  UUID := 'f2000000-0000-0000-0000-000000000001'; -- EOM June (closed, winner declared)
  ar2  UUID := 'f2000000-0000-0000-0000-000000000002'; -- EOM July (open, nominations live)
  ar3  UUID := 'f2000000-0000-0000-0000-000000000003'; -- Store of Month June (closed)
  -- nomination IDs
  an1  UUID := 'f2000000-0000-0000-0000-000000000010';
  an2  UUID := 'f2000000-0000-0000-0000-000000000011';
  an3  UUID := 'f2000000-0000-0000-0000-000000000012';
  an4  UUID := 'f2000000-0000-0000-0000-000000000013';
  an5  UUID := 'f2000000-0000-0000-0000-000000000014';
  -- spot award IDs
  sa1  UUID := 'f2000000-0000-0000-0000-000000000100';
  sa2  UUID := 'f2000000-0000-0000-0000-000000000101';
  sa3  UUID := 'f2000000-0000-0000-0000-000000000102';
  sa4  UUID := 'f2000000-0000-0000-0000-000000000103';
  sa5  UUID := 'f2000000-0000-0000-0000-000000000104';
  -- survey IDs
  sv1  UUID := 'f3000000-0000-0000-0000-000000000001'; -- Annual Engagement 2025
  sv2  UUID := 'f3000000-0000-0000-0000-000000000002'; -- Onboarding D30 for Kavya/Rohan
  sv3  UUID := 'f3000000-0000-0000-0000-000000000003'; -- Exit Intent
  -- survey question IDs (engagement survey — 8 questions)
  sq01 UUID := 'f3000000-0000-0000-0000-000000000101';
  sq02 UUID := 'f3000000-0000-0000-0000-000000000102';
  sq03 UUID := 'f3000000-0000-0000-0000-000000000103';
  sq04 UUID := 'f3000000-0000-0000-0000-000000000104';
  sq05 UUID := 'f3000000-0000-0000-0000-000000000105';
  sq06 UUID := 'f3000000-0000-0000-0000-000000000106';
  sq07 UUID := 'f3000000-0000-0000-0000-000000000107';
  sq08 UUID := 'f3000000-0000-0000-0000-000000000108';
  -- onboarding survey questions
  sq11 UUID := 'f3000000-0000-0000-0000-000000000111';
  sq12 UUID := 'f3000000-0000-0000-0000-000000000112';
  sq13 UUID := 'f3000000-0000-0000-0000-000000000113';
  -- policy IDs
  po1  UUID := 'f4000000-0000-0000-0000-000000000001'; -- Leave Policy
  po2  UUID := 'f4000000-0000-0000-0000-000000000002'; -- Code of Conduct
  po3  UUID := 'f4000000-0000-0000-0000-000000000003'; -- IT Security
  po4  UUID := 'f4000000-0000-0000-0000-000000000004'; -- Work From Home
  po5  UUID := 'f4000000-0000-0000-0000-000000000005'; -- POSH / Anti-Harassment
  -- absconding case IDs
  ac1  UUID := 'f5000000-0000-0000-0000-000000000001';
  ac2  UUID := 'f5000000-0000-0000-0000-000000000002';
  -- pulse question IDs
  pq1  UUID := 'f6000000-0000-0000-0000-000000000001';
  pq2  UUID := 'f6000000-0000-0000-0000-000000000002';
BEGIN

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. SUCCESSION PLANNING
-- ─────────────────────────────────────────────────────────────────────────────

INSERT INTO succession_plans (id, tenant_id, position_title, department, incumbent_id, risk_level, notes, status, created_by)
VALUES
  (sp1, tid, 'Chief Operations Officer',    'Operations',    e01, 'critical', 'Priya is due to retire in 18 months. Critical to identify successor now.', 'active', adm),
  (sp2, tid, 'Head of Engineering',         'Engineering',   e02, 'high',     'Rahul exploring external opportunities. Bench strength needed urgently.',  'active', adm),
  (sp3, tid, 'Head of Sales & Distribution','Sales',         e04, 'medium',   'Sneha performing well but expansion plan needs a ready successor.',         'active', adm)
ON CONFLICT (id) DO NOTHING;

-- Candidates for COO plan
INSERT INTO succession_candidates
  (id, tenant_id, plan_id, employee_id, readiness_level,
   nine_box_performance, nine_box_potential,
   score_performance, score_skill_gap, score_leadership, score_mobility, score_tenure, score_attrition_risk,
   attrition_risk_flag, strengths, gaps, development_plan, nominated_by)
VALUES
  (sc01, tid, sp1, e08, 'ready_now',
   3, 3,  -- Star (high performer, high potential)
   9, 7, 8, 8, 8, 3,
   false, 'Strategic thinking, cross-functional experience, P&L ownership', 'Board-level communication skills', 'Executive coaching + board observer seat Q3', adm),
  (sc02, tid, sp1, e12, 'ready_1_2_years',
   3, 2,  -- High Performer (high perf, medium potential)
   8, 6, 7, 6, 7, 4,
   false, 'Operations excellence, process automation expertise', 'MBA coursework pending, limited external stakeholder exposure', 'Harvard online OPM programme + 6-month rotation in HQ', adm),
  (sc03, tid, sp1, e11, 'ready_3_5_years',
   2, 3,  -- Rising Star (medium perf, high potential)
   6, 5, 7, 9, 5, 2,
   false, 'High learning agility, strong people skills', 'Only 3 yrs experience, needs P&L exposure', 'Step-up to AGM Operations role + mentoring by COO', adm),
-- Candidates for Head of Engineering plan
  (sc04, tid, sp2, e05, 'ready_now',
   3, 3,
   8, 8, 7, 7, 6, 5,
   true,  'Deep tech stack expertise, delivered 3 major product launches', 'Has competing offers; limited management experience above team lead', 'Retention conversation + team-lead-to-manager promotion in Q3', adm),
  (sc05, tid, sp2, e06, 'ready_1_2_years',
   2, 3,
   7, 6, 6, 8, 5, 3,
   false, 'Exceptional coder, strong cross-team collaboration', 'Management breadth, public speaking', 'Toastmasters enrolment + shadow Rahul in leadership meetings', adm),
  (sc06, tid, sp2, e03, 'ready_3_5_years',
   2, 2,
   6, 7, 5, 5, 4, 4,
   false, 'Solid engineering fundamentals, reliable delivery', 'Leadership presence, strategic scope', 'IDP: 1 yr as tech lead for growth squad', adm),
-- Candidates for Head of Sales plan
  (sc07, tid, sp3, e08, 'ready_now',
   3, 2,
   8, 6, 7, 5, 7, 2,
   false, 'Consistent quota achievement 3 yrs running, key account relationships', 'Team leadership at scale (>20), needs HQ exposure', 'Sales leadership workshop + acting head during Sneha leave', adm),
  (sc08, tid, sp3, e10, 'ready_1_2_years',
   2, 3,
   6, 5, 6, 9, 3, 3,
   false, 'Fast learner, opened 4 new territories in 2024', 'Revenue predictability, enterprise deal experience', 'Enterprise sales certification + paired with Sneha for 2 big deals', adm),
  (sc09, tid, sp3, e07, 'ready_3_5_years',
   1, 3,
   5, 4, 5, 8, 3, 2,
   false, 'Strong customer empathy, highest NPS scores in team', 'Quota attainment consistency, channel management', 'Annual target stretch + sales IQ programme', adm)
ON CONFLICT (plan_id, employee_id) DO NOTHING;

-- IDP Actions
INSERT INTO succession_idp_actions (id, tenant_id, candidate_id, action_type, description, target_date, completed_at, created_by)
VALUES
  (idp1, tid, sc01, 'coaching',        'Executive coaching with external coach (12 sessions)',         CURRENT_DATE + 180, NULL,                         adm),
  (idp2, tid, sc01, 'assignment',      'Board observer seat — attend 3 board meetings as observer',   CURRENT_DATE + 90,  NULL,                         adm),
  (idp3, tid, sc02, 'course',          'Harvard OPM (Owner / President Management) online programme', CURRENT_DATE + 270, NULL,                         adm),
  (idp4, tid, sc04, 'mentoring',       'Monthly 1:1 sessions with Priya Sharma on leadership',        CURRENT_DATE + 365, NULL,                         adm),
  (idp5, tid, sc05, 'certification',   'Toastmasters CC certification',                                CURRENT_DATE + 120, CURRENT_DATE - 10,            adm),
  (idp6, tid, sc07, 'course',          'Sales Leadership Masterclass — XLRI Jamshedpur',               CURRENT_DATE + 150, NULL,                         adm)
ON CONFLICT (id) DO NOTHING;

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. R&R — FORMAL AWARDS, ROUNDS, NOMINATIONS, SPOT AWARDS
-- ─────────────────────────────────────────────────────────────────────────────

-- Fetch award IDs seeded by migration 334
SELECT id INTO aw_eom FROM formal_awards WHERE tenant_id = tid AND award_type = 'employee_of_month' LIMIT 1;
SELECT id INTO aw_som FROM formal_awards WHERE tenant_id = tid AND award_type = 'store_of_month'    LIMIT 1;
SELECT id INTO aw_ls1 FROM formal_awards WHERE tenant_id = tid AND award_type = 'long_service'
  AND name ILIKE '%1 Year%' LIMIT 1;

-- Award Rounds
IF aw_eom IS NOT NULL THEN
  INSERT INTO award_rounds (id, tenant_id, award_id, period_label, period_start, period_end, status, winner_employee_id, winner_notes, declared_at, declared_by, created_by)
  VALUES
    (ar1, tid, aw_eom, 'June 2025', '2025-06-01', '2025-06-30', 'closed',
     e05, 'Arjun delivered the checkout revamp 3 weeks ahead of schedule — highest CSAT score this quarter.',
     '2025-07-03 10:00:00+05:30', adm, adm),
    (ar2, tid, aw_eom, 'July 2025', '2025-07-01', '2025-07-31', 'open',
     NULL, NULL, NULL, NULL, adm)
  ON CONFLICT (id) DO NOTHING;

  -- Nominations for June (closed) — winner + not selected
  INSERT INTO award_nominations (id, tenant_id, round_id, nominee_id, nominated_by, justification, status, reviewed_at, reviewed_by)
  VALUES
    (an1, tid, ar1, e05, adm,
     'Arjun single-handedly delivered the payments revamp, cutting checkout drop-off by 34%. Outstanding ownership.',
     'winner', '2025-07-02 18:00:00+05:30', adm),
    (an2, tid, ar1, e06, adm,
     'Nandini resolved 28 critical bugs in the mobile app during the June release sprint.',
     'not_selected', '2025-07-02 18:00:00+05:30', adm),
    (an3, tid, ar1, e12, adm,
     'Karan drove the backend migration to zero downtime. Team praised his meticulous approach.',
     'not_selected', '2025-07-02 18:00:00+05:30', adm),
    -- Nominations for July (open) — pending
    (an4, tid, ar2, e11, adm,
     'Ananya built the new onboarding pipeline end-to-end, reducing time-to-productive from 14 days to 7.',
     'pending', NULL, NULL),
    (an5, tid, ar2, e09, adm,
     'Kavya won back three key accounts that were at churn risk — Rs 18L revenue retained.',
     'pending', NULL, NULL)
  ON CONFLICT (round_id, nominee_id) DO NOTHING;
END IF;

IF aw_som IS NOT NULL THEN
  INSERT INTO award_rounds (id, tenant_id, award_id, period_label, period_start, period_end, status, winner_employee_id, winner_notes, declared_at, declared_by, created_by)
  VALUES
    (ar3, tid, aw_som, 'June 2025', '2025-06-01', '2025-06-30', 'closed',
     e04, 'Sneha''s team achieved 128% of monthly target — best sales performance in Q2.',
     '2025-07-04 09:00:00+05:30', adm, adm)
  ON CONFLICT (id) DO NOTHING;
END IF;

-- Spot Awards (peer-to-peer)
INSERT INTO spot_awards (id, tenant_id, from_employee_id, to_employee_id, award_name, message, monetary_value)
VALUES
  (sa1, tid, e02, e05, 'Thank You Star',
   'Arjun, you saved the release by catching that race condition at 11 PM. Absolute hero!', 500),
  (sa2, tid, e01, e12, 'Excellence Award',
   'Karan''s zero-downtime migration was textbook. This is what senior engineering looks like.', 1000),
  (sa3, tid, e04, e10, 'Go-Getter Award',
   'Rohan''s work ethic this month has been extraordinary — 4 new outlets onboarded in 2 weeks!', 500),
  (sa4, tid, e08, e09, 'Customer Champion',
   'Kavya''s retention saves this quarter are already at Rs 34L. Brilliant work!', 750),
  (sa5, tid, e12, e06, 'Bug Slayer Award',
   'Nandini cleared 40+ bugs from our backlog in a week. The QA team is thrilled.', 500)
ON CONFLICT (id) DO NOTHING;

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. SURVEYS — Annual Engagement + Onboarding + Exit Intent
-- ─────────────────────────────────────────────────────────────────────────────

INSERT INTO surveys (id, tenant_id, title, description, status, survey_type, is_anonymous, due_date, created_by)
VALUES
  (sv1, tid, 'Annual Employee Engagement Survey 2025',
   'Confidential 10-minute survey covering pride, growth, compensation, and leadership.',
   'closed', 'annual_engagement', true, '2025-06-15', adm),
  (sv2, tid, 'Onboarding Pulse – Day 30 (Batch July 2025)',
   'Quick check-in for employees who joined in June 2025.',
   'active', 'onboarding_d30', false, CURRENT_DATE + 7, adm),
  (sv3, tid, 'Exit Intent — Retention Check',
   'Anonymous survey to understand what might prompt team members to look elsewhere.',
   'active', 'exit_intent', true, CURRENT_DATE + 14, adm)
ON CONFLICT (id) DO NOTHING;

-- Engagement survey questions (8 rating questions across dimensions)
INSERT INTO survey_questions (id, survey_id, tenant_id, order_idx, question_text, question_type, options, required)
VALUES
  (sq01, sv1, tid, 1, 'I am proud to work at this organisation.',                   'rating', NULL, true),
  (sq02, sv1, tid, 2, 'I would recommend this organisation as a great place to work.','rating', NULL, true),
  (sq03, sv1, tid, 3, 'I plan to still be working here in 12 months.',               'rating', NULL, true),
  (sq04, sv1, tid, 4, 'My manager supports my development and treats me fairly.',     'rating', NULL, true),
  (sq05, sv1, tid, 5, 'I have opportunities to grow and advance my career here.',     'rating', NULL, true),
  (sq06, sv1, tid, 6, 'I am paid fairly for the work I do.',                          'rating', NULL, true),
  (sq07, sv1, tid, 7, 'My contributions are recognised and appreciated.',              'rating', NULL, true),
  (sq08, sv1, tid, 8, 'What is one thing that would make this a better place to work?','text',  NULL, false)
ON CONFLICT (id) DO NOTHING;

-- Onboarding survey questions
INSERT INTO survey_questions (id, survey_id, tenant_id, order_idx, question_text, question_type, options, required)
VALUES
  (sq11, sv2, tid, 1, 'How would you rate your overall joining experience so far?',        'rating', NULL, true),
  (sq12, sv2, tid, 2, 'How clear are you about your role and responsibilities?',           'rating', NULL, true),
  (sq13, sv2, tid, 3, 'How supported do you feel by your reporting manager?',              'rating', NULL, true)
ON CONFLICT (id) DO NOTHING;

-- Engagement Survey Assignments + Responses (9 employees completed)
DO $_do$
DECLARE
  emps UUID[] := ARRAY[
    'e0000000-0000-0000-0000-000000000002'::UUID,
    'e0000000-0000-0000-0000-000000000003'::UUID,
    'e0000000-0000-0000-0000-000000000004'::UUID,
    'e0000000-0000-0000-0000-000000000005'::UUID,
    'e0000000-0000-0000-0000-000000000006'::UUID,
    'e0000000-0000-0000-0000-000000000007'::UUID,
    'e0000000-0000-0000-0000-000000000008'::UUID,
    'e0000000-0000-0000-0000-000000000009'::UUID,
    'e0000000-0000-0000-0000-00000000000b'::UUID
  ];
  -- ratings per employee (q1..q7) — realistic variation
  ratings INT[][] := ARRAY[
    ARRAY[5,5,4,5,4,3,5],  -- Rahul
    ARRAY[4,4,4,4,3,3,4],  -- Deepak
    ARRAY[5,5,5,5,5,4,5],  -- Sneha
    ARRAY[5,4,3,5,4,3,4],  -- Arjun (attrition risk: 3 on Q3)
    ARRAY[4,4,5,4,4,3,5],  -- Nandini
    ARRAY[5,5,4,4,4,4,4],  -- Ayesha
    ARRAY[4,4,4,4,3,3,4],  -- Vikram
    ARRAY[5,5,5,5,5,4,5],  -- Kavya
    ARRAY[4,4,5,5,4,3,4]   -- Ananya
  ];
  open_text TEXT[] := ARRAY[
    'Better career progression clarity and more L&D budget.',
    'More cross-team collaboration opportunities.',
    'The culture here is great. Maybe more flexible timing for office days.',
    'Salary benchmarking vs market rates would help retention.',
    'More recognition for individual contributors — not just team wins.',
    'Mentoring programme for new joiners would be fantastic.',
    'Nothing major. Team events and offsites make this a great place.',
    'I''d love a structured career ladder with clear milestones.',
    'AI tools to help with repetitive tasks would save a lot of time.'
  ];
  sv1 UUID := 'f3000000-0000-0000-0000-000000000001';
  qs  UUID[] := ARRAY[
    'f3000000-0000-0000-0000-000000000101'::UUID,
    'f3000000-0000-0000-0000-000000000102'::UUID,
    'f3000000-0000-0000-0000-000000000103'::UUID,
    'f3000000-0000-0000-0000-000000000104'::UUID,
    'f3000000-0000-0000-0000-000000000105'::UUID,
    'f3000000-0000-0000-0000-000000000106'::UUID,
    'f3000000-0000-0000-0000-000000000107'::UUID,
    'f3000000-0000-0000-0000-000000000108'::UUID
  ];
  tid UUID := 'd0000000-0000-0000-0000-000000000001';
  i   INT;
  j   INT;
  asn_id UUID;
BEGIN
  FOR i IN 1..array_length(emps, 1) LOOP
    asn_id := gen_random_uuid();
    INSERT INTO survey_assignments (id, survey_id, employee_id, tenant_id, assigned_at, completed_at, respondent_type)
    VALUES (asn_id, sv1, emps[i], tid,
            '2025-06-01 09:00:00+05:30',
            '2025-06-12 14:00:00+05:30',
            'self')
    ON CONFLICT (survey_id, employee_id, respondent_type) DO UPDATE SET id = EXCLUDED.id
    RETURNING id INTO asn_id;

    -- Rating questions q1..q7
    FOR j IN 1..7 LOOP
      INSERT INTO survey_responses (assignment_id, question_id, tenant_id, response)
      VALUES (asn_id, qs[j], tid, to_jsonb(ratings[i][j]))
      ON CONFLICT (assignment_id, question_id) DO NOTHING;
    END LOOP;
    -- Open text q8
    INSERT INTO survey_responses (assignment_id, question_id, tenant_id, response)
    VALUES (asn_id, qs[8], tid, to_jsonb(open_text[i]))
    ON CONFLICT (assignment_id, question_id) DO NOTHING;
  END LOOP;
END;
$_do$;

-- Onboarding survey: assign to recent joiners (Kavya, Rohan, Ananya)
INSERT INTO survey_assignments (survey_id, employee_id, tenant_id, respondent_type)
VALUES
  (sv2, e09, tid, 'self'),
  (sv2, e10, tid, 'self'),
  (sv2, e11, tid, 'self')
ON CONFLICT (survey_id, employee_id, respondent_type) DO NOTHING;

-- Exit intent: assign to Arjun (flagged for attrition risk in succession scorecard)
INSERT INTO survey_assignments (survey_id, employee_id, tenant_id, respondent_type)
VALUES (sv3, e05, tid, 'self')
ON CONFLICT (survey_id, employee_id, respondent_type) DO NOTHING;

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. POLICY KNOWLEDGE BASE
-- ─────────────────────────────────────────────────────────────────────────────

INSERT INTO hr_policies (id, tenant_id, title, category, description, content, status, version, requires_acknowledgement, effective_from, published_at, published_by, created_by)
VALUES
(po1, tid, 'Leave Policy 2025',
 'leave',
 'Comprehensive leave entitlements for all employees including CL, SL, EL, and maternity/paternity leave.',
 E'# Leave Policy 2025\n\n## 1. Casual Leave (CL)\nAll confirmed employees are entitled to 12 days of Casual Leave per calendar year. CL can be availed for personal reasons, family events, or short illnesses. Maximum 3 consecutive days can be taken as CL.\n\n## 2. Sick Leave (SL)\nEmployees are entitled to 10 days of Sick Leave per year. Medical certificate is required for absences exceeding 2 consecutive days.\n\n## 3. Earned Leave (EL)\nEmployees accrue 1 day of Earned Leave for every 20 days worked. EL can be encashed up to 15 days per year during the annual settlement period.\n\n## 4. Maternity Leave\nFemale employees are entitled to 26 weeks of paid maternity leave as per the Maternity Benefit Act 1961.\n\n## 5. Paternity Leave\nMale employees are entitled to 5 days of paid paternity leave within 6 months of childbirth.\n\n## 6. Leave Application Process\nAll leave requests must be submitted through CognixHR ESS at least 2 working days in advance (except medical emergencies). Manager approval is required before proceeding on leave.',
 'published', 3, true, '2025-01-01', '2024-12-15 10:00:00+05:30', adm, adm),

(po2, tid, 'Code of Conduct',
 'conduct',
 'Standards of professional behaviour expected from all employees at all times.',
 E'# Code of Conduct\n\n## 1. Professional Integrity\nAll employees must conduct themselves with honesty and integrity. Conflicts of interest must be disclosed to HR immediately.\n\n## 2. Respect in the Workplace\nEvery employee has the right to work in an environment free from harassment, bullying, or discrimination. Zero tolerance for any form of discriminatory behaviour based on gender, religion, caste, nationality, disability, or sexual orientation.\n\n## 3. Confidentiality\nEmployees must treat company information, customer data, and trade secrets as confidential. This obligation continues for 2 years post-employment.\n\n## 4. Social Media Policy\nEmployees may not make disparaging remarks about the company, its products, or colleagues on social media. Any official communication on behalf of the company requires prior approval from Marketing.\n\n## 5. Gifts and Entertainment\nEmployees may not accept gifts exceeding Rs 2,000 in value from vendors, suppliers, or customers. All gifts received must be disclosed to the Compliance team.\n\n## 6. Disciplinary Action\nViolations of this Code may result in warnings, suspension, or termination depending on the severity.',
 'published', 2, true, '2025-01-01', '2024-12-20 10:00:00+05:30', adm, adm),

(po3, tid, 'IT & Information Security Policy',
 'it',
 'Guidelines for the secure use of IT systems, devices, and data.',
 E'# IT & Information Security Policy\n\n## 1. Device Usage\nCompany laptops and devices are for business use only. Personal use is permitted within reason but must not compromise security or performance.\n\n## 2. Password Policy\nAll passwords must be minimum 12 characters with a combination of upper/lowercase, numbers, and special characters. Passwords must be changed every 90 days. Password sharing is strictly prohibited.\n\n## 3. Data Classification\n- **Confidential**: Customer PII, payroll data, board documents\n- **Internal**: Product roadmaps, HR policies, operational data\n- **Public**: Press releases, job postings\n\nConfidential data must never be stored on personal devices or shared via unapproved channels.\n\n## 4. Software Installation\nOnly IT-approved software may be installed on company devices. Requests for additional software must go through the IT Help Desk.\n\n## 5. Incident Reporting\nAny suspected security breach, data loss, or unauthorised access must be reported to IT Security within 1 hour of discovery via the Help Desk portal.',
 'published', 1, true, '2025-01-01', '2024-12-18 10:00:00+05:30', adm, adm),

(po4, tid, 'Work From Home Policy',
 'conduct',
 'Guidelines for employees working remotely, covering eligibility, expectations, and equipment.',
 E'# Work From Home Policy\n\n## 1. Eligibility\nWFH is available to all confirmed employees (after 6-month probation) in roles where remote work is operationally feasible as determined by their department head.\n\n## 2. Weekly WFH Allowance\nEligible employees may work from home up to 2 days per week. WFH days are Tuesday and Thursday by default; specific days can be adjusted with manager approval.\n\n## 3. Expectations While WFH\n- Maintain your regular working hours (9 AM – 6 PM)\n- Be available on Slack and MS Teams during core hours (10 AM – 4 PM)\n- Attend all mandatory meetings on camera\n- Ensure a professional and distraction-free environment for video calls\n\n## 4. Equipment\nThe company will provide a WFH allowance of Rs 5,000 per year for peripherals (keyboard, mouse, webcam). Submit receipts through the ESS portal for reimbursement.\n\n## 5. Revocation\nWFH privileges may be revoked temporarily or permanently in cases of repeated non-compliance, performance issues, or operational exigencies.',
 'published', 1, false, '2025-03-01', '2025-02-25 10:00:00+05:30', adm, adm),

(po5, tid, 'Prevention of Sexual Harassment (POSH) Policy',
 'conduct',
 'Policy and complaint mechanism under the Sexual Harassment of Women at Workplace Act 2013.',
 E'# Prevention of Sexual Harassment (POSH) Policy\n\n## 1. Commitment\nCognixHR is committed to providing a safe, respectful, and dignified work environment for all employees, regardless of gender.\n\n## 2. What Constitutes Sexual Harassment\nSexual harassment includes any unwelcome act of a sexual nature — physical contact, demand for sexual favours, sexually coloured remarks, showing pornography, or any other unwelcome physical, verbal, or non-verbal conduct of a sexual nature.\n\n## 3. Internal Complaints Committee (ICC)\nThe company has constituted an ICC as required by law. The ICC includes at least one external member with expertise in gender issues. Contact: posh@cognixhr.demo\n\n## 4. How to File a Complaint\nComplaints must be filed in writing within 3 months of the incident to the ICC Presiding Officer. Anonymous complaints will also be investigated to the extent possible.\n\n## 5. Enquiry Process\nThe ICC will complete the enquiry within 90 days. Both parties will be given equal opportunity to present their case. The respondent will be suspended from work with pay during enquiry if the ICC recommends it.\n\n## 6. Penalties\nIf the complaint is upheld, penalties range from a written apology to termination and criminal prosecution under IPC.',
 'published', 2, true, '2025-01-01', '2024-12-10 10:00:00+05:30', adm, adm)
ON CONFLICT (id) DO NOTHING;

-- Policy acknowledgements — 8 employees acknowledge all 3 mandatory policies
DO $_ack$
DECLARE
  emps UUID[] := ARRAY[
    'e0000000-0000-0000-0000-000000000002'::UUID,
    'e0000000-0000-0000-0000-000000000003'::UUID,
    'e0000000-0000-0000-0000-000000000004'::UUID,
    'e0000000-0000-0000-0000-000000000005'::UUID,
    'e0000000-0000-0000-0000-000000000008'::UUID,
    'e0000000-0000-0000-0000-000000000009'::UUID,
    'e0000000-0000-0000-0000-00000000000a'::UUID,
    'e0000000-0000-0000-0000-00000000000c'::UUID
  ];
  pols UUID[] := ARRAY[
    'f4000000-0000-0000-0000-000000000001'::UUID, -- Leave (mandatory)
    'f4000000-0000-0000-0000-000000000002'::UUID, -- Code of Conduct (mandatory)
    'f4000000-0000-0000-0000-000000000005'::UUID  -- POSH (mandatory)
  ];
  tid UUID := 'd0000000-0000-0000-0000-000000000001';
  i INT; j INT;
BEGIN
  FOR i IN 1..array_length(emps, 1) LOOP
    FOR j IN 1..array_length(pols, 1) LOOP
      INSERT INTO policy_acknowledgements (tenant_id, policy_id, employee_id, acknowledged_at)
      VALUES (tid, pols[j], emps[i], CURRENT_TIMESTAMP - (random() * INTERVAL '30 days'))
      ON CONFLICT (tenant_id, policy_id, employee_id) DO NOTHING;
    END LOOP;
  END LOOP;
END;
$_ack$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 5. ABSCONDING CASES
-- ─────────────────────────────────────────────────────────────────────────────

-- Case 1: WL1 sent stage (7 days absent)
INSERT INTO absconding_cases
  (id, tenant_id, employee_id, status, first_ua_date, last_ua_date, ua_days_count,
   flagged_at, wl1_sent_at, notes, assigned_to, chro_approval_required, created_by)
VALUES
  (ac1, tid, e07,
   'wl1_sent',
   CURRENT_DATE - 10, CURRENT_DATE - 1, 10,
   CURRENT_DATE - 10,
   CURRENT_DATE - 3,
   'Ayesha did not report to work from 19 Jun. Attempts to reach via phone and WhatsApp unsuccessful. Warning Letter 1 dispatched on 26 Jun.',
   adm, false, adm)
ON CONFLICT (id) DO NOTHING;

INSERT INTO absconding_communications (case_id, tenant_id, comm_type, direction, subject, body, sent_by, metadata)
VALUES
  (ac1, tid, 'system_event', 'internal',
   'Case created — 3 consecutive UA days',
   'System auto-flagged Ayesha Ahmed (SAAR007) for 3 consecutive unauthorized absences.',
   adm, '{"trigger": "auto_flag", "ua_days": 3}'::jsonb),
  (ac1, tid, 'email_sent', 'outbound',
   'Warning Letter 1 — Unauthorized Absence',
   'Dear Ayesha, You have been absent without authorization since 19 June 2025. Please report to HR within 3 working days. Failure to do so may result in further disciplinary action.',
   adm, '{"letter_type": "wl1", "channel": "email"}'::jsonb),
  (ac1, tid, 'call_attempted', 'outbound',
   'Phone call attempt — no answer',
   'Called Ayesha at +91-9800000007. Number rang but no answer. Left voicemail.',
   adm, '{"attempts": 2}'::jsonb)
ON CONFLICT DO NOTHING;

-- Case 2: Termination pending (21+ days, awaiting CHRO approval)
INSERT INTO absconding_cases
  (id, tenant_id, employee_id, status, first_ua_date, last_ua_date, ua_days_count,
   flagged_at, wl1_sent_at, wl2_sent_at, notes, assigned_to, chro_approval_required, created_by)
VALUES
  (ac2, tid, e10,
   'termination_pending',
   CURRENT_DATE - 28, CURRENT_DATE - 1, 28,
   CURRENT_DATE - 28,
   CURRENT_DATE - 21,
   CURRENT_DATE - 14,
   'Rohan has been UA since 1 Jun. WL1 sent on 8 Jun (no response). WL2 sent on 15 Jun (no response). Case escalated to CHRO for termination approval.',
   adm, true, adm)
ON CONFLICT (id) DO NOTHING;

INSERT INTO absconding_communications (case_id, tenant_id, comm_type, direction, subject, body, sent_by, metadata)
VALUES
  (ac2, tid, 'system_event', 'internal',
   'Case created — 3 consecutive UA days',
   'System auto-flagged Rohan Mehta (SAAR010) for 3 consecutive unauthorized absences starting 1 June.',
   adm, '{"trigger": "auto_flag", "ua_days": 3}'::jsonb),
  (ac2, tid, 'letter_generated', 'outbound',
   'Warning Letter 1 dispatched',
   'WL1 generated and dispatched to last known address and email on 8 June 2025.',
   adm, '{"letter_type": "wl1"}'::jsonb),
  (ac2, tid, 'letter_generated', 'outbound',
   'Warning Letter 2 dispatched',
   'WL2 generated and dispatched on 15 June 2025. No response received.',
   adm, '{"letter_type": "wl2"}'::jsonb),
  (ac2, tid, 'system_event', 'internal',
   'Escalated to CHRO — termination pending approval',
   'Case auto-escalated on day 21. Termination approval request sent to CHRO.',
   adm, '{"escalation_day": 21, "ua_days": 21}'::jsonb)
ON CONFLICT DO NOTHING;

-- ─────────────────────────────────────────────────────────────────────────────
-- 6. MOOD CHECK-INS — 30 days for all employees
-- ─────────────────────────────────────────────────────────────────────────────

DO $_mood$
DECLARE
  tid  UUID := 'd0000000-0000-0000-0000-000000000001';
  emps UUID[] := ARRAY[
    'e0000000-0000-0000-0000-000000000001'::UUID,
    'e0000000-0000-0000-0000-000000000002'::UUID,
    'e0000000-0000-0000-0000-000000000003'::UUID,
    'e0000000-0000-0000-0000-000000000004'::UUID,
    'e0000000-0000-0000-0000-000000000005'::UUID,
    'e0000000-0000-0000-0000-000000000006'::UUID,
    'e0000000-0000-0000-0000-000000000008'::UUID,
    'e0000000-0000-0000-0000-000000000009'::UUID,
    'e0000000-0000-0000-0000-00000000000b'::UUID,
    'e0000000-0000-0000-0000-00000000000c'::UUID
  ];
  -- base mood for each employee (1-5): Arjun=3 (at risk), others 3-5
  base_mood INT[] := ARRAY[4, 4, 3, 5, 3, 4, 4, 5, 4, 4];
  sentiments TEXT[] := ARRAY['positive','neutral','negative'];
  i INT; d INT;
  mood_score INT;
  this_date DATE;
BEGIN
  FOR i IN 1..array_length(emps, 1) LOOP
    FOR d IN 1..30 LOOP
      this_date := CURRENT_DATE - (31 - d);
      -- skip weekends
      IF EXTRACT(DOW FROM this_date) IN (0, 6) THEN CONTINUE; END IF;
      -- 80% check-in rate
      IF random() < 0.20 THEN CONTINUE; END IF;
      -- mood varies ±1 from base
      mood_score := GREATEST(1, LEAST(5, base_mood[i] + (floor(random() * 3) - 1)::int));
      INSERT INTO mood_checkins (tenant_id, employee_id, mood, checkin_date,
                                  sentiment_label,
                                  note)
      VALUES (
        tid, emps[i], mood_score, this_date,
        CASE WHEN mood_score >= 4 THEN 'positive'
             WHEN mood_score = 3  THEN 'neutral'
             ELSE 'negative' END,
        CASE
          WHEN mood_score = 5 THEN 'Great day — productive sprint!'
          WHEN mood_score = 4 THEN 'Solid day, on track.'
          WHEN mood_score = 3 THEN NULL
          WHEN mood_score = 2 THEN 'Feeling stressed with workload.'
          ELSE 'Very difficult day.'
        END
      )
      ON CONFLICT (tenant_id, employee_id, checkin_date) DO NOTHING;
    END LOOP;
  END LOOP;
END;
$_mood$;

-- Pulse questions
INSERT INTO pulse_questions (id, tenant_id, question, options, status, starts_at, ends_at, created_by)
VALUES
  (pq1, tid,
   'How is your current workload this week?',
   '["Very light — I can take on more", "Just right", "Slightly heavy but manageable", "Too heavy — I''m overwhelmed"]'::jsonb,
   'active',
   CURRENT_TIMESTAMP - INTERVAL '3 days',
   CURRENT_TIMESTAMP + INTERVAL '4 days',
   adm),
  (pq2, tid,
   'Do you feel adequately recognised for your contributions this month?',
   '["Yes, absolutely", "Somewhat", "Not really", "No, I feel overlooked"]'::jsonb,
   'active',
   CURRENT_TIMESTAMP - INTERVAL '1 day',
   CURRENT_TIMESTAMP + INTERVAL '6 days',
   adm)
ON CONFLICT (id) DO NOTHING;

-- Sample pulse responses for workload question
INSERT INTO pulse_responses (tenant_id, question_id, employee_id, response)
VALUES
  (tid, pq1, e02, 'Just right'),
  (tid, pq1, e03, 'Slightly heavy but manageable'),
  (tid, pq1, e04, 'Just right'),
  (tid, pq1, e06, 'Too heavy — I''m overwhelmed'),
  (tid, pq1, e08, 'Just right'),
  (tid, pq1, e09, 'Just right'),
  (tid, pq1, e11, 'Very light — I can take on more'),
  (tid, pq1, e12, 'Slightly heavy but manageable')
ON CONFLICT (tenant_id, question_id, employee_id) DO NOTHING;

-- ─────────────────────────────────────────────────────────────────────────────
-- 7. HELPDESK — satisfaction ratings on resolved tickets
-- ─────────────────────────────────────────────────────────────────────────────

-- Update a few existing resolved helpdesk tickets with satisfaction ratings
-- (only update tickets belonging to this tenant, idempotent)
DO $_hd$
DECLARE
  tid UUID := 'd0000000-0000-0000-0000-000000000001';
  r RECORD;
  i INT := 0;
  ratings INT[] := ARRAY[5, 4, 3, 5, 4, 5, 2, 4];
  comments TEXT[] := ARRAY[
    'Resolved super fast! Great support.',
    'Issue fixed, took a day but OK.',
    'It took 3 follow-ups to get resolved. Could be faster.',
    'Excellent — agent was very helpful and proactive.',
    'Smooth experience. Thank you!',
    'Problem solved on first response. 5 stars!',
    'The resolution didn''t fully fix my issue. Had to raise again.',
    'Good service, quick turnaround.'
  ];
BEGIN
  FOR r IN
    SELECT id FROM helpdesk_tickets
    WHERE tenant_id = tid AND status = 'resolved'
      AND csat_submitted_at IS NULL
    ORDER BY created_at DESC
    LIMIT 8
  LOOP
    i := i + 1;
    UPDATE helpdesk_tickets
    SET csat_rating       = ratings[i],
        csat_comment      = comments[i],
        csat_submitted_at = now() - ((9 - i) * INTERVAL '1 day')
    WHERE id = r.id;
    EXIT WHEN i >= 8;
  END LOOP;
END;
$_hd$;

-- Helpdesk category SLA defaults (idempotent — migration 332 already seeds these)
INSERT INTO helpdesk_category_sla (tenant_id, category, response_hours, resolution_hours)
VALUES
  (tid, 'it_support', 8,   16),
  (tid, 'hr_query',   24,  48),
  (tid, 'payroll',    24,  48),
  (tid, 'general',    48,  96),
  (tid, 'grievance',  120, 240)
ON CONFLICT (tenant_id, category) DO NOTHING;

END;
$$;

COMMIT;
