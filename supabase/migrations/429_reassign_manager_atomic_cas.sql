-- ============================================================
-- 429_reassign_manager_atomic_cas.sql
--
-- PEND-105 follow-up — reassign_manager_atomic() (migration 414) performs
-- the employees.manager_id UPDATE inside its own transaction, so the
-- uniform "add version + CAS check in the route handler" pattern used for
-- every other PEND-105 endpoint doesn't reach this one — the RPC's prior
-- signature had no way to receive an expected_version from the caller.
--
-- Fix: add an optional p_expected_version param (default NULL, so every
-- existing/other caller of this RPC keeps working unchanged) and fold it
-- into the UPDATE's WHERE clause exactly like the plain-.update() CAS
-- endpoints do — a stale version matches 0 rows, which the function now
-- reports as a new 'version_conflict' outcome alongside its existing
-- 'not_found' / 'manager_not_found' / 'self_reference' / 'cycle' /
-- 'updated' outcomes. RETURNS TABLE gains a `new_version` column so a
-- successful update tells the caller the version to compare against on
-- its NEXT write, without a second round-trip SELECT.
-- ============================================================

CREATE OR REPLACE FUNCTION reassign_manager_atomic(
  p_tenant_id        UUID,
  p_employee_id      UUID,
  p_new_manager_id   UUID,
  p_max_depth        INT DEFAULT 20,
  p_expected_version INT DEFAULT NULL
) RETURNS TABLE (
  outcome     TEXT,  -- 'updated' | 'not_found' | 'manager_not_found' | 'self_reference' | 'cycle' | 'version_conflict'
  new_version INT
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_exists      BOOLEAN;
  v_cursor      UUID;
  v_depth       INT := 0;
  v_new_version INT;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext(p_tenant_id::text));

  SELECT EXISTS(
    SELECT 1 FROM employees WHERE id = p_employee_id AND tenant_id = p_tenant_id
  ) INTO v_exists;
  IF NOT v_exists THEN
    RETURN QUERY SELECT 'not_found'::TEXT, NULL::INT;
    RETURN;
  END IF;

  IF p_new_manager_id IS NOT NULL THEN
    IF p_new_manager_id = p_employee_id THEN
      RETURN QUERY SELECT 'self_reference'::TEXT, NULL::INT;
      RETURN;
    END IF;

    SELECT EXISTS(
      SELECT 1 FROM employees WHERE id = p_new_manager_id AND tenant_id = p_tenant_id
    ) INTO v_exists;
    IF NOT v_exists THEN
      RETURN QUERY SELECT 'manager_not_found'::TEXT, NULL::INT;
      RETURN;
    END IF;

    v_cursor := p_new_manager_id;
    WHILE v_cursor IS NOT NULL AND v_depth < p_max_depth LOOP
      IF v_cursor = p_employee_id THEN
        RETURN QUERY SELECT 'cycle'::TEXT, NULL::INT;
        RETURN;
      END IF;
      SELECT manager_id INTO v_cursor FROM employees WHERE id = v_cursor AND tenant_id = p_tenant_id;
      v_depth := v_depth + 1;
    END LOOP;
  END IF;

  -- PEND-105: optimistic-concurrency check — only applied when the caller
  -- sends p_expected_version (NULL means "no CAS check", matching every
  -- other endpoint's expected_version-optional contract).
  UPDATE employees
  SET    manager_id = p_new_manager_id, updated_at = now()
  WHERE  id = p_employee_id AND tenant_id = p_tenant_id
    AND (p_expected_version IS NULL OR version = p_expected_version)
  RETURNING version INTO v_new_version;

  IF NOT FOUND THEN
    -- 0 rows matched — we already confirmed the row exists above, so this
    -- can only mean version moved on since expected_version was read.
    RETURN QUERY SELECT 'version_conflict'::TEXT, NULL::INT;
    RETURN;
  END IF;

  RETURN QUERY SELECT 'updated'::TEXT, v_new_version;
END;
$$;

ALTER FUNCTION reassign_manager_atomic(UUID, UUID, UUID, INT, INT) SET search_path = public;

-- Re-apply the EXECUTE lockdown 421 established — a changed parameter list
-- is a new function identity in Postgres and defaults back to PUBLIC
-- EXECUTE otherwise.
REVOKE EXECUTE ON FUNCTION reassign_manager_atomic(UUID, UUID, UUID, INT, INT)
  FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION reassign_manager_atomic(UUID, UUID, UUID, INT, INT)
  TO service_role;

-- Drop the old 4-arg signature — PostgREST/supabase-js resolve overloaded
-- RPC names by argument-name matching, and a stale old-signature function
-- left in place would silently keep matching calls that don't pass
-- p_expected_version, masking any caller not yet migrated.
DROP FUNCTION IF EXISTS reassign_manager_atomic(UUID, UUID, UUID, INT);
