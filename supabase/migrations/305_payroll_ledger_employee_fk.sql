-- Migration 305: add the employee FK PostgREST needs for ledger exports
--
-- payroll_ledger_entries.employee_id exists but has no FK constraint, so the
-- export query's `employees ( ... )` embed 500s with "could not find a
-- relationship". Add the FK. NOT VALID skips validation of existing rows
-- (some entries are aggregate/employer-level with NULL or legacy employee_id)
-- while still establishing the relationship for PostgREST and enforcing it on
-- new rows.

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'payroll_ledger_entries_employee_id_fkey'
  ) THEN
    ALTER TABLE payroll_ledger_entries
      ADD CONSTRAINT payroll_ledger_entries_employee_id_fkey
      FOREIGN KEY (employee_id) REFERENCES employees(id) ON DELETE SET NULL NOT VALID;
  END IF;
END $$;
