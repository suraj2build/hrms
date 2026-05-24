-- =============================================================================
-- 098_tds_foundation.sql
-- TDS (Tax Deducted at Source) foundation
-- Covers employee tax regime elections (old vs new), investment declarations,
-- supporting proof documents, and month-by-month TDS projection recalculations.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- TABLE: tax_regime_elections
-- Stores the employee's chosen income tax regime for a financial year.
-- Only one election is permitted per employee per financial year.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS tax_regime_elections (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id       UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    employee_id     UUID NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
    regime          TEXT NOT NULL CHECK (regime IN ('old','new')),
    financial_year  TEXT NOT NULL,
    elected_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    effective_from  DATE NOT NULL,
    elected_by      UUID REFERENCES profiles(id) ON DELETE SET NULL,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (tenant_id, employee_id, financial_year)
);

-- ---------------------------------------------------------------------------
-- TABLE: tax_declarations
-- Employee investment/deduction declarations per section per financial year.
-- Approved amounts may differ from declared amounts after proof review.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS tax_declarations (
    id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id               UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    employee_id             UUID NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
    financial_year          TEXT NOT NULL,
    declaration_category    TEXT NOT NULL CHECK (declaration_category IN (
                                '80C','80D','80E','80G','80TTA','HRA','LTA',
                                'home_loan_principal','home_loan_interest','NPS',
                                'standard_deduction','professional_tax','other')),
    section                 TEXT NOT NULL,
    description             TEXT NOT NULL,
    declared_amount         DECIMAL(14,2) NOT NULL DEFAULT 0,
    approved_amount         DECIMAL(14,2),
    status                  TEXT NOT NULL DEFAULT 'declared' CHECK (status IN (
                                'declared','submitted','under_review','approved',
                                'rejected','revision_requested')),
    submitted_at            TIMESTAMPTZ,
    reviewed_by             UUID REFERENCES profiles(id) ON DELETE SET NULL,
    reviewed_at             TIMESTAMPTZ,
    rejection_reason        TEXT,
    metadata                JSONB NOT NULL DEFAULT '{}',
    created_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (tenant_id, employee_id, financial_year, declaration_category, section)
);

-- ---------------------------------------------------------------------------
-- TABLE: declaration_proofs
-- Supporting documents attached to a tax declaration.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS declaration_proofs (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id       UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    declaration_id  UUID NOT NULL REFERENCES tax_declarations(id) ON DELETE CASCADE,
    file_name       TEXT NOT NULL,
    storage_path    TEXT NOT NULL,
    mime_type       TEXT,
    file_size_bytes INT,
    uploaded_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
    uploaded_by     UUID REFERENCES profiles(id) ON DELETE SET NULL,
    is_verified     BOOLEAN NOT NULL DEFAULT false,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------------
-- TABLE: tds_monthly_projections
-- Running TDS projections recalculated each month as income or declarations
-- change. Tracks cumulative TDS already deducted vs. amount due this month.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS tds_monthly_projections (
    id                          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id                   UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    employee_id                 UUID NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
    financial_year              TEXT NOT NULL,
    projection_month            TEXT NOT NULL,
    gross_income_projected      DECIMAL(14,2) NOT NULL DEFAULT 0,
    total_deductions_projected  DECIMAL(14,2) NOT NULL DEFAULT 0,
    taxable_income_projected    DECIMAL(14,2) NOT NULL DEFAULT 0,
    tax_liability               DECIMAL(14,2) NOT NULL DEFAULT 0,
    tds_already_deducted        DECIMAL(14,2) NOT NULL DEFAULT 0,
    tds_this_month              DECIMAL(14,2) NOT NULL DEFAULT 0,
    regime                      TEXT NOT NULL CHECK (regime IN ('old','new')),
    created_at                  TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at                  TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (tenant_id, employee_id, financial_year, projection_month)
);

-- ---------------------------------------------------------------------------
-- INDEXES
-- ---------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_tre_tenant_employee_fy
    ON tax_regime_elections (tenant_id, employee_id, financial_year);

CREATE INDEX IF NOT EXISTS idx_td_tenant_employee_fy
    ON tax_declarations (tenant_id, employee_id, financial_year);

CREATE INDEX IF NOT EXISTS idx_td_tenant_status
    ON tax_declarations (tenant_id, status)
    WHERE status NOT IN ('approved');

CREATE INDEX IF NOT EXISTS idx_tds_proj_tenant_employee_fy
    ON tds_monthly_projections (tenant_id, employee_id, financial_year);

-- ---------------------------------------------------------------------------
-- ROW LEVEL SECURITY: tax_regime_elections
-- ---------------------------------------------------------------------------
ALTER TABLE tax_regime_elections ENABLE ROW LEVEL SECURITY;

CREATE POLICY "tre_tenant_read" ON tax_regime_elections
    FOR SELECT
    USING (tenant_id = get_user_tenant_id());

CREATE POLICY "tre_hr_write" ON tax_regime_elections
    FOR ALL
    USING (get_user_role() IN ('super_admin','hr_admin'));

-- ---------------------------------------------------------------------------
-- ROW LEVEL SECURITY: tax_declarations
-- ---------------------------------------------------------------------------
ALTER TABLE tax_declarations ENABLE ROW LEVEL SECURITY;

CREATE POLICY "td_tenant_read" ON tax_declarations
    FOR SELECT
    USING (tenant_id = get_user_tenant_id());

CREATE POLICY "td_hr_write" ON tax_declarations
    FOR ALL
    USING (get_user_role() IN ('super_admin','hr_admin'));

-- ---------------------------------------------------------------------------
-- ROW LEVEL SECURITY: declaration_proofs
-- ---------------------------------------------------------------------------
ALTER TABLE declaration_proofs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "dp_tenant_read" ON declaration_proofs
    FOR SELECT
    USING (tenant_id = get_user_tenant_id());

CREATE POLICY "dp_hr_write" ON declaration_proofs
    FOR ALL
    USING (get_user_role() IN ('super_admin','hr_admin'));

-- ---------------------------------------------------------------------------
-- ROW LEVEL SECURITY: tds_monthly_projections
-- ---------------------------------------------------------------------------
ALTER TABLE tds_monthly_projections ENABLE ROW LEVEL SECURITY;

CREATE POLICY "tmp_tenant_read" ON tds_monthly_projections
    FOR SELECT
    USING (tenant_id = get_user_tenant_id());

CREATE POLICY "tmp_hr_write" ON tds_monthly_projections
    FOR ALL
    USING (get_user_role() IN ('super_admin','hr_admin'));
