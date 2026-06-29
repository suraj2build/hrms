-- Migration 326: Mood Check-ins + Pulse Polls
--
-- mood_checkins   — one per employee per calendar day (1-5 score + optional note)
-- pulse_questions — short HR-created polls (options or free text)
-- pulse_responses — one response per employee per question

-- ── mood_checkins ─────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS mood_checkins (
  id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     UUID        NOT NULL REFERENCES tenants(id)   ON DELETE CASCADE,
  employee_id   UUID        NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  mood          SMALLINT    NOT NULL CHECK (mood BETWEEN 1 AND 5),
  note          TEXT,
  checkin_date  DATE        NOT NULL DEFAULT CURRENT_DATE,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, employee_id, checkin_date)
);

CREATE INDEX IF NOT EXISTS idx_mood_checkins_tenant_date
  ON mood_checkins(tenant_id, checkin_date DESC);

CREATE INDEX IF NOT EXISTS idx_mood_checkins_employee
  ON mood_checkins(tenant_id, employee_id, checkin_date DESC);

-- ── pulse_questions ───────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS pulse_questions (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   UUID        NOT NULL REFERENCES tenants(id)  ON DELETE CASCADE,
  question    TEXT        NOT NULL,
  options     JSONB,               -- array of strings; NULL = free-text response
  status      TEXT        NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft','active','closed')),
  starts_at   TIMESTAMPTZ,
  ends_at     TIMESTAMPTZ,
  created_by  UUID        REFERENCES profiles(id) ON DELETE SET NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_pulse_questions_tenant_status
  ON pulse_questions(tenant_id, status);

-- ── pulse_responses ───────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS pulse_responses (
  id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    UUID        NOT NULL REFERENCES tenants(id)        ON DELETE CASCADE,
  question_id  UUID        NOT NULL REFERENCES pulse_questions(id) ON DELETE CASCADE,
  employee_id  UUID        NOT NULL REFERENCES employees(id)      ON DELETE CASCADE,
  response     TEXT        NOT NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, question_id, employee_id)
);

CREATE INDEX IF NOT EXISTS idx_pulse_responses_question
  ON pulse_responses(tenant_id, question_id);

-- ── updated_at trigger ────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION update_pulse_questions_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_pulse_questions_updated_at ON pulse_questions;
CREATE TRIGGER trg_pulse_questions_updated_at
  BEFORE UPDATE ON pulse_questions
  FOR EACH ROW EXECUTE FUNCTION update_pulse_questions_updated_at();

-- ── Row-level security ────────────────────────────────────────────────────────

ALTER TABLE mood_checkins    ENABLE ROW LEVEL SECURITY;
ALTER TABLE pulse_questions  ENABLE ROW LEVEL SECURITY;
ALTER TABLE pulse_responses  ENABLE ROW LEVEL SECURITY;

-- Mood check-ins: employees manage their own; HR admin reads all
DROP POLICY IF EXISTS "mood_employee_own" ON mood_checkins;
CREATE POLICY "mood_employee_own" ON mood_checkins FOR ALL
  USING (tenant_id = get_user_tenant_id());

-- Pulse questions: HR admin full control; others read active only
DROP POLICY IF EXISTS "pulse_q_admin_all" ON pulse_questions;
CREATE POLICY "pulse_q_admin_all" ON pulse_questions FOR ALL
  USING (tenant_id = get_user_tenant_id()
         AND get_user_role() IN ('super_admin','hr_admin'));

DROP POLICY IF EXISTS "pulse_q_employee_read" ON pulse_questions;
CREATE POLICY "pulse_q_employee_read" ON pulse_questions FOR SELECT
  USING (tenant_id = get_user_tenant_id() AND status = 'active');

-- Pulse responses: employees manage their own; HR admin reads all
DROP POLICY IF EXISTS "pulse_resp_tenant_all" ON pulse_responses;
CREATE POLICY "pulse_resp_tenant_all" ON pulse_responses FOR ALL
  USING (tenant_id = get_user_tenant_id());
