-- =============================================================================
-- FILE    : supabase/migrations/082_attendance_confidence.sql
-- PURPOSE : Attendance confidence scoring for the HRMS attendance intelligence
--           sprint. Adds confidence columns to `attendance_daily` and creates
--           the `attendance_inference_log` table that records every inference
--           event used to reconstruct or approximate attendance data, together
--           with the confidence penalty each event contributes.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- STEP 1 – Add confidence columns to attendance_daily
-- ---------------------------------------------------------------------------
ALTER TABLE attendance_daily
    ADD COLUMN IF NOT EXISTS confidence_score   DECIMAL(5,2) NOT NULL DEFAULT 100
        CHECK (confidence_score >= 0 AND confidence_score <= 100),
    ADD COLUMN IF NOT EXISTS confidence_level   TEXT         NOT NULL DEFAULT 'high'
        CHECK (confidence_level IN ('high', 'medium', 'low', 'critical')),
    ADD COLUMN IF NOT EXISTS confidence_factors JSONB        NULL;
    -- confidence_factors shape: [{factor: TEXT, impact: DECIMAL, explanation: TEXT}]

-- ---------------------------------------------------------------------------
-- STEP 2 – TABLE: attendance_inference_log
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS attendance_inference_log (
    id                          UUID          NOT NULL DEFAULT gen_random_uuid(),
    tenant_id                   UUID          NOT NULL,
    employee_id                 UUID          NOT NULL,
    date                        DATE          NOT NULL,

    -- Inference classification
    inference_type              TEXT          NOT NULL
        CHECK (inference_type IN (
            'single_punch',
            'device_outage',
            'manager_confirmed',
            'field_work',
            'network_outage',
            'geo_fallback',
            'prior_pattern',
            'hr_override'
        )),
    inference_reason            TEXT          NOT NULL,

    -- Actor: 'system', a user UUID string, or 'manager'
    inferred_by                 TEXT          NOT NULL DEFAULT 'system',

    -- Confidence impact: how many points this inference deducts (0-100)
    inference_confidence_penalty DECIMAL(5,2) NOT NULL DEFAULT 0
        CHECK (inference_confidence_penalty >= 0 AND inference_confidence_penalty <= 100),

    inference_explanation       TEXT          NOT NULL,

    -- Approval
    approved_by                 UUID          NULL,
    approved_at                 TIMESTAMPTZ   NULL,

    -- Processing reference
    run_id                      UUID          NULL,

    -- Audit timestamp
    created_at                  TIMESTAMPTZ   NOT NULL DEFAULT now(),

    -- Constraints
    CONSTRAINT attendance_inference_log_pkey PRIMARY KEY (id),
    CONSTRAINT att_inference_log_tenant_fk
        FOREIGN KEY (tenant_id)   REFERENCES tenants(id)   ON DELETE CASCADE,
    CONSTRAINT att_inference_log_employee_fk
        FOREIGN KEY (employee_id) REFERENCES employees(id) ON DELETE CASCADE,
    CONSTRAINT att_inference_log_approved_by_fk
        FOREIGN KEY (approved_by) REFERENCES profiles(id)  ON DELETE SET NULL
);

-- ---------------------------------------------------------------------------
-- INDEXES
-- ---------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_att_infer_tenant_emp_date
    ON attendance_inference_log (tenant_id, employee_id, date DESC);

CREATE INDEX IF NOT EXISTS idx_att_infer_tenant_type_date
    ON attendance_inference_log (tenant_id, inference_type, date DESC);

-- ---------------------------------------------------------------------------
-- ROW-LEVEL SECURITY
-- ---------------------------------------------------------------------------
ALTER TABLE attendance_inference_log ENABLE ROW LEVEL SECURITY;

-- Tenants can read their own rows
CREATE POLICY attendance_inference_log_tenant_read
    ON attendance_inference_log
    FOR SELECT
    USING (tenant_id = get_user_tenant_id());

-- HR admins and super admins can insert / update / delete
CREATE POLICY attendance_inference_log_hr_write
    ON attendance_inference_log
    FOR ALL
    USING (
        tenant_id = get_user_tenant_id()
        AND get_user_role() IN ('super_admin', 'hr_admin')
    )
    WITH CHECK (
        tenant_id = get_user_tenant_id()
        AND get_user_role() IN ('super_admin', 'hr_admin')
    );
