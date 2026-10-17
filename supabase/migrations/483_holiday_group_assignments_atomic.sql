-- SYSTEM_AUDIT_2026-10-14, checkpoint 28 — found while auditing masters/
-- holidays.ts: POST /masters/holidays/group-assignments replaces a
-- holiday's full group assignment set (holiday_group_assignments, a real
-- many-to-many junction table — a holiday CAN apply to multiple groups),
-- then "syncs" the legacy single-FK holiday_calendar.holiday_group_id
-- column to group_ids[0] "for backward compat". That sync was the bug:
-- grep confirmed holiday_group_assignments is read ONLY by this one file
-- (the group-matrix GET and this POST), while every real consumer that
-- decides whether a holiday applies to an employee --
-- attendance-engine.ts, attendance-processor.ts, roster-calendar-engine.ts,
-- leave-engine.ts, payroll-engine.ts, collision-engine.ts,
-- routes/attendance/leave-collision.ts, routes/employees/org-context.ts --
-- read the single legacy column directly. A holiday assigned to groups
-- [B, A] applied correctly to group B's employees (group_ids[0]) but
-- silently NOT to group A's, even though the admin UI (which reads the
-- correct multi-group table) showed it assigned to both.
--
-- Decision (explicit, asked of the user): build real multi-group support
-- rather than restrict holidays to one group. All 9 consumers above are
-- now fixed to read the full assignment set via a holiday_group_
-- assignments(group_id) embed instead of the legacy column. With every
-- consumer migrated, the legacy holiday_calendar.holiday_group_id column
-- is now genuinely dead -- nothing reads it for applicability anymore (the
-- web admin page's own local `holiday_group_id: null` field is likewise
-- vestigial, never read back). This migration stops writing it.
--
-- Also fuses the handler's delete-then-insert (two separate, unguarded
-- Supabase calls) into one atomic transaction -- the secondary,
-- lower-severity defect flagged alongside the group_ids[0] bug: if the
-- insert failed after the delete had already committed, the holiday was
-- left with zero group assignments and no indication anything went wrong
-- beyond the 500 response. Same established pattern as this audit's other
-- atomic-write fixes.

CREATE OR REPLACE FUNCTION set_holiday_group_assignments_atomic(
  p_tenant_id  UUID,
  p_holiday_id UUID,
  p_group_ids  UUID[]
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  PERFORM 1 FROM holiday_calendar WHERE id = p_holiday_id AND tenant_id = p_tenant_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'NOT_FOUND: Holiday not found';
  END IF;

  DELETE FROM holiday_group_assignments
  WHERE tenant_id = p_tenant_id AND holiday_id = p_holiday_id;

  IF array_length(p_group_ids, 1) > 0 THEN
    INSERT INTO holiday_group_assignments (tenant_id, holiday_id, group_id)
    SELECT p_tenant_id, p_holiday_id, gid FROM unnest(p_group_ids) AS gid;
  END IF;

  RETURN jsonb_build_object('holiday_id', p_holiday_id, 'group_count', COALESCE(array_length(p_group_ids, 1), 0));
END;
$$;

ALTER FUNCTION set_holiday_group_assignments_atomic(UUID, UUID, UUID[]) SET search_path = public;
REVOKE EXECUTE ON FUNCTION set_holiday_group_assignments_atomic(UUID, UUID, UUID[]) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION set_holiday_group_assignments_atomic(UUID, UUID, UUID[]) TO service_role;
