-- Migration 314: threshold/amount routing for the 053 approval engine (P2.3).
--
-- Two changes:
--  1. Extend the engine enums to the finance entities so admins can configure
--     chains for reimbursement / loan / advance.
--  2. Add approval_workflow_config.min_amount — a level applies to an instance only
--     when the entity's amount >= min_amount. NULL = always applies (the existing
--     behaviour). This lets an admin add e.g. a Finance level that only kicks in
--     above ₹10,000, with NO amount hardcoded in code.
--
-- Idempotent. The orchestrator computes an instance's total_levels from the levels
-- applicable to its amount at creation time.

-- 1. Enum extensions ----------------------------------------------------------
ALTER TABLE approval_workflow_config
  DROP CONSTRAINT IF EXISTS approval_workflow_config_workflow_type_check;
ALTER TABLE approval_workflow_config
  ADD  CONSTRAINT approval_workflow_config_workflow_type_check
  CHECK (workflow_type IN ('leave', 'correction', 'regularisation', 'overtime', 'comp_off',
                           'reimbursement', 'loan', 'advance'));

ALTER TABLE approval_instances
  DROP CONSTRAINT IF EXISTS approval_instances_entity_type_check;
ALTER TABLE approval_instances
  ADD  CONSTRAINT approval_instances_entity_type_check
  CHECK (entity_type IN ('leave_request', 'attendance_correction', 'attendance_regularisation',
                         'overtime_request', 'comp_off_request',
                         'reimbursement_claim', 'employee_loan', 'advance_salary'));

-- 2. Per-level amount threshold ----------------------------------------------
ALTER TABLE approval_workflow_config
  ADD COLUMN IF NOT EXISTS min_amount NUMERIC NULL
  CHECK (min_amount IS NULL OR min_amount >= 0);

COMMENT ON COLUMN approval_workflow_config.min_amount IS
  'Level applies only when the entity amount >= min_amount. NULL = always applies.';
