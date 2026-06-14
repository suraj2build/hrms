-- ============================================================
-- 254_wo_credit_phase2.sql
--
-- WO-Credit Phase 2 — carry-over balance, manual redemption, LOP finalisation.
--
-- Leftover (unused) current-month WO credit is credited into a "Weekly Off
-- Credit" leave type via leave_accrual_ledger (with rollover expiry) so the
-- employee can redeem it manually in later months through the normal
-- leave-request flow. This needs the ledger's accrual_type CHECK to accept
-- the new 'wo_credit' value.
-- ============================================================

ALTER TABLE leave_accrual_ledger
  DROP CONSTRAINT IF EXISTS leave_accrual_ledger_accrual_type_check;

ALTER TABLE leave_accrual_ledger
  ADD CONSTRAINT leave_accrual_ledger_accrual_type_check
  CHECK (accrual_type IN (
    'monthly', 'yearly', 'upfront', 'carry_forward',
    'co_grant', 'manual', 'adjustment',
    'wo_credit'        -- carried-over weekly-off credit (has rollover expiry)
  ));
