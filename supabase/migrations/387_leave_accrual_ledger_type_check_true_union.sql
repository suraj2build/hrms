-- ============================================================
-- 387_leave_accrual_ledger_type_check_true_union.sql
--
-- FIX (CRITICAL, ISSUE-128): leave_accrual_ledger_accrual_type_check
-- was rewritten in migration 254 with only 8 values, silently dropping
-- 7 that migration 159 had added (advance_accrual, earned_accrual,
-- prorated_accrual, recovery, settlement_recovery, tier_adjustment,
-- release — 159 even has its own downstream query filtering on
-- 'recovery'/'settlement_recovery'/'advance_accrual', proving these
-- were load-bearing). Migrations 268/269 added consumption/
-- opening_balance/reversal/encashment back but never restored the
-- other 7.
--
-- Confirmed live and broken: apps/api/src/lib/leave-jobs.ts computes
-- accrual_type = 'advance_accrual' or 'prorated_accrual' for any
-- tenant on an advance/prorated accrual policy and upserts it into
-- this table — every such insert has been silently rejected by the
-- CHECK constraint since migration 254, and the upsert's `{ error }`
-- was never checked (fixed separately in the same commit as this
-- migration), so the job has been reporting phantom success.
--
-- This migration sets the constraint to the true union of every value
-- that has ever appeared across 159/254/268/269.
-- ============================================================

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
    'encashment'
  ));

-- The idempotency index's WHERE predicate must cover every accrual_type
-- the ON CONFLICT target in leave-jobs.ts actually upserts through this
-- composite key, or the insert fails at the "no unique or exclusion
-- constraint matching the ON CONFLICT specification" stage instead —
-- the same class of bug as the durable-queue incident this week.
-- advance_accrual/prorated_accrual are the two types leave-jobs.ts
-- writes via this exact (tenant_id,employee_id,leave_type_id,year,
-- accrual_type,accrued_on) key that weren't yet covered. Other
-- restored types above (recovery, settlement_recovery, tier_adjustment,
-- release, earned_accrual, consumption, reversal, encashment,
-- opening_balance) are written through different call sites with
-- different natural keys (e.g. source_request_id) and are deliberately
-- NOT added here — widening this predicate to types whose true
-- idempotency key isn't this composite would silently collapse
-- legitimate distinct rows that happen to share a date.
DROP INDEX IF EXISTS uidx_accrual_ledger_idempotency;
CREATE UNIQUE INDEX IF NOT EXISTS uidx_accrual_ledger_idempotency
  ON leave_accrual_ledger (tenant_id, employee_id, leave_type_id, year, accrual_type, accrued_on)
  WHERE accrual_type IN ('monthly','quarterly','yearly','upfront','carry_forward','co_grant','wo_credit','advance_accrual','prorated_accrual');
