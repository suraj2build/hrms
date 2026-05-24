-- =============================================================================
-- 182_ensure_observability_tables.sql
--
-- Idempotent guards for the four operational-dashboard tables that back
-- the Control Center page. Migrations 081, 087, 118 and 119 already create
-- these, but this migration re-applies the CREATE TABLE IF NOT EXISTS
-- statements so a fresh or partially-migrated DB always has what it needs
-- without failing on an already-applied migration.
--
-- Safe to run multiple times (all statements are IF NOT EXISTS).
-- =============================================================================

-- ── attendance_exceptions ─────────────────────────────────────────────────────
-- Source: migration 081
CREATE TABLE IF NOT EXISTS attendance_exceptions (
    id                      UUID          NOT NULL DEFAULT gen_random_uuid(),
    tenant_id               UUID          NOT NULL,
    employee_id             UUID          NOT NULL,
    date                    DATE          NOT NULL,
    exception_type          TEXT          NOT NULL,
    exception_category      TEXT          NOT NULL
        CHECK (exception_category IN (
            'punch', 'shift', 'roster', 'policy',
            'device', 'geo', 'integrity', 'payroll'
        )),
    severity                TEXT          NOT NULL DEFAULT 'medium'
        CHECK (severity IN ('low', 'medium', 'high', 'critical')),
    payroll_impacting        BOOLEAN       NOT NULL DEFAULT false,
    requires_investigation   BOOLEAN       NOT NULL DEFAULT false,
    confidence_impact        DECIMAL(4,2)  NOT NULL DEFAULT 0
        CHECK (confidence_impact >= 0 AND confidence_impact <= 1),
    status                  TEXT          NOT NULL DEFAULT 'open'
        CHECK (status IN ('open', 'acknowledged', 'resolved', 'escalated', 'dismissed')),
    sla_due_at              TIMESTAMPTZ   NULL,
    sla_breached            BOOLEAN       NOT NULL DEFAULT false,
    investigation_id        UUID          NULL,
    resolution_note         TEXT          NULL,
    resolved_by             UUID          NULL,
    resolved_at             TIMESTAMPTZ   NULL,
    source                  TEXT          NOT NULL DEFAULT 'system'
        CHECK (source IN ('system', 'manual', 'import')),
    metadata                JSONB         NULL,
    created_at              TIMESTAMPTZ   NOT NULL DEFAULT now(),
    updated_at              TIMESTAMPTZ   NOT NULL DEFAULT now(),
    CONSTRAINT attendance_exceptions_pkey PRIMARY KEY (id),
    CONSTRAINT attendance_exceptions_tenant_fk
        FOREIGN KEY (tenant_id)   REFERENCES tenants(id)   ON DELETE CASCADE,
    CONSTRAINT attendance_exceptions_employee_fk
        FOREIGN KEY (employee_id) REFERENCES employees(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_att_exc_tenant_date
    ON attendance_exceptions (tenant_id, date DESC);
CREATE INDEX IF NOT EXISTS idx_att_exc_tenant_category_severity
    ON attendance_exceptions (tenant_id, exception_category, severity);
CREATE INDEX IF NOT EXISTS idx_att_exc_tenant_status_sla
    ON attendance_exceptions (tenant_id, status, sla_due_at);

ALTER TABLE attendance_exceptions ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'attendance_exceptions'
      AND policyname = 'attendance_exceptions_tenant_read'
  ) THEN
    CREATE POLICY attendance_exceptions_tenant_read
      ON attendance_exceptions FOR SELECT
      USING (tenant_id = get_user_tenant_id());
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'attendance_exceptions'
      AND policyname = 'attendance_exceptions_hr_write'
  ) THEN
    CREATE POLICY attendance_exceptions_hr_write
      ON attendance_exceptions FOR ALL
      USING (get_user_role() IN ('super_admin', 'hr_admin'));
  END IF;
END $$;


-- ── scheduler_heartbeats ──────────────────────────────────────────────────────
-- Source: migration 118
CREATE TABLE IF NOT EXISTS scheduler_heartbeats (
    id                 UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    scheduler_name     TEXT        NOT NULL,
    tenant_id          TEXT,
    last_heartbeat_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    status             TEXT        NOT NULL DEFAULT 'ok'
        CHECK (status IN ('ok', 'degraded', 'error')),
    tick_count         BIGINT      NOT NULL DEFAULT 0,
    last_error         TEXT,
    metadata           JSONB       NOT NULL DEFAULT '{}',
    created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (scheduler_name, tenant_id)
);

CREATE INDEX IF NOT EXISTS idx_scheduler_heartbeats_stale
    ON scheduler_heartbeats (last_heartbeat_at);


-- ── attendance_reconciliation_runs ───────────────────────────────────────────
-- Source: migration 119
CREATE TABLE IF NOT EXISTS attendance_reconciliation_runs (
    id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id       UUID        NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    status          TEXT        NOT NULL DEFAULT 'running'
        CHECK (status IN ('running', 'completed', 'failed')),
    scan_from       DATE        NOT NULL,
    scan_to         DATE        NOT NULL,
    started_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    completed_at    TIMESTAMPTZ,
    duration_ms     INT,
    total_issues    INT         NOT NULL DEFAULT 0,
    critical_count  INT         NOT NULL DEFAULT 0,
    error_count     INT         NOT NULL DEFAULT 0,
    warning_count   INT         NOT NULL DEFAULT 0,
    info_count      INT         NOT NULL DEFAULT 0,
    issue_breakdown JSONB       NOT NULL DEFAULT '{}',
    trigger_source  TEXT        NOT NULL DEFAULT 'api'
        CHECK (trigger_source IN ('api', 'scheduler', 'manual')),
    triggered_by    UUID        REFERENCES profiles(id) ON DELETE SET NULL,
    error_message   TEXT,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_att_recon_runs_tenant
    ON attendance_reconciliation_runs (tenant_id, started_at DESC);


-- ── attendance_reconciliation_issues ─────────────────────────────────────────
-- Source: migration 119
CREATE TABLE IF NOT EXISTS attendance_reconciliation_issues (
    id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    run_id        UUID        NOT NULL
        REFERENCES attendance_reconciliation_runs(id) ON DELETE CASCADE,
    tenant_id     UUID        NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    issue_type    TEXT        NOT NULL CHECK (issue_type IN (
        'orphan_raw_log', 'incomplete_session', 'missing_daily_row',
        'duplicate_session', 'cross_day_session', 'stale_processing_gap',
        'missing_raw_source'
    )),
    severity      TEXT        NOT NULL DEFAULT 'warning'
        CHECK (severity IN ('info', 'warning', 'error', 'critical')),
    employee_id   UUID        REFERENCES employees(id) ON DELETE SET NULL,
    date          DATE,
    detail        JSONB       NOT NULL DEFAULT '{}',
    suggestion    TEXT,
    resolved      BOOLEAN     NOT NULL DEFAULT false,
    resolved_at   TIMESTAMPTZ,
    resolved_by   UUID        REFERENCES profiles(id) ON DELETE SET NULL,
    resolution_note TEXT,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_att_recon_issues_run
    ON attendance_reconciliation_issues (run_id, issue_type, severity);
CREATE INDEX IF NOT EXISTS idx_att_recon_issues_open
    ON attendance_reconciliation_issues (tenant_id, severity, created_at DESC)
    WHERE resolved = false;

ALTER TABLE attendance_reconciliation_runs  ENABLE ROW LEVEL SECURITY;
ALTER TABLE attendance_reconciliation_issues ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'attendance_reconciliation_runs'
      AND policyname = 'arr_hr_all'
  ) THEN
    CREATE POLICY "arr_hr_all" ON attendance_reconciliation_runs
      FOR ALL USING (get_user_role() IN ('super_admin','hr_admin'));
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'attendance_reconciliation_issues'
      AND policyname = 'ari_hr_all'
  ) THEN
    CREATE POLICY "ari_hr_all" ON attendance_reconciliation_issues
      FOR ALL USING (get_user_role() IN ('super_admin','hr_admin'));
  END IF;
END $$;
