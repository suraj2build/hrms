-- =============================================================================
-- Migration 353: H1 — attendance_daily status+date composite index
--
-- Phase C readiness: GATE-1 item H1
--
-- Problem: attendance_daily has (tenant_id, date DESC) and
-- (tenant_id, employee_id, date DESC) but no index covering status
-- filtering. Dashboard queries ("show all absent employees on date X
-- for tenant Y") scan the full tenant+date slice then post-filter by
-- status — at 1.825M rows this produces artificially slow Phase C
-- timing results that reflect a known missing index, not true capacity.
--
-- Fix: add (tenant_id, status, date DESC) to support:
--   SELECT * FROM attendance_daily
--   WHERE tenant_id = $1 AND status = $2 AND date BETWEEN $3 AND $4
--
-- Must be applied before Phase C data seeding begins.
-- NOTE: CONCURRENTLY omitted — migrations run inside transaction blocks.
-- =============================================================================

CREATE INDEX IF NOT EXISTS idx_ad_tenant_status_date
  ON attendance_daily (tenant_id, status, date DESC);
