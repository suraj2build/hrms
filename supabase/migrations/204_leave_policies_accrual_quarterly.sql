-- 204_leave_policies_accrual_quarterly.sql
--
-- Adds 'quarterly' to the accrual_type check constraint on leave_policies.
-- Migration 049 created the constraint with only ('monthly', 'yearly', 'upfront').
-- The API (leave-policies.ts) and frontend both support quarterly — DB was lagging.

ALTER TABLE leave_policies
  DROP CONSTRAINT IF EXISTS leave_policies_accrual_type_check;

ALTER TABLE leave_policies
  ADD CONSTRAINT leave_policies_accrual_type_check
  CHECK (accrual_type IN ('monthly', 'quarterly', 'yearly', 'upfront'));
