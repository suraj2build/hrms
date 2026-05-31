-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 119 — Reconciliation & Operational Observability
--
-- Adds schema supporting Sprint 3:
--   attendance_reconciliation_runs    — per-scan execution record
--   attendance_reconciliation_issues  — detected anomalies with repair hints
--   leave_reconciliation_runs         — per-scan execution record
--   leave_reconciliation_issues       — balance drift detected per employee/type
--   attendance_freshness_snapshots    — per-tenant daily freshness health
--
-- All reconciliation runs are non-destructive — detection only.
-- Issues can be marked resolved by an operator; the run engine never modifies
-- source data (attendance_raw_logs, attendance_daily, employee_leave_balance).
--
-- Rollback:
--   DROP TABLE IF EXISTS attendance_freshness_snapshots,
--     leave_reconciliation_issues, leave_reconciliation_runs,
--     attendance_reconciliation_issues, attendance_reconciliation_runs CASCADE;
-- ─────────────────────────────────────────────────────────────────────────────


-- ═══════════════════════════════════════════════════════════════════════════════
-- ATTENDANCE RECONCILIATION
-- ═══════════════════════════════════════════════════════════════════════════════

-- ── attendance_reconciliation_runs ────────────────────────────────────────────
-- One row per reconciliation scan execution. Stores aggregate breakdown and
-- links to individual issues.

CREATE TABLE IF NOT EXISTS attendance_reconciliation_runs (
  id                uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         uuid        NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  status            text        NOT NULL DEFAULT 'running'
    CHECK (status IN ('running', 'completed', 'failed')),
  scan_from         date        NOT NULL,
  scan_to           date        NOT NULL,
  started_at        timestamptz NOT NULL DEFAULT now(),
  completed_at      timestamptz,
  duration_ms       int,
  -- Summary counts per issue_type — stored as JSONB for flexible querying
  issue_breakdown   jsonb       NOT NULL DEFAULT '{}',
  total_issues      int         NOT NULL DEFAULT 0,
  -- Severity summary
  critical_count    int         NOT NULL DEFAULT 0,
  error_count       int         NOT NULL DEFAULT 0,
  warning_count     int         NOT NULL DEFAULT 0,
  -- Metadata
  triggered_by      uuid        REFERENCES profiles(id) ON DELETE SET NULL,
  trigger_source    text        NOT NULL DEFAULT 'manual'
    CHECK (trigger_source IN ('manual', 'scheduler', 'api')),
  error             text
);

CREATE INDEX IF NOT EXISTS idx_att_recon_runs_tenant
  ON attendance_reconciliation_runs (tenant_id, started_at DESC);

CREATE INDEX IF NOT EXISTS idx_att_recon_runs_status
  ON attendance_reconciliation_runs (tenant_id, status)
  WHERE status = 'running';

COMMENT ON TABLE attendance_reconciliation_runs IS
  'Execution log for attendance reconciliation scans. Each run covers a date '
  'range and records a breakdown of detected anomalies. Non-destructive — '
  'source tables are never modified by the reconciliation engine.';


-- ── attendance_reconciliation_issues ─────────────────────────────────────────
-- Individual anomalies detected during a reconciliation run.

CREATE TABLE IF NOT EXISTS attendance_reconciliation_issues (
  id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id        uuid        NOT NULL
    REFERENCES attendance_reconciliation_runs(id) ON DELETE CASCADE,
  tenant_id     uuid        NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,

  -- Issue classification
  issue_type    text        NOT NULL CHECK (issue_type IN (
    'orphan_raw_log',       -- raw_log with processed=false older than stale threshold
    'incomplete_session',   -- attendance_log with no check_out after 12h
    'missing_daily_row',    -- employee has session log but no attendance_daily row
    'duplicate_session',    -- multiple attendance_logs for same employee on same date
    'cross_day_session',    -- session check_in/check_out spans midnight
    'stale_processing_gap', -- date range with no processing run at all
    'missing_raw_source'    -- attendance_daily exists but no raw_logs for that date (source gap)
  )),
  severity      text        NOT NULL DEFAULT 'warning'
    CHECK (severity IN ('info', 'warning', 'error', 'critical')),

  -- Affected entity
  employee_id   uuid        REFERENCES employees(id) ON DELETE SET NULL,
  date          date,       -- affected date (null for range-level issues)

  -- Structured anomaly detail — type-specific fields
  -- e.g. { raw_log_id, hours_stale, employee_code } for orphan_raw_log
  --      { session_id, check_in, hours_open } for incomplete_session
  --      { duplicate_ids: [...], count } for duplicate_session
  detail        jsonb       NOT NULL DEFAULT '{}',

  -- Human-readable repair hint for the operator
  suggestion    text,

  -- Resolution tracking
  resolved      boolean     NOT NULL DEFAULT false,
  resolved_at   timestamptz,
  resolved_by   uuid        REFERENCES profiles(id) ON DELETE SET NULL,
  resolution_note text,

  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_att_recon_issues_run
  ON attendance_reconciliation_issues (run_id, issue_type, severity);

CREATE INDEX IF NOT EXISTS idx_att_recon_issues_employee
  ON attendance_reconciliation_issues (tenant_id, employee_id, date)
  WHERE employee_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_att_recon_issues_open
  ON attendance_reconciliation_issues (tenant_id, severity, created_at DESC)
  WHERE resolved = false;

COMMENT ON TABLE attendance_reconciliation_issues IS
  'Individual anomalies detected by the attendance reconciliation engine. '
  'Each row carries structured detail and a repair suggestion. '
  'Operators mark issues resolved; the engine never auto-resolves.';


-- ═══════════════════════════════════════════════════════════════════════════════
-- LEAVE RECONCILIATION
-- ═══════════════════════════════════════════════════════════════════════════════

-- ── leave_reconciliation_runs ─────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS leave_reconciliation_runs (
  id                uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         uuid        NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  status            text        NOT NULL DEFAULT 'running'
    CHECK (status IN ('running', 'completed', 'failed')),
  reconcile_year    int         NOT NULL,
  started_at        timestamptz NOT NULL DEFAULT now(),
  completed_at      timestamptz,
  duration_ms       int,
  total_employees   int         NOT NULL DEFAULT 0,
  drifted_employees int         NOT NULL DEFAULT 0,
  total_issues      int         NOT NULL DEFAULT 0,
  issue_breakdown   jsonb       NOT NULL DEFAULT '{}',
  triggered_by      uuid        REFERENCES profiles(id) ON DELETE SET NULL,
  trigger_source    text        NOT NULL DEFAULT 'manual'
    CHECK (trigger_source IN ('manual', 'scheduler', 'api')),
  error             text
);

CREATE INDEX IF NOT EXISTS idx_leave_recon_runs_tenant
  ON leave_reconciliation_runs (tenant_id, reconcile_year, started_at DESC);

COMMENT ON TABLE leave_reconciliation_runs IS
  'Execution log for leave balance reconciliation scans. '
  'Compares leave_accrual_ledger sums against employee_leave_balance '
  'to detect drift, missing balances, and negative balance anomalies.';


-- ── leave_reconciliation_issues ───────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS leave_reconciliation_issues (
  id              uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id          uuid          NOT NULL
    REFERENCES leave_reconciliation_runs(id) ON DELETE CASCADE,
  tenant_id       uuid          NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,

  issue_type      text          NOT NULL CHECK (issue_type IN (
    'balance_drift',        -- ledger sum ≠ balance row value (rounding or missed write)
    'missing_balance_row',  -- ledger has credits but no employee_leave_balance row exists
    'negative_balance',     -- balance is below zero (policy violation)
    'orphan_balance_row',   -- balance row has no ledger entries (manual insert without audit)
    'expired_co_not_deducted', -- CO grant marked expired but balance not reduced
    'future_expiry_risk'    -- CO grants expiring within 7 days (early warning)
  )),
  severity        text          NOT NULL DEFAULT 'warning'
    CHECK (severity IN ('info', 'warning', 'error', 'critical')),

  employee_id     uuid          NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  leave_type_id   uuid          NOT NULL REFERENCES leave_types(id) ON DELETE CASCADE,
  year            int           NOT NULL,

  -- Quantified drift
  ledger_sum      decimal(7,1),   -- what the ledger says
  balance_value   decimal(7,1),   -- what employee_leave_balance says
  drift_days      decimal(7,1),   -- ledger_sum - balance_value (positive = under-counted in balance)

  detail          jsonb         NOT NULL DEFAULT '{}',
  suggestion      text,

  -- Resolution
  resolved        boolean       NOT NULL DEFAULT false,
  resolved_at     timestamptz,
  resolved_by     uuid          REFERENCES profiles(id) ON DELETE SET NULL,
  resolution_note text,

  created_at      timestamptz   NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_leave_recon_issues_run
  ON leave_reconciliation_issues (run_id, issue_type, severity);

CREATE INDEX IF NOT EXISTS idx_leave_recon_issues_employee
  ON leave_reconciliation_issues (tenant_id, employee_id, year)
  WHERE resolved = false;

CREATE INDEX IF NOT EXISTS idx_leave_recon_issues_open
  ON leave_reconciliation_issues (tenant_id, severity, created_at DESC)
  WHERE resolved = false;

COMMENT ON TABLE leave_reconciliation_issues IS
  'Individual leave balance drift anomalies. Each row records the ledger sum, '
  'the balance row value, and the computed drift for the affected '
  'employee + leave type + year combination.';


-- ═══════════════════════════════════════════════════════════════════════════════
-- ATTENDANCE FRESHNESS SNAPSHOTS
-- ═══════════════════════════════════════════════════════════════════════════════

-- ── attendance_freshness_snapshots ───────────────────────────────────────────
-- Written once per day by the freshness validator (or on-demand).
-- Tracks how many employees are "fresh" vs "stale" vs "missing" for the
-- most recent N-day window so ops can see processing health at a glance.

CREATE TABLE IF NOT EXISTS attendance_freshness_snapshots (
  id                    uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id             uuid        NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  snapshot_date         date        NOT NULL,

  -- Employee coverage
  total_active_employees   int      NOT NULL DEFAULT 0,
  employees_with_data      int      NOT NULL DEFAULT 0,   -- have attendance_daily in window
  employees_stale          int      NOT NULL DEFAULT 0,   -- last row > stale_threshold_days old
  employees_missing        int      NOT NULL DEFAULT 0,   -- no rows at all in window

  -- Raw log backlog
  unprocessed_raw_logs     int      NOT NULL DEFAULT 0,   -- processed=false count
  oldest_unprocessed_hours numeric(8,2),                  -- age of oldest unprocessed raw log

  -- Processing recency
  last_processing_run_at   timestamptz,
  hours_since_last_run     numeric(8,2),

  -- Staleness threshold used for this snapshot
  stale_threshold_days     int      NOT NULL DEFAULT 2,

  -- Summary health status
  health_status           text      NOT NULL DEFAULT 'unknown'
    CHECK (health_status IN ('healthy', 'degraded', 'critical', 'unknown')),

  created_at              timestamptz NOT NULL DEFAULT now(),

  UNIQUE (tenant_id, snapshot_date)
);

CREATE INDEX IF NOT EXISTS idx_att_freshness_tenant
  ON attendance_freshness_snapshots (tenant_id, snapshot_date DESC);

COMMENT ON TABLE attendance_freshness_snapshots IS
  'Daily attendance processing health snapshot per tenant. '
  'Records employee coverage, raw log backlog, and processing recency '
  'so operators can monitor freshness trends without querying raw tables.';


-- ── RLS ───────────────────────────────────────────────────────────────────────

ALTER TABLE attendance_reconciliation_runs    ENABLE ROW LEVEL SECURITY;
ALTER TABLE attendance_reconciliation_issues  ENABLE ROW LEVEL SECURITY;
ALTER TABLE leave_reconciliation_runs         ENABLE ROW LEVEL SECURITY;
ALTER TABLE leave_reconciliation_issues       ENABLE ROW LEVEL SECURITY;
ALTER TABLE attendance_freshness_snapshots    ENABLE ROW LEVEL SECURITY;

-- HR admins and super admins: full access
CREATE POLICY "arr_hr_all"   ON attendance_reconciliation_runs    FOR ALL USING (get_user_role() IN ('super_admin','hr_admin'));
CREATE POLICY "ari_hr_all"   ON attendance_reconciliation_issues  FOR ALL USING (get_user_role() IN ('super_admin','hr_admin'));
CREATE POLICY "lrr_hr_all"   ON leave_reconciliation_runs         FOR ALL USING (get_user_role() IN ('super_admin','hr_admin'));
CREATE POLICY "lri_hr_all"   ON leave_reconciliation_issues       FOR ALL USING (get_user_role() IN ('super_admin','hr_admin'));
CREATE POLICY "afs_hr_all"   ON attendance_freshness_snapshots    FOR ALL USING (get_user_role() IN ('super_admin','hr_admin'));
