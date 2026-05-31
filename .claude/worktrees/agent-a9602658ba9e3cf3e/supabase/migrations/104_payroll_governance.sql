-- =============================================================================
-- 104_payroll_governance.sql
-- Payroll governance: freeze/unfreeze control, maker-checker audit trail,
-- and variance approval workflows.
-- Ensures a robust four-eyes principle and auditability for all payroll
-- actions, including partial department-level freezes.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- TABLE: payroll_freeze_log
-- Records every freeze and unfreeze event, optionally scoped to departments.
-- department_ids = '{}' (empty array) means org-wide freeze.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS payroll_freeze_log (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id       UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    freeze_month    TEXT NOT NULL,
    action          TEXT NOT NULL CHECK (action IN ('freeze','unfreeze','partial_freeze')),
    department_ids  UUID[] NOT NULL DEFAULT '{}',
    reason          TEXT NOT NULL,
    frozen_by       UUID NOT NULL REFERENCES profiles(id) ON DELETE RESTRICT,
    unfrozen_by     UUID REFERENCES profiles(id) ON DELETE SET NULL,
    frozen_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
    unfrozen_at     TIMESTAMPTZ,
    payroll_run_id  UUID,
    metadata        JSONB NOT NULL DEFAULT '{}',
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------------
-- TABLE: maker_checker_log
-- Four-eyes audit log for sensitive payroll entities.
-- maker creates/proposes; checker approves or rejects.
-- sla_hours captures the expected turnaround for escalation purposes.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS maker_checker_log (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id       UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    entity_type     TEXT NOT NULL CHECK (entity_type IN (
                        'payroll_run','compensation_revision','advance','loan',
                        'reimbursement','variable_payout','arrear_batch',
                        'tds_override','governance_action')),
    entity_id       UUID NOT NULL,
    action          TEXT NOT NULL,
    maker_id        UUID NOT NULL REFERENCES profiles(id) ON DELETE RESTRICT,
    checker_id      UUID REFERENCES profiles(id) ON DELETE SET NULL,
    status          TEXT NOT NULL DEFAULT 'pending' CHECK (status IN (
                        'pending','approved','rejected','auto_approved')),
    maker_data      JSONB NOT NULL DEFAULT '{}',
    checker_notes   TEXT,
    submitted_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    reviewed_at     TIMESTAMPTZ,
    sla_hours       INT,
    is_escalated    BOOLEAN NOT NULL DEFAULT false,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------------
-- TABLE: payroll_variance_approvals
-- Auto-detected variance anomalies that require explicit HR sign-off before
-- the payroll run can proceed (e.g., salary spike, negative net pay).
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS payroll_variance_approvals (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id       UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    payroll_run_id  UUID NOT NULL,
    employee_id     UUID REFERENCES employees(id) ON DELETE SET NULL,
    variance_type   TEXT NOT NULL CHECK (variance_type IN (
                        'salary_spike','unusual_deduction','negative_net',
                        'ot_excess','reimbursement_limit_breach','comp_mismatch')),
    expected_value  DECIMAL(14,2),
    actual_value    DECIMAL(14,2),
    variance_pct    DECIMAL(8,4),
    explanation     TEXT NOT NULL,
    status          TEXT NOT NULL DEFAULT 'pending' CHECK (status IN (
                        'pending','approved','rejected')),
    reviewed_by     UUID REFERENCES profiles(id) ON DELETE SET NULL,
    reviewed_at     TIMESTAMPTZ,
    notes           TEXT,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------------
-- INDEXES
-- ---------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_pfl_tenant_month
    ON payroll_freeze_log (tenant_id, freeze_month);

CREATE INDEX IF NOT EXISTS idx_mcl_tenant_entity_status
    ON maker_checker_log (tenant_id, entity_type, status);

CREATE INDEX IF NOT EXISTS idx_pva_tenant_run_status
    ON payroll_variance_approvals (tenant_id, payroll_run_id, status);

-- ---------------------------------------------------------------------------
-- ROW LEVEL SECURITY: payroll_freeze_log
-- ---------------------------------------------------------------------------
ALTER TABLE payroll_freeze_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "pfl_tenant_read" ON payroll_freeze_log
    FOR SELECT
    USING (tenant_id = get_user_tenant_id());

CREATE POLICY "pfl_hr_write" ON payroll_freeze_log
    FOR ALL
    USING (get_user_role() IN ('super_admin','hr_admin'));

-- ---------------------------------------------------------------------------
-- ROW LEVEL SECURITY: maker_checker_log
-- ---------------------------------------------------------------------------
ALTER TABLE maker_checker_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "mcl_tenant_read" ON maker_checker_log
    FOR SELECT
    USING (tenant_id = get_user_tenant_id());

CREATE POLICY "mcl_hr_write" ON maker_checker_log
    FOR ALL
    USING (get_user_role() IN ('super_admin','hr_admin'));

-- ---------------------------------------------------------------------------
-- ROW LEVEL SECURITY: payroll_variance_approvals
-- ---------------------------------------------------------------------------
ALTER TABLE payroll_variance_approvals ENABLE ROW LEVEL SECURITY;

CREATE POLICY "pva_tenant_read" ON payroll_variance_approvals
    FOR SELECT
    USING (tenant_id = get_user_tenant_id());

CREATE POLICY "pva_hr_write" ON payroll_variance_approvals
    FOR ALL
    USING (get_user_role() IN ('super_admin','hr_admin'));
