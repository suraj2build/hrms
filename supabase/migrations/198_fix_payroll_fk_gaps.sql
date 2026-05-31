-- ============================================================
-- 198_fix_payroll_fk_gaps.sql
--
-- Adds missing REFERENCES payroll_runs(id) FK constraints on
-- the payroll_run_id columns in EPF, ESI, and Professional Tax
-- contribution tables.
--
-- ROOT CAUSE (migrations 095, 096, 097)
-- -------------------------------------
-- epf_contributions.payroll_run_id  UUID          -- no FK
-- esi_contributions.payroll_run_id  UUID          -- no FK
-- ptax_contributions.payroll_run_id UUID          -- no FK
--
-- Consequence: orphan contribution rows survive after a payroll
-- run is deleted; re-run queries join on a ghost UUID and return
-- wrong results.
--
-- ON DELETE SET NULL: contributions are permanent statutory
-- records — deleting a payroll run should not delete them.
--
-- All DO blocks are idempotent (IF NOT EXISTS constraint check).
-- ============================================================

-- ── epf_contributions ─────────────────────────────────────────
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_schema = 'public'
      AND table_name        = 'epf_contributions'
      AND constraint_name   = 'epf_contributions_payroll_run_id_fkey'
  ) THEN
    ALTER TABLE epf_contributions
      ADD CONSTRAINT epf_contributions_payroll_run_id_fkey
      FOREIGN KEY (payroll_run_id) REFERENCES payroll_runs(id) ON DELETE SET NULL;
  END IF;
END $$;

-- Covering index for payroll-run → contributions lookup
CREATE INDEX IF NOT EXISTS idx_epf_contrib_payroll_run
  ON epf_contributions (payroll_run_id)
  WHERE payroll_run_id IS NOT NULL;


-- ── esi_contributions ─────────────────────────────────────────
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_schema = 'public'
      AND table_name        = 'esi_contributions'
      AND constraint_name   = 'esi_contributions_payroll_run_id_fkey'
  ) THEN
    ALTER TABLE esi_contributions
      ADD CONSTRAINT esi_contributions_payroll_run_id_fkey
      FOREIGN KEY (payroll_run_id) REFERENCES payroll_runs(id) ON DELETE SET NULL;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_esi_contrib_payroll_run
  ON esi_contributions (payroll_run_id)
  WHERE payroll_run_id IS NOT NULL;


-- ── ptax_contributions ────────────────────────────────────────
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_schema = 'public'
      AND table_name        = 'ptax_contributions'
      AND constraint_name   = 'ptax_contributions_payroll_run_id_fkey'
  ) THEN
    ALTER TABLE ptax_contributions
      ADD CONSTRAINT ptax_contributions_payroll_run_id_fkey
      FOREIGN KEY (payroll_run_id) REFERENCES payroll_runs(id) ON DELETE SET NULL;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_ptax_contrib_payroll_run
  ON ptax_contributions (payroll_run_id)
  WHERE payroll_run_id IS NOT NULL;
