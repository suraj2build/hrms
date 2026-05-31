-- ============================================================
-- 154_workforce_governance.sql
--
-- Workforce Governance Formalization
--
-- Canonizes the policy-driven workforce governance model:
--
--   Roster Policy   → determines WHETHER employee works
--   Rotation Policy → determines WHICH shift applies
--   Shift Master    → defines HOW that shift behaves
--   Attendance Eng  → computes expected vs actual attendance
--
-- Schema is largely complete from prior migrations.
-- This migration:
--   1. Adds comment markers formalizing the governance hierarchy
--   2. Deprecates sites.default_shift_id (replaced by rotation policy)
--   3. Adds default_rotation_policy_id to sites (already added in 153,
--      this ensures column exists idempotently with COMMENT)
--   4. Adds rotation_policy_id to employees (already added in 153,
--      documented here as the employee-level governance override)
--   5. Adds missing indexes for governance queries
-- ============================================================

-- ── Deprecate sites.default_shift_id ─────────────────────────────────────────
-- The primary shift scheduling pathway is now:
--   Roster Policy → Rotation Policy → Shift Master
--
-- sites.default_shift_id was the legacy 3rd-priority fallback before rotation
-- policies were introduced. It is now DEPRECATED as a scheduling mechanism.
-- Preserved for backward compatibility; will be removed after data migration.

COMMENT ON COLUMN sites.default_shift_id IS
  'DEPRECATED (migration 154): Legacy default shift fallback.
   Replaced by sites.default_rotation_policy_id + rotation_policy_rules.
   Kept for backward compatibility only. Do NOT use for new assignments.';

-- ── Formalize governance columns on sites ─────────────────────────────────────

COMMENT ON COLUMN sites.default_roster_id IS
  'Workforce Governance: Default Roster Policy for all employees at this site.
   Determines the 7×5 weekly-off matrix (whether employees work on each day).
   Employees can override via employees.roster_id.
   Priority: employees.roster_id  >  sites.default_roster_id';

COMMENT ON COLUMN sites.default_rotation_policy_id IS
  'Workforce Governance: Default Rotation Policy for all employees at this site.
   Determines which Shift Master applies per working condition (weekday/saturday/sunday).
   Employees can override via employees.rotation_policy_id.
   Priority: employees.rotation_policy_id  >  sites.default_rotation_policy_id';

-- ── Formalize governance columns on employees ─────────────────────────────────

COMMENT ON COLUMN employees.roster_id IS
  'Workforce Governance: Employee-level Roster Policy override.
   If set, overrides sites.default_roster_id for this employee.
   Null = inherit from site.';

COMMENT ON COLUMN employees.rotation_policy_id IS
  'Workforce Governance: Employee-level Rotation Policy override.
   If set, overrides sites.default_rotation_policy_id for this employee.
   Null = inherit from site.';

-- ── Index: employees lookup by governance policy ──────────────────────────────

CREATE INDEX IF NOT EXISTS idx_employees_roster_governance
  ON employees (tenant_id, roster_id)
  WHERE roster_id IS NOT NULL;

-- idx_employees_rotation_policy already created in migration 153

-- ── employee_shifts becomes SHIFT OVERRIDES ───────────────────────────────────
-- The employee_shifts table is repurposed:
--   OLD CONCEPT: "primary shift assignment" (default scheduling mechanism)
--   NEW CONCEPT: "Shift Override" (exception-only — temp adjustments, emergency coverage)
--
-- Primary scheduling now flows through Roster + Rotation policies.
-- employee_shifts records are only created when a specific employee needs a
-- temporary or exceptional shift that differs from the rotation-policy resolution.

COMMENT ON TABLE employee_shifts IS
  'Shift Overrides (migration 154): Exception-only shift assignments for temporary,
   emergency, or special-case coverage. NOT the primary scheduling mechanism.
   Primary scheduling is governed by: roster_policy → rotation_policy → shift_master.
   Use shift_roster for date-level overrides; use this for multi-day standing exceptions.';

-- ── Governance resolution summary (informational) ─────────────────────────────
-- Runtime shift resolution priority (highest to lowest):
--   1. shift_roster      (date-specific override — highest priority)
--   2. rotation_policy   (employee override → site default → condition→shift mapping)
--   3. employee_shifts   (standing Shift Override — exception only)
--   4. sites.default_shift_id  (DEPRECATED — legacy fallback, ignore for new setups)
