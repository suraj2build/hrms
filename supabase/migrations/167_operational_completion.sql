-- =============================================================================
-- 167_operational_completion.sql
-- Enterprise Workforce Platform — Operational Completion Pass
--
-- Adds:
--   1. payroll_adjustments    — queue for retroactive adjustments on locked periods
--   2. scheduler_job_log      — persistent log of async job executions
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. payroll_adjustments
-- When a payroll period is locked/frozen and a retroactive change occurs
-- (e.g. leave approved for that period), a pending adjustment is queued here.
-- HR reviews and applies adjustments to the next open run.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS payroll_adjustments (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id           UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    employee_id         UUID NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
    locked_month        TEXT NOT NULL,      -- YYYY-MM: the frozen period affected
    apply_to_month      TEXT,               -- YYYY-MM: when this will be/was applied
    adjustment_type     TEXT NOT NULL CHECK (adjustment_type IN (
                            'lop_adjustment',      -- retro leave → LOP change
                            'arrear',              -- missed salary paid in later month
                            'statutory_correction',-- EPF/ESI/PTax correction
                            'manual'               -- operator-initiated
                        )),
    amount              DECIMAL(12,2) NOT NULL DEFAULT 0,
    lop_days_delta      DECIMAL(5,2),       -- change in LOP days (positive = more LOP)
    reason              TEXT NOT NULL,
    source_type         TEXT CHECK (source_type IN (
                            'leave_approval','statutory_revision','payroll_error','manual'
                        )),
    source_id           UUID,               -- FK to originating record (leave_application.id etc.)
    status              TEXT NOT NULL DEFAULT 'pending' CHECK (status IN (
                            'pending','approved','applied','rejected','cancelled'
                        )),
    created_by          UUID REFERENCES profiles(id) ON DELETE SET NULL,
    approved_by         UUID REFERENCES profiles(id) ON DELETE SET NULL,
    applied_run_id      UUID REFERENCES payroll_runs(id) ON DELETE SET NULL,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    approved_at         TIMESTAMPTZ,
    applied_at          TIMESTAMPTZ,
    notes               TEXT,
    CONSTRAINT padj_dates_ok CHECK (apply_to_month IS NULL OR apply_to_month >= locked_month)
);

CREATE INDEX IF NOT EXISTS idx_padj_tenant_status
    ON payroll_adjustments (tenant_id, status)
    WHERE status = 'pending';

CREATE INDEX IF NOT EXISTS idx_padj_employee
    ON payroll_adjustments (tenant_id, employee_id);

CREATE INDEX IF NOT EXISTS idx_padj_locked_month
    ON payroll_adjustments (tenant_id, locked_month);

ALTER TABLE payroll_adjustments ENABLE ROW LEVEL SECURITY;

CREATE POLICY "padj_tenant_read" ON payroll_adjustments
    FOR SELECT USING (tenant_id = get_user_tenant_id());

CREATE POLICY "padj_hr_write" ON payroll_adjustments
    FOR ALL USING (get_user_role() IN ('super_admin', 'hr_admin'));

-- ---------------------------------------------------------------------------
-- 2. scheduler_job_log
-- Lightweight persistent audit log of async background job executions.
-- Written by route handlers and background workers on job start/end.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS scheduler_job_log (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id       UUID REFERENCES tenants(id) ON DELETE CASCADE,
                    -- NULL = system-wide job (not tenant-scoped)
    job_type        TEXT NOT NULL,   -- 'payroll_run', 'epf_compute', 'esi_compute', 'ptax_compute',
                                     -- 'leave_accrual', 'attendance_recompute', 'snapshot_build', etc.
    job_name        TEXT,            -- human label for the specific invocation
    trigger_type    TEXT NOT NULL DEFAULT 'manual' CHECK (trigger_type IN (
                        'scheduled', 'manual', 'retry', 'event'
                    )),
    status          TEXT NOT NULL CHECK (status IN (
                        'started', 'completed', 'failed', 'timeout', 'cancelled'
                    )),
    started_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    completed_at    TIMESTAMPTZ,
    duration_ms     INTEGER,
    affected_count  INTEGER,         -- number of employees / records processed
    error_message   TEXT,
    retry_count     INTEGER NOT NULL DEFAULT 0,
    parent_job_id   UUID REFERENCES scheduler_job_log(id) ON DELETE SET NULL,
    triggered_by    UUID REFERENCES profiles(id) ON DELETE SET NULL,
    meta            JSONB NOT NULL DEFAULT '{}'
);

CREATE INDEX IF NOT EXISTS idx_sjl_tenant_status
    ON scheduler_job_log (tenant_id, status, started_at DESC);

CREATE INDEX IF NOT EXISTS idx_sjl_job_type
    ON scheduler_job_log (job_type, started_at DESC);

ALTER TABLE scheduler_job_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "sjl_tenant_read" ON scheduler_job_log
    FOR SELECT USING (
        tenant_id IS NULL OR tenant_id = get_user_tenant_id()
    );

CREATE POLICY "sjl_insert" ON scheduler_job_log
    FOR INSERT WITH CHECK (
        tenant_id IS NULL OR tenant_id = get_user_tenant_id()
    );
