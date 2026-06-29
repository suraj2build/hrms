-- Migration 329: Succession Planning Foundation
--
-- succession_plans  — per-position succession plan with risk assessment
-- succession_candidates — candidate pool per plan with readiness scores

CREATE TABLE IF NOT EXISTS succession_plans (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       UUID        NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  position_title  TEXT        NOT NULL,
  department      TEXT,
  incumbent_id    UUID        REFERENCES employees(id) ON DELETE SET NULL,
  risk_level      TEXT        NOT NULL DEFAULT 'medium'
    CHECK (risk_level IN ('low', 'medium', 'high', 'critical')),
  notes           TEXT,
  status          TEXT        NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'archived')),
  created_by      UUID        REFERENCES profiles(id) ON DELETE SET NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_succession_plans_tenant
  ON succession_plans(tenant_id, status);

CREATE TABLE IF NOT EXISTS succession_candidates (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       UUID        NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  plan_id         UUID        NOT NULL REFERENCES succession_plans(id) ON DELETE CASCADE,
  employee_id     UUID        NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  readiness_level TEXT        NOT NULL DEFAULT 'ready_3_5_years'
    CHECK (readiness_level IN ('ready_now', 'ready_1_2_years', 'ready_3_5_years')),
  readiness_score SMALLINT    CHECK (readiness_score BETWEEN 0 AND 100),
  strengths       TEXT,
  gaps            TEXT,
  development_plan TEXT,
  notes           TEXT,
  nominated_by    UUID        REFERENCES profiles(id) ON DELETE SET NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (plan_id, employee_id)
);

CREATE INDEX IF NOT EXISTS idx_succession_candidates_plan
  ON succession_candidates(tenant_id, plan_id);

CREATE INDEX IF NOT EXISTS idx_succession_candidates_employee
  ON succession_candidates(tenant_id, employee_id);

-- Updated_at triggers
CREATE OR REPLACE FUNCTION update_succession_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END; $$;

DROP TRIGGER IF EXISTS trg_succession_plans_updated_at ON succession_plans;
CREATE TRIGGER trg_succession_plans_updated_at
  BEFORE UPDATE ON succession_plans
  FOR EACH ROW EXECUTE FUNCTION update_succession_updated_at();

DROP TRIGGER IF EXISTS trg_succession_candidates_updated_at ON succession_candidates;
CREATE TRIGGER trg_succession_candidates_updated_at
  BEFORE UPDATE ON succession_candidates
  FOR EACH ROW EXECUTE FUNCTION update_succession_updated_at();

-- RLS
ALTER TABLE succession_plans        ENABLE ROW LEVEL SECURITY;
ALTER TABLE succession_candidates   ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "succession_plans_admin" ON succession_plans;
CREATE POLICY "succession_plans_admin" ON succession_plans FOR ALL
  USING (tenant_id = get_user_tenant_id()
         AND get_user_role() IN ('super_admin', 'hr_admin'));

DROP POLICY IF EXISTS "succession_candidates_admin" ON succession_candidates;
CREATE POLICY "succession_candidates_admin" ON succession_candidates FOR ALL
  USING (tenant_id = get_user_tenant_id()
         AND get_user_role() IN ('super_admin', 'hr_admin'));
