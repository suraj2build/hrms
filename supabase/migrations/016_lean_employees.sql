-- ============================================================
-- 016_lean_employees.sql
-- Remove legacy columns from the employees table.
--
-- PRE-REQUISITE: Run migrations 010–015 first.
-- Run this migration AFTER migrating any existing employee data
-- to the new dedicated tables (personal_info, bank_statutory, etc.)
--
-- The lean employees table retains only identity and status columns.
-- All personal, statutory, and org columns move to dedicated tables.
-- ============================================================

-- Add proper FK column for work location (replaces TEXT column)
ALTER TABLE employees
  ADD COLUMN IF NOT EXISTS work_location_id UUID
    REFERENCES work_locations(id) ON DELETE SET NULL;

-- --------------------------------------------------------
-- DROP LEGACY COLUMNS
-- (safe to run; IF EXISTS guards against re-runs)
-- --------------------------------------------------------

-- Org structure columns → now in job_history
ALTER TABLE employees DROP COLUMN IF EXISTS department_id;
ALTER TABLE employees DROP COLUMN IF EXISTS designation_id;
ALTER TABLE employees DROP COLUMN IF EXISTS grade_id;

-- employees_manager_team (007_rls_policies.sql) reads manager_id directly —
-- drop it before the column, or a fresh `supabase db reset` fails with
-- "cannot drop column manager_id ... other objects depend on it". manager_id
-- itself is re-added by a later migration (job_history's own manager_id
-- column is separate), so this policy would need re-creating there anyway
-- once the column exists again — harmless to drop it here.
DROP POLICY IF EXISTS employees_manager_team ON employees;
ALTER TABLE employees DROP COLUMN IF EXISTS manager_id;
ALTER TABLE employees DROP COLUMN IF EXISTS employment_type;
ALTER TABLE employees DROP COLUMN IF EXISTS work_location;      -- TEXT version replaced by work_location_id FK
ALTER TABLE employees DROP COLUMN IF EXISTS confirmation_date;  -- moved to job_history

-- JSONB blobs → now in normalized tables
ALTER TABLE employees DROP COLUMN IF EXISTS address;            -- → employee_addresses
ALTER TABLE employees DROP COLUMN IF EXISTS emergency_contact;  -- → emergency_contacts
ALTER TABLE employees DROP COLUMN IF EXISTS bank_details;       -- → employee_bank_statutory

-- Statutory fields → now in employee_bank_statutory
ALTER TABLE employees DROP COLUMN IF EXISTS pan_number;
ALTER TABLE employees DROP COLUMN IF EXISTS aadhaar_last4;
ALTER TABLE employees DROP COLUMN IF EXISTS uan_number;
ALTER TABLE employees DROP COLUMN IF EXISTS esi_number;

-- Personal info → now in employee_personal_info
ALTER TABLE employees DROP COLUMN IF EXISTS gender;
ALTER TABLE employees DROP COLUMN IF EXISTS dob;
ALTER TABLE employees DROP COLUMN IF EXISTS blood_group;
ALTER TABLE employees DROP COLUMN IF EXISTS nationality;
ALTER TABLE employees DROP COLUMN IF EXISTS profile_photo;

-- --------------------------------------------------------
-- RESULT: lean employees table has these columns only:
--   id, tenant_id, employee_code,
--   first_name, last_name, email, phone,
--   joining_date, status, work_location_id,
--   created_by, updated_at, created_at
-- --------------------------------------------------------

-- Add index on work_location_id
CREATE INDEX IF NOT EXISTS idx_employees_work_location
  ON employees (tenant_id, work_location_id);

-- --------------------------------------------------------
-- COMMENT for documentation
-- --------------------------------------------------------
COMMENT ON TABLE employees IS
  'Lean employee identity table. Personal info → employee_personal_info. '
  'Job info → job_history. Compensation → employee_compensations. '
  'Bank/Statutory → employee_bank_statutory.';
