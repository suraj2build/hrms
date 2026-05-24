-- ============================================================
-- 088_orchestration.sql
-- Distributed Operational Orchestration: worker registry,
-- queue partitions, job ownership visibility.
-- ============================================================

-- Worker registry — tracks active processing workers
CREATE TABLE IF NOT EXISTS worker_registry (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       UUID        REFERENCES tenants(id) ON DELETE CASCADE,  -- NULL = shared worker
  worker_id       TEXT        NOT NULL UNIQUE,        -- process/instance identifier
  worker_type     TEXT        NOT NULL CHECK (worker_type IN (
    'attendance_processor', 'leave_accrual', 'sla_scanner',
    'intelligence_scanner', 'notification', 'payroll', 'general'
  )),
  host            TEXT        NOT NULL,               -- hostname or pod name
  started_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_heartbeat  TIMESTAMPTZ NOT NULL DEFAULT now(),
  status          TEXT        NOT NULL DEFAULT 'active' CHECK (status IN (
    'active', 'idle', 'draining', 'stopped', 'crashed'
  )),
  current_job_id  TEXT,
  jobs_processed  INT         NOT NULL DEFAULT 0,
  jobs_failed     INT         NOT NULL DEFAULT 0,
  metadata        JSONB       NOT NULL DEFAULT '{}',
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_wr_status_type
  ON worker_registry (status, worker_type);
CREATE INDEX IF NOT EXISTS idx_wr_heartbeat
  ON worker_registry (last_heartbeat DESC) WHERE status = 'active';

-- Queue partitions — logical queue segmentation per tenant/type
CREATE TABLE IF NOT EXISTS queue_partitions (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       UUID        NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  queue_name      TEXT        NOT NULL,               -- e.g. 'attendance', 'leave', 'payroll'
  partition_key   TEXT        NOT NULL,               -- tenant_id or dept_id for isolation
  current_depth   INT         NOT NULL DEFAULT 0,     -- items waiting
  max_depth       INT         NOT NULL DEFAULT 1000,
  pressure_level  TEXT        NOT NULL DEFAULT 'normal' CHECK (pressure_level IN (
    'low', 'normal', 'elevated', 'critical'
  )),
  assigned_worker_id TEXT     REFERENCES worker_registry(worker_id) ON DELETE SET NULL,
  last_processed_at TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, queue_name, partition_key)
);

CREATE INDEX IF NOT EXISTS idx_qp_tenant_queue
  ON queue_partitions (tenant_id, queue_name);
CREATE INDEX IF NOT EXISTS idx_qp_pressure
  ON queue_partitions (pressure_level, current_depth DESC) WHERE pressure_level != 'normal';

-- Long-running job registry — visibility into slow/stuck jobs
CREATE TABLE IF NOT EXISTS long_running_jobs (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       UUID        NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  job_type        TEXT        NOT NULL,
  job_key         TEXT,                               -- unique key for dedup
  worker_id       TEXT        REFERENCES worker_registry(worker_id) ON DELETE SET NULL,
  status          TEXT        NOT NULL DEFAULT 'running' CHECK (status IN (
    'pending', 'running', 'completed', 'failed', 'cancelled', 'timed_out'
  )),
  started_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at    TIMESTAMPTZ,
  timeout_at      TIMESTAMPTZ,                        -- when to mark as timed_out
  duration_ms     INT,
  progress_pct    INT         CHECK (progress_pct BETWEEN 0 AND 100),
  progress_note   TEXT,
  error_message   TEXT,
  metadata        JSONB       NOT NULL DEFAULT '{}',
  retry_count     INT         NOT NULL DEFAULT 0,
  max_retries     INT         NOT NULL DEFAULT 3,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_lrj_tenant_status
  ON long_running_jobs (tenant_id, status, started_at DESC);
CREATE INDEX IF NOT EXISTS idx_lrj_timeout
  ON long_running_jobs (timeout_at) WHERE status = 'running' AND timeout_at IS NOT NULL;

-- Unique job_key per tenant when set; partial index replaces NULLS NOT DISTINCT (PG15+)
CREATE UNIQUE INDEX IF NOT EXISTS idx_lrj_job_key
  ON long_running_jobs (tenant_id, job_key)
  WHERE job_key IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_lrj_worker
  ON long_running_jobs (worker_id, status) WHERE status = 'running';

-- RLS
ALTER TABLE worker_registry ENABLE ROW LEVEL SECURITY;
ALTER TABLE queue_partitions ENABLE ROW LEVEL SECURITY;
ALTER TABLE long_running_jobs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "wr_admin_read" ON worker_registry FOR SELECT
  USING (get_user_role() IN ('super_admin','hr_admin'));
CREATE POLICY "wr_system_write" ON worker_registry FOR ALL
  USING (get_user_role() IN ('super_admin'));

CREATE POLICY "qp_admin_read" ON queue_partitions FOR SELECT
  USING (tenant_id = get_user_tenant_id() AND get_user_role() IN ('super_admin','hr_admin'));
CREATE POLICY "qp_system_write" ON queue_partitions FOR ALL
  USING (get_user_role() IN ('super_admin'));

CREATE POLICY "lrj_tenant_read" ON long_running_jobs FOR SELECT
  USING (tenant_id = get_user_tenant_id());
CREATE POLICY "lrj_hr_write" ON long_running_jobs FOR ALL
  USING (get_user_role() IN ('super_admin','hr_admin'));
