-- =============================================================================
-- 096_esi_engine.sql
-- Employee State Insurance (ESI) engine
-- Manages tenant-level ESI configuration, per-employee eligibility timeline
-- (wages can cross/re-cross the ceiling across contribution periods), and
-- monthly contribution records for statutory compliance.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- TABLE: esi_config
-- One row per tenant. Statutory rates and wage ceiling.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS esi_config (
    id                          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id                   UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE UNIQUE,
    employee_contribution_pct   DECIMAL(5,2) NOT NULL DEFAULT 0.75,
    employer_contribution_pct   DECIMAL(5,2) NOT NULL DEFAULT 3.25,
    wage_ceiling                DECIMAL(14,2) NOT NULL DEFAULT 21000.00,
    effective_from              DATE NOT NULL,
    created_at                  TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at                  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------------
-- TABLE: esi_eligibility_timeline
-- Tracks each period during which an employee is (or is not) ESI-eligible.
-- A new row is added whenever their gross wages cross the ceiling threshold.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS esi_eligibility_timeline (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id           UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    employee_id         UUID NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
    is_esi_applicable   BOOLEAN NOT NULL DEFAULT true,
    gross_wages         DECIMAL(14,2) NOT NULL,
    effective_from      DATE NOT NULL,
    effective_to        DATE,
    reason              TEXT,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------------
-- TABLE: esi_contributions
-- Monthly ESI contribution records, one row per employee per month.
-- total_contribution is the sum of employee and employer contributions.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS esi_contributions (
    id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id               UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    employee_id             UUID NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
    payroll_run_id          UUID,
    contribution_month      TEXT NOT NULL,
    esi_wages               DECIMAL(14,2) NOT NULL,
    employee_contribution   DECIMAL(14,2) NOT NULL,
    employer_contribution   DECIMAL(14,2) NOT NULL,
    total_contribution      DECIMAL(14,2) GENERATED ALWAYS AS
                                (employee_contribution + employer_contribution) STORED,
    is_eligible             BOOLEAN NOT NULL DEFAULT true,
    created_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (tenant_id, employee_id, contribution_month)
);

-- ---------------------------------------------------------------------------
-- INDEXES
-- ---------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_esi_contrib_month
    ON esi_contributions (tenant_id, contribution_month);

CREATE INDEX IF NOT EXISTS idx_esi_eligibility_employee
    ON esi_eligibility_timeline (tenant_id, employee_id, effective_from);

-- ---------------------------------------------------------------------------
-- ROW LEVEL SECURITY: esi_config
-- ---------------------------------------------------------------------------
ALTER TABLE esi_config ENABLE ROW LEVEL SECURITY;

CREATE POLICY "esic_tenant_read" ON esi_config
    FOR SELECT
    USING (tenant_id = get_user_tenant_id());

CREATE POLICY "esic_hr_write" ON esi_config
    FOR ALL
    USING (get_user_role() IN ('super_admin','hr_admin'));

-- ---------------------------------------------------------------------------
-- ROW LEVEL SECURITY: esi_eligibility_timeline
-- ---------------------------------------------------------------------------
ALTER TABLE esi_eligibility_timeline ENABLE ROW LEVEL SECURITY;

CREATE POLICY "esiet_tenant_read" ON esi_eligibility_timeline
    FOR SELECT
    USING (tenant_id = get_user_tenant_id());

CREATE POLICY "esiet_hr_write" ON esi_eligibility_timeline
    FOR ALL
    USING (get_user_role() IN ('super_admin','hr_admin'));

-- ---------------------------------------------------------------------------
-- ROW LEVEL SECURITY: esi_contributions
-- ---------------------------------------------------------------------------
ALTER TABLE esi_contributions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "esicc_tenant_read" ON esi_contributions
    FOR SELECT
    USING (tenant_id = get_user_tenant_id());

CREATE POLICY "esicc_hr_write" ON esi_contributions
    FOR ALL
    USING (get_user_role() IN ('super_admin','hr_admin'));
