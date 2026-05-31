-- =============================================================================
-- 095_epf_engine.sql
-- Employee Provident Fund (EPF) engine
-- Manages tenant-level EPF configuration, per-employee eligibility overrides,
-- and monthly contribution records for statutory compliance.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- TABLE: epf_config
-- One row per tenant. Stores statutory rates and account metadata.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS epf_config (
    id                          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id                   UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE UNIQUE,
    employee_contribution_pct   DECIMAL(5,2) NOT NULL DEFAULT 12.00,
    employer_pf_pct             DECIMAL(5,2) NOT NULL DEFAULT 3.67,
    employer_eps_pct            DECIMAL(5,2) NOT NULL DEFAULT 8.33,
    wage_ceiling                DECIMAL(14,2) NOT NULL DEFAULT 15000.00,
    is_wage_ceiling_applicable  BOOLEAN NOT NULL DEFAULT true,
    allow_voluntary_pf          BOOLEAN NOT NULL DEFAULT false,
    include_hra_in_pf_wages     BOOLEAN NOT NULL DEFAULT false,
    pf_account_number           TEXT,
    establishment_code          TEXT,
    effective_from              DATE NOT NULL,
    created_at                  TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at                  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------------
-- TABLE: epf_eligibility_overrides
-- Per-employee overrides for EPF applicability, exemptions, and voluntary PF.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS epf_eligibility_overrides (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id           UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    employee_id         UUID NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
    is_epf_applicable   BOOLEAN NOT NULL DEFAULT true,
    is_exempt           BOOLEAN NOT NULL DEFAULT false,
    exemption_reason    TEXT,
    voluntary_pf_pct    DECIMAL(5,2),
    override_reason     TEXT NOT NULL,
    effective_from      DATE NOT NULL,
    created_by          UUID REFERENCES profiles(id) ON DELETE SET NULL,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (tenant_id, employee_id)
);

-- ---------------------------------------------------------------------------
-- TABLE: epf_contributions
-- Monthly EPF contribution records, one row per employee per month.
-- total_employer_contribution is computed from sub-components.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS epf_contributions (
    id                          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id                   UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    employee_id                 UUID NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
    payroll_run_id              UUID,
    contribution_month          TEXT NOT NULL,
    pf_wages                    DECIMAL(14,2) NOT NULL,
    employee_contribution       DECIMAL(14,2) NOT NULL,
    employer_pf                 DECIMAL(14,2) NOT NULL,
    employer_eps                DECIMAL(14,2) NOT NULL,
    edli_contribution           DECIMAL(14,2) NOT NULL DEFAULT 0,
    total_employer_contribution DECIMAL(14,2) GENERATED ALWAYS AS
                                    (employer_pf + employer_eps + edli_contribution) STORED,
    voluntary_pf                DECIMAL(14,2) NOT NULL DEFAULT 0,
    is_capped                   BOOLEAN NOT NULL DEFAULT false,
    created_at                  TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (tenant_id, employee_id, contribution_month)
);

-- ---------------------------------------------------------------------------
-- INDEXES
-- ---------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_epf_contrib_month
    ON epf_contributions (tenant_id, contribution_month);

CREATE INDEX IF NOT EXISTS idx_epf_contrib_employee
    ON epf_contributions (tenant_id, employee_id);

-- ---------------------------------------------------------------------------
-- ROW LEVEL SECURITY: epf_config
-- ---------------------------------------------------------------------------
ALTER TABLE epf_config ENABLE ROW LEVEL SECURITY;

CREATE POLICY "epfc_tenant_read" ON epf_config
    FOR SELECT
    USING (tenant_id = get_user_tenant_id());

CREATE POLICY "epfc_hr_write" ON epf_config
    FOR ALL
    USING (get_user_role() IN ('super_admin','hr_admin'));

-- ---------------------------------------------------------------------------
-- ROW LEVEL SECURITY: epf_eligibility_overrides
-- ---------------------------------------------------------------------------
ALTER TABLE epf_eligibility_overrides ENABLE ROW LEVEL SECURITY;

CREATE POLICY "epfeo_tenant_read" ON epf_eligibility_overrides
    FOR SELECT
    USING (tenant_id = get_user_tenant_id());

CREATE POLICY "epfeo_hr_write" ON epf_eligibility_overrides
    FOR ALL
    USING (get_user_role() IN ('super_admin','hr_admin'));

-- ---------------------------------------------------------------------------
-- ROW LEVEL SECURITY: epf_contributions
-- ---------------------------------------------------------------------------
ALTER TABLE epf_contributions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "epfct_tenant_read" ON epf_contributions
    FOR SELECT
    USING (tenant_id = get_user_tenant_id());

CREATE POLICY "epfct_hr_write" ON epf_contributions
    FOR ALL
    USING (get_user_role() IN ('super_admin','hr_admin'));
