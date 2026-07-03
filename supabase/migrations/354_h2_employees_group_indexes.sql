-- =============================================================================
-- Migration 354: H2 — rebuild employees group indexes with tenant_id prefix
--
-- Phase C readiness: GATE-1 item H2
--
-- Problem: idx_employees_payroll_group, idx_employees_employment_category,
-- idx_employees_statutory_group (113b_enterprise_masters.sql:133–135) are
-- partial indexes on the bare FK column with no tenant_id prefix. The Postgres
-- planner may skip them for per-tenant payroll-group enumeration (choosing
-- the (tenant_id, status) index then post-filtering), producing artificially
-- slow payroll-group fan-out in Phase C WP2-2.1 / 2.2 runs.
--
-- Fix: drop the single-column indexes and recreate them as (tenant_id, col)
-- partial indexes. Tenant-prefixed lookups can now use an index-only scan.
--
-- Must be applied before Phase C data seeding begins.
-- NOTE: CONCURRENTLY omitted — migrations run inside transaction blocks.
-- =============================================================================

DROP INDEX IF EXISTS idx_employees_payroll_group;
DROP INDEX IF EXISTS idx_employees_employment_category;
DROP INDEX IF EXISTS idx_employees_statutory_group;

CREATE INDEX IF NOT EXISTS idx_employees_payroll_group
  ON employees (tenant_id, payroll_group_id)
  WHERE payroll_group_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_employees_employment_category
  ON employees (tenant_id, employment_category_id)
  WHERE employment_category_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_employees_statutory_group
  ON employees (tenant_id, statutory_group_id)
  WHERE statutory_group_id IS NOT NULL;
