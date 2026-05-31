-- 130_import_jobs_master_type_expand.sql
--
-- Extends the import_jobs.master_type CHECK constraint to include all types
-- that exist in MASTER_TEMPLATES (apps/api/src/lib/import-engine/templates.ts).
--
-- Root cause:
--   Migration 108 defined the constraint with 15 types.
--   Seven additional types were added to templates.ts without a corresponding
--   constraint update, causing "violates check constraint import_jobs_master_type_check"
--   whenever those types were used to create an import job.
--
-- Types added in this migration:
--   sites, employee_compensation, leave_opening_balances, shift_assignments,
--   employment_categories, statutory_groups, asset_categories
--
-- Types retained from migration 108 (DB-only, no template yet):
--   salary_structures, reimbursement_categories, roster_templates, notification_templates

ALTER TABLE import_jobs
  DROP CONSTRAINT IF EXISTS import_jobs_master_type_check;

ALTER TABLE import_jobs
  ADD CONSTRAINT import_jobs_master_type_check
  CHECK (master_type IN (
    -- Original 15 (migration 108)
    'employees',
    'shifts',
    'departments',
    'designations',
    'grades',
    'work_locations',
    'cost_centers',
    'salary_components',
    'salary_structures',
    'leave_types',
    'payroll_groups',
    'reimbursement_categories',
    'roster_templates',
    'notification_templates',
    'holiday_calendar',
    -- Added to templates.ts after migration 108
    'sites',
    'employee_compensation',
    'leave_opening_balances',
    'shift_assignments',
    'employment_categories',
    'statutory_groups',
    'asset_categories'
  ));
