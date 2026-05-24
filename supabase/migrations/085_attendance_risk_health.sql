-- =============================================================================
-- FILE    : supabase/migrations/085_attendance_risk_health.sql
-- PURPOSE : Attendance risk profiling and health scoring for the HRMS
--           attendance intelligence sprint.
--
--           attendance_risk_profiles  – per-employee risk scores computed over
--             configurable date periods, capturing chronic lateness, punch
--             anomalies, geo inconsistencies, shift non-compliance, and other
--             behavioural signals into a single risk score + level.
--
--           attendance_health_scores  – aggregated health scores at employee,
--             department, site, or tenant scope for a given calendar month,
--             used for dashboards, SLA reporting, and anomaly rate tracking.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- TABLE: attendance_risk_profiles
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS attendance_risk_profiles (
    id                              UUID          NOT NULL DEFAULT gen_random_uuid(),
    tenant_id                       UUID          NOT NULL,
    employee_id                     UUID          NOT NULL,

    -- Scoring period
    period_start                    DATE          NOT NULL,
    period_end                      DATE          NOT NULL,

    -- Aggregate risk
    risk_score                      DECIMAL(5,2)  NOT NULL DEFAULT 0
        CHECK (risk_score >= 0 AND risk_score <= 100),
    risk_level                      TEXT          NOT NULL DEFAULT 'low'
        CHECK (risk_level IN ('low', 'medium', 'high', 'critical')),

    -- Component counters
    chronic_late_count              INT           NOT NULL DEFAULT 0,
    attendance_instability_score    DECIMAL(5,2)  NOT NULL DEFAULT 0,
    correction_abuse_count          INT           NOT NULL DEFAULT 0,
    punch_anomaly_count             INT           NOT NULL DEFAULT 0,
    shift_non_compliance_count      INT           NOT NULL DEFAULT 0,
    geo_inconsistency_count         INT           NOT NULL DEFAULT 0,
    attendance_volatility           DECIMAL(5,2)  NOT NULL DEFAULT 0,

    -- Detailed breakdown
    -- Shape: [{factor: TEXT, score: DECIMAL, detail: TEXT}]
    risk_factors                    JSONB         NULL,

    computed_at                     TIMESTAMPTZ   NOT NULL DEFAULT now(),

    -- Constraints
    CONSTRAINT attendance_risk_profiles_pkey PRIMARY KEY (id),
    CONSTRAINT att_risk_profiles_tenant_fk
        FOREIGN KEY (tenant_id)   REFERENCES tenants(id)   ON DELETE CASCADE,
    CONSTRAINT att_risk_profiles_employee_fk
        FOREIGN KEY (employee_id) REFERENCES employees(id) ON DELETE CASCADE,
    CONSTRAINT att_risk_profiles_unique_period
        UNIQUE (tenant_id, employee_id, period_start, period_end)
);

-- ---------------------------------------------------------------------------
-- INDEXES – attendance_risk_profiles
-- ---------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_att_risk_tenant_level_computed
    ON attendance_risk_profiles (tenant_id, risk_level, computed_at DESC);

CREATE INDEX IF NOT EXISTS idx_att_risk_tenant_emp_period_end
    ON attendance_risk_profiles (tenant_id, employee_id, period_end DESC);

-- ---------------------------------------------------------------------------
-- RLS – attendance_risk_profiles
-- ---------------------------------------------------------------------------
ALTER TABLE attendance_risk_profiles ENABLE ROW LEVEL SECURITY;

CREATE POLICY attendance_risk_profiles_tenant_read
    ON attendance_risk_profiles
    FOR SELECT
    USING (tenant_id = get_user_tenant_id());

CREATE POLICY attendance_risk_profiles_hr_write
    ON attendance_risk_profiles
    FOR ALL
    USING (
        tenant_id = get_user_tenant_id()
        AND get_user_role() IN ('super_admin', 'hr_admin')
    )
    WITH CHECK (
        tenant_id = get_user_tenant_id()
        AND get_user_role() IN ('super_admin', 'hr_admin')
    );

-- ---------------------------------------------------------------------------
-- TABLE: attendance_health_scores
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS attendance_health_scores (
    id                              UUID          NOT NULL DEFAULT gen_random_uuid(),
    tenant_id                       UUID          NOT NULL,

    -- Scope of the aggregation
    scope                           TEXT          NOT NULL
        CHECK (scope IN ('employee', 'department', 'site', 'tenant')),
    -- scope_id holds the relevant UUID/ID string depending on scope:
    -- employee  → employee_id
    -- department → department_id
    -- site       → site_id
    -- tenant     → tenant_id
    scope_id                        TEXT          NOT NULL,

    -- Reporting period (calendar month)
    period_month                    TEXT          NOT NULL,  -- 'YYYY-MM'

    -- Headline health metrics
    health_score                    DECIMAL(5,2)  NOT NULL DEFAULT 100
        CHECK (health_score >= 0 AND health_score <= 100),
    health_grade                    TEXT          NOT NULL DEFAULT 'A'
        CHECK (health_grade IN ('A', 'B', 'C', 'D', 'F')),

    -- Rate metrics (0-100 percentage values)
    anomaly_rate                    DECIMAL(5,2)  NOT NULL DEFAULT 0,
    missing_punch_rate              DECIMAL(5,2)  NOT NULL DEFAULT 0,
    correction_rate                 DECIMAL(5,2)  NOT NULL DEFAULT 0,
    inference_rate                  DECIMAL(5,2)  NOT NULL DEFAULT 0,
    instability_score               DECIMAL(5,2)  NOT NULL DEFAULT 0,

    -- Count metrics
    policy_conflict_count           INT           NOT NULL DEFAULT 0,
    payroll_impacting_exceptions    INT           NOT NULL DEFAULT 0,

    -- Detailed score breakdown (arbitrary JSON object)
    score_breakdown                 JSONB         NULL,

    computed_at                     TIMESTAMPTZ   NOT NULL DEFAULT now(),

    -- Constraints
    CONSTRAINT attendance_health_scores_pkey PRIMARY KEY (id),
    CONSTRAINT att_health_scores_tenant_fk
        FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE,
    CONSTRAINT att_health_scores_unique_scope_period
        UNIQUE (tenant_id, scope, scope_id, period_month)
);

-- ---------------------------------------------------------------------------
-- INDEXES – attendance_health_scores
-- ---------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_att_health_tenant_scope_month
    ON attendance_health_scores (tenant_id, scope, period_month DESC);

CREATE INDEX IF NOT EXISTS idx_att_health_tenant_grade_month
    ON attendance_health_scores (tenant_id, health_grade, period_month DESC);

-- ---------------------------------------------------------------------------
-- RLS – attendance_health_scores
-- ---------------------------------------------------------------------------
ALTER TABLE attendance_health_scores ENABLE ROW LEVEL SECURITY;

CREATE POLICY attendance_health_scores_tenant_read
    ON attendance_health_scores
    FOR SELECT
    USING (tenant_id = get_user_tenant_id());

CREATE POLICY attendance_health_scores_hr_write
    ON attendance_health_scores
    FOR ALL
    USING (
        tenant_id = get_user_tenant_id()
        AND get_user_role() IN ('super_admin', 'hr_admin')
    )
    WITH CHECK (
        tenant_id = get_user_tenant_id()
        AND get_user_role() IN ('super_admin', 'hr_admin')
    );
