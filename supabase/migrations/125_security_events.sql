/**
 * Migration 125 — Security Operations Infrastructure
 *
 * Provides the full security event pipeline:
 *
 *   security_events          — append-only partitioned event stream.
 *                              Written by: auth middleware, API handlers, queue workers.
 *   security_detection_rules — configurable threat detection rules with thresholds.
 *   security_alerts          — alerts raised when detection rules fire.
 *                              Lifecycle: open → acknowledged → investigating → resolved.
 *
 * Detection runs every 60 seconds as a durable queue job ('security_detection_run').
 * New monthly partitions for security_events must be created by the scheduler
 * one month in advance (see scheduler job 'partition_maintenance').
 *
 * SOC 2: CC7.1 (monitoring), CC7.2 (detection), CC7.3 (response)
 * ISO 27001: A.12.4 (logging), A.16.1 (incident management)
 */

-- ── Security event severity type ──────────────────────────────────────────────

DO $$ BEGIN
  CREATE TYPE security_severity AS ENUM ('info', 'low', 'medium', 'high', 'critical');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ── Security events (partitioned by month) ────────────────────────────────────

CREATE TABLE IF NOT EXISTS security_events (
  id              bigint      GENERATED ALWAYS AS IDENTITY,
  event_type      text        NOT NULL,   -- 'failed_auth', 'bulk_export', 'role_change', …
  severity        security_severity NOT NULL DEFAULT 'info',
  tenant_id       uuid,
  actor_id        uuid,                   -- auth.users(id) — nullable for system events
  actor_ip        inet,
  actor_user_agent text,
  target_type     text,                   -- 'employee', 'payroll_run', 'credential', 'tenant' …
  target_id       text,
  event_data      jsonb       NOT NULL DEFAULT '{}',
  correlation_id  uuid,
  occurred_at     timestamptz NOT NULL DEFAULT now(),
  indexed_at      timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (id, occurred_at)
) PARTITION BY RANGE (occurred_at);

-- Create initial partitions (3 months: May, Jun, Jul 2026)
CREATE TABLE IF NOT EXISTS security_events_2026_05 PARTITION OF security_events
  FOR VALUES FROM ('2026-05-01') TO ('2026-06-01');
CREATE TABLE IF NOT EXISTS security_events_2026_06 PARTITION OF security_events
  FOR VALUES FROM ('2026-06-01') TO ('2026-07-01');
CREATE TABLE IF NOT EXISTS security_events_2026_07 PARTITION OF security_events
  FOR VALUES FROM ('2026-07-01') TO ('2026-08-01');
-- Default partition catches any out-of-range inserts (prevents INSERT failures)
CREATE TABLE IF NOT EXISTS security_events_default PARTITION OF security_events DEFAULT;

CREATE INDEX IF NOT EXISTS ON security_events (tenant_id, event_type, occurred_at DESC);
CREATE INDEX IF NOT EXISTS ON security_events (actor_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS ON security_events (severity, occurred_at DESC)
  WHERE severity IN ('high', 'critical');
CREATE INDEX IF NOT EXISTS ON security_events (correlation_id)
  WHERE correlation_id IS NOT NULL;

COMMENT ON TABLE security_events IS
  'Partitioned security event stream. Monthly partitions created by scheduler. '
  'Append-only — do not UPDATE or DELETE rows. Retention: 90 days hot, 1 year cold.';

-- ── Security detection rules ──────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS security_detection_rules (
  id               uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  rule_name        text        NOT NULL UNIQUE,
  description      text        NOT NULL,
  severity         security_severity NOT NULL,
  enabled          boolean     NOT NULL DEFAULT true,

  -- Detection parameters
  event_type_filter text,                         -- NULL = match all event types
  window_seconds   int         NOT NULL,          -- look-back window for event counting
  threshold        int         NOT NULL,          -- fire alert when count >= threshold

  -- Alert configuration
  alert_channel    text        NOT NULL DEFAULT 'slack'
                               CHECK (alert_channel IN ('slack','pagerduty','email','all')),
  cooldown_seconds int         NOT NULL DEFAULT 300,  -- suppress duplicate alerts within window
  runbook_url      text,

  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);

CREATE OR REPLACE FUNCTION fn_touch_security_detection_rules()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at := now(); RETURN NEW; END;
$$;

CREATE TRIGGER trg_touch_security_detection_rules
  BEFORE UPDATE ON security_detection_rules
  FOR EACH ROW EXECUTE FUNCTION fn_touch_security_detection_rules();

COMMENT ON TABLE security_detection_rules IS
  'Configurable threat detection rules. Detection engine evaluates all enabled rules '
  'every 60 seconds via the security_detection_run durable queue job.';

-- ── Seed: 12 detection rules ──────────────────────────────────────────────────

INSERT INTO security_detection_rules
  (rule_name, description, severity, event_type_filter, window_seconds, threshold, alert_channel, cooldown_seconds, runbook_url)
VALUES
  ('failed_auth_burst',
   'More than 10 failed authentication attempts for one user in 5 minutes',
   'high', 'failed_auth', 300, 10, 'pagerduty', 300,
   '/runbooks/failed-auth-burst'),

  ('impossible_travel',
   'Successful login from a geographically distant IP within 1 hour of previous login',
   'high', 'impossible_travel', 3600, 1, 'pagerduty', 3600,
   '/runbooks/impossible-travel'),

  ('bulk_pii_export',
   'More than 500 employee PII records accessed by one user in 10 minutes',
   'critical', 'bulk_pii_access', 600, 500, 'pagerduty', 600,
   '/runbooks/bulk-pii-export'),

  ('privilege_escalation',
   'Role elevated to payroll_admin or super_admin outside of business hours (before 08:00 or after 20:00)',
   'medium', 'role_change', 60, 1, 'slack', 300,
   '/runbooks/privilege-escalation'),

  ('after_hours_payroll_finalize',
   'Payroll finalization triggered outside of approved processing window',
   'medium', 'payroll_finalize', 60, 1, 'slack', 300,
   '/runbooks/after-hours-payroll'),

  ('api_key_new_ip',
   'Service role key used from an IP address not seen in the past 30 days',
   'high', 'credential_access', 60, 1, 'pagerduty', 3600,
   '/runbooks/api-key-new-ip'),

  ('multi_tenant_sweep',
   'Single actor accessing more than 3 distinct tenants within 5 minutes',
   'critical', 'tenant_access', 300, 3, 'pagerduty', 600,
   '/runbooks/multi-tenant-sweep'),

  ('repeated_403',
   'More than 20 forbidden (403) responses for one actor in 2 minutes — probing for access paths',
   'medium', 'access_denied', 120, 20, 'slack', 300,
   '/runbooks/access-probing'),

  ('mass_employee_delete',
   'More than 5 employee records deleted or terminated in 10 minutes',
   'critical', 'employee_delete', 600, 5, 'pagerduty', 3600,
   '/runbooks/mass-employee-delete'),

  ('payroll_override_burst',
   'More than 3 force_finalize overrides by the same user in 1 hour',
   'high', 'payroll_override', 3600, 3, 'pagerduty', 1800,
   '/runbooks/payroll-override-burst'),

  ('credential_rotation_failed',
   'Credential rotation verification failed after rotation attempt',
   'high', 'credential_rotation', 300, 1, 'pagerduty', 3600,
   '/runbooks/credential-rotation-failed'),

  ('erasure_request_bulk',
   'More than 10 right-to-erasure requests submitted within 1 hour — possible coordinated action',
   'medium', 'erasure_request', 3600, 10, 'slack', 3600,
   '/runbooks/erasure-request-bulk');

-- ── Security alerts ───────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS security_alerts (
  id               uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  rule_name        text        NOT NULL REFERENCES security_detection_rules(rule_name) ON UPDATE CASCADE,
  severity         security_severity NOT NULL,
  tenant_id        uuid,
  actor_id         uuid,                   -- which user/actor triggered the alert

  -- Trigger context
  triggered_at     timestamptz NOT NULL DEFAULT now(),
  event_ids        bigint[]    NOT NULL DEFAULT '{}',  -- security_events that triggered this
  trigger_count    int         NOT NULL DEFAULT 0,     -- how many matching events in window
  trigger_window_s int         NOT NULL DEFAULT 0,

  -- Lifecycle
  status           text        NOT NULL DEFAULT 'open'
                               CHECK (status IN (
                                 'open', 'acknowledged', 'investigating',
                                 'resolved', 'false_positive'
                               )),
  acknowledged_by  uuid        REFERENCES auth.users(id),
  acknowledged_at  timestamptz,
  investigated_by  uuid        REFERENCES auth.users(id),
  resolved_by      uuid        REFERENCES auth.users(id),
  resolved_at      timestamptz,
  resolution_note  text,

  -- Escalation
  incident_id      uuid        REFERENCES operational_incidents(id),
  escalated_at     timestamptz,
  escalated_by     uuid        REFERENCES auth.users(id),

  -- SLA tracking
  -- Critical: acknowledge within 15 min, resolve within 4h
  mtta_seconds     int GENERATED ALWAYS AS (
    EXTRACT(EPOCH FROM (acknowledged_at - triggered_at))::int
  ) STORED,
  mttr_seconds     int GENERATED ALWAYS AS (
    EXTRACT(EPOCH FROM (resolved_at - triggered_at))::int
  ) STORED,

  metadata         jsonb       NOT NULL DEFAULT '{}',
  created_at       timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_security_alerts_open      ON security_alerts (status, triggered_at DESC)
  WHERE status = 'open';
CREATE INDEX IF NOT EXISTS idx_security_alerts_critical  ON security_alerts (severity, triggered_at DESC)
  WHERE severity = 'critical';
CREATE INDEX IF NOT EXISTS idx_security_alerts_tenant    ON security_alerts (tenant_id, triggered_at DESC);
CREATE INDEX IF NOT EXISTS idx_security_alerts_rule      ON security_alerts (rule_name, triggered_at DESC);
CREATE INDEX IF NOT EXISTS idx_security_alerts_actor     ON security_alerts (actor_id, triggered_at DESC);

COMMENT ON TABLE security_alerts IS
  'Security alerts raised by the detection engine. '
  'SLA: critical acknowledged < 15 min (mtta_seconds), resolved < 4h (mttr_seconds). '
  'Unacknowledged critical alerts trigger PagerDuty escalation after 15 min.';

-- ── Security operations summary view ─────────────────────────────────────────

CREATE VIEW security_ops_health AS
SELECT
  -- Open alerts by severity
  COUNT(*) FILTER (WHERE status = 'open' AND severity = 'critical') AS open_critical,
  COUNT(*) FILTER (WHERE status = 'open' AND severity = 'high')     AS open_high,
  COUNT(*) FILTER (WHERE status = 'open' AND severity = 'medium')   AS open_medium,
  COUNT(*) FILTER (WHERE status = 'open')                           AS open_total,
  -- SLA metrics (last 30 days)
  ROUND(AVG(mtta_seconds) FILTER (
    WHERE severity = 'critical'
    AND   acknowledged_at IS NOT NULL
    AND   triggered_at > now() - INTERVAL '30 days'
  ) / 60.0, 1)                                                      AS avg_mtta_critical_min,
  ROUND(AVG(mttr_seconds) FILTER (
    WHERE severity = 'critical'
    AND   resolved_at IS NOT NULL
    AND   triggered_at > now() - INTERVAL '30 days'
  ) / 3600.0, 2)                                                    AS avg_mttr_critical_hours,
  -- Events in last 24h
  (SELECT COUNT(*) FROM security_events
   WHERE occurred_at > now() - INTERVAL '24 hours')                 AS events_24h,
  -- Unacknowledged critical alerts older than 15 min
  COUNT(*) FILTER (
    WHERE status = 'open'
    AND   severity = 'critical'
    AND   triggered_at < now() - INTERVAL '15 minutes'
  )                                                                  AS unacked_critical_overdue
FROM security_alerts
WHERE triggered_at > now() - INTERVAL '30 days';

COMMENT ON VIEW security_ops_health IS
  'Security operations KPI rollup. Dashboard reads this view every 60 seconds. '
  'Alert when unacked_critical_overdue > 0 or open_critical > 0.';
