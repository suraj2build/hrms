-- ============================================================
-- 413_talent_interest_register_atomic_fn.sql
--
-- PEND-25 (AUDIT_CONSTITUTION.md §14.6): POST /talent/interest checks
-- talent_roles.is_open, then inserts/updates a talent_interests row as a
-- separate statement — a role closed in the window between the check and
-- the write can still receive a new interest registration.
--
-- Fix: register_talent_interest_atomic() takes a row lock on the target
-- talent_roles row via SELECT ... FOR UPDATE before checking is_open, in
-- the same transaction as the interest insert/update. Any concurrent
-- UPDATE that closes the role (an ordinary UPDATE acquires the same kind
-- of row lock) blocks until this transaction commits or rolls back, so the
-- two operations are fully serialized against each other.
-- ============================================================

CREATE OR REPLACE FUNCTION register_talent_interest_atomic(
  p_tenant_id    UUID,
  p_role_id      UUID,
  p_employee_id  UUID,
  p_cover_note   TEXT,
  p_skills       TEXT[],
  p_availability TEXT,
  p_status       TEXT
) RETURNS TABLE (
  outcome     TEXT,  -- 'inserted' | 'updated' | 'role_not_open' | 'role_not_found' | 'already_reviewed'
  interest_id UUID
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_role_open       BOOLEAN;
  v_existing_id     UUID;
  v_existing_status TEXT;
  v_new_id          UUID;
BEGIN
  SELECT is_open INTO v_role_open
  FROM   talent_roles
  WHERE  id = p_role_id AND tenant_id = p_tenant_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN QUERY SELECT 'role_not_found'::TEXT, NULL::UUID;
    RETURN;
  END IF;

  IF NOT v_role_open THEN
    RETURN QUERY SELECT 'role_not_open'::TEXT, NULL::UUID;
    RETURN;
  END IF;

  SELECT id, status INTO v_existing_id, v_existing_status
  FROM   talent_interests
  WHERE  tenant_id = p_tenant_id AND role_id = p_role_id AND employee_id = p_employee_id;

  IF v_existing_id IS NOT NULL THEN
    IF v_existing_status NOT IN ('interested', 'withdrawn') THEN
      RETURN QUERY SELECT 'already_reviewed'::TEXT, v_existing_id;
      RETURN;
    END IF;

    UPDATE talent_interests
    SET    cover_note   = p_cover_note,
           skills       = p_skills,
           availability = p_availability,
           status       = p_status,
           updated_at   = now()
    WHERE  id = v_existing_id;

    RETURN QUERY SELECT 'updated'::TEXT, v_existing_id;
    RETURN;
  END IF;

  INSERT INTO talent_interests (tenant_id, role_id, employee_id, cover_note, skills, availability, status)
  VALUES (p_tenant_id, p_role_id, p_employee_id, p_cover_note, p_skills, p_availability, p_status)
  RETURNING id INTO v_new_id;

  RETURN QUERY SELECT 'inserted'::TEXT, v_new_id;
END;
$$;
