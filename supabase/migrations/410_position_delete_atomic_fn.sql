-- ============================================================
-- 410_position_delete_atomic_fn.sql
--
-- PEND-90 (AUDIT_CONSTITUTION.md §14.6): DELETE /positions/:id (hard-delete
-- path) counted references in job_requisitions and job_history
-- (is_current=true), then hard-deleted the position only when the count
-- was 0 — a check-then-write race. A concurrent hire (new job_history row)
-- or a new requisition against the same position, landing between the
-- count and the delete, gets silently orphaned by
-- job_requisitions.position_id / job_history.position_id's
-- ON DELETE SET NULL rather than blocking the delete.
--
-- Fix: fold the check-then-write into one transaction, taking a row lock
-- on the target positions row via SELECT ... FOR UPDATE before counting
-- references. The FK-check machinery on job_requisitions.position_id and
-- job_history.position_id acquires a FOR KEY SHARE tuple lock on the
-- referenced position row before inserting, which conflicts with
-- FOR UPDATE — so a concurrent insert referencing this position blocks
-- until this transaction commits or rolls back, then re-validates against
-- whatever state (deleted or not) this transaction left behind.
-- ============================================================

CREATE OR REPLACE FUNCTION delete_position_atomic(
  p_tenant_id   UUID,
  p_position_id UUID
) RETURNS TABLE (
  outcome     TEXT,  -- 'deleted' | 'in_use' | 'not_found'
  usage_count INT
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_locked_id UUID;
  v_req_count INT;
  v_jh_count  INT;
BEGIN
  SELECT id INTO v_locked_id
  FROM   positions
  WHERE  id = p_position_id AND tenant_id = p_tenant_id
  FOR UPDATE;

  IF v_locked_id IS NULL THEN
    RETURN QUERY SELECT 'not_found'::TEXT, 0;
    RETURN;
  END IF;

  SELECT count(*) INTO v_req_count
  FROM   job_requisitions
  WHERE  position_id = p_position_id AND tenant_id = p_tenant_id;

  SELECT count(*) INTO v_jh_count
  FROM   job_history
  WHERE  position_id = p_position_id AND tenant_id = p_tenant_id AND is_current = true;

  IF (v_req_count + v_jh_count) > 0 THEN
    RETURN QUERY SELECT 'in_use'::TEXT, (v_req_count + v_jh_count)::INT;
    RETURN;
  END IF;

  DELETE FROM positions WHERE id = p_position_id AND tenant_id = p_tenant_id;
  RETURN QUERY SELECT 'deleted'::TEXT, 0;
END;
$$;
