-- ============================================================
-- 200_add_missing_updated_at.sql
--
-- Adds updated_at TIMESTAMPTZ columns and auto-update triggers
-- to mutable operational tables that are missing lifecycle
-- tracking.
--
-- AFFECTED TABLES
-- ---------------
-- inbox_items (107)        — status, read_at, actioned_at all change
-- import_jobs (108)        — status, row counts update throughout
-- onboarding_documents (109) — extraction_status, review_status change
-- work_session_anomalies (148) — resolved, resolved_at change
-- payroll_adjustments (167)   — status, approved_at, applied_at change
-- statutory_registrations (166) — is_active can change
-- rotation_policy_rules (153)  — shift_id, sort_order can change
--
-- EXCLUDED (append-only / already have updated_at)
-- -------------------------------------------------
-- inbox_escalations — event log (each hop is a new row)
-- import_job_rows   — immutable once written
-- scheduler_job_log — audit log (completed_at is used instead)
-- rotation_policies — already has updated_at from migration 153
-- payroll_statutory_settings — already has updated_at
-- onboarding_sessions — already has updated_at
--
-- PATTERN
-- -------
-- 1. ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL
--      DEFAULT now() — backfills existing rows with current ts
-- 2. CREATE OR REPLACE TRIGGER using shared
--      update_updated_at_column() from 000_bootstrap_functions
-- ============================================================

-- ── inbox_items ───────────────────────────────────────────────
ALTER TABLE inbox_items
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT now();

CREATE INDEX IF NOT EXISTS idx_ii_updated_at
  ON inbox_items (tenant_id, updated_at DESC);

DROP TRIGGER IF EXISTS trg_inbox_items_updated_at ON inbox_items;
CREATE TRIGGER trg_inbox_items_updated_at
  BEFORE UPDATE ON inbox_items
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();


-- ── import_jobs ───────────────────────────────────────────────
ALTER TABLE import_jobs
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT now();

DROP TRIGGER IF EXISTS trg_import_jobs_updated_at ON import_jobs;
CREATE TRIGGER trg_import_jobs_updated_at
  BEFORE UPDATE ON import_jobs
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();


-- ── onboarding_documents ──────────────────────────────────────
ALTER TABLE onboarding_documents
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT now();

DROP TRIGGER IF EXISTS trg_onboarding_documents_updated_at ON onboarding_documents;
CREATE TRIGGER trg_onboarding_documents_updated_at
  BEFORE UPDATE ON onboarding_documents
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();


-- ── work_session_anomalies ────────────────────────────────────
ALTER TABLE work_session_anomalies
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT now();

DROP TRIGGER IF EXISTS trg_work_session_anomalies_updated_at ON work_session_anomalies;
CREATE TRIGGER trg_work_session_anomalies_updated_at
  BEFORE UPDATE ON work_session_anomalies
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();


-- ── payroll_adjustments ───────────────────────────────────────
ALTER TABLE payroll_adjustments
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT now();

DROP TRIGGER IF EXISTS trg_payroll_adjustments_updated_at ON payroll_adjustments;
CREATE TRIGGER trg_payroll_adjustments_updated_at
  BEFORE UPDATE ON payroll_adjustments
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();


-- ── statutory_registrations ───────────────────────────────────
ALTER TABLE statutory_registrations
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT now();

DROP TRIGGER IF EXISTS trg_statutory_registrations_updated_at ON statutory_registrations;
CREATE TRIGGER trg_statutory_registrations_updated_at
  BEFORE UPDATE ON statutory_registrations
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();


-- ── rotation_policy_rules ─────────────────────────────────────
ALTER TABLE rotation_policy_rules
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT now();

DROP TRIGGER IF EXISTS trg_rotation_policy_rules_updated_at ON rotation_policy_rules;
CREATE TRIGGER trg_rotation_policy_rules_updated_at
  BEFORE UPDATE ON rotation_policy_rules
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
