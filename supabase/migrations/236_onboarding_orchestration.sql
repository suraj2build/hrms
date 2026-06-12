-- ============================================================
-- 236_onboarding_orchestration.sql
--
-- Phase O1: Onboarding Orchestration Foundation
--
-- Extends the multi-level approval workflow engine CHECK
-- constraints to include onboarding sessions.  This unblocks:
--   · Phase O1 — wiring onboarding → workflow engine
--   · Phase O7 — confirmation workflow
-- ============================================================

-- ── 1. approval_workflow_config: add 'onboarding' workflow type ───────────────

ALTER TABLE approval_workflow_config
  DROP CONSTRAINT IF EXISTS approval_workflow_config_workflow_type_check;

ALTER TABLE approval_workflow_config
  ADD CONSTRAINT approval_workflow_config_workflow_type_check
  CHECK (workflow_type IN ('leave', 'correction', 'regularisation', 'onboarding'));

-- ── 2. approval_instances: add 'onboarding_session' entity type ──────────────

ALTER TABLE approval_instances
  DROP CONSTRAINT IF EXISTS approval_instances_entity_type_check;

ALTER TABLE approval_instances
  ADD CONSTRAINT approval_instances_entity_type_check
  CHECK (entity_type IN (
    'leave_request',
    'attendance_correction',
    'attendance_regularisation',
    'onboarding_session'
  ));
