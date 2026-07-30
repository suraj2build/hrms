-- ============================================================
-- 408_payroll_validation_rules_bank_missing_route_fix.sql
--
-- 143_payroll_validation_rules.sql seeded BANK_MISSING's remediation_route as
-- '/admin/workforce/employees', which 404s (the real route is
-- '/admin/employees'). A later app-level fix (commit 3b2d314) corrected the
-- DEFAULT_RULES fallback in payroll-blocker-engine.ts, but
-- groupPayrollBlockers() prioritizes the DB-seeded remediation_route over
-- that fallback whenever a DB row exists — so the broken link is still served
-- in any environment where this seed migration already ran. Correct the
-- seeded row directly; `code` is UNIQUE so this targets exactly one row.
-- ============================================================

UPDATE payroll_validation_rules
SET remediation_route = '/admin/employees'
WHERE code = 'BANK_MISSING'
  AND remediation_route = '/admin/workforce/employees';
