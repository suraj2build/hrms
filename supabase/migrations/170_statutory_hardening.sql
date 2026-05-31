-- =============================================================================
-- 170_statutory_hardening.sql
-- Targeted Statutory Compliance Hardening — EPF + ESI
--
-- Changes:
--   1. epf_eligibility_overrides: add restrict_pf_to_ceiling
--      Allows individual employees to be ceiling-capped even when the
--      tenant-level is_wage_ceiling_applicable = false.
--      NULL = follow tenant policy  |  true = always cap  |  false = never cap
--
--   2. esi_eligibility_timeline: add continuation_until
--      ESI contribution period continuation.  When set, ESI contributions are
--      forced through the end of the contribution period even if gross wages
--      exceed the ₹21,000 ceiling mid-period.
--      Example: employee enrolled Apr–Sep.  Jul salary = ₹24,000.
--      Set continuation_until = '2024-09-30' → ESI applies through Sep.
--
--   3. payroll_employee_snapshots: add total_working_days
--      Captures the total working days used in the original payroll calculation
--      so the replay engine can reproduce bit-identical results for mid-month
--      joiners and leavers without falling back to the incorrect formula
--      (payable_days + lop_days) or the hardcoded default of 26.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. EPF employee-level ceiling restriction
-- ---------------------------------------------------------------------------

ALTER TABLE epf_eligibility_overrides
    ADD COLUMN IF NOT EXISTS restrict_pf_to_ceiling BOOLEAN DEFAULT NULL;

COMMENT ON COLUMN epf_eligibility_overrides.restrict_pf_to_ceiling IS
  'Employee-level PF ceiling override.
   NULL  = follow tenant policy (is_wage_ceiling_applicable in epf_config).
   true  = always restrict PF wages to statutory ceiling (₹15,000 default)
           even when tenant policy is unrestricted.
   false = never restrict PF wages to ceiling even when tenant policy restricts.
           Typically used for international workers or CXO-level agreements.';

-- ---------------------------------------------------------------------------
-- 2. ESI contribution period continuation
-- ---------------------------------------------------------------------------

ALTER TABLE esi_eligibility_timeline
    ADD COLUMN IF NOT EXISTS continuation_until DATE DEFAULT NULL;

COMMENT ON COLUMN esi_eligibility_timeline.continuation_until IS
  'ESI contribution period continuation end date.
   When set to the last day of the current contribution period (Sep 30 or Mar 31),
   ESI contributions are enforced through that date even if the employee''s gross
   wages subsequently exceed the ₹21,000 wage ceiling.
   Statutory basis: ESIC contribution period rules — once enrolled in a period,
   the employee contributes till period end regardless of wage changes.
   Cleared or set to NULL when the continuation period expires.';

-- ---------------------------------------------------------------------------
-- 3. Payroll snapshot — total_working_days for replay safety
-- ---------------------------------------------------------------------------

ALTER TABLE payroll_employee_snapshots
    ADD COLUMN IF NOT EXISTS total_working_days INTEGER;

COMMENT ON COLUMN payroll_employee_snapshots.total_working_days IS
  'Calendar working days in the payroll month as used in the original run.
   Captured from payroll_slips.total_working_days at snapshot time.
   Used by the replay engine to reproduce bit-identical results.
   Without this, replay falls back to payable_days + lop_days which is wrong
   for mid-month joiners (their payable_days < total_working_days for the month).';
