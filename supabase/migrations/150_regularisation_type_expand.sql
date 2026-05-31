-- ============================================================
-- 150_regularisation_type_expand.sql
--
-- The regularization_type CHECK constraint (added in migration 149)
-- uses abstract backend types ('check_in','check_out','both','absence','other')
-- but the ESS frontend sends descriptive employee-facing labels
-- ('missed_punch','forgot_checkout','onsite_duty', etc.).
--
-- This migration expands the CHECK to include both sets so that:
--   - existing rows with legacy abstract types remain valid
--   - new ESS submissions using descriptive labels are accepted
-- ============================================================

ALTER TABLE attendance_regularisation
  DROP CONSTRAINT IF EXISTS attendance_regularisation_regularization_type_check;

ALTER TABLE attendance_regularisation
  ADD CONSTRAINT attendance_regularisation_regularization_type_check
    CHECK (regularization_type IN (
      -- legacy abstract types (backward compat)
      'check_in', 'check_out', 'both', 'absence', 'other',
      -- ESS descriptive types used by the frontend
      'missed_punch', 'forgot_checkout', 'onsite_duty',
      'biometric_issue', 'client_visit', 'wfh',
      'field_work', 'system_issue'
    ));
