-- ============================================================
-- 428_optimistic_locking_version_column.sql
--
-- PEND-105 (Phase A) — optimistic-concurrency-control schema.
--
-- Every PUT/PATCH masters/employee-profile endpoint does a blind
-- last-write-wins UPDATE today: fetch → edit in the browser → write, with
-- no check that the row hasn't changed underneath the user since it was
-- fetched. Two admins editing the same cost centre, salary structure, or
-- employee record concurrently silently clobber each other — the second
-- write wins with no error, no merge, no signal that anything was lost.
--
-- Standardizing on a dedicated `version INT` column + trigger for ALL 41
-- tables below, rather than reusing each table's own `updated_at` (13 of
-- them already have a working trigger; the audit for this project also
-- found 5 tables where `updated_at` exists but is silently dead — never
-- written by trigger OR app code). One column, one trigger function,
-- applied uniformly, means the backend CAS check and frontend conflict
-- handling are byte-identical across every endpoint — no per-table
-- branching to get wrong, and no dependency on each table's pre-existing
-- (and, per the above, inconsistent) `updated_at` hygiene.
--
-- PATTERN
-- -------
-- 1. ADD COLUMN IF NOT EXISTS version INT NOT NULL DEFAULT 1 — every
--    existing row starts at version 1; the first edit from an already-open
--    browser tab (which read version 1) still succeeds normally.
-- 2. CREATE TRIGGER ... BEFORE UPDATE ... EXECUTE FUNCTION
--    increment_version_column() — the DB always bumps version by exactly
--    1 per UPDATE, so the app never sets/increments it itself and can't
--    get it wrong.
--
-- Backend (Phase B, follow-up commits) reads `version` in the row's
-- response shape, requires `expected_version` in the PUT/PATCH body, and
-- adds `.eq('version', expected_version)` to the UPDATE's WHERE clause —
-- a stale write matches 0 rows and the route returns 409 VERSION_CONFLICT
-- instead of silently overwriting. The trigger then bumps version on the
-- write that DID win, so the next stale writer is caught too.
--
-- SCOPE — 41 tables, matching every plain field-edit PUT/PATCH endpoint
-- across apps/api/src/routes/masters/*.ts and the employee-profile route
-- files (apps/api/src/routes/employees/*.ts).
--
-- DEFERRED — apps/api/src/routes/employees/separation-workflow.ts (7
-- status-transition endpoints on separation_clearances/
-- separation_ff_summary/employee_separation) plus separation.ts's sibling
-- PUT /employees/:id/separation, plus clearance-departments and
-- gratuity-config. These are status-machine transitions, not field edits
-- — they already carry a WHERE-clause status-guard as a de facto
-- optimistic lock (fixed earlier this audit series: ISSUE-219/246/249 and
-- others), which closes the specific "two actors both act on the same
-- PENDING row" race this project targets. Layering `version` on top is
-- legitimate defense-in-depth for the narrower "two edits to different
-- fields of the same row" case, but is left to its own follow-up wave so
-- this migration stays a single reviewable unit.
--
-- 4 tables in this list (employee_bank_statutory, employee_personal_info,
-- compensation_policies, and gratuity_config — the last deferred above)
-- are written via .upsert() rather than .update(). A plain
-- .eq('version', expected_version) WHERE-clause CAS check does not apply
-- to an INSERT ... ON CONFLICT DO UPDATE the way it does to a plain
-- UPDATE — Phase B handles these 3 remaining upsert endpoints with an
-- explicit "SELECT ... FOR UPDATE, check version, then UPDATE-or-INSERT"
-- rewrite instead of Supabase's .upsert() helper. The version column and
-- trigger are still needed on these tables regardless of that rewrite.
-- ============================================================

CREATE OR REPLACE FUNCTION increment_version_column()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.version = OLD.version + 1;
  RETURN NEW;
END;
$$;

-- Sibling trigger fn for the 2 tables (leave_policy_masters,
-- attendance_policies) whose own `version` column already means something
-- else (see below) — bumps `cas_version` instead, leaving `version` alone.
CREATE OR REPLACE FUNCTION increment_cas_version_column()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.cas_version = OLD.cas_version + 1;
  RETURN NEW;
END;
$$;

-- ── Group A tables (13) — already have a trigger-maintained updated_at;
--    version is added alongside it for a uniform CAS token across all 41 ──

ALTER TABLE clusters               ADD COLUMN IF NOT EXISTS version INT NOT NULL DEFAULT 1;
DROP TRIGGER IF EXISTS trg_clusters_version ON clusters;
CREATE TRIGGER trg_clusters_version BEFORE UPDATE ON clusters
  FOR EACH ROW EXECUTE FUNCTION increment_version_column();

ALTER TABLE important_date_types   ADD COLUMN IF NOT EXISTS version INT NOT NULL DEFAULT 1;
DROP TRIGGER IF EXISTS trg_important_date_types_version ON important_date_types;
CREATE TRIGGER trg_important_date_types_version BEFORE UPDATE ON important_date_types
  FOR EACH ROW EXECUTE FUNCTION increment_version_column();

ALTER TABLE leave_policies         ADD COLUMN IF NOT EXISTS version INT NOT NULL DEFAULT 1;
DROP TRIGGER IF EXISTS trg_leave_policies_version ON leave_policies;
CREATE TRIGGER trg_leave_policies_version BEFORE UPDATE ON leave_policies
  FOR EACH ROW EXECUTE FUNCTION increment_version_column();

-- leave_policy_masters ALREADY has a `version INT` column (migration 075) —
-- but it's a business-semantic draft→published governance counter (exposed
-- via GET, driving POST /:id/rollback/:version and leave_policy_versions
-- snapshots), bumped explicitly by app code only on publish, NOT a CAS
-- token. Reusing that column for optimistic-locking would mean an ordinary
-- field edit silently increments the "published version number" via our
-- trigger, corrupting the rollback/version-history feature. Use a
-- distinctly-named `cas_version` column for this table instead.
ALTER TABLE leave_policy_masters   ADD COLUMN IF NOT EXISTS cas_version INT NOT NULL DEFAULT 1;
DROP TRIGGER IF EXISTS trg_leave_policy_masters_version ON leave_policy_masters;
CREATE TRIGGER trg_leave_policy_masters_version BEFORE UPDATE ON leave_policy_masters
  FOR EACH ROW EXECUTE FUNCTION increment_cas_version_column();

ALTER TABLE leave_policy_rules     ADD COLUMN IF NOT EXISTS version INT NOT NULL DEFAULT 1;
DROP TRIGGER IF EXISTS trg_leave_policy_rules_version ON leave_policy_rules;
CREATE TRIGGER trg_leave_policy_rules_version BEFORE UPDATE ON leave_policy_rules
  FOR EACH ROW EXECUTE FUNCTION increment_version_column();

ALTER TABLE rosters                ADD COLUMN IF NOT EXISTS version INT NOT NULL DEFAULT 1;
DROP TRIGGER IF EXISTS trg_rosters_version ON rosters;
CREATE TRIGGER trg_rosters_version BEFORE UPDATE ON rosters
  FOR EACH ROW EXECUTE FUNCTION increment_version_column();

ALTER TABLE rotation_policies      ADD COLUMN IF NOT EXISTS version INT NOT NULL DEFAULT 1;
DROP TRIGGER IF EXISTS trg_rotation_policies_version ON rotation_policies;
CREATE TRIGGER trg_rotation_policies_version BEFORE UPDATE ON rotation_policies
  FOR EACH ROW EXECUTE FUNCTION increment_version_column();

ALTER TABLE sites                  ADD COLUMN IF NOT EXISTS version INT NOT NULL DEFAULT 1;
DROP TRIGGER IF EXISTS trg_sites_version ON sites;
CREATE TRIGGER trg_sites_version BEFORE UPDATE ON sites
  FOR EACH ROW EXECUTE FUNCTION increment_version_column();

ALTER TABLE states                 ADD COLUMN IF NOT EXISTS version INT NOT NULL DEFAULT 1;
DROP TRIGGER IF EXISTS trg_states_version ON states;
CREATE TRIGGER trg_states_version BEFORE UPDATE ON states
  FOR EACH ROW EXECUTE FUNCTION increment_version_column();

ALTER TABLE employees               ADD COLUMN IF NOT EXISTS version INT NOT NULL DEFAULT 1;
DROP TRIGGER IF EXISTS trg_employees_version ON employees;
CREATE TRIGGER trg_employees_version BEFORE UPDATE ON employees
  FOR EACH ROW EXECUTE FUNCTION increment_version_column();

ALTER TABLE employee_bank_statutory ADD COLUMN IF NOT EXISTS version INT NOT NULL DEFAULT 1;
DROP TRIGGER IF EXISTS trg_employee_bank_statutory_version ON employee_bank_statutory;
CREATE TRIGGER trg_employee_bank_statutory_version BEFORE UPDATE ON employee_bank_statutory
  FOR EACH ROW EXECUTE FUNCTION increment_version_column();

ALTER TABLE employee_personal_info  ADD COLUMN IF NOT EXISTS version INT NOT NULL DEFAULT 1;
DROP TRIGGER IF EXISTS trg_employee_personal_info_version ON employee_personal_info;
CREATE TRIGGER trg_employee_personal_info_version BEFORE UPDATE ON employee_personal_info
  FOR EACH ROW EXECUTE FUNCTION increment_version_column();

-- ── Group B tables (3) — updated_at exists, app-set, no trigger ─────────

-- attendance_policies ALREADY has a `version INT` column (migration 075,
-- "same model" as leave_policy_masters above) — same business-semantic
-- publish-governance counter, same reason to keep it untouched.
ALTER TABLE attendance_policies     ADD COLUMN IF NOT EXISTS cas_version INT NOT NULL DEFAULT 1;
DROP TRIGGER IF EXISTS trg_attendance_policies_version ON attendance_policies;
CREATE TRIGGER trg_attendance_policies_version BEFORE UPDATE ON attendance_policies
  FOR EACH ROW EXECUTE FUNCTION increment_cas_version_column();

ALTER TABLE employee_passport_visa  ADD COLUMN IF NOT EXISTS version INT NOT NULL DEFAULT 1;
DROP TRIGGER IF EXISTS trg_employee_passport_visa_version ON employee_passport_visa;
CREATE TRIGGER trg_employee_passport_visa_version BEFORE UPDATE ON employee_passport_visa
  FOR EACH ROW EXECUTE FUNCTION increment_version_column();

ALTER TABLE compensation_policies   ADD COLUMN IF NOT EXISTS version INT NOT NULL DEFAULT 1;
DROP TRIGGER IF EXISTS trg_compensation_policies_version ON compensation_policies;
CREATE TRIGGER trg_compensation_policies_version BEFORE UPDATE ON compensation_policies
  FOR EACH ROW EXECUTE FUNCTION increment_version_column();

-- ── Group C tables (4) — updated_at column is dead (independent bug,
--    not fixed here — out of scope for a CAS-only migration; flagged in
--    AUDIT_CONSTITUTION.md) ────────────────────────────────────────────

ALTER TABLE asset_categories        ADD COLUMN IF NOT EXISTS version INT NOT NULL DEFAULT 1;
DROP TRIGGER IF EXISTS trg_asset_categories_version ON asset_categories;
CREATE TRIGGER trg_asset_categories_version BEFORE UPDATE ON asset_categories
  FOR EACH ROW EXECUTE FUNCTION increment_version_column();

ALTER TABLE employment_categories   ADD COLUMN IF NOT EXISTS version INT NOT NULL DEFAULT 1;
DROP TRIGGER IF EXISTS trg_employment_categories_version ON employment_categories;
CREATE TRIGGER trg_employment_categories_version BEFORE UPDATE ON employment_categories
  FOR EACH ROW EXECUTE FUNCTION increment_version_column();

ALTER TABLE payroll_groups          ADD COLUMN IF NOT EXISTS version INT NOT NULL DEFAULT 1;
DROP TRIGGER IF EXISTS trg_payroll_groups_version ON payroll_groups;
CREATE TRIGGER trg_payroll_groups_version BEFORE UPDATE ON payroll_groups
  FOR EACH ROW EXECUTE FUNCTION increment_version_column();

ALTER TABLE statutory_groups        ADD COLUMN IF NOT EXISTS version INT NOT NULL DEFAULT 1;
DROP TRIGGER IF EXISTS trg_statutory_groups_version ON statutory_groups;
CREATE TRIGGER trg_statutory_groups_version BEFORE UPDATE ON statutory_groups
  FOR EACH ROW EXECUTE FUNCTION increment_version_column();

-- ── Group D tables (21) — no updated_at/version column at all today ────

ALTER TABLE cost_centers               ADD COLUMN IF NOT EXISTS version INT NOT NULL DEFAULT 1;
DROP TRIGGER IF EXISTS trg_cost_centers_version ON cost_centers;
CREATE TRIGGER trg_cost_centers_version BEFORE UPDATE ON cost_centers
  FOR EACH ROW EXECUTE FUNCTION increment_version_column();

ALTER TABLE document_types             ADD COLUMN IF NOT EXISTS version INT NOT NULL DEFAULT 1;
DROP TRIGGER IF EXISTS trg_document_types_version ON document_types;
CREATE TRIGGER trg_document_types_version BEFORE UPDATE ON document_types
  FOR EACH ROW EXECUTE FUNCTION increment_version_column();

ALTER TABLE grades                     ADD COLUMN IF NOT EXISTS version INT NOT NULL DEFAULT 1;
DROP TRIGGER IF EXISTS trg_grades_version ON grades;
CREATE TRIGGER trg_grades_version BEFORE UPDATE ON grades
  FOR EACH ROW EXECUTE FUNCTION increment_version_column();

ALTER TABLE roster_holiday_groups      ADD COLUMN IF NOT EXISTS version INT NOT NULL DEFAULT 1;
DROP TRIGGER IF EXISTS trg_roster_holiday_groups_version ON roster_holiday_groups;
CREATE TRIGGER trg_roster_holiday_groups_version BEFORE UPDATE ON roster_holiday_groups
  FOR EACH ROW EXECUTE FUNCTION increment_version_column();

ALTER TABLE holiday_calendar           ADD COLUMN IF NOT EXISTS version INT NOT NULL DEFAULT 1;
DROP TRIGGER IF EXISTS trg_holiday_calendar_version ON holiday_calendar;
CREATE TRIGGER trg_holiday_calendar_version BEFORE UPDATE ON holiday_calendar
  FOR EACH ROW EXECUTE FUNCTION increment_version_column();

ALTER TABLE identity_types             ADD COLUMN IF NOT EXISTS version INT NOT NULL DEFAULT 1;
DROP TRIGGER IF EXISTS trg_identity_types_version ON identity_types;
CREATE TRIGGER trg_identity_types_version BEFORE UPDATE ON identity_types
  FOR EACH ROW EXECUTE FUNCTION increment_version_column();

ALTER TABLE leave_types                ADD COLUMN IF NOT EXISTS version INT NOT NULL DEFAULT 1;
DROP TRIGGER IF EXISTS trg_leave_types_version ON leave_types;
CREATE TRIGGER trg_leave_types_version BEFORE UPDATE ON leave_types
  FOR EACH ROW EXECUTE FUNCTION increment_version_column();

ALTER TABLE relationship_types         ADD COLUMN IF NOT EXISTS version INT NOT NULL DEFAULT 1;
DROP TRIGGER IF EXISTS trg_relationship_types_version ON relationship_types;
CREATE TRIGGER trg_relationship_types_version BEFORE UPDATE ON relationship_types
  FOR EACH ROW EXECUTE FUNCTION increment_version_column();

ALTER TABLE salary_components          ADD COLUMN IF NOT EXISTS version INT NOT NULL DEFAULT 1;
DROP TRIGGER IF EXISTS trg_salary_components_version ON salary_components;
CREATE TRIGGER trg_salary_components_version BEFORE UPDATE ON salary_components
  FOR EACH ROW EXECUTE FUNCTION increment_version_column();

ALTER TABLE salary_structures          ADD COLUMN IF NOT EXISTS version INT NOT NULL DEFAULT 1;
DROP TRIGGER IF EXISTS trg_salary_structures_version ON salary_structures;
CREATE TRIGGER trg_salary_structures_version BEFORE UPDATE ON salary_structures
  FOR EACH ROW EXECUTE FUNCTION increment_version_column();

ALTER TABLE salary_structure_components ADD COLUMN IF NOT EXISTS version INT NOT NULL DEFAULT 1;
DROP TRIGGER IF EXISTS trg_salary_structure_components_version ON salary_structure_components;
CREATE TRIGGER trg_salary_structure_components_version BEFORE UPDATE ON salary_structure_components
  FOR EACH ROW EXECUTE FUNCTION increment_version_column();

ALTER TABLE shifts                     ADD COLUMN IF NOT EXISTS version INT NOT NULL DEFAULT 1;
DROP TRIGGER IF EXISTS trg_shifts_version ON shifts;
CREATE TRIGGER trg_shifts_version BEFORE UPDATE ON shifts
  FOR EACH ROW EXECUTE FUNCTION increment_version_column();

ALTER TABLE work_locations             ADD COLUMN IF NOT EXISTS version INT NOT NULL DEFAULT 1;
DROP TRIGGER IF EXISTS trg_work_locations_version ON work_locations;
CREATE TRIGGER trg_work_locations_version BEFORE UPDATE ON work_locations
  FOR EACH ROW EXECUTE FUNCTION increment_version_column();

ALTER TABLE employee_access_cards      ADD COLUMN IF NOT EXISTS version INT NOT NULL DEFAULT 1;
DROP TRIGGER IF EXISTS trg_employee_access_cards_version ON employee_access_cards;
CREATE TRIGGER trg_employee_access_cards_version BEFORE UPDATE ON employee_access_cards
  FOR EACH ROW EXECUTE FUNCTION increment_version_column();

ALTER TABLE employee_contracts         ADD COLUMN IF NOT EXISTS version INT NOT NULL DEFAULT 1;
DROP TRIGGER IF EXISTS trg_employee_contracts_version ON employee_contracts;
CREATE TRIGGER trg_employee_contracts_version BEFORE UPDATE ON employee_contracts
  FOR EACH ROW EXECUTE FUNCTION increment_version_column();

ALTER TABLE employee_education         ADD COLUMN IF NOT EXISTS version INT NOT NULL DEFAULT 1;
DROP TRIGGER IF EXISTS trg_employee_education_version ON employee_education;
CREATE TRIGGER trg_employee_education_version BEFORE UPDATE ON employee_education
  FOR EACH ROW EXECUTE FUNCTION increment_version_column();

ALTER TABLE emergency_contacts         ADD COLUMN IF NOT EXISTS version INT NOT NULL DEFAULT 1;
DROP TRIGGER IF EXISTS trg_emergency_contacts_version ON emergency_contacts;
CREATE TRIGGER trg_emergency_contacts_version BEFORE UPDATE ON emergency_contacts
  FOR EACH ROW EXECUTE FUNCTION increment_version_column();

ALTER TABLE employee_family             ADD COLUMN IF NOT EXISTS version INT NOT NULL DEFAULT 1;
DROP TRIGGER IF EXISTS trg_employee_family_version ON employee_family;
CREATE TRIGGER trg_employee_family_version BEFORE UPDATE ON employee_family
  FOR EACH ROW EXECUTE FUNCTION increment_version_column();

ALTER TABLE employee_nominations       ADD COLUMN IF NOT EXISTS version INT NOT NULL DEFAULT 1;
DROP TRIGGER IF EXISTS trg_employee_nominations_version ON employee_nominations;
CREATE TRIGGER trg_employee_nominations_version BEFORE UPDATE ON employee_nominations
  FOR EACH ROW EXECUTE FUNCTION increment_version_column();

ALTER TABLE previous_employment        ADD COLUMN IF NOT EXISTS version INT NOT NULL DEFAULT 1;
DROP TRIGGER IF EXISTS trg_previous_employment_version ON previous_employment;
CREATE TRIGGER trg_previous_employment_version BEFORE UPDATE ON previous_employment
  FOR EACH ROW EXECUTE FUNCTION increment_version_column();

ALTER TABLE exit_interview_questions   ADD COLUMN IF NOT EXISTS version INT NOT NULL DEFAULT 1;
DROP TRIGGER IF EXISTS trg_exit_interview_questions_version ON exit_interview_questions;
CREATE TRIGGER trg_exit_interview_questions_version BEFORE UPDATE ON exit_interview_questions
  FOR EACH ROW EXECUTE FUNCTION increment_version_column();

ALTER TABLE profiles                   ADD COLUMN IF NOT EXISTS version INT NOT NULL DEFAULT 1;
DROP TRIGGER IF EXISTS trg_profiles_version ON profiles;
CREATE TRIGGER trg_profiles_version BEFORE UPDATE ON profiles
  FOR EACH ROW EXECUTE FUNCTION increment_version_column();
