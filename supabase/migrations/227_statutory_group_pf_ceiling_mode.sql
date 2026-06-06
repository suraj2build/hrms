-- 227_statutory_group_pf_ceiling_mode.sql
-- Statutory Group becomes the tagged "compliance profile" for EPF/ESI.
-- Add the PF wage-ceiling MODE so a group can be tagged Capped / Actual / Follow-default,
-- in addition to the existing pf_enabled / esi_enabled / pf_wage_ceiling / esi_wage_ceiling.
--
--   capped   → restrict PF wages to the ceiling (₹15,000 default or group's pf_wage_ceiling)
--   actual   → PF computed on full PF-applicable wages, no ceiling
--   default  → follow the tenant epf_config.is_wage_ceiling_applicable setting
--
-- Additive + idempotent. Existing rows default to 'default' (no behaviour change).

ALTER TABLE statutory_groups
  ADD COLUMN IF NOT EXISTS pf_ceiling_mode TEXT NOT NULL DEFAULT 'default';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.constraint_column_usage
    WHERE table_name = 'statutory_groups' AND constraint_name = 'statutory_groups_pf_ceiling_mode_chk'
  ) THEN
    ALTER TABLE statutory_groups
      ADD CONSTRAINT statutory_groups_pf_ceiling_mode_chk
      CHECK (pf_ceiling_mode IN ('capped', 'actual', 'default'));
  END IF;
END $$;

COMMENT ON COLUMN statutory_groups.pf_ceiling_mode IS
  'PF wage-ceiling mode for employees tagged to this group: capped | actual | default (follow tenant epf_config).';
