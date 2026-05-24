-- =============================================================================
-- FILE    : supabase/migrations/084_attendance_retroactive.sql
-- PURPOSE : Retroactive impact tracking for the HRMS attendance intelligence
--           sprint. Every time a past-dated change (leave approval, correction,
--           policy update, etc.) alters a previously finalised attendance
--           record, a row is written here so downstream systems (payroll, leave
--           balance, OT, reliability scores) can be re-propagated in a
--           controlled, auditable way.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- TABLE: attendance_retroactive_impacts
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS attendance_retroactive_impacts (
    id                      UUID          NOT NULL DEFAULT gen_random_uuid(),
    tenant_id               UUID          NOT NULL,
    employee_id             UUID          NOT NULL,
    affected_date           DATE          NOT NULL,

    -- What triggered the retroactive change
    trigger_source          TEXT          NOT NULL
        CHECK (trigger_source IN (
            'leave_approval',
            'correction_approval',
            'policy_change',
            'roster_update',
            'shift_reassignment',
            'attendance_recompute',
            'manual_adjustment'
        )),
    trigger_id              TEXT          NULL,  -- ID of the triggering entity (any type)

    -- What downstream domains are impacted
    -- e.g. '{payroll,leave_balance,ot,reliability,variance}'
    impact_types            TEXT[]        NOT NULL DEFAULT '{}',

    -- Attendance status before and after the change
    before_status           TEXT          NULL,
    after_status            TEXT          NULL,

    -- Payroll runs that need to be flagged / reprocessed
    payroll_run_ids         TEXT[]        NOT NULL DEFAULT '{}',

    -- Human-readable explanation of the impact
    impact_explanation      TEXT          NOT NULL,

    -- Propagation lifecycle
    propagation_status      TEXT          NOT NULL DEFAULT 'detected'
        CHECK (propagation_status IN (
            'detected', 'propagating', 'completed', 'failed', 'skipped'
        )),
    recomputed_at           TIMESTAMPTZ   NULL,
    recompute_run_id        UUID          NULL,

    -- Audit timestamp
    created_at              TIMESTAMPTZ   NOT NULL DEFAULT now(),

    -- Constraints
    CONSTRAINT attendance_retroactive_impacts_pkey PRIMARY KEY (id),
    CONSTRAINT att_retro_impact_tenant_fk
        FOREIGN KEY (tenant_id)   REFERENCES tenants(id)   ON DELETE CASCADE,
    CONSTRAINT att_retro_impact_employee_fk
        FOREIGN KEY (employee_id) REFERENCES employees(id) ON DELETE CASCADE
);

-- ---------------------------------------------------------------------------
-- INDEXES
-- ---------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_att_retro_tenant_emp_date
    ON attendance_retroactive_impacts (tenant_id, employee_id, affected_date DESC);

CREATE INDEX IF NOT EXISTS idx_att_retro_tenant_trigger_created
    ON attendance_retroactive_impacts (tenant_id, trigger_source, created_at DESC);

-- Partial index: only rows that still need work
CREATE INDEX IF NOT EXISTS idx_att_retro_tenant_pending_propagation
    ON attendance_retroactive_impacts (tenant_id, propagation_status)
    WHERE propagation_status IN ('detected', 'propagating');

-- ---------------------------------------------------------------------------
-- ROW-LEVEL SECURITY
-- ---------------------------------------------------------------------------
ALTER TABLE attendance_retroactive_impacts ENABLE ROW LEVEL SECURITY;

-- Tenants can read their own rows
CREATE POLICY attendance_retroactive_impacts_tenant_read
    ON attendance_retroactive_impacts
    FOR SELECT
    USING (tenant_id = get_user_tenant_id());

-- HR admins and super admins can insert / update / delete
CREATE POLICY attendance_retroactive_impacts_hr_write
    ON attendance_retroactive_impacts
    FOR ALL
    USING (
        tenant_id = get_user_tenant_id()
        AND get_user_role() IN ('super_admin', 'hr_admin')
    )
    WITH CHECK (
        tenant_id = get_user_tenant_id()
        AND get_user_role() IN ('super_admin', 'hr_admin')
    );
