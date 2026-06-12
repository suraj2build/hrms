-- ═══════════════════════════════════════════════════════════════════════════════
-- 240_recruitment_ats.sql
-- Recruitment & Applicant Tracking System (ATS) — full schema
--   recruitment_pipeline_stages  — tenant-configurable Kanban stages
--   job_requisitions             — open roles + approval workflow
--   candidates                   — applicant master (reusable across reqs)
--   applications                 — one per candidate×requisition; owns Kanban pos
--   application_activity_log     — immutable move trail
--   interview_rounds             — scheduled interviews per application
--   interview_panel              — round ↔ interviewers (junction)
--   interview_scores             — per-interviewer scorecard
--   qb_categories / qb_items     — interview question bank
--   recruitment_offer_letters    — generated offer PDFs, acceptance tracking
-- ═══════════════════════════════════════════════════════════════════════════════

-- ── Pipeline Stages ───────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS recruitment_pipeline_stages (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   UUID        NOT NULL,
  name        TEXT        NOT NULL,
  stage_order INT         NOT NULL,
  stage_type  TEXT        NOT NULL DEFAULT 'other'
              CHECK (stage_type IN ('applied','screening','assessment','technical','hr','final','offer','other')),
  color       TEXT        NOT NULL DEFAULT '#6B7280',
  is_system   BOOLEAN     NOT NULL DEFAULT false,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, stage_order)
);

CREATE INDEX IF NOT EXISTS idx_rps_tenant
  ON recruitment_pipeline_stages (tenant_id, stage_order);

ALTER TABLE recruitment_pipeline_stages ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS rps_tenant_iso ON recruitment_pipeline_stages;
CREATE POLICY rps_tenant_iso ON recruitment_pipeline_stages
  USING  (tenant_id = get_user_tenant_id())
  WITH CHECK (tenant_id = get_user_tenant_id());

-- ── Job Requisitions ──────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS job_requisitions (
  id              UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       UUID          NOT NULL,
  title           TEXT          NOT NULL,
  department_id   UUID          REFERENCES departments(id) ON DELETE SET NULL,
  location        TEXT,
  employment_type TEXT          NOT NULL DEFAULT 'full_time'
                  CHECK (employment_type IN ('full_time','part_time','contract','intern')),
  openings        INT           NOT NULL DEFAULT 1 CHECK (openings > 0),
  jd_text         TEXT,
  required_skills TEXT[],
  min_experience  NUMERIC(4,1),
  max_experience  NUMERIC(4,1),
  salary_min      NUMERIC(14,2),
  salary_max      NUMERIC(14,2),
  status          TEXT          NOT NULL DEFAULT 'draft'
                  CHECK (status IN ('draft','open','on_hold','filled','cancelled')),
  raised_by       UUID          REFERENCES profiles(id) ON DELETE SET NULL,
  approved_by     UUID          REFERENCES profiles(id) ON DELETE SET NULL,
  approved_at     TIMESTAMPTZ,
  target_date     DATE,
  created_at      TIMESTAMPTZ   NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ   NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_jr_tenant_status
  ON job_requisitions (tenant_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_jr_tenant_dept
  ON job_requisitions (tenant_id, department_id);

CREATE OR REPLACE FUNCTION trg_jr_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at := now(); RETURN NEW; END; $$;

DROP TRIGGER IF EXISTS trg_jr_updated_at ON job_requisitions;
CREATE TRIGGER trg_jr_updated_at BEFORE UPDATE ON job_requisitions
  FOR EACH ROW EXECUTE FUNCTION trg_jr_updated_at();

ALTER TABLE job_requisitions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS jr_tenant_iso ON job_requisitions;
CREATE POLICY jr_tenant_iso ON job_requisitions
  USING  (tenant_id = get_user_tenant_id())
  WITH CHECK (tenant_id = get_user_tenant_id());

-- ── Candidates ────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS candidates (
  id               UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id        UUID          NOT NULL,
  first_name       TEXT          NOT NULL,
  last_name        TEXT          NOT NULL,
  email            TEXT          NOT NULL,
  phone            TEXT,
  resume_url       TEXT,
  linkedin_url     TEXT,
  current_company  TEXT,
  current_title    TEXT,
  total_experience NUMERIC(4,1),
  source           TEXT          NOT NULL DEFAULT 'direct'
                   CHECK (source IN ('direct','referral','portal','agency','linkedin','naukri','indeed','other')),
  referral_by      UUID          REFERENCES employees(id) ON DELETE SET NULL,
  notes            TEXT,
  created_at       TIMESTAMPTZ   NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ   NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, email)
);

CREATE INDEX IF NOT EXISTS idx_cand_tenant
  ON candidates (tenant_id, created_at DESC);

CREATE OR REPLACE FUNCTION trg_cand_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at := now(); RETURN NEW; END; $$;

DROP TRIGGER IF EXISTS trg_cand_updated_at ON candidates;
CREATE TRIGGER trg_cand_updated_at BEFORE UPDATE ON candidates
  FOR EACH ROW EXECUTE FUNCTION trg_cand_updated_at();

ALTER TABLE candidates ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS cand_tenant_iso ON candidates;
CREATE POLICY cand_tenant_iso ON candidates
  USING  (tenant_id = get_user_tenant_id())
  WITH CHECK (tenant_id = get_user_tenant_id());

-- ── Applications ──────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS applications (
  id               UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id        UUID          NOT NULL,
  requisition_id   UUID          NOT NULL REFERENCES job_requisitions(id) ON DELETE CASCADE,
  candidate_id     UUID          NOT NULL REFERENCES candidates(id) ON DELETE CASCADE,
  stage_id         UUID          REFERENCES recruitment_pipeline_stages(id) ON DELETE SET NULL,
  status           TEXT          NOT NULL DEFAULT 'applied'
                   CHECK (status IN ('applied','screening','interviewing','offer','hired','rejected','withdrawn')),
  overall_score    INT           CHECK (overall_score BETWEEN 1 AND 10),
  rejection_reason TEXT,
  offer_amount     NUMERIC(14,2),
  offer_date       DATE,
  offer_accepted   BOOLEAN,
  expected_joining DATE,
  assigned_to      UUID          REFERENCES profiles(id) ON DELETE SET NULL,
  created_at       TIMESTAMPTZ   NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ   NOT NULL DEFAULT now(),
  UNIQUE (requisition_id, candidate_id)
);

CREATE INDEX IF NOT EXISTS idx_app_tenant_req
  ON applications (tenant_id, requisition_id, status);
CREATE INDEX IF NOT EXISTS idx_app_tenant_stage
  ON applications (tenant_id, stage_id, status);
CREATE INDEX IF NOT EXISTS idx_app_candidate
  ON applications (tenant_id, candidate_id);

CREATE OR REPLACE FUNCTION trg_app_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at := now(); RETURN NEW; END; $$;

DROP TRIGGER IF EXISTS trg_app_updated_at ON applications;
CREATE TRIGGER trg_app_updated_at BEFORE UPDATE ON applications
  FOR EACH ROW EXECUTE FUNCTION trg_app_updated_at();

ALTER TABLE applications ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS app_tenant_iso ON applications;
CREATE POLICY app_tenant_iso ON applications
  USING  (tenant_id = get_user_tenant_id())
  WITH CHECK (tenant_id = get_user_tenant_id());

-- ── Application Activity Log ──────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS application_activity_log (
  id             UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id      UUID          NOT NULL,
  application_id UUID          NOT NULL REFERENCES applications(id) ON DELETE CASCADE,
  from_stage_id  UUID          REFERENCES recruitment_pipeline_stages(id) ON DELETE SET NULL,
  to_stage_id    UUID          REFERENCES recruitment_pipeline_stages(id) ON DELETE SET NULL,
  from_status    TEXT,
  to_status      TEXT,
  actor_id       UUID          REFERENCES profiles(id) ON DELETE SET NULL,
  note           TEXT,
  created_at     TIMESTAMPTZ   NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_aal_tenant_app
  ON application_activity_log (tenant_id, application_id, created_at DESC);

ALTER TABLE application_activity_log ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS aal_tenant_iso ON application_activity_log;
CREATE POLICY aal_tenant_iso ON application_activity_log
  USING  (tenant_id = get_user_tenant_id())
  WITH CHECK (tenant_id = get_user_tenant_id());

-- ── Interview Rounds ──────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS interview_rounds (
  id             UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id      UUID          NOT NULL,
  application_id UUID          NOT NULL REFERENCES applications(id) ON DELETE CASCADE,
  stage_id       UUID          REFERENCES recruitment_pipeline_stages(id) ON DELETE SET NULL,
  round_number   INT           NOT NULL DEFAULT 1,
  title          TEXT,
  interview_type TEXT          NOT NULL DEFAULT 'video'
                 CHECK (interview_type IN ('video','phone','in_person','assignment')),
  scheduled_at   TIMESTAMPTZ,
  duration_mins  INT           DEFAULT 60,
  meet_link      TEXT,
  status         TEXT          NOT NULL DEFAULT 'scheduled'
                 CHECK (status IN ('scheduled','completed','cancelled','no_show')),
  notes          TEXT,
  created_by     UUID          REFERENCES profiles(id) ON DELETE SET NULL,
  created_at     TIMESTAMPTZ   NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ   NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_ir_tenant_app
  ON interview_rounds (tenant_id, application_id);
CREATE INDEX IF NOT EXISTS idx_ir_scheduled
  ON interview_rounds (tenant_id, scheduled_at);

CREATE OR REPLACE FUNCTION trg_ir_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at := now(); RETURN NEW; END; $$;

DROP TRIGGER IF EXISTS trg_ir_updated_at ON interview_rounds;
CREATE TRIGGER trg_ir_updated_at BEFORE UPDATE ON interview_rounds
  FOR EACH ROW EXECUTE FUNCTION trg_ir_updated_at();

ALTER TABLE interview_rounds ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS ir_tenant_iso ON interview_rounds;
CREATE POLICY ir_tenant_iso ON interview_rounds
  USING  (tenant_id = get_user_tenant_id())
  WITH CHECK (tenant_id = get_user_tenant_id());

-- ── Interview Panel ───────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS interview_panel (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id      UUID NOT NULL,
  round_id       UUID NOT NULL REFERENCES interview_rounds(id) ON DELETE CASCADE,
  interviewer_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  UNIQUE (round_id, interviewer_id)
);

CREATE INDEX IF NOT EXISTS idx_ip_round ON interview_panel (round_id);
CREATE INDEX IF NOT EXISTS idx_ip_interviewer ON interview_panel (tenant_id, interviewer_id);

ALTER TABLE interview_panel ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS ip_tenant_iso ON interview_panel;
CREATE POLICY ip_tenant_iso ON interview_panel
  USING  (tenant_id = get_user_tenant_id())
  WITH CHECK (tenant_id = get_user_tenant_id());

-- ── Interview Scores ──────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS interview_scores (
  id                  UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id           UUID          NOT NULL,
  round_id            UUID          NOT NULL REFERENCES interview_rounds(id) ON DELETE CASCADE,
  interviewer_id      UUID          NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  technical_score     INT           CHECK (technical_score BETWEEN 1 AND 5),
  communication_score INT           CHECK (communication_score BETWEEN 1 AND 5),
  culture_score       INT           CHECK (culture_score BETWEEN 1 AND 5),
  overall_score       INT           CHECK (overall_score BETWEEN 1 AND 5),
  recommendation      TEXT          CHECK (recommendation IN ('strong_yes','yes','maybe','no','strong_no')),
  notes               TEXT,
  submitted_at        TIMESTAMPTZ   NOT NULL DEFAULT now(),
  UNIQUE (round_id, interviewer_id)
);

CREATE INDEX IF NOT EXISTS idx_is_round ON interview_scores (round_id);

ALTER TABLE interview_scores ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS is_tenant_iso ON interview_scores;
CREATE POLICY is_tenant_iso ON interview_scores
  USING  (tenant_id = get_user_tenant_id())
  WITH CHECK (tenant_id = get_user_tenant_id());

-- ── Question Bank ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS qb_categories (
  id            UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     UUID          NOT NULL,
  name          TEXT          NOT NULL,
  department_id UUID          REFERENCES departments(id) ON DELETE SET NULL,
  category_type TEXT          NOT NULL DEFAULT 'technical'
                CHECK (category_type IN ('technical','behavioural','domain','situational','general')),
  created_at    TIMESTAMPTZ   NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, name)
);

ALTER TABLE qb_categories ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS qbc_tenant_iso ON qb_categories;
CREATE POLICY qbc_tenant_iso ON qb_categories
  USING  (tenant_id = get_user_tenant_id())
  WITH CHECK (tenant_id = get_user_tenant_id());

CREATE TABLE IF NOT EXISTS qb_items (
  id           UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    UUID          NOT NULL,
  category_id  UUID          NOT NULL REFERENCES qb_categories(id) ON DELETE CASCADE,
  question     TEXT          NOT NULL,
  model_answer TEXT,
  difficulty   TEXT          NOT NULL DEFAULT 'medium'
               CHECK (difficulty IN ('easy','medium','hard')),
  tags         TEXT[],
  is_active    BOOLEAN       NOT NULL DEFAULT true,
  created_by   UUID          REFERENCES profiles(id) ON DELETE SET NULL,
  created_at   TIMESTAMPTZ   NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ   NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_qbi_category ON qb_items (category_id, is_active);

CREATE OR REPLACE FUNCTION trg_qbi_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at := now(); RETURN NEW; END; $$;

DROP TRIGGER IF EXISTS trg_qbi_updated_at ON qb_items;
CREATE TRIGGER trg_qbi_updated_at BEFORE UPDATE ON qb_items
  FOR EACH ROW EXECUTE FUNCTION trg_qbi_updated_at();

ALTER TABLE qb_items ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS qbi_tenant_iso ON qb_items;
CREATE POLICY qbi_tenant_iso ON qb_items
  USING  (tenant_id = get_user_tenant_id())
  WITH CHECK (tenant_id = get_user_tenant_id());

-- ── Offer Letters ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS recruitment_offer_letters (
  id             UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id      UUID          NOT NULL,
  application_id UUID          NOT NULL REFERENCES applications(id) ON DELETE CASCADE,
  candidate_id   UUID          NOT NULL REFERENCES candidates(id) ON DELETE CASCADE,
  requisition_id UUID          NOT NULL REFERENCES job_requisitions(id) ON DELETE CASCADE,
  offered_amount NUMERIC(14,2) NOT NULL,
  joining_date   DATE          NOT NULL,
  valid_until    DATE,
  status         TEXT          NOT NULL DEFAULT 'draft'
                 CHECK (status IN ('draft','sent','accepted','declined','expired','revoked')),
  html_content   TEXT,
  accepted_at    TIMESTAMPTZ,
  declined_at    TIMESTAMPTZ,
  created_by     UUID          REFERENCES profiles(id) ON DELETE SET NULL,
  created_at     TIMESTAMPTZ   NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ   NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_rol_tenant
  ON recruitment_offer_letters (tenant_id, status);

CREATE OR REPLACE FUNCTION trg_rol_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at := now(); RETURN NEW; END; $$;

DROP TRIGGER IF EXISTS trg_rol_updated_at ON recruitment_offer_letters;
CREATE TRIGGER trg_rol_updated_at BEFORE UPDATE ON recruitment_offer_letters
  FOR EACH ROW EXECUTE FUNCTION trg_rol_updated_at();

ALTER TABLE recruitment_offer_letters ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS rol_tenant_iso ON recruitment_offer_letters;
CREATE POLICY rol_tenant_iso ON recruitment_offer_letters
  USING  (tenant_id = get_user_tenant_id())
  WITH CHECK (tenant_id = get_user_tenant_id());
