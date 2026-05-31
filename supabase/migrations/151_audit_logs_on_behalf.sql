-- Migration 151: Add on_behalf_of column to audit_logs
-- Tracks when an HR admin performs an action targeting another employee's record.
-- Stores employees.id (not profiles.id) — no FK so no extra lookup is needed at
-- call sites where employee_id is already in scope.
-- NULL means the actor acted on their own data (self-service) or it's a system action.

ALTER TABLE audit_logs
  ADD COLUMN IF NOT EXISTS on_behalf_of UUID;

-- Sparse index — only populated for admin-on-behalf rows
CREATE INDEX IF NOT EXISTS idx_audit_on_behalf
  ON audit_logs(on_behalf_of)
  WHERE on_behalf_of IS NOT NULL;

COMMENT ON COLUMN audit_logs.on_behalf_of IS
  'employees.id of the employee whose record was acted upon when an HR admin performs the action on their behalf. NULL for self-service or system actions.';
