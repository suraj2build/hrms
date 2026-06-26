-- Migration 313: extend the 053 approval engine to overtime + comp-off.
--
-- P1.4 of the approval-engine plan. The generic multi-level engine
-- (approval_workflow_config / approval_instances / approval_actions) was scoped
-- to leave / correction / regularisation. To let an admin configure multi-level
-- chains for overtime and comp-off too, relax the two CHECK enums.
--
-- Inline column CHECKs are auto-named <table>_<column>_check by Postgres; drop
-- and re-add with the extended value sets. Idempotent (DROP IF EXISTS).

ALTER TABLE approval_workflow_config
  DROP CONSTRAINT IF EXISTS approval_workflow_config_workflow_type_check;
ALTER TABLE approval_workflow_config
  ADD  CONSTRAINT approval_workflow_config_workflow_type_check
  CHECK (workflow_type IN ('leave', 'correction', 'regularisation', 'overtime', 'comp_off'));

ALTER TABLE approval_instances
  DROP CONSTRAINT IF EXISTS approval_instances_entity_type_check;
ALTER TABLE approval_instances
  ADD  CONSTRAINT approval_instances_entity_type_check
  CHECK (entity_type IN ('leave_request', 'attendance_correction', 'attendance_regularisation', 'overtime_request', 'comp_off_request'));
