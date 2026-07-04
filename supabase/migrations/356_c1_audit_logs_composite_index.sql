-- =============================================================================
-- Migration 356: C1 — audit_logs (tenant_id, created_at DESC) composite index
--
-- Phase C readiness: GATE-1 item C1
--
-- Problem: audit_logs has two separate single-column indexes —
-- idx_audit_tenant (tenant_id) and idx_audit_timestamp (created_at DESC)
-- (006_audit_logs.sql:14, 16). The planner cannot combine them to satisfy
-- the compliance dashboard query pattern:
--
--   SELECT * FROM audit_logs
--   WHERE tenant_id = $1 AND created_at > now() - interval '30 days'
--   ORDER BY created_at DESC
--
-- At 1.5M+ rows (year-3 steady state) this degrades to a full
-- idx_audit_tenant scan (all tenant rows) with an in-memory date filter.
-- Phase C WP4-4.8 would fail the < 5 s SLA due to a known missing index,
-- not a real capacity ceiling.
--
-- Fix: add the composite (tenant_id, created_at DESC) index so the
-- planner can satisfy both the tenant equality filter and the date range
-- scan in a single index pass.
--
-- Must be applied before Phase C data seeding begins.
-- NOTE: CONCURRENTLY omitted — migrations run inside transaction blocks.
-- =============================================================================

CREATE INDEX IF NOT EXISTS idx_audit_tenant_time
  ON audit_logs (tenant_id, created_at DESC);
