-- ============================================================
-- 419_epf_esi_registration_enforcement.sql
--
-- PEND-23: EPF/ESI were marked applicable by default regardless of whether
-- the tenant/site has an actual statutory_registrations row on file — an
-- employer that hasn't completed registration setup still had EPF/ESI
-- silently computed and deducted with no registration to remit against or
-- file returns under.
--
-- A hard gate (isApplicable = false when no registration on file) is the
-- statutorily-correct behavior, but flipping it unconditionally for every
-- existing tenant would silently zero EPF/ESI deductions on the next payroll
-- run for any tenant that hasn't gone through registration setup — most/all
-- current tenants, with no backfill/migration path.
--
-- Add an explicit per-scheme opt-in flag instead, defaulting to false (today's
-- behavior: always applicable) so nothing changes until a tenant deliberately
-- turns enforcement on for a scheme once its registration is on file.
-- ============================================================

ALTER TABLE epf_config
  ADD COLUMN IF NOT EXISTS enforce_registration BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE esi_config
  ADD COLUMN IF NOT EXISTS enforce_registration BOOLEAN NOT NULL DEFAULT false;

COMMENT ON COLUMN epf_config.enforce_registration IS
  'When true, EPF is only applicable to employees whose tenant/site has an active statutory_registrations row (statutory_type=epf). When false (default), EPF applies regardless of registration status — matches pre-419 behavior.';

COMMENT ON COLUMN esi_config.enforce_registration IS
  'When true, ESI is only applicable to employees whose tenant/site has an active statutory_registrations row (statutory_type=esi). When false (default), ESI applies regardless of registration status — matches pre-419 behavior.';
