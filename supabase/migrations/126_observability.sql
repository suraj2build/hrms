/**
 * Migration 126 — Centralized Observability Stack
 *
 * Implements lightweight distributed tracing and business event metrics
 * so that every HTTP request → queue job → scheduler tick chain is traceable
 * across process boundaries without an external APM dependency.
 *
 * Tables:
 *   trace_spans            — W3C Trace Context spans (partitioned by month).
 *                            Spans created at every process boundary.
 *                            HTTP spans → queue job spans → completion spans.
 *
 *   business_event_metrics — hourly pre-aggregated metrics per event type.
 *                            Written by the metrics aggregation scheduler job.
 *                            Queryable without scanning raw trace data.
 *
 * Both tables are partitioned by month. Partitions are created one month ahead
 * by the 'partition_maintenance' scheduler job.
 *
 * Retention: trace_spans 30 days hot, business_event_metrics 1 year.
 * External export: OTLP exporter reads trace_spans and ships to Grafana/Datadog.
 */

-- ── Distributed trace spans (partitioned) ────────────────────────────────────

CREATE TABLE IF NOT EXISTS trace_spans (
  id              uuid        NOT NULL DEFAULT gen_random_uuid(),
  trace_id        uuid        NOT NULL,   -- W3C traceparent trace-id component
  span_id         uuid        NOT NULL DEFAULT gen_random_uuid(),
  parent_span_id  uuid,                   -- NULL for root spans (HTTP entry point)

  -- Service context
  service         text        NOT NULL    -- 'api', 'scheduler', 'queue-worker', 'reconciliation'
                              CHECK (service IN ('api','scheduler','queue-worker','reconciliation','notification','payroll-engine')),
  operation       text        NOT NULL,   -- 'payroll.finalize', 'attendance.reconcile', 'leave.accrue' …
  tenant_id       uuid,

  -- Status
  status          text        NOT NULL DEFAULT 'ok'
                              CHECK (status IN ('ok','error','timeout','cancelled')),

  -- Timing
  started_at      timestamptz NOT NULL DEFAULT now(),
  finished_at     timestamptz,

  -- Error context
  error_message   text,
  error_type      text,

  -- Structured attributes (service-specific key/value pairs)
  attributes      jsonb       NOT NULL DEFAULT '{}',

  PRIMARY KEY (id, started_at)
) PARTITION BY RANGE (started_at);

-- Create initial partitions
CREATE TABLE IF NOT EXISTS trace_spans_2026_05 PARTITION OF trace_spans
  FOR VALUES FROM ('2026-05-01') TO ('2026-06-01');
CREATE TABLE IF NOT EXISTS trace_spans_2026_06 PARTITION OF trace_spans
  FOR VALUES FROM ('2026-06-01') TO ('2026-07-01');
CREATE TABLE IF NOT EXISTS trace_spans_2026_07 PARTITION OF trace_spans
  FOR VALUES FROM ('2026-07-01') TO ('2026-08-01');
-- Default partition for out-of-range inserts (prevents failures during month rollover)
CREATE TABLE IF NOT EXISTS trace_spans_default PARTITION OF trace_spans DEFAULT;

-- Indexes on each partition (inherited automatically for child tables in PG15+)
CREATE INDEX IF NOT EXISTS ON trace_spans (trace_id, started_at);
CREATE INDEX IF NOT EXISTS ON trace_spans (tenant_id, operation, started_at DESC);
CREATE INDEX IF NOT EXISTS ON trace_spans (status, started_at DESC) WHERE status IN ('error', 'timeout');
CREATE INDEX IF NOT EXISTS ON trace_spans (service, operation, started_at DESC);

COMMENT ON TABLE trace_spans IS
  'Distributed trace spans for cross-process request tracing. Partitioned monthly. '
  'Carry trace_id from HTTP request → queue job payload → scheduler tick metadata. '
  'Retention: 30 days. OTLP exporter ships to Grafana/Datadog.';

-- ── Business event metrics (hourly aggregates) ────────────────────────────────
-- Pre-aggregated so dashboards do not scan raw trace_spans.
-- Written by the 'metrics_aggregation' scheduler job every hour.

CREATE TABLE IF NOT EXISTS business_event_metrics (
  -- Surrogate PK — expressions are not permitted in PRIMARY KEY constraints.
  -- Logical uniqueness enforced by two partial unique indexes below.
  id              uuid        NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,

  tenant_id       uuid,                               -- NULL for platform-wide metrics
  event_category  text        NOT NULL                -- 'payroll', 'attendance', 'leave', 'system', 'security'
                              CHECK (event_category IN ('payroll','attendance','leave','system','security','queue')),
  event_type      text        NOT NULL,               -- 'run_completed', 'reconciliation_critical', 'job_dead', …
  metric_date     date        NOT NULL,
  metric_hour     int         NOT NULL CHECK (metric_hour BETWEEN 0 AND 23),
  count           int         NOT NULL DEFAULT 0,
  error_count     int         NOT NULL DEFAULT 0,
  -- Latency percentiles (milliseconds) — NULL if no spans in this hour
  p50_ms          int,
  p95_ms          int,
  p99_ms          int,
  -- Aggregated totals (domain-specific)
  total_amount    numeric(18,2),                      -- e.g. total gross pay for payroll runs
  metadata        jsonb       NOT NULL DEFAULT '{}',
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

-- Logical uniqueness: one row per (category, type, date, hour) per tenant.
-- Split into two partial indexes because PRIMARY KEY cannot contain expressions
-- and COALESCE in a unique constraint is not permitted in PostgreSQL.
CREATE UNIQUE INDEX IF NOT EXISTS idx_bem_unique_platform
  ON business_event_metrics (event_category, event_type, metric_date, metric_hour)
  WHERE tenant_id IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_bem_unique_tenant
  ON business_event_metrics (tenant_id, event_category, event_type, metric_date, metric_hour)
  WHERE tenant_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS ON business_event_metrics (tenant_id, event_category, metric_date DESC);
CREATE INDEX IF NOT EXISTS ON business_event_metrics (event_type, metric_date DESC);
CREATE INDEX IF NOT EXISTS ON business_event_metrics (metric_date DESC, error_count DESC)
  WHERE error_count > 0;

COMMENT ON TABLE business_event_metrics IS
  'Hourly pre-aggregated business metrics. Written by metrics_aggregation scheduler job. '
  'Dashboards read this instead of scanning raw trace_spans for trend charts. '
  'Retention: 1 year (much longer than raw traces).';

-- ── Observability health view ─────────────────────────────────────────────────

CREATE VIEW observability_health AS
SELECT
  -- Trace pipeline health
  (SELECT MAX(started_at) FROM trace_spans
   WHERE service = 'api')                                            AS last_api_span_at,
  EXTRACT(EPOCH FROM (now() - (
    SELECT MAX(started_at) FROM trace_spans WHERE service = 'api'
  ))) / 60                                                           AS api_span_lag_minutes,
  -- Error rate in last 1h
  (SELECT ROUND(100.0 * COUNT(*) FILTER (WHERE status = 'error')
                / NULLIF(COUNT(*), 0), 2)
   FROM trace_spans WHERE started_at > now() - INTERVAL '1 hour')   AS error_rate_1h_pct,
  -- Metrics aggregation freshness
  (SELECT MAX(updated_at) FROM business_event_metrics)               AS last_metrics_at,
  EXTRACT(EPOCH FROM (now() - (
    SELECT MAX(updated_at) FROM business_event_metrics
  ))) / 3600                                                         AS metrics_lag_hours,
  -- Payroll p95 latency today
  (SELECT p95_ms FROM business_event_metrics
   WHERE event_type = 'payroll_run_completed'
     AND metric_date = CURRENT_DATE
   ORDER BY metric_hour DESC LIMIT 1)                               AS payroll_p95_ms_today;

COMMENT ON VIEW observability_health IS
  'Observability pipeline health. Alert if api_span_lag_minutes > 5 '
  'or metrics_lag_hours > 2 (aggregation job stalled).';

-- ── Seed: known business event types ─────────────────────────────────────────
-- Reference table so the aggregation job knows which event types to aggregate.

CREATE TABLE IF NOT EXISTS business_event_types (
  event_category  text        NOT NULL,
  event_type      text        NOT NULL,
  description     text        NOT NULL,
  sla_p95_ms      int,                    -- SLA target for p95 latency (NULL = no SLA)
  alert_on_error  boolean     NOT NULL DEFAULT false,
  PRIMARY KEY (event_category, event_type)
);

INSERT INTO business_event_types (event_category, event_type, description, sla_p95_ms, alert_on_error) VALUES
  ('payroll',     'payroll_run_completed',       'Full payroll run finalized',                   14400000, true),
  ('payroll',     'payroll_run_failed',          'Payroll run failed to complete',               NULL,     true),
  ('payroll',     'payroll_employee_calculated', 'Single employee payroll calculated',           200,      false),
  ('attendance',  'reconciliation_completed',    'Attendance reconciliation scan completed',     300000,   false),
  ('attendance',  'reconciliation_critical',     'Reconciliation found critical issues',         NULL,     true),
  ('attendance',  'freshness_scan_completed',    'Attendance freshness scan completed',          30000,    false),
  ('leave',       'accrual_run_completed',       'Leave accrual batch completed',                60000,    false),
  ('leave',       'reconciliation_completed',    'Leave reconciliation scan completed',          600000,   false),
  ('queue',       'job_completed',               'Durable queue job completed successfully',     NULL,     false),
  ('queue',       'job_dead',                    'Durable queue job moved to dead-letter',       NULL,     true),
  ('queue',       'storm_detected',              'Retry storm detected for a job type',          NULL,     true),
  ('system',      'scheduler_tick',              'Leave scheduler tick completed',               NULL,     false),
  ('system',      'module_started',              'Application module started successfully',      NULL,     false),
  ('security',    'alert_fired',                 'Security detection rule triggered',            NULL,     true);
