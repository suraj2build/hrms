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
