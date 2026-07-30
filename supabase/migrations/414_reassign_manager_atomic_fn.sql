-- ============================================================
-- 414_reassign_manager_atomic_fn.sql
--
-- PEND-68 (AUDIT_CONSTITUTION.md §14.6): PUT /employees/:id/manager's cycle
-- prevention is an application-layer chain-walk (read manager_id's manager
-- chain, reject if the target employee appears in it) followed by a
-- completely separate UPDATE — two independent round-trips with no lock or
-- transaction between them. Two concurrent PUTs that together form a cycle
-- (e.g. A's manager set to B while B's manager is concurrently set to A)
-- can each pass their own chain-walk before either UPDATE commits.
--
-- Fix: reassign_manager_atomic() does the chain-walk and the UPDATE inside
-- one transaction, serialized against every other manager reassignment for
-- the same tenant via a session-scoped (xact-scoped) advisory lock keyed on
-- the tenant id. A recursive chain-walk of arbitrary depth can't be
-- expressed as a single WHERE-folded UPDATE, so a tenant-wide serialization
-- point is the simplest fix that's still fully correct for this rare,
-- admin-only action.
-- ============================================================

CREATE OR REPLACE FUNCTION reassign_manager_atomic(
  p_tenant_id      UUID,
  p_employee_id    UUID,
  p_new_manager_id UUID,
  p_max_depth      INT DEFAULT 20
) RETURNS TABLE (
  outcome TEXT  -- 'updated' | 'not_found' | 'manager_not_found' | 'self_reference' | 'cycle'
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_exists BOOLEAN;
  v_cursor UUID;
  v_depth  INT := 0;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext(p_tenant_id::text));

  SELECT EXISTS(
    SELECT 1 FROM employees WHERE id = p_employee_id AND tenant_id = p_tenant_id
  ) INTO v_exists;
  IF NOT v_exists THEN
    RETURN QUERY SELECT 'not_found'::TEXT;
    RETURN;
  END IF;

  IF p_new_manager_id IS NOT NULL THEN
    IF p_new_manager_id = p_employee_id THEN
      RETURN QUERY SELECT 'self_reference'::TEXT;
      RETURN;
    END IF;

    SELECT EXISTS(
      SELECT 1 FROM employees WHERE id = p_new_manager_id AND tenant_id = p_tenant_id
    ) INTO v_exists;
    IF NOT v_exists THEN
      RETURN QUERY SELECT 'manager_not_found'::TEXT;
      RETURN;
    END IF;

    v_cursor := p_new_manager_id;
    WHILE v_cursor IS NOT NULL AND v_depth < p_max_depth LOOP
      IF v_cursor = p_employee_id THEN
        RETURN QUERY SELECT 'cycle'::TEXT;
        RETURN;
      END IF;
      SELECT manager_id INTO v_cursor FROM employees WHERE id = v_cursor AND tenant_id = p_tenant_id;
      v_depth := v_depth + 1;
    END LOOP;
  END IF;

  UPDATE employees
  SET    manager_id = p_new_manager_id, updated_at = now()
  WHERE  id = p_employee_id AND tenant_id = p_tenant_id;

  RETURN QUERY SELECT 'updated'::TEXT;
END;
$$;
