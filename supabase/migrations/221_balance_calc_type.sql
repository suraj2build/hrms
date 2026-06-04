-- ============================================================
-- 221_balance_calc_type.sql
--
-- Adds a 'balance' calculation type so a designated earning (Special Allowance)
-- can absorb the residual: balance = CTC − all other earnings − employer
-- contributions. This makes the CTC breakup reconcile EXACTLY to the CTC, with
-- employer contributions (employer PF, gratuity) counted inside the CTC.
--
-- Extends the calculation_type CHECK on:
--   * salary_structure_components       (structure templates)
--   * employee_compensation_components  (per-employee breakdown)
--   * salary_components.default_calculation_type (component prefill default)
--
-- Idempotent: drops + re-adds each constraint with the expanded value set.
-- ============================================================

-- salary_structure_components.calculation_type
ALTER TABLE salary_structure_components
  DROP CONSTRAINT IF EXISTS salary_structure_components_calculation_type_check;
ALTER TABLE salary_structure_components
  ADD  CONSTRAINT salary_structure_components_calculation_type_check
  CHECK (calculation_type IN ('fixed','pct_of_basic','pct_of_ctc','pct_of_gross','balance'));

-- employee_compensation_components.calculation_type
ALTER TABLE employee_compensation_components
  DROP CONSTRAINT IF EXISTS employee_compensation_components_calculation_type_check;
ALTER TABLE employee_compensation_components
  ADD  CONSTRAINT employee_compensation_components_calculation_type_check
  CHECK (calculation_type IN ('fixed','pct_of_basic','pct_of_ctc','pct_of_gross','balance'));

-- salary_components.default_calculation_type (added in migration 215; nullable)
ALTER TABLE salary_components
  DROP CONSTRAINT IF EXISTS salary_components_default_calculation_type_check;
ALTER TABLE salary_components
  ADD  CONSTRAINT salary_components_default_calculation_type_check
  CHECK (default_calculation_type IS NULL OR default_calculation_type IN
         ('fixed','pct_of_basic','pct_of_ctc','pct_of_gross','balance'));

NOTIFY pgrst, 'reload schema';
