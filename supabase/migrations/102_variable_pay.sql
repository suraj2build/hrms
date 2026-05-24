-- =============================================================================
-- 102_variable_pay.sql
-- Variable pay and incentive management
-- Configurable incentive templates (performance bonus, spot award, etc.),
-- payout batches for bulk processing, and individual employee payout records.
-- Payouts are disbursed via a linked payroll run.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- TABLE: incentive_templates
-- Defines the types of variable pay the organisation uses.
-- Templates are reused across multiple payout batches.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS incentive_templates (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id           UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    name                TEXT NOT NULL,
    code                TEXT NOT NULL,
    template_type       TEXT NOT NULL CHECK (template_type IN (
                            'performance','sales','referral','spot_award','project',
                            'quarterly','annual','festival','retention','other')),
    is_taxable          BOOLEAN NOT NULL DEFAULT true,
    is_active           BOOLEAN NOT NULL DEFAULT true,
    requires_approval   BOOLEAN NOT NULL DEFAULT true,
    description         TEXT,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (tenant_id, code)
);

-- ---------------------------------------------------------------------------
-- TABLE: variable_payout_batches
-- Groups individual employee payouts for a given month and template.
-- Batch must be approved before payouts are included in a payroll run.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS variable_payout_batches (
    id                       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id                UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    template_id              UUID NOT NULL REFERENCES incentive_templates(id) ON DELETE RESTRICT,
    batch_name               TEXT NOT NULL,
    payout_month             TEXT NOT NULL,
    status                   TEXT NOT NULL DEFAULT 'draft' CHECK (status IN (
                                 'draft','in_review','approved','processing','processed','cancelled')),
    total_amount             DECIMAL(14,2) NOT NULL DEFAULT 0,
    employee_count           INT NOT NULL DEFAULT 0,
    approved_by              UUID REFERENCES profiles(id) ON DELETE SET NULL,
    approved_at              TIMESTAMPTZ,
    processed_payroll_run_id UUID,
    notes                    TEXT,
    created_by               UUID REFERENCES profiles(id) ON DELETE SET NULL,
    created_at               TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at               TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------------
-- TABLE: variable_payouts
-- Per-employee payout line within a batch. One row per employee per batch.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS variable_payouts (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id           UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    batch_id            UUID NOT NULL REFERENCES variable_payout_batches(id) ON DELETE CASCADE,
    employee_id         UUID NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
    payout_month        TEXT NOT NULL,
    amount              DECIMAL(14,2) NOT NULL CHECK (amount > 0),
    is_taxable          BOOLEAN NOT NULL DEFAULT true,
    performance_period  TEXT,
    performance_notes   TEXT,
    status              TEXT NOT NULL DEFAULT 'pending' CHECK (status IN (
                            'pending','approved','processed','cancelled')),
    payroll_run_id      UUID,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (tenant_id, batch_id, employee_id)
);

-- ---------------------------------------------------------------------------
-- INDEXES
-- ---------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_vpb_tenant_month_status
    ON variable_payout_batches (tenant_id, payout_month, status);

CREATE INDEX IF NOT EXISTS idx_vp_tenant_employee_month
    ON variable_payouts (tenant_id, employee_id, payout_month);

-- ---------------------------------------------------------------------------
-- ROW LEVEL SECURITY: incentive_templates
-- ---------------------------------------------------------------------------
ALTER TABLE incentive_templates ENABLE ROW LEVEL SECURITY;

CREATE POLICY "it_tenant_read" ON incentive_templates
    FOR SELECT
    USING (tenant_id = get_user_tenant_id());

CREATE POLICY "it_hr_write" ON incentive_templates
    FOR ALL
    USING (get_user_role() IN ('super_admin','hr_admin'));

-- ---------------------------------------------------------------------------
-- ROW LEVEL SECURITY: variable_payout_batches
-- ---------------------------------------------------------------------------
ALTER TABLE variable_payout_batches ENABLE ROW LEVEL SECURITY;

CREATE POLICY "vpb_tenant_read" ON variable_payout_batches
    FOR SELECT
    USING (tenant_id = get_user_tenant_id());

CREATE POLICY "vpb_hr_write" ON variable_payout_batches
    FOR ALL
    USING (get_user_role() IN ('super_admin','hr_admin'));

-- ---------------------------------------------------------------------------
-- ROW LEVEL SECURITY: variable_payouts
-- ---------------------------------------------------------------------------
ALTER TABLE variable_payouts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "vp_tenant_read" ON variable_payouts
    FOR SELECT
    USING (tenant_id = get_user_tenant_id());

CREATE POLICY "vp_hr_write" ON variable_payouts
    FOR ALL
    USING (get_user_role() IN ('super_admin','hr_admin'));
