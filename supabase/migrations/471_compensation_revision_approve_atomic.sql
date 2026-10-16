-- SYSTEM_AUDIT_2026-10-14 checkpoint 17 — user-directed requirement to finish
-- the compensation-revision approval failure proof: "Previous compensation
-- remains valid. No incomplete replacement becomes active. Components and
-- activation commit consistently. Retry is safe."
--
-- POST /payroll/revisions/:id/approve (compensation-revisions.ts) previously
-- did this as FOUR separate supabase-js calls: (1) CAS the revision to
-- 'approved', (2) supersede (deactivate) the prior active compensation,
-- (3) insert the new compensation row, (4) insert its component rows, then
-- link the revision to the new compensation. A failure at step 3 or 4 left
-- a torn state: the revision already 'approved', the prior compensation
-- already deactivated, and EITHER no new active compensation at all (step 3
-- failure) or a new active compensation with ZERO components (step 4
-- failure — this exact gap was found and partially fixed earlier this audit
-- by surfacing the error instead of swallowing it, but surfacing an error
-- does not undo the torn writes that already committed).
--
-- This migration fuses the whole sequence into one plpgsql function —
-- one transaction by construction, the same pattern already used throughout
-- this codebase for exactly this class of problem (finalize_payroll_run_atomic,
-- rollback_payroll_run_atomic, credit_engine_accrual_atomic, etc.). The
-- business-logic computation of the new (possibly CTC-scaled) component
-- values stays in TypeScript — this function only performs the actual
-- writes, taking the already-computed component rows as a JSONB array.
--
-- Guarantees proven by scripts/db/verify-compensation-revision-approve-atomic.mjs:
--   1. If the function raises at any point (including a deliberately invalid
--      component row), the ENTIRE transaction rolls back: the revision stays
--      'pending', and the prior compensation is still active, untouched —
--      "previous compensation remains valid."
--   2. A new employee_compensations row only becomes is_active=true if the
--      function reaches COMMIT, which requires its components insert to have
--      already succeeded in the SAME transaction — "no incomplete
--      replacement becomes active."
--   3. employee_compensations' trigger fn_close_prev_compensation (migration
--      pre-existing) deactivates the prior active row as a side effect of
--      the SAME INSERT statement that activates the new one, inside this
--      same function/transaction — "components and activation commit
--      consistently."
--   4. The function locks the revision row FOR UPDATE and re-checks
--      status = 'pending' as its very first action. A retry after a
--      genuine failure (which rolled back, leaving status='pending') simply
--      re-attempts cleanly; a retry after a real success (status already
--      'approved') raises INVALID_STATUS and writes nothing — "retry is
--      safe," with two concurrent callers for the same revision serializing
--      on the row lock so exactly one can ever succeed.

CREATE OR REPLACE FUNCTION approve_compensation_revision_atomic(
  p_tenant_id   UUID,
  p_revision_id UUID,
  p_actor_id    UUID,
  p_components  JSONB DEFAULT '[]'::jsonb
) RETURNS JSONB
LANGUAGE plpgsql
AS $$
DECLARE
  v_rev                  RECORD;
  v_new_comp_id           UUID;
  v_current_structure_id  UUID;
BEGIN
  -- Lock the revision row first — this is the ONLY read-then-decide gate in
  -- the whole function, and it holds for the function's entire duration,
  -- so a concurrent second call for the same revision_id blocks here until
  -- this transaction commits or rolls back, then re-evaluates fresh state.
  SELECT * INTO v_rev
  FROM compensation_revisions
  WHERE id = p_revision_id AND tenant_id = p_tenant_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'NOT_FOUND: Revision not found';
  END IF;

  IF v_rev.status <> 'pending' THEN
    RAISE EXCEPTION 'INVALID_STATUS: Cannot approve revision with status ''%''', v_rev.status;
  END IF;

  UPDATE compensation_revisions
  SET status = 'approved', approved_by = p_actor_id, decided_at = now(), updated_at = now()
  WHERE id = p_revision_id AND tenant_id = p_tenant_id;

  -- Carry forward the current active compensation's salary_structure_id —
  -- matches the pre-existing route behavior exactly (it never applied
  -- compensation_revisions.new_salary_structure_id; preserved as-is here,
  -- not expanded, since that is a separate question outside this fix's scope).
  SELECT salary_structure_id INTO v_current_structure_id
  FROM employee_compensations
  WHERE tenant_id = p_tenant_id AND employee_id = v_rev.employee_id AND is_active = true
  LIMIT 1;

  -- Insert the new compensation as active. The pre-existing trigger
  -- fn_close_prev_compensation (BEFORE INSERT OR UPDATE OF is_active) fires
  -- as part of THIS statement and deactivates the prior active row in the
  -- SAME transaction — no separate "supersede" step needed, and no window
  -- where both rows are momentarily active or neither is.
  INSERT INTO employee_compensations (
    employee_id, tenant_id, salary_structure_id, ctc_annual, effective_from,
    is_active, notes, approved_by, created_by
  ) VALUES (
    v_rev.employee_id, p_tenant_id, v_current_structure_id,
    v_rev.new_ctc_annual, v_rev.effective_date,
    true, v_rev.revision_type || ' revision approved', p_actor_id, p_actor_id
  )
  RETURNING id INTO v_new_comp_id;

  -- Insert the (already-computed, CTC-scaled) component rows. An empty or
  -- null p_components inserts zero rows — matches the pre-existing
  -- "if (prevComponents?.length)" guard for a newly onboarded employee with
  -- no prior component breakdown.
  INSERT INTO employee_compensation_components (
    compensation_id, salary_component_id, calculation_type, value, sequence,
    tenant_id, computed_monthly, computed_annual
  )
  SELECT
    v_new_comp_id,
    (elem->>'salary_component_id')::uuid,
    elem->>'calculation_type',
    (elem->>'value')::numeric,
    COALESCE((elem->>'sequence')::int, 0),
    p_tenant_id,
    COALESCE((elem->>'computed_monthly')::numeric, 0),
    COALESCE((elem->>'computed_annual')::numeric, 0)
  FROM jsonb_array_elements(COALESCE(p_components, '[]'::jsonb)) AS elem;

  UPDATE compensation_revisions
  SET resulting_compensation_id = v_new_comp_id
  WHERE id = p_revision_id AND tenant_id = p_tenant_id;

  RETURN jsonb_build_object(
    'revision_id', p_revision_id,
    'new_compensation_id', v_new_comp_id,
    'employee_id', v_rev.employee_id
  );
END;
$$;
