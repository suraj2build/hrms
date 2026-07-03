-- =============================================================================
-- Migration 357: G2 — recursive manager hierarchy function + supporting index
--
-- Phase C readiness: GATE-1 item G2
--
-- Problem: getDirectReportIds() in manager-scope.ts fires a flat
-- eq('manager_id', ...) query — one level only. In a 6-level org, a
-- Regional Head (Level 3) can only see their Level-4 direct reports, not
-- the ~500 employees in their full subtree. This silently corrupts
-- WP2-2.9 (approval routing appears to work for direct reports only) and
-- WP3-3.11 (cluster manager visibility).
--
-- Fix:
--   1. Postgres function get_all_subordinates() using WITH RECURSIVE to
--      traverse the full manager hierarchy up to max_depth levels.
--      Depth-limited to prevent infinite loops from any accidental cycle.
--   2. Supporting partial index (tenant_id, manager_id) WHERE status='active'
--      to make the recursive join efficient at 5,000 employees.
--
-- The application layer calls this via supabase.rpc('get_all_subordinates').
--
-- NOTE: CONCURRENTLY omitted — migrations run inside transaction blocks.
-- =============================================================================

-- Supporting index: makes the recursive JOIN efficient at scale.
-- Covers: WHERE tenant_id = $1 AND manager_id = $2 AND status = 'active'
CREATE INDEX IF NOT EXISTS idx_employees_manager_tenant_status
  ON employees (tenant_id, manager_id)
  WHERE status = 'active';

-- Recursive hierarchy traversal function.
-- Returns all subordinates of p_manager_id up to p_max_depth levels deep.
-- p_max_depth default 10 is well beyond any realistic org depth (6 at target
-- customer) and acts as a cycle-breaker for any accidental manager_id cycles.
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
      AND  e.status     = 'active'

    UNION ALL

    -- Recursive case: next level down
    SELECT e.id,
           s.depth + 1
    FROM   employees    e
    JOIN   subordinates s ON e.manager_id = s.id
    WHERE  e.tenant_id = p_tenant_id
      AND  e.status    = 'active'
      AND  s.depth     < p_max_depth   -- cycle / depth guard
  )
  SELECT id, depth FROM subordinates;
$$;
