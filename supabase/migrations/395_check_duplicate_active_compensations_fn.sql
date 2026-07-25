-- Fresh audit finding (payroll/statutory pass): the ops-dashboard's
-- "single_active_compensation_per_employee" health check
-- (routes/payroll/ops-dashboard.ts) calls a function,
-- check_duplicate_active_compensations(p_tenant_id), that does not exist
-- anywhere in this migration history. The RPC call therefore always errors;
-- the route discards the error unchecked (`const { data: multiCompRows } =
-- await fastify.supabase.rpc(...)`), so multiCompIssues is always [], and the
-- check always silently reports 'pass' regardless of whether duplicate
-- active compensations actually exist — the exact scenario ISSUE-143's
-- compensation-revision fix (this same session) was closing off going
-- forward, but pre-existing/historical duplicates from before that fix, or
-- from any other write path, would never be caught by this health check.
--
-- Implements the function the route already expects: one row per employee
-- with more than one is_active=true employee_compensations row.

CREATE OR REPLACE FUNCTION check_duplicate_active_compensations(p_tenant_id UUID)
RETURNS TABLE (
  employee_id   UUID,
  active_count  BIGINT
)
LANGUAGE sql
STABLE
SECURITY DEFINER
AS $$
  SELECT ec.employee_id, COUNT(*) AS active_count
  FROM   employee_compensations ec
  WHERE  ec.tenant_id = p_tenant_id
    AND  ec.is_active  = true
  GROUP BY ec.employee_id
  HAVING COUNT(*) > 1;
$$;
