-- =============================================================================
-- FILE    : supabase/migrations/083_attendance_policy_conflicts.sql
-- PURPOSE : Policy conflict detection log for the HRMS attendance intelligence
--           sprint. Records every instance where two attendance or HR policies
--           produce contradictory outcomes for the same employee-date, along
--           with which policy took precedence, why, and whether the conflict
--           affects payroll.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- TABLE: attendance_policy_conflict_log
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS attendance_policy_conflict_log (
    id                      UUID          NOT NULL DEFAULT gen_random_uuid(),
    tenant_id               UUID          NOT NULL,
    employee_id             UUID          NOT NULL,
    date                    DATE          NOT NULL,

    -- Conflict classification
    conflict_type           TEXT          NOT NULL
        CHECK (conflict_type IN (
            'late_vs_halfday',
            'holiday_vs_weekly_off',
            'leave_vs_attendance',
            'ot_vs_unauthorized_shift',
            'leave_vs_ot',
            'roster_shift_mismatch',
            'grace_overlap',
            'policy_gap'
        )),

    -- The two competing policies / rules
    policy_a                TEXT          NOT NULL,
    policy_b                TEXT          NOT NULL,

    -- Severity
    conflict_severity       TEXT          NOT NULL DEFAULT 'medium'
        CHECK (conflict_severity IN ('low', 'medium', 'high')),

    -- How the conflict was resolved
    resolution_source       TEXT          NOT NULL DEFAULT 'system'
        CHECK (resolution_source IN (
            'system', 'manual', 'hr_override', 'policy_precedence'
        )),
    applied_precedence      TEXT          NOT NULL,
    conflict_explanation    TEXT          NOT NULL,

    -- Payroll impact
    payroll_impacting       BOOLEAN       NOT NULL DEFAULT false,

    -- Processing reference
    run_id                  UUID          NULL,

    -- Audit timestamp
    created_at              TIMESTAMPTZ   NOT NULL DEFAULT now(),

    -- Constraints
    CONSTRAINT attendance_policy_conflict_log_pkey PRIMARY KEY (id),
    CONSTRAINT att_policy_conflict_tenant_fk
        FOREIGN KEY (tenant_id)   REFERENCES tenants(id)   ON DELETE CASCADE,
    CONSTRAINT att_policy_conflict_employee_fk
        FOREIGN KEY (employee_id) REFERENCES employees(id) ON DELETE CASCADE
);

-- ---------------------------------------------------------------------------
-- INDEXES
-- ---------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_att_pol_conf_tenant_emp_date
    ON attendance_policy_conflict_log (tenant_id, employee_id, date DESC);

CREATE INDEX IF NOT EXISTS idx_att_pol_conf_tenant_type_date
    ON attendance_policy_conflict_log (tenant_id, conflict_type, date DESC);

CREATE INDEX IF NOT EXISTS idx_att_pol_conf_tenant_payroll_date
    ON attendance_policy_conflict_log (tenant_id, payroll_impacting, date DESC);

-- ---------------------------------------------------------------------------
-- ROW-LEVEL SECURITY
-- ---------------------------------------------------------------------------
ALTER TABLE attendance_policy_conflict_log ENABLE ROW LEVEL SECURITY;

-- Tenants can read their own rows
CREATE POLICY attendance_policy_conflict_log_tenant_read
    ON attendance_policy_conflict_log
    FOR SELECT
    USING (tenant_id = get_user_tenant_id());

-- HR admins and super admins can insert / update / delete
CREATE POLICY attendance_policy_conflict_log_hr_write
    ON attendance_policy_conflict_log
    FOR ALL
    USING (
        tenant_id = get_user_tenant_id()
        AND get_user_role() IN ('super_admin', 'hr_admin')
    )
    WITH CHECK (
        tenant_id = get_user_tenant_id()
        AND get_user_role() IN ('super_admin', 'hr_admin')
    );
