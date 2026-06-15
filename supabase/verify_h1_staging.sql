-- ═══════════════════════════════════════════════════════════════════════════
--  verify_h1_staging.sql   (run AFTER applying migrations 252–270)
--
--  Single paste-and-run validation for Release Train H1. 100% READ-ONLY.
--  Run in the Supabase SQL editor (or psql) against the STAGING DB and return
--  the three result sets to complete the H1 validation report.
-- ═══════════════════════════════════════════════════════════════════════════

-- ── SECTION 1 — schema object assertions ────────────────────────────────────
SELECT 'checked_deduct_leave_balance fn' AS check,
       to_regprocedure('checked_deduct_leave_balance(uuid,uuid,uuid,numeric,int)') IS NOT NULL AS pass
UNION ALL
SELECT 'leave_ledger_drift_log table',
       to_regclass('leave_ledger_drift_log') IS NOT NULL
UNION ALL
SELECT 'leave_applications allows cancelled',
       (SELECT pg_get_constraintdef(oid) LIKE '%cancelled%'
        FROM pg_constraint WHERE conname = 'leave_applications_status_check')
UNION ALL
SELECT 'accrual_type allows reversal+encashment',
       (SELECT pg_get_constraintdef(oid) LIKE '%reversal%'
           AND pg_get_constraintdef(oid) LIKE '%encashment%'
        FROM pg_constraint WHERE conname = 'leave_accrual_ledger_accrual_type_check')
UNION ALL
SELECT 'uidx reversal/encashment/consumption present',
       (SELECT count(*) = 3 FROM pg_indexes WHERE indexname IN (
          'uidx_accrual_ledger_reversal_request',
          'uidx_accrual_ledger_encashment_request',
          'uidx_accrual_ledger_consumption_request'))
UNION ALL
SELECT 'opening_balance rows written (268)',
       EXISTS (SELECT 1 FROM leave_accrual_ledger WHERE accrual_type = 'opening_balance');

-- ── SECTION 2 — reconciliation scorecard (tenant-by-tenant) ─────────────────
WITH ledger AS (
  SELECT tenant_id, employee_id, leave_type_id, year, SUM(days) AS ledger_balance
  FROM leave_accrual_ledger WHERE is_expired = false
  GROUP BY 1,2,3,4),
cache AS (
  SELECT tenant_id, employee_id, leave_type_id, year, balance AS cache_balance
  FROM employee_leave_balance),
joined AS (
  SELECT COALESCE(c.tenant_id,l.tenant_id) AS tenant_id,
         ROUND(COALESCE(l.ledger_balance,0) - COALESCE(c.cache_balance,0), 2) AS delta
  FROM cache c FULL OUTER JOIN ledger l
    ON c.tenant_id=l.tenant_id AND c.employee_id=l.employee_id
   AND c.leave_type_id=l.leave_type_id AND c.year=l.year)
SELECT j.tenant_id, t.name AS tenant_name,
       COUNT(*) AS keys_checked,
       COUNT(*) FILTER (WHERE ABS(j.delta) > 0.01) AS discrepancies,
       ROUND(SUM(ABS(j.delta)),2) AS total_abs_drift,
       CASE WHEN COUNT(*) FILTER (WHERE ABS(j.delta) > 0.01)=0
            THEN 'IN_SYNC' ELSE 'DRIFT' END AS status
FROM joined j LEFT JOIN tenants t ON t.id = j.tenant_id
GROUP BY j.tenant_id, t.name
ORDER BY discrepancies DESC;

-- ── SECTION 3 — opening_balance sanity (negatives = pre-existing over-count) ─
SELECT tenant_id, employee_id, leave_type_id, year, days AS opening_balance
FROM leave_accrual_ledger
WHERE accrual_type = 'opening_balance' AND days < 0
ORDER BY days ASC;
