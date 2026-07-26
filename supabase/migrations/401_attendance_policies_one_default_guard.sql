-- ============================================================
-- 401_attendance_policies_one_default_guard.sql
--
-- POST /masters/attendance-policies/:id/set-default clears the existing
-- default policy (is_default=false) then sets the target policy's
-- is_default=true, as two separate UPDATE statements with no transaction.
-- Two concurrent set-default calls for different policies can both pass
-- the "clear" step before either "set" step commits, leaving two rows
-- simultaneously is_default=true — attendance engines that assume a
-- single default policy per tenant would then pick one nondeterministically.
--
-- leave_policy_masters already has this exact guard (migration 054,
-- idx_leave_policy_masters_one_default) — this brings attendance_policies
-- to parity.
-- ============================================================

CREATE UNIQUE INDEX IF NOT EXISTS idx_attendance_policies_one_default
  ON attendance_policies (tenant_id)
  WHERE is_default = true;
