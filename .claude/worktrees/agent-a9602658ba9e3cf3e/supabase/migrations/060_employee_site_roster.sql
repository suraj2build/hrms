-- ============================================================
-- 060_employee_site_roster.sql
--
-- Step 4: Link employees to sites and rosters.
--
-- site_id   — which physical site the employee works at (nullable).
--             Controls site-specific holiday applicability.
--
-- roster_id — override work pattern for this employee (nullable).
--             When set, the roster's weekly_off_days are used as the
--             weekly-off source if the employee has no explicit shift
--             assignment.  Falls back to global defaults when NULL.
--
-- Both columns are nullable for full backward compatibility.
-- Existing employees without a site / roster continue to use
-- global-holiday + shift-based weekly-off logic unchanged.
-- ============================================================

ALTER TABLE employees
  ADD COLUMN IF NOT EXISTS site_id   UUID NULL REFERENCES sites(id)   ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS roster_id UUID NULL REFERENCES rosters(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_employees_site_id
  ON employees (tenant_id, site_id)
  WHERE site_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_employees_roster_id
  ON employees (tenant_id, roster_id)
  WHERE roster_id IS NOT NULL;
