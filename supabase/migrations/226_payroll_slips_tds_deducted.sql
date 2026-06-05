-- 226_payroll_slips_tds_deducted.sql
-- The IT Statement / TDS Recovery / YTD ESS pages read payroll_slips.tds_deducted
-- (the income-tax actually deducted per slip), but that column was never added to
-- payroll_slips — it only existed on previous_employment_tax_details (migration
-- 172). So those reads returned nothing/erred, and the payroll run had no column
-- to record TDS into.
--
-- Add the column. The run now writes it (from the TDS line in the slip breakdown),
-- and the tax statements read it. Idempotent + defaulted, so existing slips are
-- unaffected (TDS shows 0 for cycles run before TDS was enabled).

ALTER TABLE payroll_slips
  ADD COLUMN IF NOT EXISTS tds_deducted DECIMAL(14,2) NOT NULL DEFAULT 0;

NOTIFY pgrst, 'reload schema';
