-- Migration 311: monthly recognition points budget (anti-gaming).
--
-- ESS 2.0 "Rewards" maturity. Each giver gets a monthly points budget so
-- recognition stays meaningful and can't be inflated. Giving a badge spends its
-- points from the giver's remaining monthly budget; the API rejects a give that
-- would exceed it. Budget is per-tenant (one default), overridable by HR later.
--
-- Idempotent: IF NOT EXISTS + ON CONFLICT seed.

CREATE TABLE IF NOT EXISTS recognition_budgets (
  id             UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id      UUID        NOT NULL UNIQUE REFERENCES tenants(id) ON DELETE CASCADE,
  monthly_points INT         NOT NULL DEFAULT 100 CHECK (monthly_points >= 0),
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE recognition_budgets ENABLE ROW LEVEL SECURITY;
CREATE POLICY "recbudget_hr_all" ON recognition_budgets FOR ALL    USING (get_user_role() IN ('super_admin','hr_admin'));
CREATE POLICY "recbudget_read"   ON recognition_budgets FOR SELECT USING (tenant_id = get_user_tenant_id());

-- Seed a 100-point default monthly budget for every existing tenant.
INSERT INTO recognition_budgets (tenant_id, monthly_points)
SELECT id, 100 FROM tenants
ON CONFLICT (tenant_id) DO NOTHING;
