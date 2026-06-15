-- ============================================================
-- 270_leave_ledger_drift_log.sql
--
-- C6 Phase 1 (shadow-read validation): persist every detected divergence
-- between the cached employee_leave_balance and the authoritative
-- leave_accrual_ledger sum, so drift can be MONITORED over a multi-week
-- window with a query rather than scraped from logs.
--
-- Written by:
--   • the balance-read shadow comparison (source='balance_read') — passive,
--     fires on real ESS/admin balance reads while LEAVE_LEDGER_AUTHORITATIVE
--     is still OFF; and
--   • the reconciliation sweep (source='reconciliation_sweep') — the
--     /ledger-reconciliation endpoint run with ?record=true (e.g. nightly cron).
--
-- This table is INSTRUMENTATION ONLY. It never feeds a read path and is safe
-- to truncate. Service-role writes only (RLS on, no policies → denied to anon).
-- ============================================================

CREATE TABLE IF NOT EXISTS leave_ledger_drift_log (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id      UUID NOT NULL,
  employee_id    UUID NOT NULL,
  leave_type_id  UUID NOT NULL,
  year           INT  NOT NULL,
  cache_balance  NUMERIC,            -- NULL when ledger has a key the cache lacks
  ledger_balance NUMERIC NOT NULL,
  delta          NUMERIC NOT NULL,   -- ledger_balance − COALESCE(cache_balance,0)
  source         TEXT NOT NULL DEFAULT 'balance_read'
                 CHECK (source IN ('balance_read', 'reconciliation_sweep')),
  detected_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Query the monitoring window per tenant, newest first.
CREATE INDEX IF NOT EXISTS idx_leave_drift_tenant_time
  ON leave_ledger_drift_log (tenant_id, detected_at DESC);

-- Find every employee/type that has ever drifted (distinct offenders).
CREATE INDEX IF NOT EXISTS idx_leave_drift_key
  ON leave_ledger_drift_log (tenant_id, employee_id, leave_type_id, year);

-- Lock down: service-role only (matches the rest of the internal tables).
ALTER TABLE leave_ledger_drift_log ENABLE ROW LEVEL SECURITY;
