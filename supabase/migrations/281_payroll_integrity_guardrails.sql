-- =============================================================================
-- 281_payroll_integrity_guardrails.sql
-- P0 data-integrity guardrails for payroll money tables.
--
-- Closes the duplicate-/over-deduction and double-posting gaps found in the
-- payroll integrity audit. Design principles for a live database:
--   * FK and CHECK constraints are added NOT VALID — they are enforced on every
--     new/updated row immediately, but the migration does NOT fail if legacy
--     rows already violate them. Run `VALIDATE CONSTRAINT` later, after cleanup.
--   * UNIQUE indexes cannot be NOT VALID, so they are created inside a guarded
--     block: if pre-existing duplicates would block creation, the migration
--     emits a NOTICE and continues rather than hard-failing. Clean up the
--     duplicates and re-run to get the index.
--   * No destructive DELETEs of money rows are performed automatically.
-- =============================================================================

-- Helper: add a constraint only if it doesn't already exist (idempotent).
-- (Inline DO blocks below; no shared function to keep this migration self-contained.)

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. advance_recoveries — prevent the SAME scheduled installment being recovered
--    twice (double-deduction from an employee), and tie recoveries to a real run.
-- ─────────────────────────────────────────────────────────────────────────────
DO $$ BEGIN
  -- One recovery per scheduled installment. Manual/prepayment recoveries have a
  -- NULL schedule_id and are intentionally left unconstrained (legitimately may
  -- be multiple per month).
  CREATE UNIQUE INDEX uidx_advance_recoveries_schedule
    ON advance_recoveries (tenant_id, schedule_id)
    WHERE schedule_id IS NOT NULL;
EXCEPTION
  WHEN duplicate_table THEN NULL;                 -- already created
  WHEN unique_violation THEN
    RAISE NOTICE 'advance_recoveries has duplicate schedule recoveries — unique index NOT created. Clean up duplicates (keep latest per schedule_id) and re-run.';
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'advance_recoveries_run_fkey') THEN
    ALTER TABLE advance_recoveries
      ADD CONSTRAINT advance_recoveries_run_fkey
      FOREIGN KEY (payroll_run_id) REFERENCES payroll_runs (id) ON DELETE SET NULL NOT VALID;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'advance_recoveries_amount_nonneg') THEN
    ALTER TABLE advance_recoveries
      ADD CONSTRAINT advance_recoveries_amount_nonneg CHECK (amount >= 0) NOT VALID;
  END IF;
END $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. advance_recovery_schedules — tie the run reference to a real run (orphan
--    guard). The (tenant_id, advance_id, recovery_month) UNIQUE already exists.
-- ─────────────────────────────────────────────────────────────────────────────
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'advance_recovery_schedules_run_fkey') THEN
    ALTER TABLE advance_recovery_schedules
      ADD CONSTRAINT advance_recovery_schedules_run_fkey
      FOREIGN KEY (payroll_run_id) REFERENCES payroll_runs (id) ON DELETE SET NULL NOT VALID;
  END IF;
END $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. payroll_financial_ledgers — prevent two accounting batches for the same
--    run (double GL posting) and tie the batch to a real run.
-- ─────────────────────────────────────────────────────────────────────────────
DO $$ BEGIN
  CREATE UNIQUE INDEX uidx_payroll_financial_ledgers_run_type
    ON payroll_financial_ledgers (tenant_id, run_id, ledger_type)
    WHERE ledger_status <> 'reversed';
EXCEPTION
  WHEN duplicate_table THEN NULL;
  WHEN unique_violation THEN
    RAISE NOTICE 'payroll_financial_ledgers has duplicate (run_id, ledger_type) batches — unique index NOT created. Reverse/clean the duplicates and re-run.';
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'payroll_financial_ledgers_run_fkey') THEN
    ALTER TABLE payroll_financial_ledgers
      ADD CONSTRAINT payroll_financial_ledgers_run_fkey
      FOREIGN KEY (run_id) REFERENCES payroll_runs (id) ON DELETE RESTRICT NOT VALID;
  END IF;
END $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. payroll_ledger_entries — a journal line must be EXACTLY one side
--    (debit xor credit), never both, never neither.
-- ─────────────────────────────────────────────────────────────────────────────
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'payroll_ledger_entries_one_side') THEN
    ALTER TABLE payroll_ledger_entries
      ADD CONSTRAINT payroll_ledger_entries_one_side
      CHECK ((debit_amount = 0) <> (credit_amount = 0)) NOT VALID;
  END IF;
END $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 5. payroll_payout_reconciliation — one payout row per (run, employee); tie to
--    a real run (prevents double-counting paid_amount against one obligation).
-- ─────────────────────────────────────────────────────────────────────────────
DO $$ BEGIN
  CREATE UNIQUE INDEX uidx_payroll_payout_recon_run_emp
    ON payroll_payout_reconciliation (tenant_id, run_id, employee_id)
    WHERE employee_id IS NOT NULL;
EXCEPTION
  WHEN duplicate_table THEN NULL;
  WHEN unique_violation THEN
    RAISE NOTICE 'payroll_payout_reconciliation has duplicate (run_id, employee_id) rows — unique index NOT created. Clean up and re-run.';
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'payroll_payout_recon_run_fkey') THEN
    ALTER TABLE payroll_payout_reconciliation
      ADD CONSTRAINT payroll_payout_recon_run_fkey
      FOREIGN KEY (run_id) REFERENCES payroll_runs (id) ON DELETE RESTRICT NOT VALID;
  END IF;
END $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 6. Non-negative money guards — a sign error must never silently write a
--    negative payslip / run total / dept cost. (net_pay is intentionally
--    excluded — it can be legitimately negative after recoveries.)
-- ─────────────────────────────────────────────────────────────────────────────
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'payroll_slips_money_nonneg') THEN
    ALTER TABLE payroll_slips
      ADD CONSTRAINT payroll_slips_money_nonneg
      CHECK (gross_pay >= 0 AND lop_amount >= 0 AND total_deductions >= 0 AND employer_contributions >= 0) NOT VALID;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'payroll_runs_totals_nonneg') THEN
    ALTER TABLE payroll_runs
      ADD CONSTRAINT payroll_runs_totals_nonneg
      CHECK (total_gross >= 0 AND total_deductions >= 0 AND total_net >= 0 AND total_lop_amount >= 0) NOT VALID;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'payroll_dept_snapshots_money_nonneg') THEN
    ALTER TABLE payroll_dept_snapshots
      ADD CONSTRAINT payroll_dept_snapshots_money_nonneg
      CHECK (headcount >= 0 AND total_gross >= 0 AND total_net >= 0 AND total_ot_cost >= 0) NOT VALID;
  END IF;
END $$;

-- =============================================================================
-- Follow-up (run manually after verifying no legacy violations):
--   ALTER TABLE advance_recoveries            VALIDATE CONSTRAINT advance_recoveries_run_fkey;
--   ALTER TABLE advance_recoveries            VALIDATE CONSTRAINT advance_recoveries_amount_nonneg;
--   ALTER TABLE advance_recovery_schedules    VALIDATE CONSTRAINT advance_recovery_schedules_run_fkey;
--   ALTER TABLE payroll_financial_ledgers     VALIDATE CONSTRAINT payroll_financial_ledgers_run_fkey;
--   ALTER TABLE payroll_ledger_entries        VALIDATE CONSTRAINT payroll_ledger_entries_one_side;
--   ALTER TABLE payroll_payout_reconciliation VALIDATE CONSTRAINT payroll_payout_recon_run_fkey;
--   ALTER TABLE payroll_slips                 VALIDATE CONSTRAINT payroll_slips_money_nonneg;
--   ALTER TABLE payroll_runs                  VALIDATE CONSTRAINT payroll_runs_totals_nonneg;
--   ALTER TABLE payroll_dept_snapshots        VALIDATE CONSTRAINT payroll_dept_snapshots_money_nonneg;
-- =============================================================================
