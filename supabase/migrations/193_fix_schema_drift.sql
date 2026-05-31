-- ============================================================
-- 193_fix_schema_drift.sql
--
-- Corrective migration: add columns that were defined in later
-- migrations using CREATE TABLE IF NOT EXISTS, but silently
-- skipped because the tables were already created by earlier
-- migrations.
--
-- AFFECTED TABLES
-- ---------------
-- 1. compensation_revisions
--    - Created by: 078_compensation_revisions.sql
--    - Drift from: 092_compensation_enhancement.sql
--    - Missing: old_compensation_id, new_compensation_id
--    - NOTE: ctc_change_amount GENERATED AS from 092 uses
--      column names that differ from 078's schema (revised_ vs
--      new_, previous_ vs before_). We do NOT add that column
--      to avoid a broken generated expression. The application
--      already computes delta via delta_amount / delta_pct
--      columns from 078.
--
-- 2. payroll_explainability_ledger
--    - Created by: 077_payroll_explainability_ledger.sql
--    - Drift from: 094_payroll_ledger.sql
--    - Missing: payroll_run_id, ledger_date, source_module,
--      is_payroll_impacting, correlation_id, causation_event_id
--    - NOTE: delta GENERATED AS from 094 requires before_value
--      and after_value to be DECIMAL, but 077 defines them as
--      TEXT. We add the additive columns only and skip the
--      generated column to avoid a type conflict.
--
-- SAFETY
-- ------
-- All statements use ADD COLUMN IF NOT EXISTS.
-- Safe on fresh DBs (adds columns as expected).
-- Safe on existing DBs (no-op if columns already exist via
-- a prior manual fix or partial re-run).
-- ============================================================

-- ── 1. compensation_revisions ─────────────────────────────────

-- old_compensation_id: FK to the compensation record that was
-- active before this revision was processed.
ALTER TABLE compensation_revisions
  ADD COLUMN IF NOT EXISTS old_compensation_id UUID
    REFERENCES employee_compensations(id) ON DELETE SET NULL;

-- new_compensation_id: FK to the compensation record created
-- when this revision was approved.
ALTER TABLE compensation_revisions
  ADD COLUMN IF NOT EXISTS new_compensation_id UUID
    REFERENCES employee_compensations(id) ON DELETE SET NULL;

-- Index for fast lookup of revision chains
CREATE INDEX IF NOT EXISTS idx_comp_rev_old_comp
  ON compensation_revisions (old_compensation_id)
  WHERE old_compensation_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_comp_rev_new_comp
  ON compensation_revisions (new_compensation_id)
  WHERE new_compensation_id IS NOT NULL;


-- ── 2. payroll_explainability_ledger ─────────────────────────

-- payroll_run_id: links ledger entries to the specific payroll
-- run that generated them (nullable — some events predate a run).
ALTER TABLE payroll_explainability_ledger
  ADD COLUMN IF NOT EXISTS payroll_run_id UUID
    REFERENCES payroll_runs(id) ON DELETE SET NULL;

-- ledger_date: the calendar date this event applies to.
-- Nullable to avoid breaking existing rows (which have month TEXT).
ALTER TABLE payroll_explainability_ledger
  ADD COLUMN IF NOT EXISTS ledger_date DATE;

-- source_module: which sub-system produced this ledger entry.
-- Matches 094's expected values.
ALTER TABLE payroll_explainability_ledger
  ADD COLUMN IF NOT EXISTS source_module TEXT
    CHECK (source_module IN (
      'attendance', 'leave', 'compensation', 'statutory',
      'advance', 'loan', 'reimbursement', 'variable_pay',
      'arrear', 'tds', 'manual'
    ));

-- is_payroll_impacting: whether this event directly affects net pay.
ALTER TABLE payroll_explainability_ledger
  ADD COLUMN IF NOT EXISTS is_payroll_impacting BOOLEAN NOT NULL DEFAULT true;

-- correlation_id: links related ledger entries across modules.
ALTER TABLE payroll_explainability_ledger
  ADD COLUMN IF NOT EXISTS correlation_id TEXT;

-- causation_event_id: the platform_event or upstream event that
-- triggered this ledger entry.
ALTER TABLE payroll_explainability_ledger
  ADD COLUMN IF NOT EXISTS causation_event_id TEXT;

-- Indexes for the new navigation columns
CREATE INDEX IF NOT EXISTS idx_pel_payroll_run
  ON payroll_explainability_ledger (payroll_run_id)
  WHERE payroll_run_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_pel_ledger_date
  ON payroll_explainability_ledger (tenant_id, employee_id, ledger_date DESC)
  WHERE ledger_date IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_pel_correlation
  ON payroll_explainability_ledger (correlation_id)
  WHERE correlation_id IS NOT NULL;
