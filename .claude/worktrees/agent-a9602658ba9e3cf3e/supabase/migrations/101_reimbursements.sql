-- =============================================================================
-- 101_reimbursements.sql
-- Employee expense reimbursements
-- Configurable reimbursement categories with monthly/annual caps, employee
-- claim submissions with multi-step approval, and supporting attachments.
-- Approved claims are paid out via payroll.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- TABLE: reimbursement_categories
-- HR-configured categories (fuel, mobile, medical, etc.) with limits.
-- requires_receipt controls whether supporting documents are mandatory.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS reimbursement_categories (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id       UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    name            TEXT NOT NULL,
    code            TEXT NOT NULL,
    category_type   TEXT NOT NULL CHECK (category_type IN (
                        'fuel','travel','mobile','internet','food','medical','other')),
    is_taxable      BOOLEAN NOT NULL DEFAULT false,
    monthly_limit   DECIMAL(14,2),
    annual_limit    DECIMAL(14,2),
    requires_receipt BOOLEAN NOT NULL DEFAULT true,
    is_active       BOOLEAN NOT NULL DEFAULT true,
    description     TEXT,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (tenant_id, code)
);

-- ---------------------------------------------------------------------------
-- TABLE: reimbursement_claims
-- Individual expense claims submitted by employees.
-- approved_amount may differ from claimed_amount after review.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS reimbursement_claims (
    id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id        UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    employee_id      UUID NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
    category_id      UUID NOT NULL REFERENCES reimbursement_categories(id) ON DELETE RESTRICT,
    claim_date       DATE NOT NULL DEFAULT CURRENT_DATE,
    expense_date     DATE NOT NULL,
    claimed_amount   DECIMAL(14,2) NOT NULL CHECK (claimed_amount > 0),
    approved_amount  DECIMAL(14,2),
    description      TEXT NOT NULL,
    status           TEXT NOT NULL DEFAULT 'draft' CHECK (status IN (
                         'draft','submitted','under_review','approved',
                         'rejected','paid','cancelled')),
    submitted_at     TIMESTAMPTZ,
    reviewed_by      UUID REFERENCES profiles(id) ON DELETE SET NULL,
    reviewed_at      TIMESTAMPTZ,
    rejection_reason TEXT,
    payroll_run_id   UUID,
    paid_at          TIMESTAMPTZ,
    metadata         JSONB NOT NULL DEFAULT '{}',
    created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------------
-- TABLE: reimbursement_attachments
-- Supporting receipts/documents attached to a reimbursement claim.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS reimbursement_attachments (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id       UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    claim_id        UUID NOT NULL REFERENCES reimbursement_claims(id) ON DELETE CASCADE,
    file_name       TEXT NOT NULL,
    storage_path    TEXT NOT NULL,
    mime_type       TEXT,
    file_size_bytes INT,
    uploaded_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
    uploaded_by     UUID REFERENCES profiles(id) ON DELETE SET NULL
);

-- ---------------------------------------------------------------------------
-- INDEXES
-- ---------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_rc_tenant_employee_status
    ON reimbursement_claims (tenant_id, employee_id, status);

CREATE INDEX IF NOT EXISTS idx_rc_pending
    ON reimbursement_claims (tenant_id, status)
    WHERE status IN ('submitted','under_review');

CREATE INDEX IF NOT EXISTS idx_rc_category
    ON reimbursement_claims (tenant_id, category_id);

-- ---------------------------------------------------------------------------
-- ROW LEVEL SECURITY: reimbursement_categories
-- ---------------------------------------------------------------------------
ALTER TABLE reimbursement_categories ENABLE ROW LEVEL SECURITY;

CREATE POLICY "rcat_tenant_read" ON reimbursement_categories
    FOR SELECT
    USING (tenant_id = get_user_tenant_id());

CREATE POLICY "rcat_hr_write" ON reimbursement_categories
    FOR ALL
    USING (get_user_role() IN ('super_admin','hr_admin'));

-- ---------------------------------------------------------------------------
-- ROW LEVEL SECURITY: reimbursement_claims
-- ---------------------------------------------------------------------------
ALTER TABLE reimbursement_claims ENABLE ROW LEVEL SECURITY;

CREATE POLICY "rcl_tenant_read" ON reimbursement_claims
    FOR SELECT
    USING (tenant_id = get_user_tenant_id());

CREATE POLICY "rcl_hr_write" ON reimbursement_claims
    FOR ALL
    USING (get_user_role() IN ('super_admin','hr_admin'));

CREATE POLICY "rcl_employee_insert" ON reimbursement_claims
    FOR INSERT
    WITH CHECK (tenant_id = get_user_tenant_id());

-- ---------------------------------------------------------------------------
-- ROW LEVEL SECURITY: reimbursement_attachments
-- ---------------------------------------------------------------------------
ALTER TABLE reimbursement_attachments ENABLE ROW LEVEL SECURITY;

CREATE POLICY "ra_tenant_read" ON reimbursement_attachments
    FOR SELECT
    USING (tenant_id = get_user_tenant_id());

CREATE POLICY "ra_hr_write" ON reimbursement_attachments
    FOR ALL
    USING (get_user_role() IN ('super_admin','hr_admin'));
