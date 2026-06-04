-- ============================================================
-- 222_ensure_rotation_policy_columns.sql
--
-- Ensures the per-employee rotation-policy assignment columns exist, so the
-- Employee Master "Shift & Roster" tab can persist a rotation policy and the
-- engines can resolve employee-override → site-default.
--
-- Idempotent. Safe to run repeatedly. Apply on environments where migration 153
-- was not fully applied (symptom: editing org assignment silently fails / the
-- rotation policy never saves).
-- ============================================================

ALTER TABLE employees ADD COLUMN IF NOT EXISTS rotation_policy_id UUID
  REFERENCES rotation_policies(id) ON DELETE SET NULL;

ALTER TABLE sites ADD COLUMN IF NOT EXISTS default_rotation_policy_id UUID
  REFERENCES rotation_policies(id) ON DELETE SET NULL;

NOTIFY pgrst, 'reload schema';
