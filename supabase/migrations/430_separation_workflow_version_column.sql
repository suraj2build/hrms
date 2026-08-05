-- ============================================================
-- 430_separation_workflow_version_column.sql
--
-- PEND-105 follow-up wave — the 5 tables deferred by migration 428's
-- footnote (separation_clearances, separation_ff_summary,
-- employee_separation, gratuity_config, clearance_departments).
--
-- 428 deferred these because every *status-transition* endpoint on them
-- (approve/advance/relieve/archive/mark-paid) already folds its precondition
-- into the UPDATE's own WHERE clause (ISSUE-219/246/249 fixes earlier in
-- this audit series), which is itself a de facto optimistic lock on the one
-- field each of those actions changes. That protection is unchanged by this
-- migration and those endpoints are not being converted to expected_version
-- CAS here — doing so would add a second, redundant failure mode to
-- disambiguate for no real gain.
--
-- What *was* still an open gap: the plain field-edit endpoints on these same
-- tables that have NO state-guard at all — PATCH .../separation-clearances/
-- :clearanceId (remarks/status edited by two HR staff or a manager +  HR
-- admin at once), PUT /settlement/gratuity-config (a tenant-wide config
-- singleton, upsert-based), PATCH /settlement/clearance-departments/:id
-- (label/is_active/display_order), and PUT /employees/:id/separation
-- (arbitrary partial field edit, separation.ts). Those four get real
-- expected_version CAS wiring in this wave's follow-up commit.
--
-- version + increment_version_column() are added to all 5 tables uniformly
-- regardless of which endpoints will actively check it, so every row's API
-- response carries a consistent `version` field per the project-wide
-- convention (see migration 428) and no further schema migration is needed
-- if a future endpoint on these tables needs CAS too.
-- ============================================================

ALTER TABLE separation_clearances  ADD COLUMN IF NOT EXISTS version INT NOT NULL DEFAULT 1;
DROP TRIGGER IF EXISTS trg_separation_clearances_version ON separation_clearances;
CREATE TRIGGER trg_separation_clearances_version BEFORE UPDATE ON separation_clearances
  FOR EACH ROW EXECUTE FUNCTION increment_version_column();

ALTER TABLE separation_ff_summary  ADD COLUMN IF NOT EXISTS version INT NOT NULL DEFAULT 1;
DROP TRIGGER IF EXISTS trg_separation_ff_summary_version ON separation_ff_summary;
CREATE TRIGGER trg_separation_ff_summary_version BEFORE UPDATE ON separation_ff_summary
  FOR EACH ROW EXECUTE FUNCTION increment_version_column();

ALTER TABLE employee_separation    ADD COLUMN IF NOT EXISTS version INT NOT NULL DEFAULT 1;
DROP TRIGGER IF EXISTS trg_employee_separation_version ON employee_separation;
CREATE TRIGGER trg_employee_separation_version BEFORE UPDATE ON employee_separation
  FOR EACH ROW EXECUTE FUNCTION increment_version_column();

ALTER TABLE gratuity_config         ADD COLUMN IF NOT EXISTS version INT NOT NULL DEFAULT 1;
DROP TRIGGER IF EXISTS trg_gratuity_config_version ON gratuity_config;
CREATE TRIGGER trg_gratuity_config_version BEFORE UPDATE ON gratuity_config
  FOR EACH ROW EXECUTE FUNCTION increment_version_column();

ALTER TABLE clearance_departments   ADD COLUMN IF NOT EXISTS version INT NOT NULL DEFAULT 1;
DROP TRIGGER IF EXISTS trg_clearance_departments_version ON clearance_departments;
CREATE TRIGGER trg_clearance_departments_version BEFORE UPDATE ON clearance_departments
  FOR EACH ROW EXECUTE FUNCTION increment_version_column();
