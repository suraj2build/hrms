/**
 * Migration 157 — Leave Scheduler Autonomy
 *
 * Converts leave entitlement execution from manual-trigger to fully
 * scheduler-authoritative, idempotent, auditable autonomous operation.
 *
 * Changes:
 *   1. leave_job_log — add trigger_type, dry_run, replay fields
 *   2. leave_reconciliation_reports — persistent nightly reconciliation results
 *   3. leave_scheduler_state — durable per-job state (survives restarts)
 */

-- ── 1. Extend leave_job_log with autonomy fields ──────────────────────────────

ALTER TABLE leave_job_log
  ADD COLUMN IF NOT EXISTS trigger_type TEXT NOT NULL DEFAULT 'scheduler'
    CHECK (trigger_type IN ('scheduler', 'manual_replay', 'recovery', 'dry_run')),
  ADD COLUMN IF NOT EXISTS dry_run BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS replay_reason TEXT,
  ADD COLUMN IF NOT EXISTS replay_source_job_id UUID REFERENCES leave_job_log(id) ON DELETE SET NULL;

COMMENT ON COLUMN leave_job_log.trigger_type IS
  'How this job was triggered. scheduler=automatic; manual_replay/recovery=HR-initiated with reason; dry_run=preview only';
COMMENT ON COLUMN leave_job_log.dry_run IS
  'If true, job computed and logged results but wrote no balance mutations.';
COMMENT ON COLUMN leave_job_log.replay_reason IS
  'Required when trigger_type IN (manual_replay, recovery, dry_run) — HR must document reason.';
COMMENT ON COLUMN leave_job_log.replay_source_job_id IS
  'Original job being replayed/recovered (nullable, used for traceability).';

CREATE INDEX IF NOT EXISTS idx_leave_job_log_trigger_type
  ON leave_job_log(tenant_id, job_type, trigger_type, started_at DESC);

-- ── 2. Leave reconciliation reports ─────────────────────────────────────────

CREATE TABLE IF NOT EXISTS leave_reconciliation_reports (
  id                UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         UUID        NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  run_date          DATE        NOT NULL,
  job_log_id        UUID        REFERENCES leave_job_log(id) ON DELETE SET NULL,
  year              INT         NOT NULL,
  trigger_type      TEXT        NOT NULL DEFAULT 'scheduler'
    CHECK (trigger_type IN ('scheduler', 'manual')),
  issues_found      INT         NOT NULL DEFAULT 0,
  critical_count    INT         NOT NULL DEFAULT 0,
  high_count        INT         NOT NULL DEFAULT 0,
  medium_count      INT         NOT NULL DEFAULT 0,
  low_count         INT         NOT NULL DEFAULT 0,
  severity          TEXT        NOT NULL DEFAULT 'none'
    CHECK (severity IN ('none', 'low', 'medium', 'high', 'critical')),
  employees_checked INT         NOT NULL DEFAULT 0,
  report_data       JSONB       NOT NULL DEFAULT '{}',
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (tenant_id, run_date)
);

CREATE INDEX IF NOT EXISTS idx_leave_recon_tenant_date
  ON leave_reconciliation_reports(tenant_id, run_date DESC);

COMMENT ON TABLE leave_reconciliation_reports IS
  'Nightly automated reconciliation run results — ledger integrity checks per tenant.';

-- ── 3. Leave scheduler state — durable restart-safe state ────────────────────

CREATE TABLE IF NOT EXISTS leave_scheduler_state (
  scheduler_name TEXT        NOT NULL DEFAULT 'leave-scheduler',
  state_key      TEXT        NOT NULL,   -- 'yearly_accrual', 'monthly_accrual', etc.
  last_ran_key   TEXT        NOT NULL,   -- yearKey/monthKey/dayKey last completed
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  -- The scheduler is a global process, not per-tenant.
  -- Per-tenant idempotency is already guaranteed by leave_job_log.
  PRIMARY KEY (scheduler_name, state_key)
);

COMMENT ON TABLE leave_scheduler_state IS
  'Persistent scheduler state — survives process restarts. Replaces in-memory ran object.';

-- ── 4. RLS: leave_reconciliation_reports ─────────────────────────────────────

ALTER TABLE leave_reconciliation_reports ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "tenant_isolation_recon_reports" ON leave_reconciliation_reports;
CREATE POLICY "tenant_isolation_recon_reports" ON leave_reconciliation_reports
  FOR ALL USING (
    tenant_id = (
      SELECT tenant_id FROM profiles WHERE id = auth.uid() LIMIT 1
    )
  );

-- ── 5. RLS: leave_scheduler_state ────────────────────────────────────────────
-- This table is written only by the backend service role (the scheduler process).
-- No user-facing RLS needed — deny all from anon/authenticated; service_role bypasses RLS.

ALTER TABLE leave_scheduler_state ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "deny_all_scheduler_state" ON leave_scheduler_state;
CREATE POLICY "deny_all_scheduler_state" ON leave_scheduler_state
  FOR ALL USING (false);  -- service_role always bypasses RLS; all other roles denied
