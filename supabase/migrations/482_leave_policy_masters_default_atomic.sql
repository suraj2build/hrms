-- SYSTEM_AUDIT_2026-10-14, checkpoint 27 (masters/ sweep) — found while
-- auditing leave-policy-masters.ts: POST / and PUT /:id both demote the
-- tenant's current `is_default=true` policy with one UPDATE, then separately
-- INSERT/UPDATE the target row as a second, unguarded call. The route's own
-- comment admitted this ("a transaction-like pattern" — not an actual one).
--
-- idx_leave_policy_masters_one_default (migration 054) is a partial unique
-- index enforcing at most one is_default=true row per tenant — which is
-- exactly why the demote step exists: without it, the INSERT/UPDATE would
-- violate that constraint. But if the INSERT/UPDATE then fails for ANY
-- reason (most plausibly a 23505 on the separate `(tenant_id, name)` unique
-- constraint, or a CAS `cas_version` mismatch on PUT), the demote has
-- already committed — the tenant is left with ZERO default leave policies
-- until an admin notices and manually re-sets one. Every consumer that
-- resolves "the tenant's default leave policy" by `is_default` (the
-- documented priority-5 catch-all scope in leave-policy-assignments.ts) has
-- silently nothing to fall back to in the meantime.
--
-- Fixed by fusing demote + write into one atomic transaction per route,
-- exactly this audit's established pattern elsewhere (finalize_loan_emi_
-- atomic, assign_arrears_batch_to_run_atomic, etc.): a plpgsql function's
-- own INSERT/UPDATE failing raises an exception, which rolls back every
-- earlier statement in the SAME function call — including the demote.
--
-- The UPDATE path is driven by a JSONB `p_fields` object (mirroring the
-- route's existing `updateSchema.partial()` shape) so a partial PUT that
-- never touches `is_default` at all doesn't demote anything, matching the
-- current route's (correct) behavior for that case.

CREATE OR REPLACE FUNCTION create_leave_policy_master_atomic(
  p_tenant_id   UUID,
  p_name        TEXT,
  p_description TEXT,
  p_is_default  BOOLEAN,
  p_year_type   TEXT,
  p_is_active   BOOLEAN
) RETURNS leave_policy_masters
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_row leave_policy_masters;
BEGIN
  IF p_is_default THEN
    UPDATE leave_policy_masters
    SET    is_default = false, updated_at = now()
    WHERE  tenant_id = p_tenant_id AND is_default = true;
  END IF;

  INSERT INTO leave_policy_masters (tenant_id, name, description, is_default, year_type, is_active)
  VALUES (p_tenant_id, p_name, p_description, p_is_default, p_year_type, p_is_active)
  RETURNING * INTO v_row;

  RETURN v_row;
END;
$$;

CREATE OR REPLACE FUNCTION update_leave_policy_master_atomic(
  p_tenant_id        UUID,
  p_id               UUID,
  p_fields           JSONB,
  p_expected_version INTEGER
) RETURNS leave_policy_masters
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_row leave_policy_masters;
BEGIN
  IF (p_fields ? 'is_default') AND (p_fields->>'is_default')::boolean IS TRUE THEN
    UPDATE leave_policy_masters
    SET    is_default = false, updated_at = now()
    WHERE  tenant_id = p_tenant_id AND is_default = true AND id <> p_id;
  END IF;

  UPDATE leave_policy_masters
  SET    name        = CASE WHEN p_fields ? 'name'        THEN p_fields->>'name'                    ELSE name        END,
         description = CASE WHEN p_fields ? 'description' THEN p_fields->>'description'              ELSE description END,
         is_default  = CASE WHEN p_fields ? 'is_default'   THEN (p_fields->>'is_default')::boolean    ELSE is_default  END,
         year_type   = CASE WHEN p_fields ? 'year_type'    THEN p_fields->>'year_type'                ELSE year_type   END,
         is_active   = CASE WHEN p_fields ? 'is_active'    THEN (p_fields->>'is_active')::boolean      ELSE is_active   END,
         updated_at  = now()
  WHERE  id = p_id AND tenant_id = p_tenant_id
    AND  (p_expected_version IS NULL OR cas_version = p_expected_version)
  RETURNING * INTO v_row;

  -- 0 rows matched (not found, or cas_version moved on) must ROLL BACK the
  -- demote step above too, not just return an empty result — a plain
  -- `RETURN v_row` here would let the demote silently commit, leaving the
  -- tenant with zero default policies even though the actual promotion
  -- never happened. Caught by name in the route, which already does its own
  -- existence check to disambiguate 404 (deleted) from 409 (CAS mismatch).
  IF v_row.id IS NULL THEN
    RAISE EXCEPTION 'NO_ROWS_MATCHED: policy % not found in tenant %, or cas_version moved on', p_id, p_tenant_id;
  END IF;

  RETURN v_row;
END;
$$;

ALTER FUNCTION create_leave_policy_master_atomic(UUID, TEXT, TEXT, BOOLEAN, TEXT, BOOLEAN) SET search_path = public;
ALTER FUNCTION update_leave_policy_master_atomic(UUID, UUID, JSONB, INTEGER) SET search_path = public;
REVOKE EXECUTE ON FUNCTION create_leave_policy_master_atomic(UUID, TEXT, TEXT, BOOLEAN, TEXT, BOOLEAN) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION update_leave_policy_master_atomic(UUID, UUID, JSONB, INTEGER) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION create_leave_policy_master_atomic(UUID, TEXT, TEXT, BOOLEAN, TEXT, BOOLEAN) TO service_role;
GRANT  EXECUTE ON FUNCTION update_leave_policy_master_atomic(UUID, UUID, JSONB, INTEGER) TO service_role;
