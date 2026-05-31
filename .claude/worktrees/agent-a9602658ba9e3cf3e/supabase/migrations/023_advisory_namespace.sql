-- ─────────────────────────────────────────────────────────────────────────────
-- 023_advisory_namespace.sql
--
-- Step 1: Namespace the advisory lock key.
--   Old key: hashtext(tenant_id::text)
--   New key: hashtext('attendance:' || tenant_id::text)
--
-- The namespace prefix avoids collisions with other modules that may call
-- pg_try_advisory_lock using the same tenant_id as a raw hash input.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION acquire_attendance_advisory_lock(p_tenant_id UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Namespaced key: 'attendance:' prefix prevents hash collision with other
  -- modules that advisory-lock on the same tenant UUID.
  RETURN pg_try_advisory_lock(hashtext('attendance:' || p_tenant_id::text)::bigint);
END;
$$;

CREATE OR REPLACE FUNCTION release_attendance_advisory_lock(p_tenant_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM pg_advisory_unlock(hashtext('attendance:' || p_tenant_id::text)::bigint);
END;
$$;

-- Permissions unchanged — authenticated role already granted in 022
REVOKE ALL ON FUNCTION acquire_attendance_advisory_lock(UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION release_attendance_advisory_lock(UUID) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION acquire_attendance_advisory_lock(UUID) TO authenticated;
GRANT  EXECUTE ON FUNCTION release_attendance_advisory_lock(UUID) TO authenticated;
