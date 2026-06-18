-- ============================================================
-- Migration 276: Fix Regime Lock Columns (corrects 174 typo)
-- ============================================================
-- Migration 174 (174_regime_locking.sql) attempted to add the regime-lock
-- columns to a table named `tds_regime_elections`, guarded with
-- `ALTER TABLE IF EXISTS ...`. That table name does not exist — the real
-- regime-election table (created in 098_tds_foundation.sql) is
-- `tax_regime_elections`. Because of the `IF EXISTS` guard, 174 silently
-- no-op'd and the lock columns were never created.
--
-- This migration re-applies 174's intended ALTERs against the correct table
-- `tax_regime_elections`, using the SAME column names and types as 174:
--   locked_at   TIMESTAMPTZ
--   locked_by   TEXT
--   lock_reason TEXT
-- ------------------------------------------------------------

ALTER TABLE tax_regime_elections
  ADD COLUMN IF NOT EXISTS locked_at   TIMESTAMPTZ;

ALTER TABLE tax_regime_elections
  ADD COLUMN IF NOT EXISTS locked_by   TEXT;

ALTER TABLE tax_regime_elections
  ADD COLUMN IF NOT EXISTS lock_reason TEXT;
