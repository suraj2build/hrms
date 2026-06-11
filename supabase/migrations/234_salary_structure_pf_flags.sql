-- 234_salary_structure_pf_flags.sql
-- Salary structure becomes the single source of truth for PF/ESI/TDS applicability
-- and PF ceiling mode.  Employee-level EPF override flags are no longer the primary
-- config surface — the structure assigned to the employee drives the engine.
--
-- pf_ceiling_mode values:
--   follow_policy  → use the tenant EPF config (is_wage_ceiling_applicable); statutory default
--   capped         → always restrict PF wage to the ceiling (e.g. standard ₹15,000)
--   actual         → compute PF on full PF-applicable wages, no ceiling (e.g. CXO, senior roles)
--
-- Additive + idempotent. Existing rows default to safe/statutory values (all ON, ceiling).

ALTER TABLE salary_structures
  ADD COLUMN IF NOT EXISTS pf_applicable   BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS esi_applicable  BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS tds_applicable  BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS pf_ceiling_mode TEXT    NOT NULL DEFAULT 'follow_policy';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.constraint_column_usage
    WHERE table_name = 'salary_structures'
      AND constraint_name = 'salary_structures_pf_ceiling_mode_chk'
  ) THEN
    ALTER TABLE salary_structures
      ADD CONSTRAINT salary_structures_pf_ceiling_mode_chk
      CHECK (pf_ceiling_mode IN ('capped', 'actual', 'follow_policy'));
  END IF;
END $$;

COMMENT ON COLUMN salary_structures.pf_applicable   IS 'Whether PF applies for employees on this structure (false = contractor / no-PF role).';
COMMENT ON COLUMN salary_structures.esi_applicable  IS 'Whether ESI applies for employees on this structure (false = no-ESI role; salary threshold still checked at payroll time).';
COMMENT ON COLUMN salary_structures.tds_applicable  IS 'Whether TDS/income-tax is computed for employees on this structure.';
COMMENT ON COLUMN salary_structures.pf_ceiling_mode IS 'PF wage-ceiling mode: follow_policy | capped | actual.';
