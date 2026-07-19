-- ═══════════════════════════════════════════════════════════════
-- 380 — get_active_employees_for_payroll
--
-- Returns every active employee for a tenant as a single JSON array.
-- Called via supabase.rpc() from the payroll dry-run and live-run paths.
--
-- Why a function instead of .range() pagination over /rest/v1/employees:
--   * The whole result is one JSON value in one response row, so PostgREST
--     row caps (max_rows) can never truncate it.
--   * RPC calls are POSTs, which always execute on the primary database —
--     immune to any stale read routing on GET requests.
--   * One round-trip regardless of headcount (2,877 employees ≈ 300 KB).
-- ═══════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION get_active_employees_for_payroll(p_tenant_id UUID)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN COALESCE(
    (SELECT json_agg(row_to_json(e))
     FROM (
       SELECT id, first_name, last_name, employee_code
       FROM employees
       WHERE tenant_id = p_tenant_id
         AND status = 'active'
       ORDER BY employee_code
     ) e),
    '[]'::json
  );
END;
$$;

-- The API calls this with the service-role key only; keep anon/authenticated out.
REVOKE EXECUTE ON FUNCTION get_active_employees_for_payroll(UUID) FROM anon, authenticated;
GRANT  EXECUTE ON FUNCTION get_active_employees_for_payroll(UUID) TO service_role;
