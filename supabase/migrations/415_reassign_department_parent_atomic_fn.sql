-- ============================================================
-- 415_reassign_department_parent_atomic_fn.sql
--
-- PEND-89 (AUDIT_CONSTITUTION.md §14.6): PUT /departments/:id's cycle guard
-- is the same shape as employees/manager.ts's (PEND-68) — an app-layer
-- ancestor-chain walk followed by a separate UPDATE, with no lock or
-- transaction tying them together. Two concurrent PUTs that together form
-- a cycle (set A's parent to B while B's parent is concurrently set to A)
-- can each pass their own walk before either UPDATE commits, silently
-- dropping both departments from Organization.tsx's tree (buildTree()
-- pushes each into the other's children and neither ends up in roots).
--
-- Fix: same pattern as reassign_manager_atomic() (migration 414) —
-- reassign_department_parent_atomic() does the ancestor-chain walk and the
-- parent_id UPDATE inside one transaction, serialized against every other
-- department reassignment for the same tenant via a tenant-keyed advisory
-- lock. Distinct lock key namespace (hashtext with a literal prefix) from
-- the manager-chain lock so the two independent invariants never
-- contend with each other.
-- ============================================================

CREATE OR REPLACE FUNCTION reassign_department_parent_atomic(
  p_tenant_id      UUID,
  p_department_id  UUID,
  p_new_parent_id  UUID,
  p_max_depth      INT DEFAULT 20
) RETURNS TABLE (
  outcome TEXT  -- 'updated' | 'not_found' | 'parent_not_found' | 'self_reference' | 'cycle'
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_exists BOOLEAN;
  v_cursor UUID;
  v_depth  INT := 0;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext('dept_parent:' || p_tenant_id::text));

  SELECT EXISTS(
    SELECT 1 FROM departments WHERE id = p_department_id AND tenant_id = p_tenant_id
  ) INTO v_exists;
  IF NOT v_exists THEN
    RETURN QUERY SELECT 'not_found'::TEXT;
    RETURN;
  END IF;

  IF p_new_parent_id IS NOT NULL THEN
    IF p_new_parent_id = p_department_id THEN
      RETURN QUERY SELECT 'self_reference'::TEXT;
      RETURN;
    END IF;

    SELECT EXISTS(
      SELECT 1 FROM departments WHERE id = p_new_parent_id AND tenant_id = p_tenant_id
    ) INTO v_exists;
    IF NOT v_exists THEN
      RETURN QUERY SELECT 'parent_not_found'::TEXT;
      RETURN;
    END IF;

    v_cursor := p_new_parent_id;
    WHILE v_cursor IS NOT NULL AND v_depth < p_max_depth LOOP
      IF v_cursor = p_department_id THEN
        RETURN QUERY SELECT 'cycle'::TEXT;
        RETURN;
      END IF;
      SELECT parent_id INTO v_cursor FROM departments WHERE id = v_cursor AND tenant_id = p_tenant_id;
      v_depth := v_depth + 1;
    END LOOP;
  END IF;

  UPDATE departments
  SET    parent_id = p_new_parent_id
  WHERE  id = p_department_id AND tenant_id = p_tenant_id;

  RETURN QUERY SELECT 'updated'::TEXT;
END;
$$;
