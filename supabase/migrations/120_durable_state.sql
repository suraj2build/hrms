/**
 * Migration 120 — Durable Operational State
 *
 * Replaces the in-memory operational state in durable-queue.ts:
 *
 *   1. poison_job_quarantine
 *      Replaces: Map<string,number> requeueCounts + Set<string> quarantined
 *      Stores:   per-job requeue history with quarantine flag and audit trail.
 *      Survives: process restart, deployment, horizontal scaling.
 *
 *   2. retry_storm_incidents
 *      Replaces: ephemeral storm detection with no persistence
 *      Stores:   detected storms, acknowledgement, resolution, open/closed state.
 *      Survives: process restart; enables trend analysis.
 *
 *   3. module_health
 *      Replaces: in-memory platformHealth.modules object
 *      Stores:   per-module startup status, error messages, last updated timestamp.
 *      Survives: process restart; enables cross-instance health aggregation.
 */

-- ── 1. Poison Job Quarantine ──────────────────────────────────────────────────
--
-- One row per job that has been manually requeued at least once.
-- requeue_count is incremented atomically via upsert.
-- When requeue_count >= threshold, is_quarantined is set to true.
-- Operators clear quarantine via clearQuarantine() which sets cleared_at.

CREATE TABLE poison_job_quarantine (
  job_id              uuid        PRIMARY KEY,
  job_type            text        NOT NULL,
  tenant_id           uuid        REFERENCES tenants(id) ON DELETE SET NULL,
  requeue_count       int         NOT NULL DEFAULT 0 CHECK (requeue_count >= 0),
  is_quarantined      boolean     NOT NULL DEFAULT false,
  first_requeue_at    timestamptz NOT NULL DEFAULT now(),
  last_requeue_at     timestamptz NOT NULL DEFAULT now(),
  quarantined_at      timestamptz,         -- when quarantine threshold was crossed
  quarantine_reason   text,                -- system note: '3 requeue attempts exhausted'
  cleared_at          timestamptz,         -- when operator cleared quarantine
  cleared_by          uuid        REFERENCES auth.users(id),
  clear_reason        text,                -- operator's stated reason for clearing
  metadata            jsonb       NOT NULL DEFAULT '{}',
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_poison_job_quarantine_tenant    ON poison_job_quarantine (tenant_id);
CREATE INDEX idx_poison_job_quarantine_active    ON poison_job_quarantine (is_quarantined)
  WHERE is_quarantined = true AND cleared_at IS NULL;
CREATE INDEX idx_poison_job_quarantine_updated   ON poison_job_quarantine (updated_at DESC);

-- Auto-update updated_at
CREATE OR REPLACE FUNCTION fn_touch_poison_job_quarantine()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_touch_poison_job_quarantine
  BEFORE UPDATE ON poison_job_quarantine
  FOR EACH ROW EXECUTE FUNCTION fn_touch_poison_job_quarantine();

COMMENT ON TABLE poison_job_quarantine IS
  'Durable poison-job quarantine state. Replaces in-memory requeueCounts Map and quarantined Set in durable-queue.ts.';

-- ── 2. Retry Storm Incidents ───────────────────────────────────────────────────
--
-- One row per detected storm event (job_type + detection window).
-- Idempotency: UNIQUE(job_type, detected_at::date) prevents duplicate storm
-- rows for the same job type within the same day.
-- Operators acknowledge/resolve via API; status drives dashboard alerting.

CREATE TABLE retry_storm_incidents (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  job_type        text        NOT NULL,
  tenant_id       uuid        REFERENCES tenants(id) ON DELETE SET NULL,
  dead_count      int         NOT NULL,
  window_ms       int         NOT NULL,
  first_dead_at   timestamptz NOT NULL,
  last_dead_at    timestamptz NOT NULL,
  detected_at     timestamptz NOT NULL DEFAULT now(),
  -- storm_bucket: 'YYYY-MM-DD HH24' (UTC hour bucket) — computed by trigger on INSERT.
  -- Plain text column so the dedup UNIQUE INDEX can use an IMMUTABLE expression.
  storm_bucket    text        NOT NULL DEFAULT '',
  status          text        NOT NULL DEFAULT 'open'
                              CHECK (status IN ('open', 'acknowledged', 'resolved', 'false_positive')),
  acknowledged_by uuid        REFERENCES auth.users(id),
  acknowledged_at timestamptz,
  resolved_by     uuid        REFERENCES auth.users(id),
  resolved_at     timestamptz,
  resolution_note text,
  -- Link to operational incident if escalated
  incident_id     uuid,
  metadata        jsonb       NOT NULL DEFAULT '{}',
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_retry_storm_open         ON retry_storm_incidents (status, detected_at DESC)
  WHERE status = 'open';
CREATE INDEX idx_retry_storm_job_type     ON retry_storm_incidents (job_type, detected_at DESC);
CREATE INDEX idx_retry_storm_tenant       ON retry_storm_incidents (tenant_id, detected_at DESC);

-- Dedup: one open storm per job_type per UTC-hour bucket.
-- Uses the plain-text storm_bucket column (set by trigger) — no expression in index.
CREATE UNIQUE INDEX idx_retry_storm_dedup
  ON retry_storm_incidents (job_type, storm_bucket)
  WHERE status = 'open';

-- Populate storm_bucket on INSERT from detected_at (triggers may use STABLE functions).
CREATE OR REPLACE FUNCTION fn_set_storm_bucket()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  -- Format: 'YYYY-MM-DD HH24' in UTC — uniquely identifies a 1-hour window
  NEW.storm_bucket := to_char(NEW.detected_at AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24');
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_set_storm_bucket
  BEFORE INSERT ON retry_storm_incidents
  FOR EACH ROW EXECUTE FUNCTION fn_set_storm_bucket();

COMMENT ON TABLE retry_storm_incidents IS
  'Durable retry storm detection log. Replaces in-memory storm state in durable-queue.ts. '
  'storm_bucket (UTC hour) is set by trigger on INSERT; used for dedup unique index.';

-- ── 3. Module Health ──────────────────────────────────────────────────────────
--
-- One row per application module (e.g. 'durable-queue', 'leave-scheduler').
-- Upserted on every startup and status change.
-- Replaces the in-memory platformHealth.modules object which is cleared on restart.

CREATE TABLE module_health (
  module_name     text        PRIMARY KEY,
  status          text        NOT NULL DEFAULT 'starting'
                              CHECK (status IN ('starting', 'healthy', 'degraded', 'failed', 'stopped')),
  instance_id     text,                     -- process/container ID for multi-instance deployments
  version         text,                     -- application version string
  started_at      timestamptz,              -- when module last successfully started
  last_updated_at timestamptz NOT NULL DEFAULT now(),
  error_message   text,                     -- last error if status = 'failed' or 'degraded'
  error_count     int         NOT NULL DEFAULT 0,
  metadata        jsonb       NOT NULL DEFAULT '{}'
);

CREATE INDEX idx_module_health_status ON module_health (status)
  WHERE status IN ('failed', 'degraded');
CREATE INDEX idx_module_health_updated ON module_health (last_updated_at DESC);

COMMENT ON TABLE module_health IS
  'Durable module startup/health state. Replaces in-memory platformHealth.modules in startup-health.ts.';

-- Seed known modules with 'starting' status (idempotent via ON CONFLICT DO NOTHING)
INSERT INTO module_health (module_name, status, metadata) VALUES
  ('durable-queue',        'starting', '{}'),
  ('leave-scheduler',      'starting', '{}'),
  ('attendance-processor', 'starting', '{}'),
  ('payroll-engine',       'starting', '{}'),
  ('notification-service', 'starting', '{}')
ON CONFLICT (module_name) DO NOTHING;
