-- ============================================================
-- 409_salary_component_delete_atomic_fn.sql
--
-- PEND-62 (AUDIT_CONSTITUTION.md §14.6): deleteComponent() counted
-- references in salary_structure_components, then hard-deleted the
-- component only when the count was 0 (soft-deactivating otherwise) — a
-- classic check-then-write race. A concurrent addStructureComponent()
-- inserting a new reference between the count and the delete gets silently
-- cascade-removed by salary_structure_components.salary_component_id's
-- ON DELETE CASCADE, rather than blocking the delete — an admin loses data
-- they just added with no error surfaced to either caller.
--
-- Fix: fold the check-then-write into one transaction, taking a row lock
-- on the target salary_components row via SELECT ... FOR UPDATE before
-- checking references. Postgres's FK-check machinery on
-- salary_structure_components.salary_component_id acquires a FOR KEY SHARE
-- tuple lock on the referenced row before inserting — which conflicts with
-- FOR UPDATE — so a concurrent addStructureComponent() insert blocks until
-- this transaction commits or rolls back, then re-validates against
-- whatever state (deleted or not) this transaction left behind.
-- ============================================================

CREATE OR REPLACE FUNCTION delete_salary_component_atomic(
  p_tenant_id    UUID,
  p_component_id UUID
) RETURNS TABLE (
  outcome TEXT  -- 'deleted' | 'deactivated' | 'not_found'
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_locked_id  UUID;
  v_referenced BOOLEAN;
BEGIN
  SELECT id INTO v_locked_id
  FROM   salary_components
  WHERE  id = p_component_id AND tenant_id = p_tenant_id
  FOR UPDATE;

  IF v_locked_id IS NULL THEN
    RETURN QUERY SELECT 'not_found'::TEXT;
    RETURN;
  END IF;

  v_referenced := EXISTS (
    SELECT 1 FROM salary_structure_components
    WHERE salary_component_id = p_component_id AND tenant_id = p_tenant_id
  );

  IF v_referenced THEN
    UPDATE salary_components
    SET    is_active = false
    WHERE  id = p_component_id AND tenant_id = p_tenant_id;
    RETURN QUERY SELECT 'deactivated'::TEXT;
  ELSE
    DELETE FROM salary_components
    WHERE  id = p_component_id AND tenant_id = p_tenant_id;
    RETURN QUERY SELECT 'deleted'::TEXT;
  END IF;
END;
$$;
