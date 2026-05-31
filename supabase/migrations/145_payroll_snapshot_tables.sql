-- ============================================================
-- 145_payroll_snapshot_tables.sql
--
-- Immutable payroll snapshot & replay architecture.
--
-- Three new tables:
--   payroll_run_snapshots      — top-level immutable manifest per finalized run
--   payroll_employee_snapshots — per-employee snapshot of all payroll inputs
--   payroll_replay_sessions    — tracks every replay / audit-reconstruct execution
--
-- Supporting changes:
--   payroll_runs.snapshot_id   — FK to the attached snapshot manifest
--   payroll_run_events         — expand CHECK constraint to cover snapshot events
-- ============================================================

-- ── 1. Top-level run snapshot manifest ────────────────────────────────────────

CREATE TABLE IF NOT EXISTS payroll_run_snapshots (
  id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id        UUID        NOT NULL,
  run_id           UUID        NOT NULL UNIQUE,
  month            TEXT        NOT NULL,
  snapshot_version INTEGER     NOT NULL DEFAULT 1,

  -- Deterministic SHA-256 hex of all employee snapshot blobs combined.
  -- Recomputing and comparing lets us detect silent mutation of finalized data.
  integrity_hash   TEXT,

  -- false only when the snapshot is intentionally archived by super_admin
  -- (corruption incident or engine-version migration).  Read-only otherwise.
  replayable       BOOLEAN     NOT NULL DEFAULT true,

  -- Formula / engine version identifiers — forward-compatibility metadata
  formula_engine_version     INTEGER NOT NULL DEFAULT 1,
  validation_engine_version  INTEGER NOT NULL DEFAULT 1,

  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by       UUID
);

CREATE INDEX IF NOT EXISTS idx_payroll_run_snapshots_run_id
  ON payroll_run_snapshots (run_id);

CREATE INDEX IF NOT EXISTS idx_payroll_run_snapshots_tenant_month
  ON payroll_run_snapshots (tenant_id, month);

-- Row-level security: same tenant isolation as all payroll tables
ALTER TABLE payroll_run_snapshots ENABLE ROW LEVEL SECURITY;

CREATE POLICY payroll_run_snapshots_tenant_isolation
  ON payroll_run_snapshots
  FOR ALL
  USING (tenant_id = (SELECT tenant_id FROM profiles WHERE id = auth.uid() LIMIT 1));

-- ── 2. Per-employee immutable snapshot ────────────────────────────────────────

CREATE TABLE IF NOT EXISTS payroll_employee_snapshots (
  id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  snapshot_id   UUID        NOT NULL REFERENCES payroll_run_snapshots (id) ON DELETE RESTRICT,
  tenant_id     UUID        NOT NULL,
  employee_id   UUID        NOT NULL,
  employee_code TEXT,
  employee_name TEXT,

  -- ── Serialised input state at time of finalization ──────────────────────────
  -- All JSONB blobs are write-once.  Anything that touches them after snapshot
  -- creation should be treated as data corruption.

  -- attendance_daily rows for the period (status, day_fraction, overtime_minutes)
  attendance_snapshot   JSONB,

  -- employee_compensations row (CTC, effective_from, components array)
  compensation_snapshot JSONB,

  -- salary_components definitions used (name, code, type, calc_type, formulas)
  component_snapshot    JSONB,

  -- Statutory configs: PF, ESI, PT slabs, TDS at time of run
  statutory_snapshot    JSONB,

  -- Expression strings + resolved values from formula engine
  formula_snapshot      JSONB,

  -- Enabled validation rules + severity + thresholds
  validation_snapshot   JSONB,

  -- ── Computed outputs (redundant with payroll_slips but isolated here) ───────
  gross_pay      NUMERIC(14, 2),
  deductions     NUMERIC(14, 2),
  net_pay        NUMERIC(14, 2),
  payable_days   NUMERIC(6, 2),
  lop_days       NUMERIC(6, 2),
  overtime_hours NUMERIC(6, 2),

  computed_at TIMESTAMPTZ,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_payroll_emp_snapshots_snapshot_id
  ON payroll_employee_snapshots (snapshot_id);

CREATE INDEX IF NOT EXISTS idx_payroll_emp_snapshots_employee_id
  ON payroll_employee_snapshots (employee_id);

ALTER TABLE payroll_employee_snapshots ENABLE ROW LEVEL SECURITY;

CREATE POLICY payroll_employee_snapshots_tenant_isolation
  ON payroll_employee_snapshots
  FOR ALL
  USING (tenant_id = (SELECT tenant_id FROM profiles WHERE id = auth.uid() LIMIT 1));

-- ── 3. Replay session tracking ────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS payroll_replay_sessions (
  id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    UUID        NOT NULL,
  run_id       UUID,
  snapshot_id  UUID        REFERENCES payroll_run_snapshots (id),

  -- 'dry_replay' | 'variance_replay' | 'audit_replay'
  replay_type  TEXT        NOT NULL,

  triggered_by UUID,
  triggered_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  -- 'success' | 'failed' | 'variance_found'
  result_status     TEXT,
  variance_detected BOOLEAN     NOT NULL DEFAULT false,
  variance_summary  JSONB,

  -- Full per-employee diff array (stored separately so summary stays small)
  employee_diffs    JSONB,

  completed_at      TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_payroll_replay_sessions_run_id
  ON payroll_replay_sessions (run_id);

CREATE INDEX IF NOT EXISTS idx_payroll_replay_sessions_tenant_id
  ON payroll_replay_sessions (tenant_id);

ALTER TABLE payroll_replay_sessions ENABLE ROW LEVEL SECURITY;

CREATE POLICY payroll_replay_sessions_tenant_isolation
  ON payroll_replay_sessions
  FOR ALL
  USING (tenant_id = (SELECT tenant_id FROM profiles WHERE id = auth.uid() LIMIT 1));

-- ── 4. Attach snapshot FK to payroll_runs ─────────────────────────────────────

ALTER TABLE payroll_runs
  ADD COLUMN IF NOT EXISTS snapshot_id UUID REFERENCES payroll_run_snapshots (id);

-- ── 5. Expand payroll_run_events CHECK constraint ─────────────────────────────

ALTER TABLE payroll_run_events
  DROP CONSTRAINT IF EXISTS payroll_run_events_type_check;

ALTER TABLE payroll_run_events
  ADD CONSTRAINT payroll_run_events_type_check
  CHECK (event_type IN (
    -- existing (run 139 + 144)
    'run_started',
    'run_completed',
    'slip_computed',
    'slip_insert_failed',
    'validation_failed',
    'data_fetch_failed',
    'compensation_missing',
    'compensation_invalid',
    'dry_run_completed',
    'run_finalized',
    'run_rolled_back',
    'run_frozen',
    'run_unfrozen',
    'blocker_resolved',
    'approval_submitted',
    'approval_approved',
    'approval_rejected',
    'slip_regenerated',
    'payout_initiated',
    'payout_failed',
    'payout_reversed',
    'override_applied',
    -- new (snapshot & replay)
    'snapshot_created',
    'snapshot_verified',
    'snapshot_integrity_failed',
    'replay_completed',
    'replay_variance_found'
  ));
