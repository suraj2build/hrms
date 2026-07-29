-- =============================================================================
-- Migration 404: get_all_subordinates() must include 'on_notice' employees
--
-- Problem: migration 357's get_all_subordinates() hardcodes
-- `e.status = 'active'` in BOTH the base case and the recursive case. The
-- codebase has an established convention that "still employed" means
-- status IN ('active', 'on_notice') — already applied to executive
-- headcount metrics (see "Align executive headcount metrics with
-- active+on_notice SSOT convention"). This function was never brought in
-- line with that convention.
--
-- Effect: getDirectReportIds()/getAllSubordinateIds() (manager-scope.ts),
-- which call this RPC, silently drop every on_notice direct report from a
-- manager's "my team" set — and because the exclusion also applies to the
-- recursive case, an on_notice employee's own subordinates never enter the
-- CTE at all, dropping their entire subtree too. Concretely this causes:
--   - false 403 "not your direct report" on leave/regularisation approval
--     endpoints for an employee serving their notice period (exactly when
--     their pending leave/regularisation approvals matter most)
--   - team payroll-cost and team-assets dashboards silently undercounting/
--     omitting on-notice employees, while those same dashboards' HR-admin
--     branches already correctly include on_notice via an explicit
--     .in('status', ['active', 'on_notice']) filter — an inconsistency
--     between the two branches of the same endpoint.
--
-- Fix: broaden the status filter to ('active', 'on_notice') in both the
-- base case and the recursive case, and update the supporting partial
-- index to match (a partial index's WHERE clause must match the query
-- predicate to be used).
-- =============================================================================

DROP INDEX IF EXISTS idx_employees_manager_tenant_status;

CREATE INDEX IF NOT EXISTS idx_employees_manager_tenant_status
  ON employees (tenant_id, manager_id)
  WHERE status IN ('active', 'on_notice');

CREATE OR REPLACE FUNCTION get_all_subordinates(
  p_manager_id UUID,
  p_tenant_id  UUID,
  p_max_depth  INT DEFAULT 10
)
RETURNS TABLE (id UUID, depth INT)
LANGUAGE sql
STABLE
SECURITY DEFINER
AS $$
  WITH RECURSIVE subordinates AS (
    -- Base case: immediate direct reports
    SELECT e.id,
           1 AS depth
    FROM   employees e
    WHERE  e.manager_id = p_manager_id
      AND  e.tenant_id  = p_tenant_id
      AND  e.status     IN ('active', 'on_notice')

    UNION ALL

    -- Recursive case: next level down
    SELECT e.id,
           s.depth + 1
    FROM   employees    e
    JOIN   subordinates s ON e.manager_id = s.id
    WHERE  e.tenant_id = p_tenant_id
      AND  e.status    IN ('active', 'on_notice')
      AND  s.depth     < p_max_depth   -- cycle / depth guard
  )
  SELECT id, depth FROM subordinates;
$$;
