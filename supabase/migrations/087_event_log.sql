-- ============================================================
-- 087_event_log.sql
-- Persistent Event Log: durable, queryable event storage
-- with correlation tracing and deduplication governance.
-- ============================================================

CREATE TABLE IF NOT EXISTS event_log (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       UUID        NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  event_type      TEXT        NOT NULL,
  correlation_id  TEXT,                   -- groups related events (e.g. a processing run)
  causation_id    UUID,                   -- the event_log.id that caused this event
  source          TEXT        NOT NULL DEFAULT 'system',  -- system | api | webhook | scheduler
  actor_id        UUID        REFERENCES profiles(id) ON DELETE SET NULL,
  payload         JSONB       NOT NULL DEFAULT '{}',
  metadata        JSONB       NOT NULL DEFAULT '{}',
  -- Status
  status          TEXT        NOT NULL DEFAULT 'delivered' CHECK (status IN (
    'delivered', 'failed', 'replayed', 'dead_lettered'
  )),
  delivery_attempts INT       NOT NULL DEFAULT 1,
  last_error      TEXT,
  -- Deduplication
  idempotency_key TEXT,                   -- if set, prevents duplicate processing
  -- Retention
  expires_at      TIMESTAMPTZ,            -- set by retention rules
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_event_log_tenant_type
  ON event_log (tenant_id, event_type, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_event_log_correlation
  ON event_log (tenant_id, correlation_id, created_at) WHERE correlation_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_event_log_status
  ON event_log (tenant_id, status, created_at DESC) WHERE status != 'delivered';
CREATE INDEX IF NOT EXISTS idx_event_log_actor
  ON event_log (tenant_id, actor_id, created_at DESC) WHERE actor_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_event_log_expires
  ON event_log (expires_at) WHERE expires_at IS NOT NULL;

-- Deduplication: unique idempotency_key per tenant when key is non-null
-- (replaces NULLS NOT DISTINCT which requires PG15+)
CREATE UNIQUE INDEX IF NOT EXISTS idx_event_log_idempotency
  ON event_log (tenant_id, idempotency_key)
  WHERE idempotency_key IS NOT NULL;

-- Event retention rules — how long to keep each event type
CREATE TABLE IF NOT EXISTS event_retention_rules (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       UUID        NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  event_type      TEXT,                   -- NULL = default rule for all types
  retention_days  INT         NOT NULL DEFAULT 90,
  archive_after_days INT,                 -- if set, archive instead of delete
  is_active       BOOLEAN     NOT NULL DEFAULT true,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_err_tenant_active
  ON event_retention_rules (tenant_id, is_active);

-- Unique event_type per tenant (NULL = default rule); partial index replaces NULLS NOT DISTINCT
CREATE UNIQUE INDEX IF NOT EXISTS idx_err_tenant_type_notnull
  ON event_retention_rules (tenant_id, event_type)
  WHERE event_type IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_err_tenant_default
  ON event_retention_rules (tenant_id)
  WHERE event_type IS NULL;

-- Event replay queue — tracks pending/completed replays
CREATE TABLE IF NOT EXISTS event_replay_queue (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       UUID        NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  event_log_id    UUID        NOT NULL REFERENCES event_log(id) ON DELETE CASCADE,
  requested_by    UUID        REFERENCES profiles(id) ON DELETE SET NULL,
  reason          TEXT        NOT NULL,
  status          TEXT        NOT NULL DEFAULT 'pending' CHECK (status IN (
    'pending', 'processing', 'completed', 'failed', 'cancelled'
  )),
  attempt_count   INT         NOT NULL DEFAULT 0,
  last_error      TEXT,
  completed_at    TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_erq_tenant_status
  ON event_replay_queue (tenant_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_erq_event_log
  ON event_replay_queue (event_log_id);

-- RLS
ALTER TABLE event_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE event_retention_rules ENABLE ROW LEVEL SECURITY;
ALTER TABLE event_replay_queue ENABLE ROW LEVEL SECURITY;

CREATE POLICY "el_tenant_read" ON event_log FOR SELECT
  USING (tenant_id = get_user_tenant_id());
CREATE POLICY "el_system_write" ON event_log FOR ALL
  USING (get_user_role() IN ('super_admin','hr_admin'));

CREATE POLICY "err_tenant_read" ON event_retention_rules FOR SELECT
  USING (tenant_id = get_user_tenant_id());
CREATE POLICY "err_admin_write" ON event_retention_rules FOR ALL
  USING (get_user_role() IN ('super_admin'));

CREATE POLICY "erq_tenant_read" ON event_replay_queue FOR SELECT
  USING (tenant_id = get_user_tenant_id());
CREATE POLICY "erq_admin_write" ON event_replay_queue FOR ALL
  USING (get_user_role() IN ('super_admin','hr_admin'));
