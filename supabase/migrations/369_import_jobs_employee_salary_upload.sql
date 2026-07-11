-- 369_import_jobs_employee_salary_upload.sql
--
-- Add 'employee_salary_upload' to the import_jobs master_type CHECK constraint.
-- This dynamic import type generates its template columns from the tenant's
-- salary_components at request time rather than a static template.

ALTER TABLE import_jobs
  DROP CONSTRAINT IF EXISTS import_jobs_master_type_check;

ALTER TABLE import_jobs
  ADD CONSTRAINT import_jobs_master_type_check
  CHECK (master_type IN (
    -- Original (migration 108)
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
    -- Added in migration 130
    'sites',
    'employee_compensation',
    'leave_opening_balances',
    'shift_assignments',
    'employment_categories',
    'statutory_groups',
    'asset_categories',
    -- Added in migration 135
    'compensation_revisions',
    'document_types',
    'identity_types',
    'relationship_types',
    -- Added in migration 361
    'rosters',
    'employee_bank_details',
    'states',
    'clusters',
    'holiday_groups',
    'important_date_types',
    'rotation_policies',
    'positions',
    -- Added in this migration
    'employee_salary_upload'
  ));
