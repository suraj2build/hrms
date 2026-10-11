-- F&F settlement: auto-pull asset/loan/advance recovery deductions.
--
-- separation_ff_summary previously had no columns for outstanding assets,
-- loan balances, or advance-salary recovery schedules — those amounts had to
-- be folded manually into other_deductions by HR, with no record of why.
-- Add three distinct, auditable columns and extend net_payable to subtract
-- them. net_payable is a GENERATED STORED column, so its expression can't be
-- altered in place — it must be dropped and re-added.

ALTER TABLE separation_ff_summary
  ADD COLUMN IF NOT EXISTS asset_recovery_amount   NUMERIC(14,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS loan_recovery_amount     NUMERIC(14,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS advance_recovery_amount  NUMERIC(14,2) NOT NULL DEFAULT 0;

ALTER TABLE separation_ff_summary DROP COLUMN IF EXISTS net_payable;

ALTER TABLE separation_ff_summary ADD COLUMN net_payable NUMERIC(14,2) GENERATED ALWAYS AS (
  last_payroll_amount + leave_encashment_amount + gratuity_amount + other_additions
  - notice_period_deduction - other_deductions
  - asset_recovery_amount - loan_recovery_amount - advance_recovery_amount
) STORED;
