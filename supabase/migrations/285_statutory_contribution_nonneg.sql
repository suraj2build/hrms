-- ============================================================
-- 285_statutory_contribution_nonneg.sql
--
-- COMPLIANCE P1-6 — statutory contribution tables had no guard against negative
-- amounts. A bad config (negative rate) or arithmetic path could persist a
-- negative liability that silently corrupts a challan.
--
-- Adds CHECK (col >= 0) on every wage/amount column of the four contribution
-- tables. NOT VALID so the constraint applies to new/updated rows immediately
-- without scanning (and without failing the migration on any pre-existing bad
-- data) — run VALIDATE CONSTRAINT later once data is confirmed clean.
--
-- Idempotent: each constraint is added only if absent.
-- ============================================================

DO $$
DECLARE
  v record;
BEGIN
  FOR v IN
    SELECT * FROM (VALUES
      ('epf_contributions',  'chk_epf_pf_wages_nonneg',       'pf_wages'),
      ('epf_contributions',  'chk_epf_emp_contrib_nonneg',    'employee_contribution'),
      ('epf_contributions',  'chk_epf_employer_pf_nonneg',    'employer_pf'),
      ('epf_contributions',  'chk_epf_employer_eps_nonneg',   'employer_eps'),
      ('epf_contributions',  'chk_epf_edli_nonneg',           'edli_contribution'),
      ('epf_contributions',  'chk_epf_voluntary_pf_nonneg',   'voluntary_pf'),
      ('esi_contributions',  'chk_esi_wages_nonneg',          'esi_wages'),
      ('esi_contributions',  'chk_esi_emp_contrib_nonneg',    'employee_contribution'),
      ('esi_contributions',  'chk_esi_employer_contrib_nonneg','employer_contribution'),
      ('ptax_contributions', 'chk_ptax_gross_nonneg',         'gross_salary'),
      ('ptax_contributions', 'chk_ptax_amount_nonneg',        'ptax_amount'),
      ('lwf_contributions',  'chk_lwf_gross_nonneg',          'gross_salary'),
      ('lwf_contributions',  'chk_lwf_emp_contrib_nonneg',    'employee_contribution'),
      ('lwf_contributions',  'chk_lwf_employer_contrib_nonneg','employer_contribution')
    ) AS t(tbl, cons, col)
  LOOP
    -- Skip if the table or column doesn't exist (schema variance across envs).
    IF EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_name = v.tbl AND column_name = v.col
    ) AND NOT EXISTS (
      SELECT 1 FROM pg_constraint WHERE conname = v.cons
    ) THEN
      EXECUTE format(
        'ALTER TABLE %I ADD CONSTRAINT %I CHECK (%I >= 0) NOT VALID',
        v.tbl, v.cons, v.col
      );
    END IF;
  END LOOP;
END $$;
