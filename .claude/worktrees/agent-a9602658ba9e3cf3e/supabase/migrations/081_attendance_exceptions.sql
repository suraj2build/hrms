-- =============================================================================
-- FILE    : supabase/migrations/081_attendance_exceptions.sql
-- PURPOSE : Attendance exception tracking table for the HRMS attendance
--           intelligence sprint. Captures every detected anomaly or rule
--           violation for a given employee-date, with SLA tracking, severity
--           grading, payroll-impact flags, and a full resolution workflow.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- TABLE: attendance_exceptions
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS attendance_exceptions (
    id                      UUID          NOT NULL DEFAULT gen_random_uuid(),
    tenant_id               UUID          NOT NULL,
    employee_id             UUID          NOT NULL,
    date                    DATE          NOT NULL,

    -- Classification
    exception_type          TEXT          NOT NULL,
    exception_category      TEXT          NOT NULL
        CHECK (exception_category IN (
            'punch', 'shift', 'roster', 'policy',
            'device', 'geo', 'integrity', 'payroll'
        )),
    severity                TEXT          NOT NULL DEFAULT 'medium'
        CHECK (severity IN ('low', 'medium', 'high', 'critical')),

    -- Impact flags
    payroll_impacting        BOOLEAN       NOT NULL DEFAULT false,
    requires_investigation   BOOLEAN       NOT NULL DEFAULT false,
    confidence_impact        DECIMAL(4,2)  NOT NULL DEFAULT 0
        CHECK (confidence_impact >= 0 AND confidence_impact <= 1),

    -- Lifecycle / SLA
    status                  TEXT          NOT NULL DEFAULT 'open'
        CHECK (status IN ('open', 'acknowledged', 'resolved', 'escalated', 'dismissed')),
    sla_due_at              TIMESTAMPTZ   NULL,
    sla_breached            BOOLEAN       NOT NULL DEFAULT false,

    -- Investigation & resolution
    investigation_id        UUID          NULL,  -- soft reference, no FK
    resolution_note         TEXT          NULL,
    resolved_by             UUID          NULL,
    resolved_at             TIMESTAMPTZ   NULL,

    -- Provenance
    source                  TEXT          NOT NULL DEFAULT 'system'
        CHECK (source IN ('system', 'manual', 'import')),
    metadata                JSONB         NULL,

    -- Audit timestamps
    created_at              TIMESTAMPTZ   NOT NULL DEFAULT now(),
    updated_at              TIMESTAMPTZ   NOT NULL DEFAULT now(),

    -- Constraints
    CONSTRAINT attendance_exceptions_pkey PRIMARY KEY (id),
    CONSTRAINT attendance_exceptions_tenant_fk
        FOREIGN KEY (tenant_id)   REFERENCES tenants(id)   ON DELETE CASCADE,
    CONSTRAINT attendance_exceptions_employee_fk
        FOREIGN KEY (employee_id) REFERENCES employees(id) ON DELETE CASCADE,
    CONSTRAINT attendance_exceptions_resolved_by_fk
        FOREIGN KEY (resolved_by) REFERENCES profiles(id)  ON DELETE SET NULL
);

-- ---------------------------------------------------------------------------
-- INDEXES
-- ---------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_att_exc_tenant_date
    ON attendance_exceptions (tenant_id, date DESC);

CREATE INDEX IF NOT EXISTS idx_att_exc_tenant_emp_date
    ON attendance_exceptions (tenant_id, employee_id, date DESC);

CREATE INDEX IF NOT EXISTS idx_att_exc_tenant_category_severity
    ON attendance_exceptions (tenant_id, exception_category, severity);

CREATE INDEX IF NOT EXISTS idx_att_exc_tenant_status_sla
    ON attendance_exceptions (tenant_id, status, sla_due_at);

CREATE INDEX IF NOT EXISTS idx_att_exc_tenant_payroll_date
    ON attendance_exceptions (tenant_id, payroll_impacting, date DESC);

CREATE INDEX IF NOT EXISTS idx_att_exc_tenant_sla_breached
    ON attendance_exceptions (tenant_id, sla_breached)
    WHERE sla_breached = true;

-- ---------------------------------------------------------------------------
-- ROW-LEVEL SECURITY
-- ---------------------------------------------------------------------------
ALTER TABLE attendance_exceptions ENABLE ROW LEVEL SECURITY;

-- Tenants can read their own rows
CREATE POLICY attendance_exceptions_tenant_read
    ON attendance_exceptions
    FOR SELECT
    USING (tenant_id = get_user_tenant_id());

-- HR admins and super admins can insert / update / delete
CREATE POLICY attendance_exceptions_hr_write
    ON attendance_exceptions
    FOR ALL
    USING (
        tenant_id = get_user_tenant_id()
        AND get_user_role() IN ('super_admin', 'hr_admin')
    )
    WITH CHECK (
        tenant_id = get_user_tenant_id()
        AND get_user_role() IN ('super_admin', 'hr_admin')
    );
