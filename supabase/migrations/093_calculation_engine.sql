-- =============================================================================
-- 093_calculation_engine.sql
-- Formula registry, component calculation configs, calculation trace log
-- Provides a pluggable formula engine for salary component computation.
-- Every computed value is fully traceable via the trace log.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- TABLE: formula_registry
-- Central library of named, versioned formulas used by the payroll engine.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS formula_registry (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id           UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    formula_name        TEXT NOT NULL,
    formula_code        TEXT NOT NULL,
    category            TEXT CHECK (category IN ('earning','deduction','statutory','custom')),
    expression          TEXT NOT NULL,
    depends_on          TEXT[] NOT NULL DEFAULT '{}',
    calculation_type    TEXT NOT NULL CHECK (calculation_type IN (
                            'fixed','percentage_of_component','formula_based','slab_based',
                            'attendance_based','prorated','reimbursement_based','policy_based')),
    description         TEXT,
    is_active           BOOLEAN NOT NULL DEFAULT true,
    version             INT NOT NULL DEFAULT 1,
    created_by          UUID REFERENCES profiles(id) ON DELETE SET NULL,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (tenant_id, formula_code, version)
);

-- ---------------------------------------------------------------------------
-- TABLE: component_calculation_configs
-- Per-component configuration that ties a salary component to a formula.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS component_calculation_configs (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id           UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    component_id        UUID NOT NULL REFERENCES salary_components(id) ON DELETE CASCADE,
    formula_code        TEXT,
    calculation_type    TEXT NOT NULL CHECK (calculation_type IN (
                            'fixed','percentage_of_component','formula_based','slab_based',
                            'attendance_based','prorated','reimbursement_based','policy_based')),
    base_component_code TEXT,
    percentage          DECIMAL(8,4),
    fixed_amount        DECIMAL(14,2),
    slab_config         JSONB NOT NULL DEFAULT '{}',
    attendance_factor   TEXT CHECK (attendance_factor IN ('working_days','present_days','paid_days')),
    proration_method    TEXT CHECK (proration_method IN ('calendar_days','working_days','none')),
    is_active           BOOLEAN NOT NULL DEFAULT true,
    effective_from      DATE NOT NULL,
    effective_to        DATE,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (tenant_id, component_id, effective_from)
);

-- ---------------------------------------------------------------------------
-- TABLE: calculation_trace_log
-- Immutable audit log capturing every individual component computation.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS calculation_trace_log (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id           UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    employee_id         UUID NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
    payroll_run_id      UUID,
    calculation_date    DATE NOT NULL,
    component_code      TEXT NOT NULL,
    component_name      TEXT NOT NULL,
    formula_used        TEXT,
    input_values        JSONB NOT NULL DEFAULT '{}',
    computed_value      DECIMAL(14,2) NOT NULL,
    computation_steps   JSONB NOT NULL DEFAULT '[]',
    warnings            TEXT[] NOT NULL DEFAULT '{}',
    is_override         BOOLEAN NOT NULL DEFAULT false,
    override_reason     TEXT,
    calculated_by       TEXT NOT NULL DEFAULT 'engine',
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------------
-- INDEXES
-- ---------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_ctl_tenant_employee
    ON calculation_trace_log (tenant_id, employee_id, calculation_date DESC);

CREATE INDEX IF NOT EXISTS idx_ctl_tenant_payroll_run
    ON calculation_trace_log (tenant_id, payroll_run_id);

CREATE INDEX IF NOT EXISTS idx_ccc_tenant_component
    ON component_calculation_configs (tenant_id, component_id, effective_from DESC);

-- ---------------------------------------------------------------------------
-- ROW LEVEL SECURITY: formula_registry
-- ---------------------------------------------------------------------------
ALTER TABLE formula_registry ENABLE ROW LEVEL SECURITY;

CREATE POLICY "fr_tenant_read" ON formula_registry
    FOR SELECT
    USING (tenant_id = get_user_tenant_id());

CREATE POLICY "fr_hr_write" ON formula_registry
    FOR ALL
    USING (get_user_role() IN ('super_admin','hr_admin'));

-- ---------------------------------------------------------------------------
-- ROW LEVEL SECURITY: component_calculation_configs
-- ---------------------------------------------------------------------------
ALTER TABLE component_calculation_configs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "ccc_tenant_read" ON component_calculation_configs
    FOR SELECT
    USING (tenant_id = get_user_tenant_id());

CREATE POLICY "ccc_hr_write" ON component_calculation_configs
    FOR ALL
    USING (get_user_role() IN ('super_admin','hr_admin'));

-- ---------------------------------------------------------------------------
-- ROW LEVEL SECURITY: calculation_trace_log
-- ---------------------------------------------------------------------------
ALTER TABLE calculation_trace_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "ctl_tenant_read" ON calculation_trace_log
    FOR SELECT
    USING (tenant_id = get_user_tenant_id());

CREATE POLICY "ctl_hr_write" ON calculation_trace_log
    FOR ALL
    USING (get_user_role() IN ('super_admin','hr_admin'));
