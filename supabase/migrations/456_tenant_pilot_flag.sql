-- ============================================================
-- Migration 456: tenants.is_pilot — gates real-money/statutory
-- actions off for an invite-only friends pilot.
-- ============================================================
--
-- A pilot tenant uses synthetic data and real API writes (unlike the
-- existing frontend-only VITE_DEMO_MODE, which never reaches the backend
-- at all) so attendance/leave/payroll-PREVIEW workflows behave like the
-- real thing — but payroll finalize, statutory filing-pack generation/
-- export, and payout-obligation generation are blocked server-side.
--
-- Follows the existing precedent (migration 321's tenants.ai_mode) of a
-- single tenant-scoped flag read by the API, rather than a new
-- feature-flag subsystem.

ALTER TABLE tenants
  ADD COLUMN IF NOT EXISTS is_pilot BOOLEAN NOT NULL DEFAULT false;

COMMENT ON COLUMN tenants.is_pilot IS
  'True for an invite-only pilot tenant using synthetic data. The API '
  'blocks real-money/statutory actions for these tenants (payroll '
  'finalize/rollback, filing-pack generation and exports, payout-'
  'obligation generation) with 403 PILOT_TENANT_RESTRICTED — attendance, '
  'leave and payroll PREVIEW (dry_run) remain available. Set only by '
  'platform-admin tooling (owner/index.ts), mirroring how tenants.status '
  'is owned.';
