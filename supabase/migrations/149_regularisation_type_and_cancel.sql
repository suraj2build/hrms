-- ============================================================
-- 149_regularisation_type_and_cancel.sql
--
-- 1. Add regularization_type to attendance_regularisation
--    so employees can classify what they are correcting.
-- 2. Expand the status CHECK to include 'withdrawn'
--    (employee cancels their own pending request).
-- ============================================================

-- Add regularization_type (nullable for backward compat with old rows)
ALTER TABLE attendance_regularisation
  ADD COLUMN IF NOT EXISTS regularization_type TEXT NULL
    CHECK (regularization_type IN ('check_in','check_out','both','absence','other'));

-- Allow 'withdrawn' status (employee self-cancel)
-- PostgreSQL requires dropping + recreating the constraint
ALTER TABLE attendance_regularisation
  DROP CONSTRAINT IF EXISTS attendance_regularisation_status_check;

ALTER TABLE attendance_regularisation
  ADD CONSTRAINT attendance_regularisation_status_check
    CHECK (status IN ('pending','approved','rejected','withdrawn'));

-- Index: fast lookup of pending requests by type
CREATE INDEX IF NOT EXISTS idx_reg_type
  ON attendance_regularisation (tenant_id, employee_id, regularization_type)
  WHERE status = 'pending';
