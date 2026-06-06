-- 229_lwf_tables.sql
-- Labour Welfare Fund (LWF) statutory tables.
-- LWF is state-driven (like PT) with employee + employer contributions.
-- Rates, deduction frequency and wage ceilings vary per state.
-- Additive + idempotent.

-- ── lwf_state_settings ─────────────────────────────────────────────────────────
-- Per-state LWF configuration for a tenant.
CREATE TABLE IF NOT EXISTS lwf_state_settings (
  id                      UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id               UUID        NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  state_code              TEXT        NOT NULL,
  state_name              TEXT        NOT NULL,
  enabled                 BOOLEAN     NOT NULL DEFAULT false,
  -- Contribution amounts (can be fixed or wage-slab based)
  employee_amount         DECIMAL(10,2) NOT NULL DEFAULT 0,
  employer_amount         DECIMAL(10,2) NOT NULL DEFAULT 0,
  -- Wage ceiling below which LWF applies (NULL = no ceiling)
  wage_ceiling            DECIMAL(14,2),
  -- Deduction frequency: monthly | half_yearly | annual
  frequency               TEXT        NOT NULL DEFAULT 'monthly'
                            CHECK (frequency IN ('monthly','half_yearly','annual')),
  -- For half_yearly / annual: which calendar months to deduct (comma-separated, e.g. '6,12')
  deduction_months        TEXT,
  registration_number     TEXT,
  effective_from          DATE,
  is_active               BOOLEAN     NOT NULL DEFAULT true,
  created_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, state_code)
);

CREATE INDEX IF NOT EXISTS idx_lwf_state_settings_tenant ON lwf_state_settings (tenant_id);

-- ── lwf_contributions ───────────────────────────────────────────────────────────
-- Per-employee LWF contributions for a payroll month.
CREATE TABLE IF NOT EXISTS lwf_contributions (
  id                      UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id               UUID        NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  employee_id             UUID        NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  contribution_month      TEXT        NOT NULL,
  state_code              TEXT        NOT NULL,
  gross_salary            DECIMAL(14,2) NOT NULL DEFAULT 0,
  employee_contribution   DECIMAL(10,2) NOT NULL DEFAULT 0,
  employer_contribution   DECIMAL(10,2) NOT NULL DEFAULT 0,
  is_eligible             BOOLEAN     NOT NULL DEFAULT true,
  created_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, employee_id, contribution_month)
);

CREATE INDEX IF NOT EXISTS idx_lwf_contributions_month ON lwf_contributions (tenant_id, contribution_month);

-- ── lwf_state_config (per-employee manual state override) ──────────────────────
-- When an employee's work state differs from their site or needs manual assignment.
CREATE TABLE IF NOT EXISTS lwf_state_config (
  id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id        UUID        NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  employee_id      UUID        NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  state_code       TEXT        NOT NULL,
  effective_from   DATE        NOT NULL,
  effective_to     DATE,
  override_reason  TEXT,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_lwf_state_config_emp ON lwf_state_config (tenant_id, employee_id);

COMMENT ON TABLE lwf_state_settings  IS 'Per-state LWF configuration (rates, frequency, wage ceiling) per tenant.';
COMMENT ON TABLE lwf_contributions   IS 'Per-employee LWF contributions per payroll month.';
COMMENT ON TABLE lwf_state_config    IS 'Manual LWF state assignment per employee (overrides site state_code).';
