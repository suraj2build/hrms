-- =============================================================================
-- 103_arrear_engine.sql
-- Arrear and retrospective pay engine
-- Handles salary arrears arising from late revisions, corrections, or missed
-- payments. Arrear batches group calculations for a period range; individual
-- arrear records hold per-component deltas; payout rows track disbursement.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- TABLE: arrear_batches
-- Groups all arrear calculations for a given period range and type.
-- payout_month is the payroll month in which the arrear will be disbursed.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS arrear_batches (
    id                       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id                UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    batch_name               TEXT NOT NULL,
    arrear_type              TEXT NOT NULL CHECK (arrear_type IN (
                                 'salary_revision','correction','missed_payment',
                                 'retro_increment','retro_deduction','other')),
    from_period              TEXT NOT NULL,
    to_period                TEXT NOT NULL,
    status                   TEXT NOT NULL DEFAULT 'draft' CHECK (status IN (
                                 'draft','calculated','approved','processing',
                                 'processed','cancelled')),
    total_arrear_amount      DECIMAL(14,2) NOT NULL DEFAULT 0,
    employee_count           INT NOT NULL DEFAULT 0,
    payout_month             TEXT,
    approved_by              UUID REFERENCES profiles(id) ON DELETE SET NULL,
    approved_at              TIMESTAMPTZ,
    processed_payroll_run_id UUID,
    notes                    TEXT,
    created_by               UUID REFERENCES profiles(id) ON DELETE SET NULL,
    created_at               TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at               TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------------
-- TABLE: arrear_records
-- Per-employee, per-period, per-component arrear calculation detail.
-- arrear_amount (generated) = new_amount - old_amount.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS arrear_records (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id           UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    batch_id            UUID NOT NULL REFERENCES arrear_batches(id) ON DELETE CASCADE,
    employee_id         UUID NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
    period_month        TEXT NOT NULL,
    component_code      TEXT NOT NULL,
    component_name      TEXT NOT NULL,
    old_amount          DECIMAL(14,2) NOT NULL DEFAULT 0,
    new_amount          DECIMAL(14,2) NOT NULL DEFAULT 0,
    arrear_amount       DECIMAL(14,2) GENERATED ALWAYS AS (new_amount - old_amount) STORED,
    is_taxable          BOOLEAN NOT NULL DEFAULT true,
    calculation_notes   TEXT,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (tenant_id, batch_id, employee_id, period_month, component_code)
);

-- ---------------------------------------------------------------------------
-- TABLE: arrear_payouts
-- Tracks the staged disbursement of each arrear record into a payroll run.
-- A single arrear_record can be split across payout months if needed.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS arrear_payouts (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id       UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    batch_id        UUID NOT NULL REFERENCES arrear_batches(id) ON DELETE CASCADE,
    record_id       UUID NOT NULL REFERENCES arrear_records(id) ON DELETE CASCADE,
    employee_id     UUID NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
    payout_month    TEXT NOT NULL,
    amount          DECIMAL(14,2) NOT NULL,
    status          TEXT NOT NULL DEFAULT 'pending' CHECK (status IN (
                        'pending','processed','cancelled')),
    payroll_run_id  UUID,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------------
-- INDEXES
-- ---------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_ab_tenant_status
    ON arrear_batches (tenant_id, status, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_ar_tenant_employee_period
    ON arrear_records (tenant_id, employee_id, period_month);

CREATE INDEX IF NOT EXISTS idx_ar_batch
    ON arrear_records (tenant_id, batch_id);

CREATE INDEX IF NOT EXISTS idx_ap_batch
    ON arrear_payouts (tenant_id, batch_id);

-- ---------------------------------------------------------------------------
-- ROW LEVEL SECURITY: arrear_batches
-- ---------------------------------------------------------------------------
ALTER TABLE arrear_batches ENABLE ROW LEVEL SECURITY;

CREATE POLICY "ab_tenant_read" ON arrear_batches
    FOR SELECT
    USING (tenant_id = get_user_tenant_id());

CREATE POLICY "ab_hr_write" ON arrear_batches
    FOR ALL
    USING (get_user_role() IN ('super_admin','hr_admin'));

-- ---------------------------------------------------------------------------
-- ROW LEVEL SECURITY: arrear_records
-- ---------------------------------------------------------------------------
ALTER TABLE arrear_records ENABLE ROW LEVEL SECURITY;

CREATE POLICY "ar_tenant_read" ON arrear_records
    FOR SELECT
    USING (tenant_id = get_user_tenant_id());

CREATE POLICY "ar_hr_write" ON arrear_records
    FOR ALL
    USING (get_user_role() IN ('super_admin','hr_admin'));

-- ---------------------------------------------------------------------------
-- ROW LEVEL SECURITY: arrear_payouts
-- ---------------------------------------------------------------------------
ALTER TABLE arrear_payouts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "ap_tenant_read" ON arrear_payouts
    FOR SELECT
    USING (tenant_id = get_user_tenant_id());

CREATE POLICY "ap_hr_write" ON arrear_payouts
    FOR ALL
    USING (get_user_role() IN ('super_admin','hr_admin'));
