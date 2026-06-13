-- ============================================================
-- 243_benefits_enrolment.sql
--
-- ESS-05: Benefits enrolment (distinct from FBP tax module).
--
--   benefit_plans        — HR-defined benefit products (group health, term
--                          life, accident, wellness, meal/transport, etc.),
--                          with cost split + an optional enrolment window.
--   benefit_enrollments  — an employee's election for a plan (enrolled/waived),
--                          including which dependents (employee_family rows)
--                          are covered.
--
-- Idempotent — safe to re-run.
-- ============================================================

-- ── 1. Benefit plans ──────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS benefit_plans (
  id                  UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id           UUID        NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name                TEXT        NOT NULL,
  plan_type           TEXT        NOT NULL DEFAULT 'health'
                                  CHECK (plan_type IN ('health','term_life','accident','wellness','meal','transport','other')),
  provider            TEXT,
  description         TEXT,
  coverage_amount     NUMERIC(14,2) NOT NULL DEFAULT 0,   -- sum assured / cover value
  employee_cost       NUMERIC(12,2) NOT NULL DEFAULT 0,   -- annual employee contribution
  employer_cost       NUMERIC(12,2) NOT NULL DEFAULT 0,   -- annual employer contribution
  allows_dependents   BOOLEAN     NOT NULL DEFAULT false,
  enrollment_opens_at  DATE,                               -- NULL = always open
  enrollment_closes_at DATE,
  is_active           BOOLEAN     NOT NULL DEFAULT true,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by          UUID
);

CREATE INDEX IF NOT EXISTS idx_benefit_plans_tenant
  ON benefit_plans (tenant_id, is_active);

ALTER TABLE benefit_plans ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS benefit_plans_tenant_isolation ON benefit_plans;
CREATE POLICY benefit_plans_tenant_isolation
  ON benefit_plans FOR ALL
  USING (tenant_id = (SELECT tenant_id FROM profiles WHERE id = auth.uid() LIMIT 1));

-- ── 2. Employee enrolments ────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS benefit_enrollments (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       UUID        NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  employee_id     UUID        NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  plan_id         UUID        NOT NULL REFERENCES benefit_plans(id) ON DELETE CASCADE,
  status          TEXT        NOT NULL DEFAULT 'enrolled'
                              CHECK (status IN ('enrolled','waived')),
  dependent_ids   JSONB       NOT NULL DEFAULT '[]'::jsonb,   -- employee_family ids covered
  notes           TEXT,
  enrolled_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, employee_id, plan_id)
);

CREATE INDEX IF NOT EXISTS idx_benefit_enrollments_employee
  ON benefit_enrollments (tenant_id, employee_id);
CREATE INDEX IF NOT EXISTS idx_benefit_enrollments_plan
  ON benefit_enrollments (tenant_id, plan_id);

ALTER TABLE benefit_enrollments ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS benefit_enrollments_tenant_isolation ON benefit_enrollments;
CREATE POLICY benefit_enrollments_tenant_isolation
  ON benefit_enrollments FOR ALL
  USING (tenant_id = (SELECT tenant_id FROM profiles WHERE id = auth.uid() LIMIT 1));
