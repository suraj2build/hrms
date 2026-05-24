-- =============================================================================
-- 105_payroll_validation.sql
-- Payroll validation and reconciliation engine
-- Configurable rule library, per-run validation execution records, granular
-- per-employee per-rule results, and multi-type reconciliation runs.
-- Blocking errors prevent payroll from being finalised until resolved.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- TABLE: payroll_validation_rules
-- Library of configurable rules. threshold_config holds rule-specific
-- parameters (e.g., max variance %, required fields list).
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS payroll_validation_rules (
    id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id        UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    rule_code        TEXT NOT NULL,
    rule_name        TEXT NOT NULL,
    category         TEXT NOT NULL CHECK (category IN (
                         'data_completeness','calculation_integrity','compliance',
                         'bank_details','variance','statutory')),
    severity         TEXT NOT NULL CHECK (severity IN ('error','warning','info')),
    is_active        BOOLEAN NOT NULL DEFAULT true,
    description      TEXT,
    threshold_config JSONB NOT NULL DEFAULT '{}',
    auto_resolve     BOOLEAN NOT NULL DEFAULT false,
    created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (tenant_id, rule_code)
);

-- ---------------------------------------------------------------------------
-- TABLE: payroll_validation_runs
-- One record per validation execution against a payroll run or month.
-- is_payroll_blocked = true prevents the payroll run from being finalised.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS payroll_validation_runs (
    id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id        UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    payroll_run_id   UUID,
    validation_month TEXT NOT NULL,
    status           TEXT NOT NULL DEFAULT 'running' CHECK (status IN (
                         'running','completed','failed')),
    total_rules      INT NOT NULL DEFAULT 0,
    passed_rules     INT NOT NULL DEFAULT 0,
    error_count      INT NOT NULL DEFAULT 0,
    warning_count    INT NOT NULL DEFAULT 0,
    blocking_errors  INT NOT NULL DEFAULT 0,
    is_payroll_blocked BOOLEAN NOT NULL DEFAULT false,
    started_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
    completed_at     TIMESTAMPTZ,
    duration_ms      INT,
    triggered_by     UUID REFERENCES profiles(id) ON DELETE SET NULL,
    created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------------
-- TABLE: payroll_validation_results
-- Per-rule, per-employee results from a validation run.
-- auto_resolved = true means the engine fixed the issue without HR action.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS payroll_validation_results (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id           UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    validation_run_id   UUID NOT NULL REFERENCES payroll_validation_runs(id) ON DELETE CASCADE,
    rule_id             UUID REFERENCES payroll_validation_rules(id) ON DELETE SET NULL,
    employee_id         UUID REFERENCES employees(id) ON DELETE SET NULL,
    rule_code           TEXT NOT NULL,
    rule_name           TEXT NOT NULL,
    severity            TEXT NOT NULL,
    status              TEXT NOT NULL CHECK (status IN ('pass','fail','warning','skipped')),
    message             TEXT,
    detail_data         JSONB NOT NULL DEFAULT '{}',
    auto_resolved       BOOLEAN NOT NULL DEFAULT false,
    resolution_notes    TEXT,
    resolved_by         UUID REFERENCES profiles(id) ON DELETE SET NULL,
    resolved_at         TIMESTAMPTZ,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------------
-- TABLE: payroll_reconciliation_runs
-- Reconciliation runs validate data consistency across modules (attendance,
-- statutory, bank). exceptions is a JSONB array of discrepancy details.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS payroll_reconciliation_runs (
    id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id               UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    payroll_run_id          UUID,
    reconciliation_month    TEXT NOT NULL,
    reconciliation_type     TEXT NOT NULL CHECK (reconciliation_type IN (
                                'attendance','statutory','bank','reimbursement','full')),
    status                  TEXT NOT NULL DEFAULT 'running' CHECK (status IN (
                                'running','completed','completed_with_exceptions','failed')),
    total_employees         INT NOT NULL DEFAULT 0,
    matched_count           INT NOT NULL DEFAULT 0,
    exception_count         INT NOT NULL DEFAULT 0,
    exceptions              JSONB NOT NULL DEFAULT '[]',
    started_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
    completed_at            TIMESTAMPTZ,
    triggered_by            UUID REFERENCES profiles(id) ON DELETE SET NULL,
    created_at              TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------------
-- INDEXES
-- ---------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_pvrun_tenant_month_status
    ON payroll_validation_runs (tenant_id, validation_month, status);

CREATE INDEX IF NOT EXISTS idx_pvrun_tenant_payroll_run
    ON payroll_validation_runs (tenant_id, payroll_run_id);

CREATE INDEX IF NOT EXISTS idx_pvres_tenant_run
    ON payroll_validation_results (tenant_id, validation_run_id);

CREATE INDEX IF NOT EXISTS idx_prec_tenant_month
    ON payroll_reconciliation_runs (tenant_id, reconciliation_month);

-- ---------------------------------------------------------------------------
-- ROW LEVEL SECURITY: payroll_validation_rules
-- ---------------------------------------------------------------------------
ALTER TABLE payroll_validation_rules ENABLE ROW LEVEL SECURITY;

CREATE POLICY "pvr_tenant_read" ON payroll_validation_rules
    FOR SELECT
    USING (tenant_id = get_user_tenant_id());

CREATE POLICY "pvr_hr_write" ON payroll_validation_rules
    FOR ALL
    USING (get_user_role() IN ('super_admin','hr_admin'));

-- ---------------------------------------------------------------------------
-- ROW LEVEL SECURITY: payroll_validation_runs
-- ---------------------------------------------------------------------------
ALTER TABLE payroll_validation_runs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "pvrun_tenant_read" ON payroll_validation_runs
    FOR SELECT
    USING (tenant_id = get_user_tenant_id());

CREATE POLICY "pvrun_hr_write" ON payroll_validation_runs
    FOR ALL
    USING (get_user_role() IN ('super_admin','hr_admin'));

-- ---------------------------------------------------------------------------
-- ROW LEVEL SECURITY: payroll_validation_results
-- ---------------------------------------------------------------------------
ALTER TABLE payroll_validation_results ENABLE ROW LEVEL SECURITY;

CREATE POLICY "pvres_tenant_read" ON payroll_validation_results
    FOR SELECT
    USING (tenant_id = get_user_tenant_id());

CREATE POLICY "pvres_hr_write" ON payroll_validation_results
    FOR ALL
    USING (get_user_role() IN ('super_admin','hr_admin'));

-- ---------------------------------------------------------------------------
-- ROW LEVEL SECURITY: payroll_reconciliation_runs
-- ---------------------------------------------------------------------------
ALTER TABLE payroll_reconciliation_runs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "prec_tenant_read" ON payroll_reconciliation_runs
    FOR SELECT
    USING (tenant_id = get_user_tenant_id());

CREATE POLICY "prec_hr_write" ON payroll_reconciliation_runs
    FOR ALL
    USING (get_user_role() IN ('super_admin','hr_admin'));
