-- SYSTEM_AUDIT_2026-10-14 checkpoint 14 (attendance batch continuation).
--
-- regularisation-policy.ts's POST /attendance/regularisation/breach-check
-- auto-rejects pending regularisations whose SLA has lapsed via a raw
-- UPDATE directly on attendance_regularisation — the exact same bug class
-- already found and fixed in period-locks.ts's auto-LOP path (migration
-- 467): a regularisation can have an OPEN multi-level approval_instances
-- row (advanced to level 2, awaiting HR) when its SLA breaches, and a raw
-- UPDATE that flips status to 'rejected' without also closing that
-- approval_instances row leaves it orphaned (final_approved still NULL)
-- — a dead request that keeps surfacing in an approver's pending-approvals
-- view forever, exactly the defect migration 467 closed for the period-
-- lock trigger.
--
-- auto_lop_reject_regularisations_atomic already does the right thing
-- (reject + close the chain, in one transaction) but hardcodes the
-- period-lock rejection message. Adding a DEFAULT parameter for the
-- message is a non-breaking change — every existing call site (period-
-- locks.ts) keeps compiling and behaving identically — while letting the
-- SLA-breach auto-reject path reuse the exact same atomic function with
-- its own message instead of duplicating the logic or falling back to an
-- unguarded raw UPDATE.

-- Postgres treats a different parameter COUNT as a different overload, not
-- a superset/subset relationship — leaving migration 467's 2-arg version in
-- place alongside a new 3-arg version would make any 2-named-arg RPC call
-- ambiguous (it could match the old function exactly, or the new one via
-- its default), which Postgres rejects outright ("function ... is not
-- unique"). Drop the old signature first so there is exactly one function.
DROP FUNCTION IF EXISTS auto_lop_reject_regularisations_atomic(UUID, UUID[]);

CREATE OR REPLACE FUNCTION auto_lop_reject_regularisations_atomic(
  p_tenant_id        UUID,
  p_reg_ids          UUID[],
  p_rejection_reason TEXT DEFAULT 'Period locked — regularisation window closed. Attendance marked as Absent (LOP).'
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_rejected_ids UUID[];
BEGIN
  WITH rejected AS (
    UPDATE attendance_regularisation
    SET    status            = 'rejected',
           rejection_reason   = p_rejection_reason,
           approved_at        = now()
    WHERE  tenant_id = p_tenant_id
      AND  id = ANY(p_reg_ids)
      AND  status = 'pending'
    RETURNING id
  )
  SELECT array_agg(id) INTO v_rejected_ids FROM rejected;

  IF v_rejected_ids IS NOT NULL THEN
    UPDATE approval_instances
    SET    final_approved = false,
           closed_at      = now()
    WHERE  tenant_id    = p_tenant_id
      AND  entity_type  = 'attendance_regularisation'
      AND  entity_id    = ANY(v_rejected_ids)
      AND  final_approved IS NULL;
  END IF;

  RETURN jsonb_build_object('rejected_ids', COALESCE(v_rejected_ids, ARRAY[]::UUID[]));
END;
$$;

ALTER FUNCTION auto_lop_reject_regularisations_atomic(UUID, UUID[], TEXT) SET search_path = public;

REVOKE EXECUTE ON FUNCTION auto_lop_reject_regularisations_atomic(UUID, UUID[], TEXT)
  FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION auto_lop_reject_regularisations_atomic(UUID, UUID[], TEXT)
  TO service_role;
