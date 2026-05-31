-- ============================================================
-- 113b_enterprise_masters.sql
--
-- Enterprise Operational Masters — four new governance tables:
--
--   payroll_groups        — payroll processing cycles
--   employment_categories — engagement classification + eligibility flags
--   statutory_groups      — state-wise compliance config (PF/ESI/PT/LWF)
--   asset_categories      — asset classification + depreciation rules
--
-- FK columns added to `employees`:
--   payroll_group_id, employment_category_id, statutory_group_id
--
-- All tables are tenant-scoped with RLS.
-- ============================================================

-- ── payroll_groups ────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS payroll_groups (
  id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     UUID        NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  code          TEXT        NOT NULL,
  name          TEXT        NOT NULL,
  description   TEXT,
  cycle_type    TEXT        NOT NULL DEFAULT 'monthly'
    CHECK (cycle_type IN ('monthly', 'biweekly', 'weekly')),
  cutoff_day    INT         NOT NULL DEFAULT 25 CHECK (cutoff_day BETWEEN 1 AND 28),
  payout_day    INT         NOT NULL DEFAULT 1  CHECK (payout_day BETWEEN 1 AND 31),
  currency_code TEXT        NOT NULL DEFAULT 'INR',
  is_active     BOOLEAN     NOT NULL DEFAULT true,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),

  UNIQUE (tenant_id, code)
);

CREATE INDEX IF NOT EXISTS idx_payroll_groups_tenant ON payroll_groups (tenant_id);

ALTER TABLE payroll_groups ENABLE ROW LEVEL SECURITY;
CREATE POLICY payroll_groups_tenant_isolation ON payroll_groups
  USING (tenant_id = get_user_tenant_id());

-- ── employment_categories ─────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS employment_categories (
  id                  UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id           UUID        NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  code                TEXT        NOT NULL,
  name                TEXT        NOT NULL,
  description         TEXT,
  benefits_eligible   BOOLEAN     NOT NULL DEFAULT true,
  pf_applicable       BOOLEAN     NOT NULL DEFAULT true,
  esi_applicable      BOOLEAN     NOT NULL DEFAULT true,
  pt_applicable       BOOLEAN     NOT NULL DEFAULT true,
  gratuity_eligible   BOOLEAN     NOT NULL DEFAULT true,
  notice_period_days  INT         NOT NULL DEFAULT 30,
  probation_days      INT         NOT NULL DEFAULT 90,
  is_active           BOOLEAN     NOT NULL DEFAULT true,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),

  UNIQUE (tenant_id, code)
);

CREATE INDEX IF NOT EXISTS idx_employment_categories_tenant ON employment_categories (tenant_id);

ALTER TABLE employment_categories ENABLE ROW LEVEL SECURITY;
CREATE POLICY employment_categories_tenant_isolation ON employment_categories
  USING (tenant_id = get_user_tenant_id());

-- ── statutory_groups ─────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS statutory_groups (
  id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id        UUID        NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  code             TEXT        NOT NULL,
  name             TEXT        NOT NULL,
  state            TEXT,
  pf_enabled       BOOLEAN     NOT NULL DEFAULT true,
  esi_enabled      BOOLEAN     NOT NULL DEFAULT true,
  pt_enabled       BOOLEAN     NOT NULL DEFAULT false,
  lwf_enabled      BOOLEAN     NOT NULL DEFAULT false,
  pf_wage_ceiling  NUMERIC(12,2),
  esi_wage_ceiling NUMERIC(12,2),
  pt_slab_json     TEXT,
  is_active        BOOLEAN     NOT NULL DEFAULT true,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now(),

  UNIQUE (tenant_id, code)
);

CREATE INDEX IF NOT EXISTS idx_statutory_groups_tenant ON statutory_groups (tenant_id);

ALTER TABLE statutory_groups ENABLE ROW LEVEL SECURITY;
CREATE POLICY statutory_groups_tenant_isolation ON statutory_groups
  USING (tenant_id = get_user_tenant_id());

-- ── asset_categories ─────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS asset_categories (
  id                   UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id            UUID        NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  code                 TEXT        NOT NULL,
  name                 TEXT        NOT NULL,
  description          TEXT,
  depreciation_method  TEXT        NOT NULL DEFAULT 'straight_line'
    CHECK (depreciation_method IN ('straight_line', 'declining_balance', 'none')),
  useful_life_years    INT,
  salvage_value_pct    NUMERIC(5,2) NOT NULL DEFAULT 0,
  requires_return      BOOLEAN     NOT NULL DEFAULT true,
  is_trackable         BOOLEAN     NOT NULL DEFAULT true,
  is_active            BOOLEAN     NOT NULL DEFAULT true,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT now(),

  UNIQUE (tenant_id, code)
);

CREATE INDEX IF NOT EXISTS idx_asset_categories_tenant ON asset_categories (tenant_id);

ALTER TABLE asset_categories ENABLE ROW LEVEL SECURITY;
CREATE POLICY asset_categories_tenant_isolation ON asset_categories
  USING (tenant_id = get_user_tenant_id());

-- ── FK columns on employees ───────────────────────────────────────────────────

ALTER TABLE employees
  ADD COLUMN IF NOT EXISTS payroll_group_id        UUID REFERENCES payroll_groups(id)        ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS employment_category_id  UUID REFERENCES employment_categories(id)  ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS statutory_group_id      UUID REFERENCES statutory_groups(id)       ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_employees_payroll_group       ON employees (payroll_group_id)       WHERE payroll_group_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_employees_employment_category ON employees (employment_category_id) WHERE employment_category_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_employees_statutory_group     ON employees (statutory_group_id)     WHERE statutory_group_id IS NOT NULL;
