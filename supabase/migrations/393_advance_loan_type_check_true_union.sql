-- Fresh audit finding (payroll/statutory pass): two CHECK constraints don't
-- match what the route code actually validates/inserts — the same recurring
-- bug class this session has hit repeatedly with other CHECK constraints
-- (payroll_run_events_type_check, leave_accrual_ledger_accrual_type_check,
-- absconding_cases_status_check). Both endpoints are currently unreachable
-- from the web frontend (no caller found for POST /payroll/advances/recover
-- or a payment_type='adjustment' loan payment), so this hasn't yet caused a
-- live incident — but both are authenticated, hr-admin-gated, and would fail
-- every insert (or every 'adjustment'-typed insert) the moment they're used.
--
-- advance_recoveries.recovery_type: ZERO overlap between the migration-099
-- CHECK ('scheduled','prepayment','manual') and routes/payroll/advances.ts's
-- RECOVERY_TYPES ('payroll_deduction','manual_payment','adjustment') — every
-- POST /payroll/advances/recover insert fails.
--
-- loan_payments.payment_type: 3 of 4 values overlap with migration-100's
-- CHECK; the 4th differs (code: 'adjustment', constraint: 'manual') — an
-- 'adjustment'-typed payment insert fails.
--
-- True union, additive only — neither value set is dropped, matching this
-- session's established non-destructive migration pattern. Nothing in the
-- codebase reads either column's value, so there's no other consumer to
-- reconcile against.

ALTER TABLE advance_recoveries DROP CONSTRAINT IF EXISTS advance_recoveries_recovery_type_check;
ALTER TABLE advance_recoveries ADD CONSTRAINT advance_recoveries_recovery_type_check
  CHECK (recovery_type IN (
    'scheduled', 'prepayment', 'manual',              -- migration 099
    'payroll_deduction', 'manual_payment', 'adjustment' -- routes/payroll/advances.ts
  ));

ALTER TABLE loan_payments DROP CONSTRAINT IF EXISTS loan_payments_payment_type_check;
ALTER TABLE loan_payments ADD CONSTRAINT loan_payments_payment_type_check
  CHECK (payment_type IN (
    'emi', 'prepayment', 'foreclosure', 'manual',  -- migration 100
    'adjustment'                                    -- routes/payroll/loans.ts
  ));
