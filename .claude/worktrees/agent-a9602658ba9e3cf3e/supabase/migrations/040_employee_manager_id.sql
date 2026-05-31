-- ============================================================
-- 040_employee_manager_id.sql
-- Add manager_id (self-reference FK) to the employees table
-- for live reporting-structure and approval routing.
--
-- Why a dedicated column instead of relying on job_history.manager_id:
--   - job_history.manager_id tracks the HISTORICAL manager at each
--     job change point.  For real-time approval routing we need a
--     single authoritative "who is this person's manager RIGHT NOW"
--     that can be read without joining job_history.
--   - The two are kept in sync by the application layer when a new
--     job_history row is inserted.
-- ============================================================

ALTER TABLE employees
  ADD COLUMN IF NOT EXISTS manager_id UUID
    REFERENCES employees(id) ON DELETE SET NULL;

-- Index for fast "give me all direct reports of manager X" queries
CREATE INDEX IF NOT EXISTS idx_employees_manager
  ON employees (tenant_id, manager_id)
  WHERE manager_id IS NOT NULL;

-- ── Circular reference prevention ─────────────────────────────────────────────
-- A simple DB-level guard: prevents an employee from being set as their own
-- manager.  Deeper cycle detection (A→B→A) is handled in the application
-- layer (see manager.ts route).  The CHECK constraint alone cannot traverse
-- chains, but it covers the most common mistake.
ALTER TABLE employees
  ADD CONSTRAINT employees_no_self_manager
    CHECK (manager_id IS NULL OR manager_id != id);

-- ── RLS — no new policy needed ────────────────────────────────────────────────
-- manager_id is a column on the employees table which already has RLS policies
-- in migration 002 (tenant-scoped read) and subsequent migrations.
-- The existing policies automatically cover this column.

-- ── Comment ──────────────────────────────────────────────────────────────────
COMMENT ON COLUMN employees.manager_id IS
  'Direct reporting manager (self-reference FK).  Used for approval routing. '
  'Kept in sync with job_history.manager_id when a new job_history row is inserted.';
