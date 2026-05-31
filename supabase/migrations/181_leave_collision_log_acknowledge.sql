-- ---------------------------------------------------------------------------
-- Migration 181: Add acknowledgement fields to leave_collision_log
--
-- Allows HR admins to acknowledge/dismiss collision log entries from the
-- Daily Operations dashboard without deleting the audit record.
-- ---------------------------------------------------------------------------

ALTER TABLE leave_collision_log
  ADD COLUMN IF NOT EXISTS acknowledged_at   TIMESTAMPTZ NULL,
  ADD COLUMN IF NOT EXISTS acknowledged_by   UUID        NULL REFERENCES profiles(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_collision_log_unacknowledged
  ON leave_collision_log (tenant_id, acknowledged_at)
  WHERE acknowledged_at IS NULL;
