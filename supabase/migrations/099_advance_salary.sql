-- =============================================================================
-- 099_advance_salary.sql
-- Advance salary management
-- Covers the full lifecycle of salary advance requests: application,
-- approval, disbursement, scheduled EMI-style recovery, and actual
-- recovery records tied to payroll runs.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- TABLE: advance_salary_requests
-- Master record for each advance request from an employee.
-- Recovery can be paused (e.g., employee on LOP or long leave).
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS advance_salary_requests (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id           UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    employee_id         UUID NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
    requested_amount    DECIMAL(14,2) NOT NULL CHECK (requested_amount > 0),
    approved_amount     DECIMAL(14,2),
    purpose             TEXT NOT NULL,
    recovery_months     INT NOT NULL DEFAULT 1 CHECK (recovery_months BETWEEN 1 AND 12),
    status              TEXT NOT NULL DEFAULT 'pending' CHECK (status IN (
                            'pending','approved','rejected','disbursed',
                            'recovering','recovered','cancelled')),
    requested_date      DATE NOT NULL DEFAULT CURRENT_DATE,
    approved_by         UUID REFERENCES profiles(id) ON DELETE SET NULL,
    approved_at         TIMESTAMPTZ,
    disbursed_date      DATE,
    disbursed_amount    DECIMAL(14,2),
    rejection_reason    TEXT,
    is_recovery_paused  BOOLEAN NOT NULL DEFAULT false,
    pause_reason        TEXT,
    created_by          UUID REFERENCES profiles(id) ON DELETE SET NULL,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------------
-- TABLE: advance_recovery_schedules
-- Month-by-month repayment schedule generated after disbursement.
-- Each row represents one installment of the recovery plan.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS advance_recovery_schedules (
    id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id        UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    advance_id       UUID NOT NULL REFERENCES advance_salary_requests(id) ON DELETE CASCADE,
    recovery_month   TEXT NOT NULL,
    scheduled_amount DECIMAL(14,2) NOT NULL,
    actual_amount    DECIMAL(14,2),
    status           TEXT NOT NULL DEFAULT 'pending' CHECK (status IN (
                         'pending','recovered','skipped','adjusted')),
    payroll_run_id   UUID,
    recovered_at     TIMESTAMPTZ,
    notes            TEXT,
    created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (tenant_id, advance_id, recovery_month)
);

-- ---------------------------------------------------------------------------
-- TABLE: advance_recoveries
-- Actual recovery transactions recorded when payroll is processed.
-- Linked to both the advance request and (optionally) the schedule row.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS advance_recoveries (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id       UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    advance_id      UUID NOT NULL REFERENCES advance_salary_requests(id) ON DELETE CASCADE,
    schedule_id     UUID REFERENCES advance_recovery_schedules(id) ON DELETE SET NULL,
    employee_id     UUID NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
    payroll_run_id  UUID,
    recovery_month  TEXT NOT NULL,
    amount          DECIMAL(14,2) NOT NULL,
    recovery_type   TEXT CHECK (recovery_type IN ('scheduled','prepayment','manual')),
    notes           TEXT,
    created_by      UUID REFERENCES profiles(id) ON DELETE SET NULL,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------------
-- INDEXES
-- ---------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_asr_tenant_employee_status
    ON advance_salary_requests (tenant_id, employee_id, status);

CREATE INDEX IF NOT EXISTS idx_asr_active
    ON advance_salary_requests (tenant_id, status)
    WHERE status IN ('approved','disbursed','recovering');

CREATE INDEX IF NOT EXISTS idx_arsch_advance_month
    ON advance_recovery_schedules (tenant_id, advance_id, recovery_month);

-- ---------------------------------------------------------------------------
-- ROW LEVEL SECURITY: advance_salary_requests
-- ---------------------------------------------------------------------------
ALTER TABLE advance_salary_requests ENABLE ROW LEVEL SECURITY;

CREATE POLICY "asr_tenant_read" ON advance_salary_requests
    FOR SELECT
    USING (tenant_id = get_user_tenant_id());

CREATE POLICY "asr_hr_write" ON advance_salary_requests
    FOR ALL
    USING (get_user_role() IN ('super_admin','hr_admin'));

-- ---------------------------------------------------------------------------
-- ROW LEVEL SECURITY: advance_recovery_schedules
-- ---------------------------------------------------------------------------
ALTER TABLE advance_recovery_schedules ENABLE ROW LEVEL SECURITY;

CREATE POLICY "arsch_tenant_read" ON advance_recovery_schedules
    FOR SELECT
    USING (tenant_id = get_user_tenant_id());

CREATE POLICY "arsch_hr_write" ON advance_recovery_schedules
    FOR ALL
    USING (get_user_role() IN ('super_admin','hr_admin'));

-- ---------------------------------------------------------------------------
-- ROW LEVEL SECURITY: advance_recoveries
-- ---------------------------------------------------------------------------
ALTER TABLE advance_recoveries ENABLE ROW LEVEL SECURITY;

CREATE POLICY "arec_tenant_read" ON advance_recoveries
    FOR SELECT
    USING (tenant_id = get_user_tenant_id());

CREATE POLICY "arec_hr_write" ON advance_recoveries
    FOR ALL
    USING (get_user_role() IN ('super_admin','hr_admin'));
