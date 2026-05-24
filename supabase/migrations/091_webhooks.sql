-- ============================================================
-- 091_webhooks.sql
-- Platform Extensibility Foundation: webhook registry,
-- delivery tracking, integration registry, audit logs.
-- ============================================================

-- Webhook registrations — outbound event subscriptions
CREATE TABLE IF NOT EXISTS webhooks (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       UUID        NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name            TEXT        NOT NULL,
  url             TEXT        NOT NULL,
  secret          TEXT,                               -- HMAC signing secret
  event_types     TEXT[]      NOT NULL DEFAULT '{}',  -- subscribed event types
  headers         JSONB       NOT NULL DEFAULT '{}',  -- custom headers to send
  is_active       BOOLEAN     NOT NULL DEFAULT true,
  -- Retry config
  max_retries     INT         NOT NULL DEFAULT 3,
  retry_delay_seconds INT     NOT NULL DEFAULT 60,
  timeout_seconds INT         NOT NULL DEFAULT 30,
  -- Stats
  total_deliveries    INT     NOT NULL DEFAULT 0,
  successful_deliveries INT   NOT NULL DEFAULT 0,
  failed_deliveries   INT     NOT NULL DEFAULT 0,
  last_triggered_at   TIMESTAMPTZ,
  last_success_at     TIMESTAMPTZ,
  last_failure_at     TIMESTAMPTZ,
  -- Governance
  description     TEXT,
  created_by      UUID        REFERENCES profiles(id) ON DELETE SET NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, name)
);

CREATE INDEX IF NOT EXISTS idx_wh_tenant_active
  ON webhooks (tenant_id, is_active);
CREATE INDEX IF NOT EXISTS idx_wh_event_types
  ON webhooks USING GIN (event_types);

-- Webhook deliveries — per-event delivery tracking
CREATE TABLE IF NOT EXISTS webhook_deliveries (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       UUID        NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  webhook_id      UUID        NOT NULL REFERENCES webhooks(id) ON DELETE CASCADE,
  event_log_id    UUID        REFERENCES event_log(id) ON DELETE SET NULL,
  event_type      TEXT        NOT NULL,
  payload         JSONB       NOT NULL DEFAULT '{}',
  -- Delivery outcome
  status          TEXT        NOT NULL DEFAULT 'pending' CHECK (status IN (
    'pending', 'delivering', 'delivered', 'failed', 'retrying', 'dead_lettered'
  )),
  http_status     INT,
  response_body   TEXT,
  duration_ms     INT,
  attempt_number  INT         NOT NULL DEFAULT 1,
  next_retry_at   TIMESTAMPTZ,
  -- Correlation
  correlation_id  TEXT,
  idempotency_key TEXT,
  delivered_at    TIMESTAMPTZ,
  failed_at       TIMESTAMPTZ,
  last_error      TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_wd_webhook_status
  ON webhook_deliveries (webhook_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_wd_tenant_status
  ON webhook_deliveries (tenant_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_wd_retry
  ON webhook_deliveries (next_retry_at) WHERE status = 'retrying';
CREATE INDEX IF NOT EXISTS idx_wd_correlation
  ON webhook_deliveries (correlation_id) WHERE correlation_id IS NOT NULL;

-- Integration registry — external system catalog
CREATE TABLE IF NOT EXISTS integration_registry (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       UUID        NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name            TEXT        NOT NULL,
  integration_type TEXT       NOT NULL CHECK (integration_type IN (
    'payroll_export', 'biometric', 'erp', 'hris_external',
    'notification_gateway', 'document_storage', 'identity_provider',
    'time_tracking', 'custom_api', 'other'
  )),
  status          TEXT        NOT NULL DEFAULT 'active' CHECK (status IN (
    'active', 'inactive', 'error', 'maintenance'
  )),
  endpoint_url    TEXT,
  auth_type       TEXT        CHECK (auth_type IN ('api_key','oauth2','basic','hmac','none')),
  -- Config (non-sensitive metadata only — secrets stored externally)
  config          JSONB       NOT NULL DEFAULT '{}',
  -- Health
  last_health_check_at TIMESTAMPTZ,
  health_status   TEXT        CHECK (health_status IN ('healthy','degraded','unhealthy','unknown')),
  -- Stats
  total_calls     INT         NOT NULL DEFAULT 0,
  error_rate_pct  DECIMAL(5,2),
  avg_latency_ms  INT,
  -- Governance
  description     TEXT,
  created_by      UUID        REFERENCES profiles(id) ON DELETE SET NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, name)
);

CREATE INDEX IF NOT EXISTS idx_ir_tenant_status
  ON integration_registry (tenant_id, status);

-- Integration audit log — every call to external integrations
CREATE TABLE IF NOT EXISTS integration_audit_log (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       UUID        NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  integration_id  UUID        NOT NULL REFERENCES integration_registry(id) ON DELETE CASCADE,
  direction       TEXT        NOT NULL CHECK (direction IN ('inbound','outbound')),
  event_type      TEXT,
  operation       TEXT        NOT NULL,
  status          TEXT        NOT NULL CHECK (status IN ('success','failure','timeout','partial')),
  http_method     TEXT,
  endpoint        TEXT,
  http_status     INT,
  duration_ms     INT,
  payload_size_bytes INT,
  error_message   TEXT,
  correlation_id  TEXT,
  actor_id        UUID        REFERENCES profiles(id) ON DELETE SET NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_ial_integration_recent
  ON integration_audit_log (integration_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_ial_tenant_status
  ON integration_audit_log (tenant_id, status, created_at DESC);

-- RLS
ALTER TABLE webhooks ENABLE ROW LEVEL SECURITY;
ALTER TABLE webhook_deliveries ENABLE ROW LEVEL SECURITY;
ALTER TABLE integration_registry ENABLE ROW LEVEL SECURITY;
ALTER TABLE integration_audit_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "wh_tenant_read" ON webhooks FOR SELECT
  USING (tenant_id = get_user_tenant_id());
CREATE POLICY "wh_admin_write" ON webhooks FOR ALL
  USING (get_user_role() IN ('super_admin','hr_admin'));

CREATE POLICY "wd_tenant_read" ON webhook_deliveries FOR SELECT
  USING (tenant_id = get_user_tenant_id());
CREATE POLICY "wd_system_write" ON webhook_deliveries FOR ALL
  USING (get_user_role() IN ('super_admin','hr_admin'));

CREATE POLICY "ir_tenant_read" ON integration_registry FOR SELECT
  USING (tenant_id = get_user_tenant_id());
CREATE POLICY "ir_admin_write" ON integration_registry FOR ALL
  USING (get_user_role() IN ('super_admin','hr_admin'));

CREATE POLICY "ial_tenant_read" ON integration_audit_log FOR SELECT
  USING (tenant_id = get_user_tenant_id());
CREATE POLICY "ial_system_write" ON integration_audit_log FOR ALL
  USING (get_user_role() IN ('super_admin','hr_admin'));
