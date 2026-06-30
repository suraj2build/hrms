-- Migration 340: Benefits Management Enhancements
-- Adds band eligibility, ESIC flag, NPS plan type, insurance outbox

-- ── Designation band on employees ────────────────────────────────────────────
ALTER TABLE employees
  ADD COLUMN IF NOT EXISTS designation_band TEXT
    CHECK (designation_band IN ('store_staff','store_management','corporate_ho') OR designation_band IS NULL);

-- ── ESIC eligibility (computed) ───────────────────────────────────────────────
-- gross_salary field must exist; if not, this column is nullable with no generation
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'employees' AND column_name = 'gross_salary'
  ) THEN
    EXECUTE $sql$
      ALTER TABLE employees
        ADD COLUMN IF NOT EXISTS esic_eligible BOOLEAN
          GENERATED ALWAYS AS (gross_salary IS NOT NULL AND gross_salary <= 21000) STORED
    $sql$;
  ELSE
    EXECUTE $sql$
      ALTER TABLE employees
        ADD COLUMN IF NOT EXISTS esic_eligible BOOLEAN DEFAULT false
    $sql$;
  END IF;
EXCEPTION WHEN duplicate_column THEN NULL;
END
$$;

-- ── Eligible bands on benefit_plans ──────────────────────────────────────────
ALTER TABLE benefit_plans
  ADD COLUMN IF NOT EXISTS eligible_bands TEXT[] DEFAULT '{store_staff,store_management,corporate_ho}';

-- ── Contribution percentages for NPS ─────────────────────────────────────────
ALTER TABLE benefit_plans
  ADD COLUMN IF NOT EXISTS employee_contribution_pct NUMERIC(5,2),
  ADD COLUMN IF NOT EXISTS employer_contribution_pct NUMERIC(5,2);

-- ── Add NPS to plan_type CHECK constraint ─────────────────────────────────────
ALTER TABLE benefit_plans
  DROP CONSTRAINT IF EXISTS benefit_plans_plan_type_check;

ALTER TABLE benefit_plans
  ADD CONSTRAINT benefit_plans_plan_type_check
  CHECK (plan_type IN ('health','life','dental','vision','nps','other'));

-- ── Insurance outbox ─────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS insurance_outbox (
  id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     UUID        NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  provider_name TEXT        NOT NULL,
  event_type    TEXT        NOT NULL CHECK (event_type IN ('enrolment_sync','dependent_update','unenrolment')),
  payload       JSONB       NOT NULL,
  status        TEXT        NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','sent','failed')),
  sent_at       TIMESTAMPTZ,
  error_message TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE insurance_outbox ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "insurance_outbox_admin" ON insurance_outbox;
CREATE POLICY "insurance_outbox_admin" ON insurance_outbox FOR ALL
  USING (tenant_id = get_user_tenant_id()
         AND get_user_role() IN ('super_admin','hr_admin'));

-- Seed a demo NPS plan
INSERT INTO benefit_plans (tenant_id, name, plan_type, description, is_active,
                            employee_contribution_pct, employer_contribution_pct)
SELECT id, 'National Pension Scheme (NPS)', 'nps',
       'Employer and employee contribute 10% each to NPS Tier-I account.', true,
       10.00, 10.00
FROM tenants
WHERE id = 'd0000000-0000-0000-0000-000000000001'
ON CONFLICT DO NOTHING;
