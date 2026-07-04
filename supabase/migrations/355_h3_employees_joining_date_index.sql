-- =============================================================================
-- Migration 355: H3 — rebuild employees joining_date index with tenant_id prefix
--
-- Phase C readiness: GATE-1 item H3
--
-- Problem: idx_employees_joining in 004_employees.sql:49 is a bare
-- (joining_date) index with no tenant_id prefix. ESS home anniversary scans
-- (WP2-2.13) and intelligence scanner onboarding-blocker pass (WP2-2.17)
-- filter by joining_date within a tenant. Without the composite index, the
-- planner scans all joining dates across all tenants then filters — producing
-- artificially slow Phase C timing results from a known missing index.
--
-- Fix: drop the single-column index, recreate as (tenant_id, joining_date).
--
-- Must be applied before Phase C data seeding begins.
-- NOTE: CONCURRENTLY omitted — migrations run inside transaction blocks.
-- =============================================================================

DROP INDEX IF EXISTS idx_employees_joining;

CREATE INDEX IF NOT EXISTS idx_employees_tenant_joining
  ON employees (tenant_id, joining_date);
