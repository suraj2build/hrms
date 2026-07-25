-- ISSUE-156: carryForwardJob (apps/api/src/lib/leave-jobs.ts) caps the amount
-- carried forward at policy.carry_forward_max_days, but the gap between the
-- employee's actual fromYear balance and the capped amount was never written
-- anywhere — not the ledger, not any other table. An employee with 15 days
-- and a 5-day cap silently lost 10 days with zero audit trail: an auditor
-- summing leave_accrual_ledger for that employee/year would have no record
-- explaining the gap, and HR/employees disputing "where did my leave go"
-- would find nothing.
--
-- Adds 'forfeiture' to the same true-union CHECK constraint fixed in
-- migration 387 (ISSUE-128) — additive only, does not touch any existing
-- allowed value.

ALTER TABLE leave_accrual_ledger DROP CONSTRAINT IF EXISTS leave_accrual_ledger_accrual_type_check;

ALTER TABLE leave_accrual_ledger ADD CONSTRAINT leave_accrual_ledger_accrual_type_check
  CHECK (accrual_type IN (
    -- base (migration 159)
    'monthly',
    'yearly',
    'upfront',
    'carry_forward',
    'co_grant',
    'manual',
    'adjustment',
    'quarterly',
    'advance_accrual',
    'earned_accrual',
    'prorated_accrual',
    'recovery',
    'settlement_recovery',
    'tier_adjustment',
    'release',
    -- weekly-off carry-over (migration 254)
    'wo_credit',
    -- ledger-as-authority additions (migration 268)
    'consumption',
    'opening_balance',
    -- cutover-prep additions (migration 269)
    'reversal',
    'encashment',
    -- carry-forward cap forfeiture (migration 392 / ISSUE-156)
    'forfeiture'
  ));
