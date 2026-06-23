-- ============================================================================
-- apply_missing_migrations.sql  (AUTO-GENERATED — do not hand-edit)
--
-- Applies the 6 migrations that supabase/audit_schema_drift.sql found MISSING
-- from production. NOTE: prod is PARTIALLY applied for most of these (built from
-- a consolidated snapshot), so the raw migration files are NOT safe to re-run.
-- This bundle is rewritten to be fully idempotent:
--   • CREATE INDEX            → CREATE INDEX IF NOT EXISTS
--   • CREATE TRIGGER          → CREATE OR REPLACE TRIGGER      (PG14+)
--   • CREATE [MAT] VIEW       → CREATE OR REPLACE VIEW
--   • CREATE POLICY "x" ON t  → DROP POLICY IF EXISTS "x" ON t; CREATE POLICY ...
--   • seed INSERT             → ... ON CONFLICT DO NOTHING
--   • CREATE TABLE/FUNCTION   → already IF NOT EXISTS / OR REPLACE
-- Wrapped in one transaction → all-or-nothing, and safe to re-run.
--
-- Usage:  psql "$PROD_DATABASE_URL" -f supabase/apply_missing_migrations.sql
--
-- Bundled (in order): 118_durable_queue.sql, 119_reconciliation.sql, 124_pii_governance.sql, 164_workforce_orchestration.sql, 166_statutory_governance.sql, 188_operational_intelligence.sql
-- ============================================================================

BEGIN;

-- ─────────────────────────────────────────────────────────────────────────
-- 118_durable_queue.sql
-- ─────────────────────────────────────────────────────────────────────────
-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 118 — Durable Background Job Queue
--
-- Replaces the in-memory Node.js JobQueue with a Postgres-persisted queue that
-- survives process crashes, server restarts, and multi-instance deployments.
--
-- Tables:
--   background_jobs        — the primary job store
--   background_job_results — completed/dead job history (ring-buffer equivalent)
--   scheduler_heartbeats   — scheduler liveness tracking
--   payroll_finalize_overrides — audit trail for force_finalize overrides
--
-- Rollback:
--   DROP TABLE IF EXISTS payroll_finalize_overrides, scheduler_heartbeats,
--     background_job_results, background_jobs CASCADE;
-- ─────────────────────────────────────────────────────────────────────────────

-- ── background_jobs ───────────────────────────────────────────────────────────
-- Primary queue. Workers poll WHERE status = 'pending' AND scheduled_at <= now().
-- Stale 'running' rows (started_at < now() - stale_after_seconds) are candidates
-- for recovery — reset to 'pending' on process startup.

CREATE TABLE IF NOT EXISTS background_jobs (
  id                uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  job_type          text        NOT NULL,
  payload           jsonb       NOT NULL DEFAULT '{}',
  status            text        NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'running', 'completed', 'failed', 'dead')),
  attempt           int         NOT NULL DEFAULT 0,
  max_retries       int         NOT NULL DEFAULT 3,
  retry_delay_ms    int         NOT NULL DEFAULT 1000,
  max_delay_ms      int         NOT NULL DEFAULT 30000,
  timeout_ms        int         NOT NULL DEFAULT 60000,
  scheduled_at      timestamptz NOT NULL DEFAULT now(),
  started_at        timestamptz,
  completed_at      timestamptz,
  failed_at         timestamptz,
  error             text,
  failure_category  text        CHECK (failure_category IN ('transient', 'permanent', 'timeout', 'unknown')),
  -- Idempotency: supply a key to prevent duplicate enqueues.
  -- On conflict the existing job row is left untouched (DO NOTHING semantics).
  idempotency_key   text        UNIQUE,
  -- Optional tenant scope — global jobs (e.g. scheduler ticks) leave this null.
  tenant_id         text,
  -- Traceback: who/what enqueued this job
  created_by        text,
  created_at        timestamptz NOT NULL DEFAULT now()
);

-- Primary worker poll index: next runnable pending job
CREATE INDEX IF NOT EXISTS idx_bg_jobs_pending
  ON background_jobs (status, scheduled_at)
  WHERE status = 'pending';

-- Stale-lock recovery: find crashed running jobs
CREATE INDEX IF NOT EXISTS idx_bg_jobs_running
  ON background_jobs (status, started_at)
  WHERE status = 'running';

-- Tenant scoping
CREATE INDEX IF NOT EXISTS idx_bg_jobs_tenant
  ON background_jobs (tenant_id, job_type, status)
  WHERE tenant_id IS NOT NULL;

COMMENT ON TABLE background_jobs IS
  'Durable background job queue. Workers poll pending rows and claim them via '
  'an atomic UPDATE ... RETURNING to prevent double-execution. Stale running '
  'rows (crashed jobs) are recovered to pending on process startup.';

-- ── background_job_results ────────────────────────────────────────────────────
-- Persistent dead-letter + completion log. Rows are inserted when a job
-- reaches terminal state (completed | dead). Kept for 90 days then purged.

CREATE TABLE IF NOT EXISTS background_job_results (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id          uuid        NOT NULL,   -- references background_jobs.id
  job_type        text        NOT NULL,
  tenant_id       text,
  final_status    text        NOT NULL CHECK (final_status IN ('completed', 'dead')),
  attempt         int         NOT NULL,
  payload         jsonb       NOT NULL DEFAULT '{}',
  error           text,
  failure_category text,
  started_at      timestamptz,
  completed_at    timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now()
);

-- TTL purge support
CREATE INDEX IF NOT EXISTS idx_bg_job_results_ttl
  ON background_job_results (created_at);

-- Dead-letter inspection by type
CREATE INDEX IF NOT EXISTS idx_bg_job_results_dead
  ON background_job_results (job_type, final_status, created_at DESC)
  WHERE final_status = 'dead';

COMMENT ON TABLE background_job_results IS
  'Persistent terminal-state log for completed and dead-letter jobs. '
  'Acts as the crash-safe equivalent of the in-memory completed[] ring buffer '
  'and deadLetter[] array. Purge rows older than 90 days via a cron job.';

-- ── scheduler_heartbeats ──────────────────────────────────────────────────────
-- Each scheduler writes a heartbeat row on every tick. Operators can detect
-- stale or crashed schedulers by querying last_heartbeat_at.
-- One row per (scheduler_name, tenant_id) pair. Upsert semantics.

CREATE TABLE IF NOT EXISTS scheduler_heartbeats (
  id                 uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  scheduler_name     text        NOT NULL,
  tenant_id          text,       -- null = global scheduler
  last_heartbeat_at  timestamptz NOT NULL DEFAULT now(),
  status             text        NOT NULL DEFAULT 'ok'
    CHECK (status IN ('ok', 'degraded', 'error')),
  tick_count         bigint      NOT NULL DEFAULT 0,
  last_error         text,
  metadata           jsonb       NOT NULL DEFAULT '{}',
  created_at         timestamptz NOT NULL DEFAULT now(),
  UNIQUE (scheduler_name, tenant_id)
);

CREATE INDEX IF NOT EXISTS idx_scheduler_heartbeats_stale
  ON scheduler_heartbeats (last_heartbeat_at);

COMMENT ON TABLE scheduler_heartbeats IS
  'Liveness tracking for all background schedulers. Each scheduler upserts its '
  'row on every tick so operators can verify schedulers are alive. '
  'A heartbeat older than 2× the tick interval indicates a stale/crashed scheduler. '
  'Queried by GET /system/scheduler-health.';

-- ── payroll_finalize_overrides ────────────────────────────────────────────────
-- Persistent audit trail for every force_finalize=true override of the
-- attendance completeness gate. Required for payroll audit and SOX compliance.

CREATE TABLE IF NOT EXISTS payroll_finalize_overrides (
  id                       uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id                text        NOT NULL,
  run_id                   uuid        NOT NULL,
  month                    text        NOT NULL,
  overridden_by            text        NOT NULL,   -- user_id
  override_reason          text,
  missing_employee_count   int         NOT NULL DEFAULT 0,
  missing_employee_ids     jsonb       NOT NULL DEFAULT '[]',
  overridden_at            timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_payroll_finalize_overrides_run
  ON payroll_finalize_overrides (tenant_id, run_id);

CREATE INDEX IF NOT EXISTS idx_payroll_finalize_overrides_month
  ON payroll_finalize_overrides (tenant_id, month, overridden_at DESC);

COMMENT ON TABLE payroll_finalize_overrides IS
  'Persistent audit trail for every payroll finalization override where '
  'force_finalize=true bypassed the missing-attendance completeness gate. '
  'Required for payroll audit and compliance review.';

-- ─────────────────────────────────────────────────────────────────────────
-- 119_reconciliation.sql
-- ─────────────────────────────────────────────────────────────────────────
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
DROP POLICY IF EXISTS "arr_hr_all" ON attendance_reconciliation_runs;
CREATE POLICY "arr_hr_all"   ON attendance_reconciliation_runs    FOR ALL USING (get_user_role() IN ('super_admin','hr_admin'));
DROP POLICY IF EXISTS "ari_hr_all" ON attendance_reconciliation_issues;
CREATE POLICY "ari_hr_all"   ON attendance_reconciliation_issues  FOR ALL USING (get_user_role() IN ('super_admin','hr_admin'));
DROP POLICY IF EXISTS "lrr_hr_all" ON leave_reconciliation_runs;
CREATE POLICY "lrr_hr_all"   ON leave_reconciliation_runs         FOR ALL USING (get_user_role() IN ('super_admin','hr_admin'));
DROP POLICY IF EXISTS "lri_hr_all" ON leave_reconciliation_issues;
CREATE POLICY "lri_hr_all"   ON leave_reconciliation_issues       FOR ALL USING (get_user_role() IN ('super_admin','hr_admin'));
DROP POLICY IF EXISTS "afs_hr_all" ON attendance_freshness_snapshots;
CREATE POLICY "afs_hr_all"   ON attendance_freshness_snapshots    FOR ALL USING (get_user_role() IN ('super_admin','hr_admin'));

-- ─────────────────────────────────────────────────────────────────────────
-- 124_pii_governance.sql
-- ─────────────────────────────────────────────────────────────────────────
/**
 * Migration 124 — PII & Privacy Governance
 *
 * Implements privacy-by-design infrastructure required by GDPR Art. 25,
 * DPDPA 2023 §8, and ISO 27001 A.18.
 *
 * Tables:
 *   data_field_classifications   — data registry: every PII field classified by
 *                                  sensitivity tier, legal basis, and retention period.
 *   pii_access_log               — access justification log for sensitive field reads.
 *   erasure_requests             — right-to-erasure workflow with 30-day SLA tracking.
 *   retention_enforcement_runs   — audit trail for automated retention enforcement jobs.
 *
 * Sensitivity tiers:
 *   public        — freely shareable (employee name, department)
 *   internal      — internal use only (employee ID, join date)
 *   confidential  — need-to-know (date of birth, emergency contacts)
 *   restricted    — financial / identity data (salary, national ID, bank account)
 *   special_category — biometric / health data (GDPR Art. 9)
 */

-- ── Data field classification registry ───────────────────────────────────────

CREATE TABLE IF NOT EXISTS data_field_classifications (
  table_name       text        NOT NULL,
  column_name      text        NOT NULL,
  sensitivity      text        NOT NULL
                               CHECK (sensitivity IN (
                                 'public', 'internal', 'confidential',
                                 'restricted', 'special_category'
                               )),
  pii_category     text                    -- 'identity', 'financial', 'health', 'biometric', 'contact'
                               CHECK (pii_category IN (
                                 'identity', 'financial', 'health',
                                 'biometric', 'contact', 'employment', NULL
                               )),
  gdpr_basis       text,                   -- lawful basis: 'contract', 'legitimate_interest', 'consent', 'legal_obligation'
  dpdpa_basis      text,                   -- DPDPA 2023 basis
  retention_days   int,                    -- NULL = retain for duration of employment + statutory period
  encrypt_at_rest  boolean      NOT NULL DEFAULT false,
  mask_in_logs     boolean      NOT NULL DEFAULT true,
  mask_in_exports  boolean      NOT NULL DEFAULT false,
  notes            text,
  created_at       timestamptz  NOT NULL DEFAULT now(),
  updated_at       timestamptz  NOT NULL DEFAULT now(),

  PRIMARY KEY (table_name, column_name)
);

CREATE INDEX IF NOT EXISTS idx_dfc_sensitivity ON data_field_classifications (sensitivity)
  WHERE sensitivity IN ('restricted', 'special_category');
CREATE INDEX IF NOT EXISTS idx_dfc_encrypt     ON data_field_classifications (encrypt_at_rest)
  WHERE encrypt_at_rest = true;

CREATE OR REPLACE FUNCTION fn_touch_data_field_classifications()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at := now(); RETURN NEW; END;
$$;

CREATE OR REPLACE TRIGGER trg_touch_data_field_classifications
  BEFORE UPDATE ON data_field_classifications
  FOR EACH ROW EXECUTE FUNCTION fn_touch_data_field_classifications();

COMMENT ON TABLE data_field_classifications IS
  'PII data classification registry. One row per table/column containing personal data. '
  'Used for: retention enforcement, encryption decisions, access log filtering, RoPA generation.';

-- ── Seed: classify all known PII fields ──────────────────────────────────────

INSERT INTO data_field_classifications
  (table_name, column_name, sensitivity, pii_category, gdpr_basis, dpdpa_basis, retention_days, encrypt_at_rest, mask_in_logs, notes)
VALUES
  -- employees table
  ('employees', 'first_name',               'internal',      'employment', 'contract',            'legitimate_interest', NULL,  false, false, NULL),
  ('employees', 'last_name',                'internal',      'employment', 'contract',            'legitimate_interest', NULL,  false, false, NULL),
  ('employees', 'personal_email',           'confidential',  'contact',    'contract',            'contract',            3650,  false, true,  'Personal email for communications'),
  ('employees', 'phone',                    'confidential',  'contact',    'contract',            'contract',            3650,  false, true,  NULL),
  ('employees', 'date_of_birth',            'confidential',  'identity',   'contract',            'contract',            3650,  false, true,  'Age determination for statutory compliance'),
  ('employees', 'gender',                   'confidential',  'identity',   'contract',            'contract',            3650,  false, true,  'Statutory reporting'),
  ('employees', 'national_id',              'restricted',    'identity',   'legal_obligation',    'legal_obligation',    3650,  true,  true,  'Aadhaar/PAN — encrypt at rest'),
  ('employees', 'pan_number',               'restricted',    'identity',   'legal_obligation',    'legal_obligation',    3650,  true,  true,  'PAN card for TDS'),
  ('employees', 'address_line1',            'confidential',  'contact',    'contract',            'contract',            3650,  false, true,  NULL),
  ('employees', 'address_line2',            'confidential',  'contact',    'contract',            'contract',            3650,  false, false, NULL),
  ('employees', 'city',                     'internal',      'contact',    'contract',            'contract',            3650,  false, false, NULL),
  ('employees', 'emergency_contact_name',   'confidential',  'contact',    'legitimate_interest', 'legitimate_interest', 3650,  false, true,  'Third-party data — handle with care'),
  ('employees', 'emergency_contact_phone',  'confidential',  'contact',    'legitimate_interest', 'legitimate_interest', 3650,  false, true,  'Third-party data'),
  ('employees', 'bank_account_number',      'restricted',    'financial',  'contract',            'contract',            3650,  true,  true,  'Salary disbursement — encrypt at rest'),
  ('employees', 'bank_ifsc',                'restricted',    'financial',  'contract',            'contract',            3650,  false, true,  NULL),
  ('employees', 'bank_name',                'confidential',  'financial',  'contract',            'contract',            3650,  false, false, NULL),
  -- employee_compensations table
  ('employee_compensations', 'ctc_annual',  'restricted',    'financial',  'contract',            'contract',            3650,  false, true,  'Salary data — restricted access'),
  ('employee_compensations', 'ctc_monthly', 'restricted',    'financial',  'contract',            'contract',            3650,  false, true,  NULL),
  ('employee_compensations', 'basic',       'restricted',    'financial',  'contract',            'contract',            3650,  false, true,  NULL),
  ('employee_compensations', 'hra',         'restricted',    'financial',  'contract',            'contract',            3650,  false, true,  NULL),
  -- payroll_runs / payroll_run_employees
  ('payroll_run_employees',  'gross_pay',   'restricted',    'financial',  'contract',            'contract',            3650,  false, true,  NULL),
  ('payroll_run_employees',  'net_pay',     'restricted',    'financial',  'contract',            'contract',            3650,  false, true,  NULL),
  ('payroll_run_employees',  'tax_deducted','restricted',    'financial',  'legal_obligation',    'legal_obligation',    3650,  false, true,  NULL),
  -- attendance_raw_logs
  ('attendance_raw_logs', 'device_id',      'confidential',  'biometric',  'legitimate_interest', 'legitimate_interest', 1825,  false, false, 'Clock-in device — may qualify as biometric data'),
  ('attendance_raw_logs', 'timestamp',      'internal',      'employment', 'legitimate_interest', 'legitimate_interest', 1825,  false, false, NULL) ON CONFLICT DO NOTHING;

-- ── PII access justification log ─────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS pii_access_log (
  id              bigint      GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  tenant_id       uuid        NOT NULL,
  accessor_id     uuid        NOT NULL,           -- auth.users(id) of the accessor
  accessor_role   text        NOT NULL,
  accessed_table  text        NOT NULL,
  accessed_fields text[]      NOT NULL DEFAULT '{}',  -- columns accessed
  access_purpose  text        NOT NULL
                              CHECK (access_purpose IN (
                                'payroll_run', 'hr_review', 'audit', 'support',
                                'employee_self', 'bulk_export', 'background_job',
                                'compliance_report', 'erasure_request'
                              )),
  justification   text,                           -- required for bulk_export and support
  employee_ids    uuid[],                         -- affected employee records (NULL = bulk)
  record_count    int,                            -- number of employee records accessed
  accessed_at     timestamptz NOT NULL DEFAULT now(),
  source_ip       inet,
  correlation_id  uuid,
  -- Anomaly flag: set by detection engine if access pattern is unusual
  flagged         boolean     NOT NULL DEFAULT false,
  flag_reason     text
);

CREATE INDEX IF NOT EXISTS idx_pii_access_tenant_time   ON pii_access_log (tenant_id, accessed_at DESC);
CREATE INDEX IF NOT EXISTS idx_pii_access_accessor      ON pii_access_log (accessor_id, accessed_at DESC);
CREATE INDEX IF NOT EXISTS idx_pii_access_purpose       ON pii_access_log (access_purpose, accessed_at DESC)
  WHERE access_purpose IN ('bulk_export', 'support');
CREATE INDEX IF NOT EXISTS idx_pii_access_flagged       ON pii_access_log (flagged, accessed_at DESC)
  WHERE flagged = true;
CREATE INDEX IF NOT EXISTS idx_pii_access_correlation   ON pii_access_log (correlation_id)
  WHERE correlation_id IS NOT NULL;

COMMENT ON TABLE pii_access_log IS
  'PII access justification log. Written when sensitive fields are read. '
  'Enables post-incident forensics and anomaly detection (bulk export detection).';

-- ── Right-to-erasure requests ─────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS erasure_requests (
  id               uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id        uuid        NOT NULL,

  -- Subject identification
  employee_id      uuid,                          -- NULL for ex-employees no longer in DB
  subject_email    text,
  subject_name     text,

  -- Request metadata
  requested_at     timestamptz NOT NULL DEFAULT now(),
  request_source   text        NOT NULL DEFAULT 'subject'
                               CHECK (request_source IN ('subject','hr_admin','regulator','legal')),
  requested_by     uuid        REFERENCES auth.users(id),

  -- Workflow state
  status           text        NOT NULL DEFAULT 'pending'
                               CHECK (status IN (
                                 'pending', 'in_progress', 'completed',
                                 'rejected', 'partial', 'on_hold'
                               )),
  -- SLA: GDPR Art. 17 / DPDPA §12 = 30 days
  -- sla_deadline is a plain column computed by fn_erasure_requests_before_insert trigger.
  -- sla_breached is NOT stored (depends on CURRENT_DATE which changes daily);
  --   compute inline: sla_deadline < CURRENT_DATE AND status NOT IN ('completed','rejected').
  sla_deadline     date,

  -- Resolution
  rejection_reason text,                          -- legal hold, statutory retention, etc.
  completed_at     timestamptz,
  completed_by     uuid        REFERENCES auth.users(id),

  -- Evidence of completion
  fields_erased    jsonb,    -- {table: [col1, col2]} actually anonymised/deleted
  fields_retained  jsonb,    -- {table: [col1, col2], reason: 'statutory_7yr'}
  retention_basis  text,     -- why retained fields were not erased

  -- Tamper evidence
  verification_hash text,    -- SHA-256(id || completed_at || fields_erased) for integrity

  notes            text,
  metadata         jsonb     NOT NULL DEFAULT '{}',
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_erasure_tenant_status  ON erasure_requests (tenant_id, status);
CREATE INDEX IF NOT EXISTS idx_erasure_pending_sla    ON erasure_requests (sla_deadline ASC)
  WHERE status IN ('pending', 'in_progress', 'on_hold');
CREATE INDEX IF NOT EXISTS idx_erasure_employee       ON erasure_requests (employee_id)
  WHERE employee_id IS NOT NULL;

-- Compute sla_deadline on INSERT (requested_at + 30 days).
-- Cannot be GENERATED ALWAYS AS STORED because timestamptz + interval is STABLE.
CREATE OR REPLACE FUNCTION fn_erasure_requests_before_insert()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.sla_deadline := NEW.requested_at::date + 30;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE TRIGGER trg_erasure_requests_before_insert
  BEFORE INSERT ON erasure_requests
  FOR EACH ROW EXECUTE FUNCTION fn_erasure_requests_before_insert();

CREATE OR REPLACE FUNCTION fn_touch_erasure_requests()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at := now(); RETURN NEW; END;
$$;

CREATE OR REPLACE TRIGGER trg_touch_erasure_requests
  BEFORE UPDATE ON erasure_requests
  FOR EACH ROW EXECUTE FUNCTION fn_touch_erasure_requests();

COMMENT ON TABLE erasure_requests IS
  'Right-to-erasure workflow. SLA = 30 days (GDPR Art. 17, DPDPA §12). '
  'sla_deadline set by trigger on INSERT. sla_breached computed inline: '
  'sla_deadline < CURRENT_DATE AND status NOT IN (''completed'',''rejected''). '
  'Dashboard alerts on breached requests.';

-- ── Retention enforcement runs ────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS retention_enforcement_runs (
  id                 uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id          uuid        NOT NULL,
  run_at             timestamptz NOT NULL DEFAULT now(),
  tables_scanned     text[]      NOT NULL DEFAULT '{}',
  records_evaluated  int         NOT NULL DEFAULT 0,
  records_deleted    int         NOT NULL DEFAULT 0,
  records_anonymized int         NOT NULL DEFAULT 0,
  records_retained   int         NOT NULL DEFAULT 0,  -- retention basis applied
  duration_ms        int,
  errors             jsonb       NOT NULL DEFAULT '[]',
  triggered_by       text        NOT NULL DEFAULT 'scheduler'
                                 CHECK (triggered_by IN ('scheduler','manual','test'))
);

CREATE INDEX IF NOT EXISTS idx_retention_runs_tenant ON retention_enforcement_runs (tenant_id, run_at DESC);
CREATE INDEX IF NOT EXISTS idx_retention_runs_errors ON retention_enforcement_runs (run_at DESC)
  WHERE jsonb_array_length(errors) > 0;

COMMENT ON TABLE retention_enforcement_runs IS
  'Audit trail for automated data retention enforcement. '
  'One row per tenant per weekly scheduler run. Records how many rows were deleted/anonymised.';

-- ── Privacy health view ───────────────────────────────────────────────────────

CREATE OR REPLACE VIEW privacy_health AS
SELECT
  t.id                                                                AS tenant_id,
  -- Open erasure requests
  (SELECT COUNT(*) FROM erasure_requests e
   WHERE e.tenant_id = t.id AND e.status IN ('pending','in_progress','on_hold'))
                                                                      AS open_erasure_requests,
  -- Breached SLA erasure requests (sla_deadline has passed and not yet resolved)
  (SELECT COUNT(*) FROM erasure_requests e
   WHERE e.tenant_id = t.id
     AND e.sla_deadline < CURRENT_DATE
     AND e.status NOT IN ('completed', 'rejected'))                   AS sla_breached_requests,
  -- Last retention enforcement run
  (SELECT run_at FROM retention_enforcement_runs r
   WHERE r.tenant_id = t.id ORDER BY run_at DESC LIMIT 1)            AS last_retention_run_at,
  -- Bulk export events in last 7 days (anomaly indicator)
  (SELECT COUNT(*) FROM pii_access_log p
   WHERE p.tenant_id = t.id
     AND p.access_purpose = 'bulk_export'
     AND p.accessed_at > now() - INTERVAL '7 days')                  AS bulk_exports_7d,
  -- Flagged PII access in last 7 days
  (SELECT COUNT(*) FROM pii_access_log p
   WHERE p.tenant_id = t.id
     AND p.flagged = true
     AND p.accessed_at > now() - INTERVAL '7 days')                  AS flagged_access_7d
FROM tenants t;

COMMENT ON VIEW privacy_health IS
  'Per-tenant privacy health rollup. Dashboard uses this for Privacy Health widget. '
  'Alert on sla_breached_requests > 0 and flagged_access_7d > 0.';

-- ─────────────────────────────────────────────────────────────────────────
-- 164_workforce_orchestration.sql
-- ─────────────────────────────────────────────────────────────────────────
/**
 * Migration 164 — Deterministic Cross-System Workforce State Engine
 *
 * Phase 3 of Enterprise Governance Consolidation.
 *
 * Adds:
 *   A. leave_reconciliation_issues — extend issue_type to include 'replay_drift'
 *   B. retroactive_rebuild_queue   — add orchestration columns:
 *        dependency_order, orchestrator_lineage_id, blocked_by_rebuild_id,
 *        rebuild_stage, rebuild_scope
 *   C. payroll_period_states       — governance freeze states for payroll periods
 *   D. attendance_processing_states — attendance lifecycle state authority
 *   E. workforce_rebuild_events    — retroactive orchestration event tracking
 *   F. workforce_event_timeline    — unified chronological governance history
 *   G. workforce_reconciliation_runs + workforce_reconciliation_issues
 *        — cross-module reconciliation extension
 *
 * NO existing data is modified.
 * All additions are backwards-compatible (nullable or defaulted).
 * NO external behavior changes.
 */

-- =============================================================================
-- A. Fix leave_reconciliation_issues — add replay_drift to constraint
-- =============================================================================
--
-- Phase 2 added 'replay_drift' to the TypeScript LeaveIssueType union and to
-- the leave-reconciliation.ts engine. The DB constraint must match or inserts
-- will fail with a check-violation error.

ALTER TABLE leave_reconciliation_issues
  DROP CONSTRAINT IF EXISTS leave_reconciliation_issues_issue_type_check;

ALTER TABLE leave_reconciliation_issues
  ADD CONSTRAINT leave_reconciliation_issues_issue_type_check
    CHECK (issue_type IN (
      'balance_drift',
      'missing_balance_row',
      'negative_balance',
      'orphan_balance_row',
      'expired_co_not_deducted',
      'future_expiry_risk',
      'replay_drift'
    ));

-- =============================================================================
-- B. retroactive_rebuild_queue — orchestration columns
-- =============================================================================
--
-- These columns support deterministic dependency-ordered execution of rebuild
-- chains coordinated by the workforce orchestrator.

-- dependency_order: execution position within a chain (1=first, higher=later)
ALTER TABLE retroactive_rebuild_queue
  ADD COLUMN IF NOT EXISTS dependency_order        INT         NOT NULL DEFAULT 0;

-- orchestrator_lineage_id: shared UUID across all rebuilds in one chain
ALTER TABLE retroactive_rebuild_queue
  ADD COLUMN IF NOT EXISTS orchestrator_lineage_id UUID;

-- blocked_by_rebuild_id: explicit dependency — this rebuild waits until the
-- referenced rebuild is 'completed' before it can be started.
ALTER TABLE retroactive_rebuild_queue
  ADD COLUMN IF NOT EXISTS blocked_by_rebuild_id   UUID
    REFERENCES retroactive_rebuild_queue(id)       ON DELETE SET NULL;

-- rebuild_stage: which part of the processing lifecycle this entry covers.
ALTER TABLE retroactive_rebuild_queue
  ADD COLUMN IF NOT EXISTS rebuild_stage           TEXT
    CHECK (rebuild_stage IS NULL OR rebuild_stage IN (
      'attendance', 'leave_balance', 'payroll', 'entitlement', 'reconciliation'
    ));

-- rebuild_scope: categorises the date span for prioritisation.
ALTER TABLE retroactive_rebuild_queue
  ADD COLUMN IF NOT EXISTS rebuild_scope           TEXT
    CHECK (rebuild_scope IS NULL OR rebuild_scope IN (
      'single_day', 'date_range', 'full_year', 'open_ended'
    ));

-- Index: find all entries in a shared orchestration chain
CREATE INDEX IF NOT EXISTS idx_rrq_orchestrator_lineage
  ON retroactive_rebuild_queue (orchestrator_lineage_id)
  WHERE orchestrator_lineage_id IS NOT NULL;

-- Index: find entries blocked by a specific predecessor
CREATE INDEX IF NOT EXISTS idx_rrq_blocked_by
  ON retroactive_rebuild_queue (blocked_by_rebuild_id)
  WHERE blocked_by_rebuild_id IS NOT NULL;

-- =============================================================================
-- C. payroll_period_states — payroll freeze governance
-- =============================================================================
--
-- Tracks the governance freeze state for each payroll period (tenant × month).
-- This is a separate layer ON TOP of payroll_runs — it enforces retroactive
-- mutation boundaries WITHOUT replacing the existing payroll run status machine.
--
-- States:
--   open               — retroactive rebuilds allowed (default)
--   payroll_processing — rebuild is queued but NOT executed (run in progress)
--   payroll_locked     — retroactive changes require an adjustment workflow
--   payroll_archived   — audit-only; no mutations permitted
--
-- The period_month column uses 'YYYY-MM' text format to match payroll_runs.month.

CREATE TABLE IF NOT EXISTS payroll_period_states (
  id                UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         UUID          NOT NULL REFERENCES tenants(id)    ON DELETE CASCADE,

  -- 'YYYY-MM' format — matches payroll_runs.month for easy join
  period_month      TEXT          NOT NULL
    CHECK (period_month ~ '^\d{4}-\d{2}$'),

  -- Optional link to the payroll run that triggered this state
  payroll_run_id    UUID          REFERENCES payroll_runs(id)        ON DELETE SET NULL,

  -- Governance state machine
  governance_state  TEXT          NOT NULL DEFAULT 'open'
    CHECK (governance_state IN (
      'open', 'payroll_processing', 'payroll_locked', 'payroll_archived'
    )),

  -- Lock audit
  locked_at         TIMESTAMPTZ,
  locked_by         UUID          REFERENCES profiles(id)            ON DELETE SET NULL,

  -- Archive audit
  archived_at       TIMESTAMPTZ,

  notes             TEXT,
  created_at        TIMESTAMPTZ   NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ   NOT NULL DEFAULT now(),

  UNIQUE (tenant_id, period_month)
);

CREATE INDEX IF NOT EXISTS idx_pps_tenant_month
  ON payroll_period_states (tenant_id, period_month DESC);

CREATE INDEX IF NOT EXISTS idx_pps_tenant_state
  ON payroll_period_states (tenant_id, governance_state);

ALTER TABLE payroll_period_states ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "pps_hr_all" ON payroll_period_states;
CREATE POLICY "pps_hr_all" ON payroll_period_states FOR ALL
  USING (tenant_id = get_user_tenant_id() AND get_user_role() IN ('super_admin', 'hr_admin'));

COMMENT ON TABLE payroll_period_states IS
  'Payroll freeze governance layer. Tracks whether retroactive rebuilds are allowed for each tenant×period. Does not replace payroll_runs — it adds orchestration boundaries on top.';

-- =============================================================================
-- D. attendance_processing_states — attendance lifecycle state authority
-- =============================================================================
--
-- Centralises the processing-state authority for each employee × date's
-- attendance data. Does NOT rewrite attendance_daily records — it augments them
-- with a state machine that the orchestrator and rebuild pipeline consult.
--
-- States:
--   raw            — unprocessed punch data, no reconstruction applied
--   reconstructed  — attendance calculated/corrected but not yet finalized
--   finalized      — attendance confirmed for this period (attendance finalisation)
--   payroll_locked — the period containing this date is locked for payroll
--   frozen         — immutable; no replay or retroactive mutations allowed
--   replay_pending — a retroactive rebuild is queued; data may be recomputed

CREATE TABLE IF NOT EXISTS attendance_processing_states (
  id                        UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id                 UUID          NOT NULL REFERENCES tenants(id)    ON DELETE CASCADE,
  employee_id               UUID          NOT NULL REFERENCES employees(id)  ON DELETE CASCADE,

  -- The calendar date this state applies to (named work_date to avoid SQL keyword clash)
  work_date                 DATE          NOT NULL,

  -- State machine
  state                     TEXT          NOT NULL DEFAULT 'raw'
    CHECK (state IN (
      'raw', 'reconstructed', 'finalized', 'payroll_locked', 'frozen', 'replay_pending'
    )),
  state_reason              TEXT,

  -- Link to the payroll period that locked this date (set when state = 'payroll_locked')
  payroll_period_state_id   UUID          REFERENCES payroll_period_states(id) ON DELETE SET NULL,

  -- Lineage link — which orchestration chain last transitioned this state
  orchestrator_lineage_id   UUID,

  transitioned_at           TIMESTAMPTZ   NOT NULL DEFAULT now(),
  created_at                TIMESTAMPTZ   NOT NULL DEFAULT now(),
  updated_at                TIMESTAMPTZ   NOT NULL DEFAULT now(),

  UNIQUE (tenant_id, employee_id, work_date)
);

CREATE INDEX IF NOT EXISTS idx_aps_employee_date
  ON attendance_processing_states (tenant_id, employee_id, work_date DESC);

CREATE INDEX IF NOT EXISTS idx_aps_state
  ON attendance_processing_states (tenant_id, state, work_date DESC);

CREATE INDEX IF NOT EXISTS idx_aps_orchestrator_lineage
  ON attendance_processing_states (orchestrator_lineage_id)
  WHERE orchestrator_lineage_id IS NOT NULL;

ALTER TABLE attendance_processing_states ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "aps_hr_all" ON attendance_processing_states;
CREATE POLICY "aps_hr_all" ON attendance_processing_states FOR ALL
  USING (tenant_id = get_user_tenant_id() AND get_user_role() IN ('super_admin', 'hr_admin'));

COMMENT ON TABLE attendance_processing_states IS
  'Authoritative attendance processing lifecycle state per employee × date. Consulted by the workforce orchestrator to determine replay eligibility and retroactive mutation boundaries.';

-- =============================================================================
-- E. workforce_rebuild_events — retroactive orchestration event tracking
-- =============================================================================
--
-- One row per orchestration chain. Tracks the full lifecycle of a coordinated
-- retroactive rebuild from initiation through completion of all downstream
-- modules. The orchestrator_lineage_id ties this to all retroactive_rebuild_queue
-- entries that belong to the same chain.

CREATE TABLE IF NOT EXISTS workforce_rebuild_events (
  id                      UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id               UUID          NOT NULL REFERENCES tenants(id)            ON DELETE CASCADE,

  -- Shared lineage across the entire rebuild chain
  orchestrator_lineage_id UUID          NOT NULL,

  -- The root retroactive_rebuild_queue entry that initiated this chain (if any)
  parent_rebuild_id       UUID          REFERENCES retroactive_rebuild_queue(id)   ON DELETE SET NULL,

  -- Source governance event that triggered this orchestration
  source_event_id         UUID          NOT NULL,
  source_event_type       TEXT          NOT NULL,

  -- Affected scope
  employee_id             UUID          REFERENCES employees(id)                   ON DELETE CASCADE,
  rebuild_from_date       DATE          NOT NULL,
  rebuild_to_date         DATE,

  -- Full ordered list of modules to rebuild (may include 'entitlement', 'reconciliation'
  -- in addition to the core RebuildModule values)
  downstream_modules      TEXT[]        NOT NULL DEFAULT '{}',

  -- How many times this chain has been replayed (1 = original run)
  replay_generation       INT           NOT NULL DEFAULT 1,

  rebuild_scope           TEXT
    CHECK (rebuild_scope IS NULL OR rebuild_scope IN (
      'single_day', 'date_range', 'full_year', 'open_ended'
    )),

  -- Chain orchestration status
  orchestration_status    TEXT          NOT NULL DEFAULT 'initiated'
    CHECK (orchestration_status IN (
      'initiated', 'sequencing', 'in_progress', 'completed', 'failed', 'cancelled'
    )),

  -- Progress tracking (filled in as each module completes / fails)
  completed_modules       TEXT[]        NOT NULL DEFAULT '{}',
  failed_modules          TEXT[]        NOT NULL DEFAULT '{}',

  -- Replay safety: stores cycle keys seen, idempotency guards, etc.
  replay_safety_markers   JSONB         NOT NULL DEFAULT '{}',

  notes                   TEXT,
  created_by              UUID          REFERENCES profiles(id)                    ON DELETE SET NULL,
  created_at              TIMESTAMPTZ   NOT NULL DEFAULT now(),
  updated_at              TIMESTAMPTZ   NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_wre_tenant_status
  ON workforce_rebuild_events (tenant_id, orchestration_status, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_wre_employee
  ON workforce_rebuild_events (tenant_id, employee_id, created_at DESC)
  WHERE employee_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_wre_lineage
  ON workforce_rebuild_events (orchestrator_lineage_id);

CREATE INDEX IF NOT EXISTS idx_wre_source_event
  ON workforce_rebuild_events (source_event_type, source_event_id);

ALTER TABLE workforce_rebuild_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "wre_hr_all" ON workforce_rebuild_events;
CREATE POLICY "wre_hr_all" ON workforce_rebuild_events FOR ALL
  USING (tenant_id = get_user_tenant_id() AND get_user_role() IN ('super_admin', 'hr_admin'));

COMMENT ON TABLE workforce_rebuild_events IS
  'Orchestration event record for each coordinated retroactive rebuild chain. Tracks all downstream modules, completion progress, and replay lineage across attendance, leave, payroll, entitlement, and reconciliation.';

-- =============================================================================
-- F. workforce_event_timeline — unified chronological governance history
-- =============================================================================
--
-- Write-once event log. Every governance action that crosses module boundaries
-- is recorded here. This becomes the authoritative single source of truth for
-- "what happened to this employee's workforce state and when."
--
-- NOT yet surfaced in UI — Phase 3 establishes contracts and persistence only.

CREATE TABLE IF NOT EXISTS workforce_event_timeline (
  id                      UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id               UUID          NOT NULL REFERENCES tenants(id)            ON DELETE CASCADE,

  -- Which employee is affected (null for tenant-wide events)
  employee_id             UUID          REFERENCES employees(id)                   ON DELETE CASCADE,

  -- Event classification
  event_type              TEXT          NOT NULL
    CHECK (event_type IN (
      'leave_approved',
      'leave_cancelled',
      'retro_leave_approved',
      'attendance_rebuild',
      'attendance_finalized',
      'attendance_correction',
      'payroll_lock',
      'payroll_unlock',
      'payroll_archived',
      'entitlement_release',
      'freeze_application',
      'carry_forward',
      'reconciliation_repair',
      'scheduler_replay',
      'policy_change',
      'balance_correction',
      'retroactive_rebuild_queued',
      'retroactive_rebuild_completed'
    )),

  -- The calendar date this event is effective for (governance date, not created_at)
  event_date              DATE          NOT NULL,

  -- Which module produced this event
  source_module           TEXT          NOT NULL
    CHECK (source_module IN (
      'leave', 'attendance', 'payroll', 'entitlement',
      'reconciliation', 'scheduler', 'orchestrator'
    )),

  -- FK to the source entity (leave_request_id, attendance_daily_id, etc.)
  source_entity_id        UUID,
  source_entity_type      TEXT,

  -- Orchestration lineage — ties timeline entries to rebuild chains
  orchestrator_lineage_id UUID,
  rebuild_event_id        UUID          REFERENCES workforce_rebuild_events(id)    ON DELETE SET NULL,

  -- Arbitrary governance metadata (event-specific payload)
  payload                 JSONB         NOT NULL DEFAULT '{}',

  -- Replay chain linkage
  replay_reference_id     UUID,         -- points to the original event this replays
  replay_generation       INT           NOT NULL DEFAULT 1,

  created_by              UUID          REFERENCES profiles(id)                    ON DELETE SET NULL,
  created_at              TIMESTAMPTZ   NOT NULL DEFAULT now()
  -- NOTE: intentionally no updated_at — timeline entries are write-once
);

CREATE INDEX IF NOT EXISTS idx_wet_employee_date
  ON workforce_event_timeline (tenant_id, employee_id, event_date DESC)
  WHERE employee_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_wet_event_type_date
  ON workforce_event_timeline (tenant_id, event_type, event_date DESC);

CREATE INDEX IF NOT EXISTS idx_wet_lineage
  ON workforce_event_timeline (orchestrator_lineage_id)
  WHERE orchestrator_lineage_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_wet_rebuild_event
  ON workforce_event_timeline (rebuild_event_id)
  WHERE rebuild_event_id IS NOT NULL;

ALTER TABLE workforce_event_timeline ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "wet_hr_read" ON workforce_event_timeline;
CREATE POLICY "wet_hr_read" ON workforce_event_timeline FOR SELECT
  USING (tenant_id = get_user_tenant_id() AND get_user_role() IN ('super_admin', 'hr_admin'));

DROP POLICY IF EXISTS "wet_hr_insert" ON workforce_event_timeline;
CREATE POLICY "wet_hr_insert" ON workforce_event_timeline FOR INSERT
  WITH CHECK (get_user_role() IN ('super_admin', 'hr_admin'));

-- Service-role inserts (orchestrator) bypass RLS — no INSERT policy needed for service key.

COMMENT ON TABLE workforce_event_timeline IS
  'Unified write-once governance event log. Records every cross-module workforce governance action with orchestration lineage for deterministic replay and audit trail.';

-- =============================================================================
-- G. workforce_reconciliation_runs + workforce_reconciliation_issues
-- =============================================================================
--
-- Cross-module reconciliation extension. Runs AFTER the existing per-module
-- reconciliation engines and validates orchestration-level integrity:
-- orphan rebuild chains, freeze-boundary violations, replay lineage corruption, etc.

CREATE TABLE IF NOT EXISTS workforce_reconciliation_runs (
  id                    UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id             UUID          NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  status                TEXT          NOT NULL DEFAULT 'running'
    CHECK (status IN ('running', 'completed', 'failed')),
  reconcile_year        INT           NOT NULL,
  triggered_by          UUID          REFERENCES profiles(id) ON DELETE SET NULL,
  trigger_source        TEXT          NOT NULL DEFAULT 'api'
    CHECK (trigger_source IN ('api', 'scheduler', 'manual')),
  total_issues          INT           NOT NULL DEFAULT 0,
  issue_breakdown       JSONB         NOT NULL DEFAULT '{}',
  duration_ms           INT,
  error                 TEXT,
  completed_at          TIMESTAMPTZ,
  created_at            TIMESTAMPTZ   NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_wrr_tenant_year
  ON workforce_reconciliation_runs (tenant_id, reconcile_year DESC, created_at DESC);

ALTER TABLE workforce_reconciliation_runs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "wrr_hr_all" ON workforce_reconciliation_runs;
CREATE POLICY "wrr_hr_all" ON workforce_reconciliation_runs FOR ALL
  USING (tenant_id = get_user_tenant_id() AND get_user_role() IN ('super_admin', 'hr_admin'));

-- ── Cross-module issues ────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS workforce_reconciliation_issues (
  id                      UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id                  UUID          NOT NULL REFERENCES workforce_reconciliation_runs(id) ON DELETE CASCADE,
  tenant_id               UUID          NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,

  issue_type              TEXT          NOT NULL
    CHECK (issue_type IN (
      'cross_module_replay_drift',
      'orphan_rebuild_chain',
      'freeze_boundary_violation',
      'replay_lineage_corruption',
      'retro_rebuild_incomplete',
      'attendance_payroll_mismatch'
    )),

  severity                TEXT          NOT NULL DEFAULT 'warning'
    CHECK (severity IN ('info', 'warning', 'error', 'critical')),

  -- Scope of the issue
  employee_id             UUID          REFERENCES employees(id)    ON DELETE CASCADE,
  rebuild_event_id        UUID          REFERENCES workforce_rebuild_events(id) ON DELETE SET NULL,
  orchestrator_lineage_id UUID,
  affected_modules        TEXT[]        NOT NULL DEFAULT '{}',
  affected_period         TEXT,         -- 'YYYY-MM' if period-specific

  -- Diagnostic data
  detail                  JSONB         NOT NULL DEFAULT '{}',
  suggestion              TEXT,

  created_at              TIMESTAMPTZ   NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_wri_run_id
  ON workforce_reconciliation_issues (run_id, severity);

CREATE INDEX IF NOT EXISTS idx_wri_tenant_type
  ON workforce_reconciliation_issues (tenant_id, issue_type, created_at DESC);

ALTER TABLE workforce_reconciliation_issues ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "wri_hr_all" ON workforce_reconciliation_issues;
CREATE POLICY "wri_hr_all" ON workforce_reconciliation_issues FOR ALL
  USING (tenant_id = get_user_tenant_id() AND get_user_role() IN ('super_admin', 'hr_admin'));

COMMENT ON TABLE workforce_reconciliation_runs IS
  'Cross-module reconciliation run metadata. Extends per-module reconciliation with orchestration-level integrity checks across attendance, leave, payroll, and rebuild chains.';

COMMENT ON TABLE workforce_reconciliation_issues IS
  'Cross-module reconciliation issues. Records orphan rebuild chains, freeze-boundary violations, replay lineage corruption, and other orchestration-level anomalies.';

-- ─────────────────────────────────────────────────────────────────────────
-- 166_statutory_governance.sql
-- ─────────────────────────────────────────────────────────────────────────
-- =============================================================================
-- 166_statutory_governance.sql
-- Enterprise Statutory Governance — EPF / ESI / PTax
--
-- Adds:
--   1.  state_code on sites (Employee → Site → State chain for PTax)
--   2.  statutory_registrations — site-level registration numbers
--   3.  payroll_statutory_settings — enabled flags (replaces missing payroll_configs)
--   4.  ptax_slabs.frequency & deduction_month — half-yearly / annual support
--   5.  epf_config: effective_to + multi-row versioning support
--   6.  epf_eligibility_overrides: effective_to, approved_by, audit fields
--   7.  employee_statutory_overrides — unified ESI/PTax exemption table
--   8.  statutory_audit_log — all override/config change events
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1.  state_code on sites
-- ---------------------------------------------------------------------------
ALTER TABLE sites ADD COLUMN IF NOT EXISTS state_code TEXT;

COMMENT ON COLUMN sites.state_code IS
  'ISO 3166-2 state code (e.g. MH, KA, TG, DL). '
  'Used to auto-derive Professional Tax jurisdiction for employees at this site.';

-- ---------------------------------------------------------------------------
-- 2.  statutory_registrations
-- Site-level registration numbers for EPF, ESI, and Professional Tax.
-- A company with branches in MH, KA, TG maintains separate registrations.
-- One row per (tenant, site, statutory_type, effective_from).
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS statutory_registrations (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id           UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    site_id             UUID REFERENCES sites(id) ON DELETE SET NULL,
                        -- NULL = applies at tenant level (fallback when no site match)
    statutory_type      TEXT NOT NULL CHECK (statutory_type IN ('epf', 'esi', 'ptax')),
    registration_number TEXT NOT NULL,
    state_code          TEXT,           -- required for ptax, optional for epf/esi
    effective_from      DATE NOT NULL,
    effective_to        DATE,
    is_active           BOOLEAN NOT NULL DEFAULT true,
    notes               TEXT,
    created_by          UUID REFERENCES profiles(id) ON DELETE SET NULL,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (tenant_id, site_id, statutory_type, effective_from)
);

CREATE INDEX IF NOT EXISTS idx_stat_reg_tenant_site_type
    ON statutory_registrations (tenant_id, site_id, statutory_type)
    WHERE is_active = true;

ALTER TABLE statutory_registrations ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "statreg_tenant_read" ON statutory_registrations;
CREATE POLICY "statreg_tenant_read" ON statutory_registrations
    FOR SELECT USING (tenant_id = get_user_tenant_id());

DROP POLICY IF EXISTS "statreg_hr_write" ON statutory_registrations;
CREATE POLICY "statreg_hr_write" ON statutory_registrations
    FOR ALL USING (get_user_role() IN ('super_admin', 'hr_admin'));

-- ---------------------------------------------------------------------------
-- 3.  payroll_statutory_settings
-- Enabled flags and TDS defaults for the tenant.
-- This replaces the previously referenced but never-created `payroll_configs`
-- table.  The payroll snapshot engine will read from this table.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS payroll_statutory_settings (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id           UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE UNIQUE,
    pf_enabled          BOOLEAN NOT NULL DEFAULT true,
    esi_enabled         BOOLEAN NOT NULL DEFAULT true,
    pt_enabled          BOOLEAN NOT NULL DEFAULT false,
    tds_enabled         BOOLEAN NOT NULL DEFAULT false,
    tds_default_rate    DECIMAL(5,2) NOT NULL DEFAULT 0,
    tds_default_regime  TEXT NOT NULL DEFAULT 'new' CHECK (tds_default_regime IN ('old','new')),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_by          UUID REFERENCES profiles(id) ON DELETE SET NULL
);

ALTER TABLE payroll_statutory_settings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "statset_tenant_read" ON payroll_statutory_settings;
CREATE POLICY "statset_tenant_read" ON payroll_statutory_settings
    FOR SELECT USING (tenant_id = get_user_tenant_id());

DROP POLICY IF EXISTS "statset_hr_write" ON payroll_statutory_settings;
CREATE POLICY "statset_hr_write" ON payroll_statutory_settings
    FOR ALL USING (get_user_role() IN ('super_admin', 'hr_admin'));

-- ---------------------------------------------------------------------------
-- 4.  PTax slab: frequency + deduction_month
-- frequency controls WHEN the deduction fires within a year.
-- deduction_month is the calendar month (1-12) for first/only deduction.
-- half_yearly fires at deduction_month AND (deduction_month + 6).
-- ---------------------------------------------------------------------------
ALTER TABLE ptax_slabs
    ADD COLUMN IF NOT EXISTS frequency       TEXT NOT NULL DEFAULT 'monthly'
        CHECK (frequency IN ('monthly','half_yearly','annual')),
    ADD COLUMN IF NOT EXISTS deduction_month INT CHECK (deduction_month BETWEEN 1 AND 12);
    -- deduction_month NULL = use month 3 (March) for annual, month 9 + 3 for half_yearly

COMMENT ON COLUMN ptax_slabs.frequency IS
  'monthly: deduct every month. '
  'half_yearly: deduct in deduction_month and deduction_month+6. '
  'annual: deduct only in deduction_month (default March=3).';

-- ---------------------------------------------------------------------------
-- 5.  epf_config: effective_to for version history + configurable EDLI/admin
-- Drop the UNIQUE constraint on tenant_id to allow multiple dated versions.
-- The active version is effective_from <= :month AND (effective_to IS NULL OR effective_to >= :month).
-- ---------------------------------------------------------------------------
ALTER TABLE epf_config DROP CONSTRAINT IF EXISTS epf_config_tenant_id_key;

ALTER TABLE epf_config
    ADD COLUMN IF NOT EXISTS effective_to       DATE,
    ADD COLUMN IF NOT EXISTS edli_rate_pct      DECIMAL(5,2)  NOT NULL DEFAULT 0.50,
    ADD COLUMN IF NOT EXISTS edli_cap           DECIMAL(10,2) NOT NULL DEFAULT 75.00,
    ADD COLUMN IF NOT EXISTS edli_floor         DECIMAL(10,2) NOT NULL DEFAULT 25.00,
    ADD COLUMN IF NOT EXISTS admin_charges_pct  DECIMAL(5,2)  NOT NULL DEFAULT 0.50;

COMMENT ON COLUMN epf_config.edli_rate_pct     IS 'EDLI contribution rate (%) — statutory default 0.5%';
COMMENT ON COLUMN epf_config.edli_cap          IS 'EDLI monthly cap in INR — statutory default ₹75';
COMMENT ON COLUMN epf_config.edli_floor        IS 'EDLI/admin charge floor in INR — statutory default ₹25; set 0 to disable';
COMMENT ON COLUMN epf_config.admin_charges_pct IS 'EPF admin charges on employer side (%) — statutory default 0.5%';

-- Unique: one open-ended (effective_to IS NULL) config per tenant at any time.
-- Partial unique index: allows many closed versions, only one open-ended.
CREATE UNIQUE INDEX IF NOT EXISTS idx_epf_config_active_per_tenant
    ON epf_config (tenant_id)
    WHERE effective_to IS NULL;

-- Same for ESI config
ALTER TABLE esi_config DROP CONSTRAINT IF EXISTS esi_config_tenant_id_key;

ALTER TABLE esi_config
    ADD COLUMN IF NOT EXISTS effective_to DATE;

CREATE UNIQUE INDEX IF NOT EXISTS idx_esi_config_active_per_tenant
    ON esi_config (tenant_id)
    WHERE effective_to IS NULL;

-- ---------------------------------------------------------------------------
-- 6.  epf_eligibility_overrides: add effective_to + governance fields
-- ---------------------------------------------------------------------------
ALTER TABLE epf_eligibility_overrides
    ADD COLUMN IF NOT EXISTS effective_to    DATE,
    ADD COLUMN IF NOT EXISTS approved_by     UUID REFERENCES profiles(id) ON DELETE SET NULL,
    ADD COLUMN IF NOT EXISTS approved_at     TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS is_international_worker BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN IF NOT EXISTS higher_pf_opted         BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN IF NOT EXISTS higher_pf_pct           DECIMAL(5,2),
    ADD COLUMN IF NOT EXISTS uan                     TEXT;
    -- UAN: Universal Account Number — stored here to link to ECR export

-- ---------------------------------------------------------------------------
-- 7.  employee_statutory_overrides
-- Unified ESI and PTax exemption tracking with full audit trail.
-- Covers cases: disability exemption, trainee, contract worker, etc.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS employee_statutory_overrides (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id           UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    employee_id         UUID NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
    statutory_type      TEXT NOT NULL CHECK (statutory_type IN ('esi','ptax')),
    is_exempt           BOOLEAN NOT NULL DEFAULT true,
    exemption_reason    TEXT NOT NULL,
    effective_from      DATE NOT NULL,
    effective_to        DATE,
    approved_by         UUID REFERENCES profiles(id) ON DELETE SET NULL,
    approved_at         TIMESTAMPTZ,
    created_by          UUID REFERENCES profiles(id) ON DELETE SET NULL,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    -- No UNIQUE — allow multiple time-range entries per employee per type
    CONSTRAINT eso_eff_dates_check CHECK (effective_to IS NULL OR effective_to >= effective_from)
);

CREATE INDEX IF NOT EXISTS idx_eso_tenant_emp_type
    ON employee_statutory_overrides (tenant_id, employee_id, statutory_type);

ALTER TABLE employee_statutory_overrides ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "eso_tenant_read" ON employee_statutory_overrides;
CREATE POLICY "eso_tenant_read" ON employee_statutory_overrides
    FOR SELECT USING (tenant_id = get_user_tenant_id());

DROP POLICY IF EXISTS "eso_hr_write" ON employee_statutory_overrides;
CREATE POLICY "eso_hr_write" ON employee_statutory_overrides
    FOR ALL USING (get_user_role() IN ('super_admin', 'hr_admin'));

-- ---------------------------------------------------------------------------
-- 8.  statutory_audit_log
-- Immutable append-only log for all statutory config and override changes.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS statutory_audit_log (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id       UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    event_type      TEXT NOT NULL,
                    -- 'epf_config_updated' | 'esi_config_updated'
                    -- | 'ptax_slab_added' | 'registration_added'
                    -- | 'epf_override_set' | 'statutory_override_set'
    entity_type     TEXT NOT NULL,   -- 'epf_config' | 'esi_config' | 'ptax_slab' | etc.
    entity_id       UUID,
    employee_id     UUID REFERENCES employees(id) ON DELETE SET NULL,
    changed_by      UUID REFERENCES profiles(id) ON DELETE SET NULL,
    changed_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    before_value    JSONB,           -- snapshot before change
    after_value     JSONB NOT NULL,  -- snapshot after change
    notes           TEXT
);

CREATE INDEX IF NOT EXISTS idx_stat_audit_tenant_changed_at
    ON statutory_audit_log (tenant_id, changed_at DESC);

CREATE INDEX IF NOT EXISTS idx_stat_audit_employee
    ON statutory_audit_log (tenant_id, employee_id)
    WHERE employee_id IS NOT NULL;

ALTER TABLE statutory_audit_log ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "stataudit_tenant_read" ON statutory_audit_log;
CREATE POLICY "stataudit_tenant_read" ON statutory_audit_log
    FOR SELECT USING (tenant_id = get_user_tenant_id());

DROP POLICY IF EXISTS "stataudit_insert" ON statutory_audit_log;
CREATE POLICY "stataudit_insert" ON statutory_audit_log
    FOR INSERT WITH CHECK (tenant_id = get_user_tenant_id());

-- ─────────────────────────────────────────────────────────────────────────
-- 188_operational_intelligence.sql
-- ─────────────────────────────────────────────────────────────────────────
-- ── Sprint 4: Operational Intelligence & Controlled Automation ───────────────
-- All tables additive. No existing tables modified.

-- automation_activity_logs: append-only audit trail of all automation actions
CREATE TABLE IF NOT EXISTS automation_activity_logs (
  id           UUID        NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  org_id       UUID        NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  action_type  TEXT        NOT NULL
    CHECK (action_type IN ('notification','escalation','reminder','task_creation','nudge','sla_alert','incident_creation')),
  entity_id    UUID        NOT NULL,
  entity_type  TEXT        NOT NULL,
  message      TEXT        NOT NULL,
  severity     TEXT        NOT NULL CHECK (severity IN ('info','warning','high','critical')),
  metadata     JSONB,
  explainability JSONB,
  fired_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- sla_breach_events: append-only SLA breach log
CREATE TABLE IF NOT EXISTS sla_breach_events (
  id               UUID        NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  org_id           UUID        NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  sla_id           TEXT        NOT NULL,
  entity_id        UUID        NOT NULL,
  entity_type      TEXT        NOT NULL,
  breach_severity  TEXT        NOT NULL CHECK (breach_severity IN ('info','warning','high','critical')),
  description      TEXT        NOT NULL,
  explainability   JSONB,
  breached_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- operational_heatmap_snapshots: periodic heatmap captures
CREATE TABLE IF NOT EXISTS operational_heatmap_snapshots (
  id           UUID        NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  org_id       UUID        NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  domain       TEXT        NOT NULL
    CHECK (domain IN ('payroll','attendance','governance','trust','approvals','system')),
  period       TEXT        NOT NULL,  -- YYYY-MM
  cells        JSONB       NOT NULL DEFAULT '[]',
  computed_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- simulation_runs: analytical simulation history
CREATE TABLE IF NOT EXISTS simulation_runs (
  id               UUID        NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  org_id           UUID        NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  simulation_type  TEXT        NOT NULL
    CHECK (simulation_type IN ('payroll_impact','compliance_threshold','workforce_overtime','policy_change')),
  label            TEXT        NOT NULL,
  input_params     JSONB       NOT NULL DEFAULT '{}',
  result_summary   JSONB       NOT NULL DEFAULT '{}',
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by       UUID        REFERENCES profiles(id) ON DELETE SET NULL
);

-- operational_health_signals: persisted health snapshots
CREATE TABLE IF NOT EXISTS operational_health_signals (
  id           UUID        NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  org_id       UUID        NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  domain       TEXT        NOT NULL,
  score        NUMERIC(5,2) NOT NULL CHECK (score >= 0 AND score <= 100),
  severity     TEXT        NOT NULL CHECK (severity IN ('healthy','warning','critical')),
  factors      TEXT[]      NOT NULL DEFAULT '{}',
  explainability JSONB,
  computed_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- security_intelligence_events: passive security signal log
CREATE TABLE IF NOT EXISTS security_intelligence_events (
  id           UUID        NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  org_id       UUID        NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  signal_type  TEXT        NOT NULL,
  entity_id    UUID        NOT NULL,
  entity_type  TEXT        NOT NULL DEFAULT 'user',
  severity     TEXT        NOT NULL CHECK (severity IN ('info','warning','high','critical')),
  description  TEXT        NOT NULL,
  metadata     JSONB,
  explainability JSONB,
  detected_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_automation_logs_org ON automation_activity_logs(org_id, fired_at DESC);
CREATE INDEX IF NOT EXISTS idx_sla_breaches_org ON sla_breach_events(org_id, breached_at DESC);
CREATE INDEX IF NOT EXISTS idx_heatmap_snapshots_org ON operational_heatmap_snapshots(org_id, domain, period);
CREATE INDEX IF NOT EXISTS idx_simulation_runs_org ON simulation_runs(org_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_health_signals_org ON operational_health_signals(org_id, domain, computed_at DESC);
CREATE INDEX IF NOT EXISTS idx_security_events_org ON security_intelligence_events(org_id, detected_at DESC);

-- RLS
ALTER TABLE automation_activity_logs       ENABLE ROW LEVEL SECURITY;
ALTER TABLE sla_breach_events              ENABLE ROW LEVEL SECURITY;
ALTER TABLE operational_heatmap_snapshots  ENABLE ROW LEVEL SECURITY;
ALTER TABLE simulation_runs                ENABLE ROW LEVEL SECURITY;
ALTER TABLE operational_health_signals     ENABLE ROW LEVEL SECURITY;
ALTER TABLE security_intelligence_events   ENABLE ROW LEVEL SECURITY;

-- Read policies
DROP POLICY IF EXISTS "aal_read" ON automation_activity_logs;
CREATE POLICY "aal_read" ON automation_activity_logs      FOR SELECT USING (org_id IN (SELECT id FROM tenants WHERE id = auth.uid()));
DROP POLICY IF EXISTS "sbe_read" ON sla_breach_events;
CREATE POLICY "sbe_read" ON sla_breach_events             FOR SELECT USING (org_id IN (SELECT id FROM tenants WHERE id = auth.uid()));
DROP POLICY IF EXISTS "ohs_read" ON operational_heatmap_snapshots;
CREATE POLICY "ohs_read" ON operational_heatmap_snapshots FOR SELECT USING (org_id IN (SELECT id FROM tenants WHERE id = auth.uid()));
DROP POLICY IF EXISTS "sr_read" ON simulation_runs;
CREATE POLICY "sr_read"  ON simulation_runs               FOR SELECT USING (org_id IN (SELECT id FROM tenants WHERE id = auth.uid()));
DROP POLICY IF EXISTS "ohs2_read" ON operational_health_signals;
CREATE POLICY "ohs2_read" ON operational_health_signals   FOR SELECT USING (org_id IN (SELECT id FROM tenants WHERE id = auth.uid()));
DROP POLICY IF EXISTS "sie_read" ON security_intelligence_events;
CREATE POLICY "sie_read" ON security_intelligence_events  FOR SELECT USING (org_id IN (SELECT id FROM tenants WHERE id = auth.uid()));

-- Write policies
DROP POLICY IF EXISTS "aal_insert" ON automation_activity_logs;
CREATE POLICY "aal_insert" ON automation_activity_logs      FOR INSERT WITH CHECK (true);
DROP POLICY IF EXISTS "sbe_insert" ON sla_breach_events;
CREATE POLICY "sbe_insert" ON sla_breach_events             FOR INSERT WITH CHECK (true);
DROP POLICY IF EXISTS "ohs_insert" ON operational_heatmap_snapshots;
CREATE POLICY "ohs_insert" ON operational_heatmap_snapshots FOR INSERT WITH CHECK (true);
DROP POLICY IF EXISTS "sr_insert" ON simulation_runs;
CREATE POLICY "sr_insert"  ON simulation_runs               FOR INSERT WITH CHECK (true);
DROP POLICY IF EXISTS "ohs2_insert" ON operational_health_signals;
CREATE POLICY "ohs2_insert" ON operational_health_signals   FOR INSERT WITH CHECK (true);
DROP POLICY IF EXISTS "sie_insert" ON security_intelligence_events;
CREATE POLICY "sie_insert" ON security_intelligence_events  FOR INSERT WITH CHECK (true);

COMMIT;
