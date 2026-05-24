-- =============================================================================
-- 097_ptax_engine.sql
-- Professional Tax (PTax) engine
-- Manages state-specific slab tables, per-employee state assignments,
-- and monthly professional tax contribution records.
-- Different Indian states have different slab structures; gender-based slabs
-- (e.g., Andhra Pradesh) are supported via the gender column.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- TABLE: ptax_slabs
-- State and financial-year specific income slabs with corresponding PTax.
-- monthly_income_to = NULL indicates "and above" (open-ended top slab).
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS ptax_slabs (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id           UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    state_code          TEXT NOT NULL,
    financial_year      TEXT NOT NULL,
    gender              TEXT CHECK (gender IN ('male','female','other','all')) DEFAULT 'all',
    monthly_income_from DECIMAL(14,2) NOT NULL DEFAULT 0,
    monthly_income_to   DECIMAL(14,2),
    monthly_ptax        DECIMAL(10,2) NOT NULL DEFAULT 0,
    annual_ptax         DECIMAL(10,2),
    is_active           BOOLEAN NOT NULL DEFAULT true,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (tenant_id, state_code, financial_year, gender, monthly_income_from)
);

-- ---------------------------------------------------------------------------
-- TABLE: ptax_state_config
-- Maps each employee to a state for PTax computation, with date-range support.
-- A new row is created if an employee relocates and their state changes.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS ptax_state_config (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id       UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    employee_id     UUID NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
    state_code      TEXT NOT NULL,
    effective_from  DATE NOT NULL,
    effective_to    DATE,
    override_reason TEXT,
    created_by      UUID REFERENCES profiles(id) ON DELETE SET NULL,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (tenant_id, employee_id, effective_from)
);

-- ---------------------------------------------------------------------------
-- TABLE: ptax_contributions
-- Monthly PTax deduction records, one row per employee per month.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS ptax_contributions (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id           UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    employee_id         UUID NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
    payroll_run_id      UUID,
    contribution_month  TEXT NOT NULL,
    state_code          TEXT NOT NULL,
    gross_salary        DECIMAL(14,2) NOT NULL,
    ptax_amount         DECIMAL(10,2) NOT NULL DEFAULT 0,
    financial_year      TEXT NOT NULL,
    is_exempt           BOOLEAN NOT NULL DEFAULT false,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (tenant_id, employee_id, contribution_month)
);

-- ---------------------------------------------------------------------------
-- INDEXES
-- ---------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_ptax_slabs_state_fy
    ON ptax_slabs (tenant_id, state_code, financial_year);

CREATE INDEX IF NOT EXISTS idx_ptax_contrib_month
    ON ptax_contributions (tenant_id, employee_id, contribution_month);

-- ---------------------------------------------------------------------------
-- ROW LEVEL SECURITY: ptax_slabs
-- ---------------------------------------------------------------------------
ALTER TABLE ptax_slabs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "pts_tenant_read" ON ptax_slabs
    FOR SELECT
    USING (tenant_id = get_user_tenant_id());

CREATE POLICY "pts_hr_write" ON ptax_slabs
    FOR ALL
    USING (get_user_role() IN ('super_admin','hr_admin'));

-- ---------------------------------------------------------------------------
-- ROW LEVEL SECURITY: ptax_state_config
-- ---------------------------------------------------------------------------
ALTER TABLE ptax_state_config ENABLE ROW LEVEL SECURITY;

CREATE POLICY "ptsc_tenant_read" ON ptax_state_config
    FOR SELECT
    USING (tenant_id = get_user_tenant_id());

CREATE POLICY "ptsc_hr_write" ON ptax_state_config
    FOR ALL
    USING (get_user_role() IN ('super_admin','hr_admin'));

-- ---------------------------------------------------------------------------
-- ROW LEVEL SECURITY: ptax_contributions
-- ---------------------------------------------------------------------------
ALTER TABLE ptax_contributions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "ptct_tenant_read" ON ptax_contributions
    FOR SELECT
    USING (tenant_id = get_user_tenant_id());

CREATE POLICY "ptct_hr_write" ON ptax_contributions
    FOR ALL
    USING (get_user_role() IN ('super_admin','hr_admin'));
