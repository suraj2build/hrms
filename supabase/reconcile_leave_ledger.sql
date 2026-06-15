-- ═══════════════════════════════════════════════════════════════════════════
--  reconcile_leave_ledger.sql   (C6 Phase 1 — read-only reconciliation)
--
--  Proves whether the cached employee_leave_balance agrees with the
--  authoritative leave_accrual_ledger sum, ACROSS ALL TENANTS, in one shot.
--
--  100% READ-ONLY. No INSERT / UPDATE / DELETE. Safe on production.
--  Run in the Supabase SQL editor (or psql) against the live DB.
--
--  Prerequisites: migrations 262–270 applied (in particular 264 source_request_id,
--  268 opening_balance reconciliation, 269 accrual-type superset).
--
--  Tolerance: 0.01 day (rounding noise below this is ignored).
-- ═══════════════════════════════════════════════════════════════════════════

-- Shared CTEs: ledger sum (non-expired) vs cache, full-outer-joined per key.
WITH ledger AS (
  SELECT tenant_id, employee_id, leave_type_id, year, SUM(days) AS ledger_balance
  FROM   leave_accrual_ledger
  WHERE  is_expired = false
  GROUP  BY tenant_id, employee_id, leave_type_id, year
),
cache AS (
  SELECT tenant_id, employee_id, leave_type_id, year, balance AS cache_balance
  FROM   employee_leave_balance
),
joined AS (
  SELECT
    COALESCE(c.tenant_id,     l.tenant_id)     AS tenant_id,
    COALESCE(c.employee_id,   l.employee_id)   AS employee_id,
    COALESCE(c.leave_type_id, l.leave_type_id) AS leave_type_id,
    COALESCE(c.year,          l.year)          AS year,
    c.cache_balance,
    COALESCE(l.ledger_balance, 0)              AS ledger_balance,
    ROUND(COALESCE(l.ledger_balance, 0) - COALESCE(c.cache_balance, 0), 2) AS delta
  FROM cache c
  FULL OUTER JOIN ledger l
    ON  c.tenant_id     = l.tenant_id
    AND c.employee_id   = l.employee_id
    AND c.leave_type_id = l.leave_type_id
    AND c.year          = l.year
)

-- ── REPORT A — tenant-by-tenant summary (the headline scorecard) ─────────────
SELECT
  j.tenant_id,
  t.name                                                   AS tenant_name,
  COUNT(*)                                                  AS keys_checked,
  COUNT(*) FILTER (WHERE ABS(j.delta) > 0.01)              AS discrepancies,
  COUNT(*) FILTER (WHERE j.cache_balance IS NULL)          AS ledger_only_keys,
  COUNT(*) FILTER (WHERE j.ledger_balance = 0 AND j.cache_balance IS NOT NULL) AS cache_only_keys,
  ROUND(SUM(ABS(j.delta)), 2)                              AS total_abs_drift,
  ROUND(MAX(ABS(j.delta)), 2)                              AS worst_abs_drift,
  CASE WHEN COUNT(*) FILTER (WHERE ABS(j.delta) > 0.01) = 0
       THEN 'IN_SYNC' ELSE 'DRIFT' END                     AS status
FROM joined j
LEFT JOIN tenants t ON t.id = j.tenant_id
GROUP BY j.tenant_id, t.name
ORDER BY discrepancies DESC, total_abs_drift DESC;

-- ── REPORT B — detailed discrepancy rows (uncomment to drill in) ─────────────
-- SELECT
--   j.tenant_id, j.employee_id, j.leave_type_id, j.year,
--   j.cache_balance, j.ledger_balance, j.delta,
--   CASE
--     WHEN j.cache_balance IS NULL                    THEN 'ledger_only (no cache row)'
--     WHEN ABS(j.delta) > 0.01 AND j.delta > 0        THEN 'ledger_high (cache under-counts)'
--     WHEN ABS(j.delta) > 0.01 AND j.delta < 0        THEN 'ledger_low (cache over-counts)'
--     ELSE 'in_sync'
--   END AS classification
-- FROM joined j
-- WHERE ABS(j.delta) > 0.01
-- ORDER BY j.tenant_id, ABS(j.delta) DESC;

-- ── REPORT C — opening_balance sanity (negatives = pre-existing ledger over-count) ──
-- A negative opening_balance row means cache < Σ(prior ledger) at migration time,
-- i.e. the ledger already over-counted before C6. These must be investigated.
-- SELECT tenant_id, employee_id, leave_type_id, year, days AS opening_balance
-- FROM   leave_accrual_ledger
-- WHERE  accrual_type = 'opening_balance' AND days < 0
-- ORDER  BY days ASC;
