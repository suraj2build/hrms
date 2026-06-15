-- ============================================================
-- 266_rotation_rules_temporal.sql
--
-- AHI-3: Temporal versioning for rotation_policy_rules.
-- Closes Enterprise Integrity findings C4 (rotation rules had no
-- effective_from/to, so the resolver read them live and editing a
-- condition→shift mapping retroactively changed past late/OT) and the
-- replay half of C5 (a recompute re-resolved against current rules).
--
-- Mirrors the AHI-1 employee_shifts temporal model (migration 260b):
--   • effective_from / effective_to define each rule version's validity
--   • the unified resolver picks the version effective ON the compute date
--   • existing rows are backfilled to an open window (always-effective),
--     so behaviour is unchanged until a rule is next edited
-- ============================================================

ALTER TABLE rotation_policy_rules
  ADD COLUMN IF NOT EXISTS effective_from DATE,
  ADD COLUMN IF NOT EXISTS effective_to   DATE;

-- Backfill existing rules to an open window starting far in the past so the
-- temporal resolver matches them for every date (no behaviour change on deploy).
UPDATE rotation_policy_rules
   SET effective_from = COALESCE(effective_from, DATE '2000-01-01')
 WHERE effective_from IS NULL;

ALTER TABLE rotation_policy_rules
  ALTER COLUMN effective_from SET DEFAULT CURRENT_DATE;

-- Replace the hard "one shift per condition per policy" constraint with a
-- temporal one: only ONE OPEN (effective_to IS NULL) version per condition.
-- Historical (closed) versions accumulate for point-in-time resolution.
ALTER TABLE rotation_policy_rules
  DROP CONSTRAINT IF EXISTS rotation_policy_rules_rotation_policy_id_condition_type_key;

CREATE UNIQUE INDEX IF NOT EXISTS uidx_rotation_rule_open_version
  ON rotation_policy_rules (rotation_policy_id, condition_type)
  WHERE effective_to IS NULL;

CREATE INDEX IF NOT EXISTS idx_rotation_rule_temporal
  ON rotation_policy_rules (rotation_policy_id, condition_type, effective_from DESC, effective_to DESC);
