-- ============================================================
-- 255_wo_credit_holiday_pay.sql
--
-- WO-Credit: configurable holiday-work extra-pay multiplier.
--
-- When holiday_work_reward = 'extra_pay', working a public holiday earns extra
-- pay. The rate is now configurable (default 1.0 × daily rate). At month-close
-- the finaliser computes the amount (extra_pay_days × daily_rate × multiplier)
-- and drops a PENDING payroll_adjustments row for the payroll team to apply.
-- ============================================================

ALTER TABLE wo_credit_structure
  ADD COLUMN IF NOT EXISTS holiday_pay_multiplier NUMERIC(5,2) NOT NULL DEFAULT 1.0
    CHECK (holiday_pay_multiplier > 0 AND holiday_pay_multiplier <= 10);

ALTER TABLE wo_credit_monthly
  ADD COLUMN IF NOT EXISTS extra_pay_amount NUMERIC(12,2) NOT NULL DEFAULT 0;
