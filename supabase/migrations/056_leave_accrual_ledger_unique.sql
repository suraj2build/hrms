-- =============================================================================
-- 056_leave_accrual_ledger_unique.sql
--
-- Two hardening changes:
--
--   1. UNIQUE index on leave_accrual_ledger to prevent duplicate ledger
--      entries from repeated job runs (idempotency at DB level).
--      Covers the structured accrual types; co_grant / manual / adjustment
--      are intentionally NOT constrained (they may legitimately repeat
--      on different events within the same day).
--
--   2. Add 'yearly_accrual' to the leave_job_log.job_type CHECK constraint
--      so the new yearlyAccrualJob can write its log row without a violation.
-- =============================================================================

-- ── 1. Unique index on leave_accrual_ledger ───────────────────────────────────
--
-- Key:  (tenant_id, employee_id, leave_type_id, year, accrual_type, accrued_on)
--
-- For monthly accrual   : accrued_on = YYYY-MM-01   → one entry per month
-- For quarterly accrual : accrued_on = YYYY-QQ-01   → one entry per quarter month
-- For yearly / upfront  : accrued_on = YYYY-01-01   → one entry per year
-- For carry_forward     : accrued_on = toYear-01-01  → one entry per year transition
--
-- Partial: excludes co_grant, manual, adjustment rows so they can repeat freely.

CREATE UNIQUE INDEX IF NOT EXISTS uidx_accrual_ledger_idempotency
  ON leave_accrual_ledger (tenant_id, employee_id, leave_type_id, year, accrual_type, accrued_on)
  WHERE accrual_type IN ('monthly', 'quarterly', 'yearly', 'upfront', 'carry_forward');

-- ── 2. Extend leave_job_log.job_type CHECK ─────────────────────────────────────
--
-- The original CHECK in migration 050 did not include 'yearly_accrual'.
-- Drop + re-add the constraint to include the new type.

ALTER TABLE leave_job_log
  DROP CONSTRAINT IF EXISTS leave_job_log_job_type_check;

ALTER TABLE leave_job_log
  ADD CONSTRAINT leave_job_log_job_type_check
    CHECK (job_type IN (
      'monthly_accrual',
      'yearly_accrual',
      'co_expiry',
      'carry_forward',
      'policy_recalculate'
    ));
