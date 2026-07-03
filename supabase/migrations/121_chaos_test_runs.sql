/**
 * Migration 121 — Chaos Test Audit Trail
 *
 * Stores results of chaos/resilience test runs so that:
 *   - Test evidence is preserved for certification (SOC 2 CC9.1)
 *   - Regressions are detected by comparing runs over time
 *   - CI/CD can gate deployments on minimum pass rate
 *
 * Scenarios are run against staging, never production.
 * Results are written by the chaos test runner after each scenario.
 */

-- ── Chaos test run log ────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS chaos_test_runs (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Scenario identification
  scenario_name   text        NOT NULL,
  scenario_code   text        NOT NULL,   -- e.g. 'C1', 'C2' ... 'C12'
  category        text        NOT NULL
                              CHECK (category IN (
                                'infrastructure',
                                'application',
                                'data_integrity',
                                'security'
                              )),
  description     text        NOT NULL,

  -- Execution context
  environment     text        NOT NULL DEFAULT 'staging'
                              CHECK (environment IN ('staging', 'scale-test', 'dr-drill')),
  suite_run_id    uuid,                   -- groups all scenarios run together in one suite
  triggered_by    text        NOT NULL DEFAULT 'automated',  -- 'automated', 'manual', 'ci'
  conducted_by    uuid        REFERENCES auth.users(id),

  -- Timing
  started_at      timestamptz NOT NULL DEFAULT now(),
  completed_at    timestamptz,
  duration_seconds int GENERATED ALWAYS AS (
    EXTRACT(EPOCH FROM (completed_at - started_at))::int
  ) STORED,

  -- Result
  passed          boolean,
  pass_criteria   text        NOT NULL,   -- human-readable criteria checked
  failure_details jsonb       NOT NULL DEFAULT '[]',  -- [{check, expected, actual}]

  -- Recovery metrics (key SLA data)
  rto_seconds_actual   int,   -- actual time to recover
  rto_seconds_target   int,   -- SLA target
  rto_met              boolean GENERATED ALWAYS AS (
    CASE WHEN rto_seconds_actual IS NOT NULL AND rto_seconds_target IS NOT NULL
         THEN rto_seconds_actual <= rto_seconds_target
         ELSE NULL END
  ) STORED,

  -- Evidence
  log_snippet     text,                   -- relevant log lines
  notes           text,
  metadata        jsonb       NOT NULL DEFAULT '{}',
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_chaos_runs_suite       ON chaos_test_runs (suite_run_id) WHERE suite_run_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_chaos_runs_scenario    ON chaos_test_runs (scenario_code, started_at DESC);
CREATE INDEX IF NOT EXISTS idx_chaos_runs_passed      ON chaos_test_runs (passed, started_at DESC);
CREATE INDEX IF NOT EXISTS idx_chaos_runs_category    ON chaos_test_runs (category, started_at DESC);

COMMENT ON TABLE chaos_test_runs IS
  'Audit trail for chaos/resilience test scenarios. One row per scenario execution. '
  'Provides certification evidence (SOC 2 CC9.1) and CI/CD deployment gate data.';

-- ── Suite summary view ────────────────────────────────────────────────────────
-- Aggregates all scenarios in a suite run into a pass/fail summary.

CREATE VIEW chaos_suite_summary AS
SELECT
  suite_run_id,
  MIN(started_at)                                     AS suite_started_at,
  MAX(completed_at)                                   AS suite_completed_at,
  COUNT(*)                                            AS total_scenarios,
  COUNT(*) FILTER (WHERE passed = true)               AS passed_count,
  COUNT(*) FILTER (WHERE passed = false)              AS failed_count,
  COUNT(*) FILTER (WHERE passed IS NULL)              AS incomplete_count,
  ROUND(
    100.0 * COUNT(*) FILTER (WHERE passed = true)
    / NULLIF(COUNT(*) FILTER (WHERE passed IS NOT NULL), 0),
    1
  )                                                   AS pass_rate_pct,
  BOOL_AND(passed)                                    AS all_passed,
  environment
FROM  chaos_test_runs
WHERE suite_run_id IS NOT NULL
GROUP BY suite_run_id, environment;

COMMENT ON VIEW chaos_suite_summary IS
  'Per-suite pass/fail summary. CI/CD reads all_passed to gate deployments.';

-- ── Seed: known scenario definitions ─────────────────────────────────────────
-- Reference table so the runner can look up human-readable metadata.

CREATE TABLE IF NOT EXISTS chaos_scenarios (
  code            text        PRIMARY KEY,   -- 'C1' .. 'C12'
  name            text        NOT NULL,
  category        text        NOT NULL CHECK (category IN ('infrastructure','application','data_integrity','security')),
  fault_method    text        NOT NULL,
  pass_criteria   text        NOT NULL,
  rto_target_seconds int      NOT NULL,
  enabled         boolean     NOT NULL DEFAULT true
);

INSERT INTO chaos_scenarios (code, name, category, fault_method, pass_criteria, rto_target_seconds) VALUES
  ('C1',  'DB connection pool exhaustion',      'infrastructure',   'Open 100 connections, attempt payroll run',                   'QUEUE_UNAVAILABLE returned; no data corruption; connections release within 30s',            30),
  ('C2',  'DB write timeout mid-payroll',        'infrastructure',   'Inject 10s write delay via pg_sleep',                        'Payroll run marked failed atomically; retry completes correctly',                           300),
  ('C3',  'Supabase platform 503 (30s)',         'infrastructure',   'Block all DB traffic for 30 seconds',                        'API returns 503 with Retry-After; queue workers pause and resume on reconnect',             60),
  ('C4',  'Queue worker process kill',           'application',      'kill -9 worker PID mid-job execution',                       'Stale job reset within 5 min; re-executed; result correct',                               300),
  ('C5',  'Scheduler missed 3 ticks',            'application',      'Pause scheduler for 3 hours',                                'Scheduler resumes; is_stale flag raised; missed accruals queued',                         3600),
  ('C6',  'Handler unhandled exception',         'application',      'Handler throws uncaught Error',                              'Job moves to dead-letter; error logged; queue continues other jobs',                         30),
  ('C7',  'Duplicate payroll run enqueue',       'data_integrity',   'Enqueue same run ID twice concurrently',                     'Idempotency key deduplication: exactly one job processed',                                  30),
  ('C8',  'Partial DB write (kill mid-tx)',      'data_integrity',   'Kill connection after payroll_run INSERT before employees',  'Reconciliation detects incomplete run; run status=failed; no orphan rows',                  600),
  ('C9',  'Corrupt job payload',                'data_integrity',   'Insert job with malformed JSON payload',                     'Handler receives empty payload; job marked dead with permanent category',                     30),
  ('C10', 'Cross-tenant employee ID probe',      'security',         'Craft request with employee from different tenant',          'RLS returns 0 rows; no 404 information leak; pii_access_log records attempt',                10),
  ('C11', 'Expired JWT token',                  'security',         'Use token with exp=past',                                    '401 returned before any DB operation; no data accessed',                                     5),
  ('C12', 'Rapid privilege escalation probe',   'security',         '50 role-change requests per second',                         'Rate limiter triggers; security_events logged; security alert fires',                        30);
