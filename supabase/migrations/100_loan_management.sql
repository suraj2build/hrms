-- =============================================================================
-- 100_loan_management.sql
-- Employee loan management
-- Full lifecycle: loan application, approval, disbursement, amortisation
-- schedule generation, and per-payment records tied to payroll runs.
-- Supports interest-bearing and interest-free loans with foreclosure.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- TABLE: employee_loans
-- Master loan record. outstanding_balance is updated as payments are made.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS employee_loans (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id           UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    employee_id         UUID NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
    loan_type           TEXT NOT NULL CHECK (loan_type IN (
                            'personal','education','vehicle','home','emergency','other')),
    principal_amount    DECIMAL(14,2) NOT NULL CHECK (principal_amount > 0),
    disbursed_amount    DECIMAL(14,2),
    interest_rate_pct   DECIMAL(5,2) NOT NULL DEFAULT 0,
    tenure_months       INT NOT NULL CHECK (tenure_months > 0),
    emi_amount          DECIMAL(14,2) NOT NULL DEFAULT 0,
    outstanding_balance DECIMAL(14,2) NOT NULL DEFAULT 0,
    status              TEXT NOT NULL DEFAULT 'pending' CHECK (status IN (
                            'pending','approved','rejected','disbursed','active',
                            'foreclosed','completed','cancelled')),
    purpose             TEXT,
    disbursed_date      DATE,
    first_emi_month     TEXT,
    approved_by         UUID REFERENCES profiles(id) ON DELETE SET NULL,
    approved_at         TIMESTAMPTZ,
    rejection_reason    TEXT,
    is_emi_paused       BOOLEAN NOT NULL DEFAULT false,
    foreclosed_at       TIMESTAMPTZ,
    foreclosure_amount  DECIMAL(14,2),
    created_by          UUID REFERENCES profiles(id) ON DELETE SET NULL,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------------
-- TABLE: loan_schedules
-- Auto-generated amortisation schedule, one row per EMI installment.
-- For interest-free loans, interest_component = 0.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS loan_schedules (
    id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id            UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    loan_id              UUID NOT NULL REFERENCES employee_loans(id) ON DELETE CASCADE,
    installment_number   INT NOT NULL,
    due_month            TEXT NOT NULL,
    principal_component  DECIMAL(14,2) NOT NULL,
    interest_component   DECIMAL(14,2) NOT NULL DEFAULT 0,
    emi_amount           DECIMAL(14,2) NOT NULL,
    status               TEXT NOT NULL DEFAULT 'pending' CHECK (status IN (
                             'pending','paid','skipped','adjusted')),
    paid_amount          DECIMAL(14,2),
    payroll_run_id       UUID,
    paid_at              TIMESTAMPTZ,
    created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (tenant_id, loan_id, installment_number)
);

-- ---------------------------------------------------------------------------
-- TABLE: loan_payments
-- Actual payment transactions (EMI, prepayment, foreclosure) per payroll run.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS loan_payments (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id       UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    loan_id         UUID NOT NULL REFERENCES employee_loans(id) ON DELETE CASCADE,
    schedule_id     UUID REFERENCES loan_schedules(id) ON DELETE SET NULL,
    employee_id     UUID NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
    payroll_run_id  UUID,
    payment_month   TEXT NOT NULL,
    amount          DECIMAL(14,2) NOT NULL,
    principal_paid  DECIMAL(14,2) NOT NULL,
    interest_paid   DECIMAL(14,2) NOT NULL DEFAULT 0,
    payment_type    TEXT CHECK (payment_type IN ('emi','prepayment','foreclosure','manual')),
    notes           TEXT,
    created_by      UUID REFERENCES profiles(id) ON DELETE SET NULL,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------------
-- INDEXES
-- ---------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_el_tenant_employee_status
    ON employee_loans (tenant_id, employee_id, status);

CREATE INDEX IF NOT EXISTS idx_el_active
    ON employee_loans (tenant_id, status)
    WHERE status IN ('active','disbursed');

CREATE INDEX IF NOT EXISTS idx_ls_loan_installment
    ON loan_schedules (tenant_id, loan_id, installment_number);

-- ---------------------------------------------------------------------------
-- ROW LEVEL SECURITY: employee_loans
-- ---------------------------------------------------------------------------
ALTER TABLE employee_loans ENABLE ROW LEVEL SECURITY;

CREATE POLICY "el_tenant_read" ON employee_loans
    FOR SELECT
    USING (tenant_id = get_user_tenant_id());

CREATE POLICY "el_hr_write" ON employee_loans
    FOR ALL
    USING (get_user_role() IN ('super_admin','hr_admin'));

-- ---------------------------------------------------------------------------
-- ROW LEVEL SECURITY: loan_schedules
-- ---------------------------------------------------------------------------
ALTER TABLE loan_schedules ENABLE ROW LEVEL SECURITY;

CREATE POLICY "ls_tenant_read" ON loan_schedules
    FOR SELECT
    USING (tenant_id = get_user_tenant_id());

CREATE POLICY "ls_hr_write" ON loan_schedules
    FOR ALL
    USING (get_user_role() IN ('super_admin','hr_admin'));

-- ---------------------------------------------------------------------------
-- ROW LEVEL SECURITY: loan_payments
-- ---------------------------------------------------------------------------
ALTER TABLE loan_payments ENABLE ROW LEVEL SECURITY;

CREATE POLICY "lp_tenant_read" ON loan_payments
    FOR SELECT
    USING (tenant_id = get_user_tenant_id());

CREATE POLICY "lp_hr_write" ON loan_payments
    FOR ALL
    USING (get_user_role() IN ('super_admin','hr_admin'));
