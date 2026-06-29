-- ============================================================
-- seed-demo-extra-12.sql
--
-- Fills in ALL previously empty tables so every admin/ESS page
-- has demo data to show.
--
-- Covers:
--   1. benefit_plans         (migration 243)
--   2. benefit_enrollments   (migration 243)
--   3. talent_roles          (migration 335)
--   4. talent_interests      (migration 335)
--   5. succession_plans      (migration 329) — safe idempotent
--   6. succession_candidates (migrations 329+330)
--   7. succession_idp_actions (migration 330)
--
-- Safe to re-run: all inserts use ON CONFLICT DO NOTHING
-- ============================================================

-- ──────────────────────────────────────────────────────────────
-- 1. BENEFIT PLANS
-- ──────────────────────────────────────────────────────────────

INSERT INTO benefit_plans (id, tenant_id, name, plan_type, provider, description,
  coverage_amount, employee_cost, employer_cost, allows_dependents,
  enrollment_opens_at, enrollment_closes_at, is_active, created_by)
VALUES
  ('b0000000-0000-0000-0000-000000000001',
   'd0000000-0000-0000-0000-000000000001',
   'Group Health Insurance', 'health',
   'Star Health Insurance',
   'Comprehensive family floater health cover. Cashless treatment at 5,000+ network hospitals across India. Covers hospitalisation, day-care procedures, and pre/post hospitalisation expenses.',
   500000, 6000, 18000, true, '2025-12-01', '2026-01-31', true,
   'd0000000-0000-0000-0000-0000000000a1'),

  ('b0000000-0000-0000-0000-000000000002',
   'd0000000-0000-0000-0000-000000000001',
   'Group Term Life Cover', 'term_life',
   'LIC Group',
   'Life insurance cover equal to 3× annual CTC. Nominee receives the sum assured in the event of death during employment. No medical underwriting required.',
   0, 2400, 7200, false, '2025-12-01', '2026-01-31', true,
   'd0000000-0000-0000-0000-0000000000a1'),

  ('b0000000-0000-0000-0000-000000000003',
   'd0000000-0000-0000-0000-000000000001',
   'Personal Accident Cover', 'accident',
   'New India Assurance',
   'Covers accidental death, permanent total/partial disability, and temporary total disability. Includes medical expenses up to ₹1L arising from accidents.',
   1000000, 1200, 3600, false, null, null, true,
   'd0000000-0000-0000-0000-0000000000a1'),

  ('b0000000-0000-0000-0000-000000000004',
   'd0000000-0000-0000-0000-000000000001',
   'Employee Wellness Program', 'wellness',
   'Cult.fit Corporate',
   'Access to 1000+ Cult.fit centres across India, live and recorded workout sessions, mental wellness sessions with certified therapists, and nutrition consultations.',
   0, 3000, 6000, false, null, null, true,
   'd0000000-0000-0000-0000-0000000000a1'),

  ('b0000000-0000-0000-0000-000000000005',
   'd0000000-0000-0000-0000-000000000001',
   'Office Transport Allowance', 'transport',
   null,
   'Monthly transport pass reimbursement up to ₹3,200/month for commuting to the office on at least 15 working days. Requires cab/Metro bills.',
   38400, 0, 38400, false, null, null, true,
   'd0000000-0000-0000-0000-0000000000a1')
ON CONFLICT (id) DO NOTHING;


-- ──────────────────────────────────────────────────────────────
-- 2. BENEFIT ENROLLMENTS  (UNIQUE: tenant_id, employee_id, plan_id)
-- ──────────────────────────────────────────────────────────────

-- Health insurance
INSERT INTO benefit_enrollments (tenant_id, employee_id, plan_id, status, dependent_ids, notes)
VALUES
  ('d0000000-0000-0000-0000-000000000001','e0000000-0000-0000-0000-000000000001','b0000000-0000-0000-0000-000000000001','enrolled','[]',null),
  ('d0000000-0000-0000-0000-000000000001','e0000000-0000-0000-0000-000000000002','b0000000-0000-0000-0000-000000000001','enrolled','[]',null),
  ('d0000000-0000-0000-0000-000000000001','e0000000-0000-0000-0000-000000000003','b0000000-0000-0000-0000-000000000001','enrolled','[]',null),
  ('d0000000-0000-0000-0000-000000000001','e0000000-0000-0000-0000-000000000004','b0000000-0000-0000-0000-000000000001','enrolled','[]',null),
  ('d0000000-0000-0000-0000-000000000001','e0000000-0000-0000-0000-000000000005','b0000000-0000-0000-0000-000000000001','enrolled','[]',null),
  ('d0000000-0000-0000-0000-000000000001','e0000000-0000-0000-0000-000000000006','b0000000-0000-0000-0000-000000000001','enrolled','[]',null),
  ('d0000000-0000-0000-0000-000000000001','e0000000-0000-0000-0000-000000000007','b0000000-0000-0000-0000-000000000001','waived','[]','Covered under spouse employer plan'),
  ('d0000000-0000-0000-0000-000000000001','e0000000-0000-0000-0000-000000000008','b0000000-0000-0000-0000-000000000001','enrolled','[]',null),
  ('d0000000-0000-0000-0000-000000000001','e0000000-0000-0000-0000-000000000009','b0000000-0000-0000-0000-000000000001','enrolled','[]',null),
  ('d0000000-0000-0000-0000-000000000001','e0000000-0000-0000-0000-00000000000a','b0000000-0000-0000-0000-000000000001','enrolled','[]',null)
ON CONFLICT (tenant_id, employee_id, plan_id) DO NOTHING;

-- Term life
INSERT INTO benefit_enrollments (tenant_id, employee_id, plan_id, status, dependent_ids)
VALUES
  ('d0000000-0000-0000-0000-000000000001','e0000000-0000-0000-0000-000000000001','b0000000-0000-0000-0000-000000000002','enrolled','[]'),
  ('d0000000-0000-0000-0000-000000000001','e0000000-0000-0000-0000-000000000002','b0000000-0000-0000-0000-000000000002','enrolled','[]'),
  ('d0000000-0000-0000-0000-000000000001','e0000000-0000-0000-0000-000000000003','b0000000-0000-0000-0000-000000000002','enrolled','[]'),
  ('d0000000-0000-0000-0000-000000000001','e0000000-0000-0000-0000-000000000004','b0000000-0000-0000-0000-000000000002','enrolled','[]'),
  ('d0000000-0000-0000-0000-000000000001','e0000000-0000-0000-0000-000000000005','b0000000-0000-0000-0000-000000000002','enrolled','[]'),
  ('d0000000-0000-0000-0000-000000000001','e0000000-0000-0000-0000-000000000006','b0000000-0000-0000-0000-000000000002','enrolled','[]'),
  ('d0000000-0000-0000-0000-000000000001','e0000000-0000-0000-0000-000000000008','b0000000-0000-0000-0000-000000000002','enrolled','[]'),
  ('d0000000-0000-0000-0000-000000000001','e0000000-0000-0000-0000-000000000009','b0000000-0000-0000-0000-000000000002','enrolled','[]')
ON CONFLICT (tenant_id, employee_id, plan_id) DO NOTHING;

-- Personal accident
INSERT INTO benefit_enrollments (tenant_id, employee_id, plan_id, status, dependent_ids)
VALUES
  ('d0000000-0000-0000-0000-000000000001','e0000000-0000-0000-0000-000000000001','b0000000-0000-0000-0000-000000000003','enrolled','[]'),
  ('d0000000-0000-0000-0000-000000000001','e0000000-0000-0000-0000-000000000003','b0000000-0000-0000-0000-000000000003','enrolled','[]'),
  ('d0000000-0000-0000-0000-000000000001','e0000000-0000-0000-0000-000000000005','b0000000-0000-0000-0000-000000000003','enrolled','[]'),
  ('d0000000-0000-0000-0000-000000000001','e0000000-0000-0000-0000-000000000008','b0000000-0000-0000-0000-000000000003','enrolled','[]'),
  ('d0000000-0000-0000-0000-000000000001','e0000000-0000-0000-0000-00000000000a','b0000000-0000-0000-0000-000000000003','enrolled','[]'),
  ('d0000000-0000-0000-0000-000000000001','e0000000-0000-0000-0000-00000000000c','b0000000-0000-0000-0000-000000000003','enrolled','[]')
ON CONFLICT (tenant_id, employee_id, plan_id) DO NOTHING;

-- Wellness
INSERT INTO benefit_enrollments (tenant_id, employee_id, plan_id, status, dependent_ids)
VALUES
  ('d0000000-0000-0000-0000-000000000001','e0000000-0000-0000-0000-000000000001','b0000000-0000-0000-0000-000000000004','enrolled','[]'),
  ('d0000000-0000-0000-0000-000000000001','e0000000-0000-0000-0000-000000000004','b0000000-0000-0000-0000-000000000004','enrolled','[]'),
  ('d0000000-0000-0000-0000-000000000001','e0000000-0000-0000-0000-000000000006','b0000000-0000-0000-0000-000000000004','enrolled','[]'),
  ('d0000000-0000-0000-0000-000000000001','e0000000-0000-0000-0000-000000000007','b0000000-0000-0000-0000-000000000004','enrolled','[]'),
  ('d0000000-0000-0000-0000-000000000001','e0000000-0000-0000-0000-000000000009','b0000000-0000-0000-0000-000000000004','enrolled','[]'),
  ('d0000000-0000-0000-0000-000000000001','e0000000-0000-0000-0000-00000000000b','b0000000-0000-0000-0000-000000000004','enrolled','[]')
ON CONFLICT (tenant_id, employee_id, plan_id) DO NOTHING;

-- Transport
INSERT INTO benefit_enrollments (tenant_id, employee_id, plan_id, status, dependent_ids)
VALUES
  ('d0000000-0000-0000-0000-000000000001','e0000000-0000-0000-0000-000000000002','b0000000-0000-0000-0000-000000000005','enrolled','[]'),
  ('d0000000-0000-0000-0000-000000000001','e0000000-0000-0000-0000-000000000003','b0000000-0000-0000-0000-000000000005','enrolled','[]'),
  ('d0000000-0000-0000-0000-000000000001','e0000000-0000-0000-0000-000000000005','b0000000-0000-0000-0000-000000000005','enrolled','[]'),
  ('d0000000-0000-0000-0000-000000000001','e0000000-0000-0000-0000-000000000008','b0000000-0000-0000-0000-000000000005','enrolled','[]'),
  ('d0000000-0000-0000-0000-000000000001','e0000000-0000-0000-0000-00000000000c','b0000000-0000-0000-0000-000000000005','enrolled','[]')
ON CONFLICT (tenant_id, employee_id, plan_id) DO NOTHING;


-- ──────────────────────────────────────────────────────────────
-- 3. TALENT MARKETPLACE — ROLES
-- ──────────────────────────────────────────────────────────────

INSERT INTO talent_roles (id, tenant_id, title, department, location, description,
  skills_required, experience_min, is_open, closes_at, created_by)
VALUES
  ('t0000000-0000-0000-0000-000000000001',
   'd0000000-0000-0000-0000-000000000001',
   'Senior Product Manager', 'Product', 'Bangalore / Remote',
   'Lead the roadmap for our flagship HRMS modules. You will work closely with engineering, design, and HR operations teams to define and ship high-impact features. Ideal for someone with a strong grasp of SaaS product cycles and a passion for workforce technology.',
   ARRAY['Product Strategy','Agile','Stakeholder Management','Roadmapping','Data Analysis'],
   4, true, (now() + interval '45 days')::date,
   'd0000000-0000-0000-0000-0000000000a1'),

  ('t0000000-0000-0000-0000-000000000002',
   'd0000000-0000-0000-0000-000000000001',
   'Engineering Lead — Platform', 'Engineering', 'Hyderabad',
   'Own the core infrastructure and API platform. Lead a team of 4–6 engineers, drive technical decisions, code reviews, and reliability improvements. Strong TypeScript and PostgreSQL background essential.',
   ARRAY['TypeScript','Node.js','PostgreSQL','System Design','Team Leadership'],
   6, true, (now() + interval '30 days')::date,
   'd0000000-0000-0000-0000-0000000000a1'),

  ('t0000000-0000-0000-0000-000000000003',
   'd0000000-0000-0000-0000-000000000001',
   'Data Scientist — People Analytics', 'Analytics', 'Bangalore',
   'Build predictive models for attrition, performance, and hiring. Work with HR data to surface actionable workforce insights. Experience with Python, scikit-learn, and time-series forecasting preferred.',
   ARRAY['Python','Machine Learning','SQL','Statistics','Data Visualisation'],
   3, true, (now() + interval '60 days')::date,
   'd0000000-0000-0000-0000-0000000000a1'),

  ('t0000000-0000-0000-0000-000000000004',
   'd0000000-0000-0000-0000-000000000001',
   'HR Business Partner — Technology', 'Human Resources', 'Pune / Remote',
   'Partner with the Technology division to manage talent, performance, and engagement. Act as a strategic advisor to technology leads and drive organisation-wide HR initiatives.',
   ARRAY['HRBP','Performance Management','Talent Development','Employee Relations'],
   5, true, (now() + interval '30 days')::date,
   'd0000000-0000-0000-0000-0000000000a1'),

  ('t0000000-0000-0000-0000-000000000005',
   'd0000000-0000-0000-0000-000000000001',
   'Finance Analyst — FP&A', 'Finance', 'Mumbai',
   'Own financial modelling, forecasting, and variance analysis for the SaaS business. Work with CFO on board presentations and investor reporting.',
   ARRAY['Financial Modelling','Excel','Power BI','FP&A','SQL'],
   3, false, null,
   'd0000000-0000-0000-0000-0000000000a1')
ON CONFLICT (id) DO NOTHING;


-- ──────────────────────────────────────────────────────────────
-- 4. TALENT MARKETPLACE — INTERESTS
-- (UNIQUE: role_id, employee_id)
-- ──────────────────────────────────────────────────────────────

-- Senior PM role
INSERT INTO talent_interests (tenant_id, role_id, employee_id, cover_note, skills, availability, status)
VALUES
  ('d0000000-0000-0000-0000-000000000001','t0000000-0000-0000-0000-000000000001',
   'e0000000-0000-0000-0000-000000000001',
   'I have been leading end-to-end feature discovery for the Attendance module over the past 18 months. Eager to take on a broader product scope.',
   ARRAY['Product Strategy','Agile','Data Analysis'], 'immediate', 'shortlisted'),

  ('d0000000-0000-0000-0000-000000000001','t0000000-0000-0000-0000-000000000001',
   'e0000000-0000-0000-0000-000000000004',
   'With my background in HR operations, I can bridge the gap between what HR teams need and what the product delivers.',
   ARRAY['Stakeholder Management','Roadmapping'], '1_month', 'interested'),

  ('d0000000-0000-0000-0000-000000000001','t0000000-0000-0000-0000-000000000001',
   'e0000000-0000-0000-0000-000000000006',
   'I have been involved in several cross-functional projects and feel ready to step into a product leadership role.',
   ARRAY['Agile','Data Analysis'], '3_months', 'interested'),

  ('d0000000-0000-0000-0000-000000000001','t0000000-0000-0000-0000-000000000001',
   'e0000000-0000-0000-0000-000000000009',
   'My experience in data analytics and understanding customer pain points translates well to a PM role.',
   ARRAY['Data Analysis','Stakeholder Management'], '1_month', 'not_selected')
ON CONFLICT (role_id, employee_id) DO NOTHING;

-- Engineering Lead role
INSERT INTO talent_interests (tenant_id, role_id, employee_id, cover_note, skills, availability, status)
VALUES
  ('d0000000-0000-0000-0000-000000000001','t0000000-0000-0000-0000-000000000002',
   'e0000000-0000-0000-0000-000000000002',
   'I have been architecting our microservices layer and leading code reviews informally. Ready to formalise this into a team lead role.',
   ARRAY['TypeScript','Node.js','PostgreSQL','System Design'], 'immediate', 'shortlisted'),

  ('d0000000-0000-0000-0000-000000000001','t0000000-0000-0000-0000-000000000002',
   'e0000000-0000-0000-0000-000000000005',
   'Six years of backend experience with a focus on high-availability systems. Looking for a leadership challenge.',
   ARRAY['TypeScript','PostgreSQL','System Design','Team Leadership'], '1_month', 'interested'),

  ('d0000000-0000-0000-0000-000000000001','t0000000-0000-0000-0000-000000000002',
   'e0000000-0000-0000-0000-000000000008',
   'Strong interest in taking ownership of the platform infrastructure.',
   ARRAY['Node.js','PostgreSQL'], '3_months', 'interested')
ON CONFLICT (role_id, employee_id) DO NOTHING;

-- Data Scientist role
INSERT INTO talent_interests (tenant_id, role_id, employee_id, cover_note, skills, availability, status)
VALUES
  ('d0000000-0000-0000-0000-000000000001','t0000000-0000-0000-0000-000000000003',
   'e0000000-0000-0000-0000-000000000003',
   'Completed two internal analytics projects using Python and trained a churn model. Deeply interested in people analytics.',
   ARRAY['Python','Machine Learning','SQL','Statistics'], '1_month', 'interested'),

  ('d0000000-0000-0000-0000-000000000001','t0000000-0000-0000-0000-000000000003',
   'e0000000-0000-0000-0000-00000000000b',
   'I hold a post-graduate diploma in data science and have been contributing to our BI dashboard.',
   ARRAY['Python','SQL','Data Visualisation'], '3_months', 'interested')
ON CONFLICT (role_id, employee_id) DO NOTHING;

-- HRBP role
INSERT INTO talent_interests (tenant_id, role_id, employee_id, cover_note, skills, availability, status)
VALUES
  ('d0000000-0000-0000-0000-000000000001','t0000000-0000-0000-0000-000000000004',
   'e0000000-0000-0000-0000-000000000007',
   'HRBP for the Operations function for the past two years. Ready to partner with the Technology division.',
   ARRAY['HRBP','Performance Management','Employee Relations'], 'immediate', 'selected'),

  ('d0000000-0000-0000-0000-000000000001','t0000000-0000-0000-0000-000000000004',
   'e0000000-0000-0000-0000-00000000000c',
   'Strong interest in moving into an HRBP role from my current generalist position.',
   ARRAY['Talent Development','HRBP'], '1_month', 'withdrawn')
ON CONFLICT (role_id, employee_id) DO NOTHING;


-- ──────────────────────────────────────────────────────────────
-- 5. SUCCESSION PLANS  (safe idempotent with ON CONFLICT)
-- ──────────────────────────────────────────────────────────────

INSERT INTO succession_plans (id, tenant_id, position_title, department, incumbent_id,
  risk_level, status, notes, created_by)
VALUES
  ('s0000000-0000-0000-0000-000000000001',
   'd0000000-0000-0000-0000-000000000001',
   'Chief Operating Officer', 'Operations',
   'e0000000-0000-0000-0000-000000000001',
   'critical', 'active',
   'Priya is the key decision-maker for all operations. Succession coverage is essential before Series B fundraise.',
   'd0000000-0000-0000-0000-0000000000a1'),

  ('s0000000-0000-0000-0000-000000000002',
   'd0000000-0000-0000-0000-000000000001',
   'Head of Engineering', 'Engineering',
   'e0000000-0000-0000-0000-000000000005',
   'high', 'active',
   'Arjun leads the 40-person engineering org. Two strong internal candidates identified.',
   'd0000000-0000-0000-0000-0000000000a1'),

  ('s0000000-0000-0000-0000-000000000003',
   'd0000000-0000-0000-0000-000000000001',
   'Head of Sales', 'Sales',
   'e0000000-0000-0000-0000-00000000000c',
   'medium', 'active',
   'Karan heads enterprise sales. Building a pipeline of successors from the regional leads.',
   'd0000000-0000-0000-0000-0000000000a1')
ON CONFLICT (id) DO NOTHING;


-- ──────────────────────────────────────────────────────────────
-- 6. SUCCESSION CANDIDATES  (safe per-row check)
-- ──────────────────────────────────────────────────────────────

DO $$
DECLARE
  sp_coo  UUID := 's0000000-0000-0000-0000-000000000001';
  sp_eng  UUID := 's0000000-0000-0000-0000-000000000002';
  sp_sales UUID := 's0000000-0000-0000-0000-000000000003';
  v_tenant UUID := 'd0000000-0000-0000-0000-000000000001';
  v_admin  UUID := 'd0000000-0000-0000-0000-0000000000a1';
  e02 UUID := 'e0000000-0000-0000-0000-000000000002';
  e03 UUID := 'e0000000-0000-0000-0000-000000000003';
  e04 UUID := 'e0000000-0000-0000-0000-000000000004';
  e06 UUID := 'e0000000-0000-0000-0000-000000000006';
  e08 UUID := 'e0000000-0000-0000-0000-000000000008';
  e09 UUID := 'e0000000-0000-0000-0000-000000000009';
  e0b UUID := 'e0000000-0000-0000-0000-00000000000b';
  cand_id UUID;
BEGIN

  -- COO: Deepak Nair
  IF NOT EXISTS (SELECT 1 FROM succession_candidates WHERE plan_id=sp_coo AND employee_id=e03 AND tenant_id=v_tenant) THEN
    INSERT INTO succession_candidates (tenant_id, plan_id, employee_id, readiness_level, readiness_score,
      nine_box_performance, nine_box_potential,
      score_performance, score_skill_gap, score_leadership, score_mobility, score_tenure, score_attrition_risk,
      attrition_risk_flag, strengths, gaps, development_plan, notes, nominated_by)
    VALUES (v_tenant, sp_coo, e03, 'ready_1_2_years', 78,
      3, 3, 8.2, 7.5, 8.8, 7.0, 8.5, 2.5, false,
      'Exceptional cross-functional leadership. Proven delivery on scale. Strong executive presence.',
      'Limited P&L ownership. No board-level exposure yet.',
      'CFO shadowing program Q1. External executive coaching. Lead one board presentation per quarter.',
      'Top internal candidate for COO succession.', v_admin);
  END IF;

  -- COO: Nandini Rao
  IF NOT EXISTS (SELECT 1 FROM succession_candidates WHERE plan_id=sp_coo AND employee_id=e06 AND tenant_id=v_tenant) THEN
    INSERT INTO succession_candidates (tenant_id, plan_id, employee_id, readiness_level, readiness_score,
      nine_box_performance, nine_box_potential,
      score_performance, score_skill_gap, score_leadership, score_mobility, score_tenure, score_attrition_risk,
      attrition_risk_flag, strengths, gaps, development_plan, notes, nominated_by)
    VALUES (v_tenant, sp_coo, e06, 'ready_3_5_years', 62,
      3, 2, 7.0, 6.0, 7.5, 6.5, 7.0, 3.5, false,
      'Outstanding stakeholder management. Deep domain expertise in HR and compliance.',
      'Engineering / technical org management experience limited. Finance exposure needed.',
      'Rotation into Product function for 6 months. P&L mini-pilot for HR department budget.',
      'Strong culture carrier. Long-term COO pipeline.', v_admin);
  END IF;

  -- Engineering: Rahul Verma
  IF NOT EXISTS (SELECT 1 FROM succession_candidates WHERE plan_id=sp_eng AND employee_id=e02 AND tenant_id=v_tenant) THEN
    INSERT INTO succession_candidates (tenant_id, plan_id, employee_id, readiness_level, readiness_score,
      nine_box_performance, nine_box_potential,
      score_performance, score_skill_gap, score_leadership, score_mobility, score_tenure, score_attrition_risk,
      attrition_risk_flag, strengths, gaps, development_plan, notes, nominated_by)
    VALUES (v_tenant, sp_eng, e02, 'ready_now', 91,
      3, 3, 9.2, 8.8, 8.5, 9.0, 8.0, 1.5, false,
      'Outstanding architect. Mentors junior engineers organically. Highly regarded by team.',
      'Limited experience managing distributed teams across time zones.',
      'Lead next hiring cycle. Present at 2 external engineering conferences.',
      'Ready to step in immediately if needed.', v_admin);
  END IF;

  -- Engineering: Vikram Singh
  IF NOT EXISTS (SELECT 1 FROM succession_candidates WHERE plan_id=sp_eng AND employee_id=e08 AND tenant_id=v_tenant) THEN
    INSERT INTO succession_candidates (tenant_id, plan_id, employee_id, readiness_level, readiness_score,
      nine_box_performance, nine_box_potential,
      score_performance, score_skill_gap, score_leadership, score_mobility, score_tenure, score_attrition_risk,
      attrition_risk_flag, strengths, gaps, development_plan, notes, nominated_by)
    VALUES (v_tenant, sp_eng, e08, 'ready_1_2_years', 74,
      2, 3, 7.5, 7.0, 6.5, 8.0, 7.0, 2.0, false,
      'Technically very strong. High potential. Proactively upskilling in system design.',
      'Leadership and conflict-resolution skills need development.',
      'Assigned as engineering lead for Q3 product sprint. Leadership coaching once a month.',
      'Fast-tracker. Will be ready in 12–18 months with right coaching.', v_admin);
  END IF;

  -- Engineering: Ananya Iyer
  IF NOT EXISTS (SELECT 1 FROM succession_candidates WHERE plan_id=sp_eng AND employee_id=e0b AND tenant_id=v_tenant) THEN
    INSERT INTO succession_candidates (tenant_id, plan_id, employee_id, readiness_level, readiness_score,
      nine_box_performance, nine_box_potential,
      score_performance, score_skill_gap, score_leadership, score_mobility, score_tenure, score_attrition_risk,
      attrition_risk_flag, strengths, gaps, development_plan, notes, nominated_by)
    VALUES (v_tenant, sp_eng, e0b, 'ready_3_5_years', 55,
      2, 2, 6.5, 5.5, 5.0, 6.0, 6.0, 4.0, false,
      'Solid individual contributor. Strong in ML/Data engineering stack.',
      'No team management experience. Needs broader business understanding.',
      'Pair with Arjun for architecture reviews. Include in quarterly business reviews.',
      'Long-term pipeline candidate.', v_admin);
  END IF;

  -- Sales: Sneha Pillai
  IF NOT EXISTS (SELECT 1 FROM succession_candidates WHERE plan_id=sp_sales AND employee_id=e04 AND tenant_id=v_tenant) THEN
    INSERT INTO succession_candidates (tenant_id, plan_id, employee_id, readiness_level, readiness_score,
      nine_box_performance, nine_box_potential,
      score_performance, score_skill_gap, score_leadership, score_mobility, score_tenure, score_attrition_risk,
      attrition_risk_flag, strengths, gaps, development_plan, notes, nominated_by)
    VALUES (v_tenant, sp_sales, e04, 'ready_1_2_years', 82,
      3, 2, 8.5, 7.0, 8.0, 7.5, 8.5, 2.0, false,
      'Consistently exceeds quota. Excellent client relationships. Natural team leader.',
      'Limited exposure to enterprise / key account strategy at scale.',
      'Shadow Karan on 3 enterprise RFP responses. Co-present at next QBR.',
      'Strong regional lead — clear succession track for Head of Sales.', v_admin);
  END IF;

  -- Sales: Kavya Reddy
  IF NOT EXISTS (SELECT 1 FROM succession_candidates WHERE plan_id=sp_sales AND employee_id=e09 AND tenant_id=v_tenant) THEN
    INSERT INTO succession_candidates (tenant_id, plan_id, employee_id, readiness_level, readiness_score,
      nine_box_performance, nine_box_potential,
      score_performance, score_skill_gap, score_leadership, score_mobility, score_tenure, score_attrition_risk,
      attrition_risk_flag, strengths, gaps, development_plan, notes, nominated_by)
    VALUES (v_tenant, sp_sales, e09, 'ready_3_5_years', 66,
      2, 3, 7.0, 6.5, 6.0, 7.0, 6.5, 3.0, false,
      'High potential. Fast learner. Impressive pipeline growth in South India territory.',
      'Leadership skills early stage. Needs cross-functional exposure.',
      'Assigned as acting team lead for two quarters. Paired with external sales coach.',
      'Future pipeline for Head of Sales once more management experience is gained.', v_admin);
  END IF;

  -- ── IDP Actions ────────────────────────────────────────────

  -- Rahul's IDP (Engineering Lead candidate)
  SELECT id INTO cand_id FROM succession_candidates
    WHERE plan_id=sp_eng AND employee_id=e02 AND tenant_id=v_tenant;
  IF cand_id IS NOT NULL THEN
    INSERT INTO succession_idp_actions (tenant_id, candidate_id, action_type, description, target_date, created_by)
    VALUES
      (v_tenant, cand_id, 'assignment', 'Lead engineering hiring cycle for FY2026 — own JD, interviews, offers',
       now() + interval '3 months', v_admin),
      (v_tenant, cand_id, 'course',     'Distributed Systems Leadership — O''Reilly online course',
       now() + interval '2 months', v_admin)
    ON CONFLICT DO NOTHING;
  END IF;

  -- Deepak's IDP (COO candidate)
  SELECT id INTO cand_id FROM succession_candidates
    WHERE plan_id=sp_coo AND employee_id=e03 AND tenant_id=v_tenant;
  IF cand_id IS NOT NULL THEN
    INSERT INTO succession_idp_actions (tenant_id, candidate_id, action_type, description, target_date, created_by)
    VALUES
      (v_tenant, cand_id, 'mentoring',     'Executive coaching with external coach — bi-weekly for 6 months',
       now() + interval '6 months', v_admin),
      (v_tenant, cand_id, 'assignment',    'Own department budget for HR — P&L mini-pilot',
       now() + interval '4 months', v_admin),
      (v_tenant, cand_id, 'certification', 'XLRI General Management Programme',
       now() + interval '12 months', v_admin)
    ON CONFLICT DO NOTHING;
  END IF;

  -- Sneha's IDP (Sales Lead candidate)
  SELECT id INTO cand_id FROM succession_candidates
    WHERE plan_id=sp_sales AND employee_id=e04 AND tenant_id=v_tenant;
  IF cand_id IS NOT NULL THEN
    INSERT INTO succession_idp_actions (tenant_id, candidate_id, action_type, description, target_date, created_by)
    VALUES
      (v_tenant, cand_id, 'assignment', 'Co-present at Q3 Quarterly Business Review with Karan',
       now() + interval '2 months', v_admin),
      (v_tenant, cand_id, 'course',     'Enterprise Sales Strategy — LinkedIn Learning',
       now() + interval '1 month',  v_admin)
    ON CONFLICT DO NOTHING;
  END IF;

END $$;
