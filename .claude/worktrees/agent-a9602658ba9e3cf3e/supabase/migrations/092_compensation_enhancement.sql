-- =============================================================================
-- 092_compensation_enhancement.sql
-- Compensation revision tracking and immutable snapshots
-- Tracks every change to employee compensation with full audit trail.
-- Snapshots freeze compensation state at key moments (payroll run, revision).
-- =============================================================================

-- ---------------------------------------------------------------------------
-- TABLE: compensation_revisions
-- Every change to an employee's compensation package is logged here.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS compensation_revisions (
    id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id               UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    employee_id             UUID NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
    old_compensation_id     UUID REFERENCES employee_compensations(id) ON DELETE SET NULL,
    new_compensation_id     UUID REFERENCES employee_compensations(id) ON DELETE SET NULL,
    revision_type           TEXT NOT NULL CHECK (revision_type IN (
                                'initial','increment','decrement','restructure',
                                'correction','promotion','transfer')),
    revision_reason         TEXT NOT NULL,
    effective_date          DATE NOT NULL,
    revised_ctc_annual      DECIMAL(14,2) NOT NULL,
    previous_ctc_annual     DECIMAL(14,2),
    ctc_change_amount       DECIMAL(14,2) GENERATED ALWAYS AS
                                (revised_ctc_annual - COALESCE(previous_ctc_annual, 0)) STORED,
    ctc_change_pct          DECIMAL(8,4),
    status                  TEXT NOT NULL DEFAULT 'draft' CHECK (status IN (
                                'draft','pending_approval','approved','rejected','cancelled')),
    approved_by             UUID REFERENCES profiles(id) ON DELETE SET NULL,
    approved_at             TIMESTAMPTZ,
    rejected_reason         TEXT,
    effective_order         INT NOT NULL DEFAULT 0,
    is_retro                BOOLEAN NOT NULL DEFAULT false,
    payroll_impact_month    TEXT,
    metadata                JSONB NOT NULL DEFAULT '{}',
    created_by              UUID REFERENCES profiles(id) ON DELETE SET NULL,
    created_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (tenant_id, employee_id, effective_date, revision_type)
);

-- ---------------------------------------------------------------------------
-- TABLE: compensation_snapshots
-- Immutable point-in-time record of an employee's full compensation breakdown.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS compensation_snapshots (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id           UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    employee_id         UUID NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
    compensation_id     UUID REFERENCES employee_compensations(id) ON DELETE SET NULL,
    snapshot_type       TEXT NOT NULL CHECK (snapshot_type IN (
                            'revision_before','revision_after','payroll_run',
                            'manual','year_start')),
    payroll_run_id      UUID,
    snapshot_date       DATE NOT NULL,
    gross_salary        DECIMAL(14,2) NOT NULL,
    net_salary          DECIMAL(14,2) NOT NULL,
    total_earnings      DECIMAL(14,2) NOT NULL DEFAULT 0,
    total_deductions    DECIMAL(14,2) NOT NULL DEFAULT 0,
    components_snapshot JSONB NOT NULL DEFAULT '{}',
    statutory_snapshot  JSONB NOT NULL DEFAULT '{}',
    created_by          UUID REFERENCES profiles(id) ON DELETE SET NULL,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------------
-- INDEXES
-- ---------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_cr_tenant_employee
    ON compensation_revisions (tenant_id, employee_id, effective_date DESC);

CREATE INDEX IF NOT EXISTS idx_cr_tenant_status
    ON compensation_revisions (tenant_id, status);

CREATE INDEX IF NOT EXISTS idx_cs_tenant_employee
    ON compensation_snapshots (tenant_id, employee_id, snapshot_date DESC);

-- ---------------------------------------------------------------------------
-- ROW LEVEL SECURITY: compensation_revisions
-- ---------------------------------------------------------------------------
ALTER TABLE compensation_revisions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "cr_tenant_read" ON compensation_revisions
    FOR SELECT
    USING (tenant_id = get_user_tenant_id());

CREATE POLICY "cr_hr_write" ON compensation_revisions
    FOR ALL
    USING (get_user_role() IN ('super_admin','hr_admin'));

-- ---------------------------------------------------------------------------
-- ROW LEVEL SECURITY: compensation_snapshots
-- ---------------------------------------------------------------------------
ALTER TABLE compensation_snapshots ENABLE ROW LEVEL SECURITY;

CREATE POLICY "cs_tenant_read" ON compensation_snapshots
    FOR SELECT
    USING (tenant_id = get_user_tenant_id());

CREATE POLICY "cs_hr_write" ON compensation_snapshots
    FOR ALL
    USING (get_user_role() IN ('super_admin','hr_admin'));
