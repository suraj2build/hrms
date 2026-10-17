-- SYSTEM_AUDIT_2026-10-14 checkpoint 12 — the checkpoint 11 fix for
-- POST /leave/encashment/request added an Idempotency-Key, but that alone
-- does not protect the annual-encashment-cap check: two requests using
-- DIFFERENT keys (or a genuinely simultaneous pair of requests racing
-- before either's idempotency row is stored) each read the same pre-insert
-- SUM(days), each pass `alreadyEncashed + days <= max_encashable_per_year`,
-- and both insert — a correctly-reviewed critique the checkpoint-11 report
-- did not close. A second, independent defect found while building this
-- fix: the sum excluded only status='rejected', never 'reversed' — but
-- reverse_leave_encashment_atomic (migration 446) credits the leave
-- balance BACK on reversal, so a reversed request should free its days
-- back into the annual cap too; leaving it counted permanently understates
-- how much an employee can still encash that year, forever, after a
-- correction.
--
-- This migration fuses the cap check and the insert into one transaction,
-- serialized by a per (tenant, employee, leave_type, year) advisory lock —
-- the same `pg_advisory_xact_lock(hashtextextended(...))` convention
-- migrations 425/427 already use for this exact employee-scoped shape.
-- Idempotency-Key handling stays a SEPARATE, complementary concern in the
-- route (switched to claimIdempotency's atomic INSERT-based claim in the
-- same commit, replacing the non-atomic checkIdempotency/storeIdempotency
-- pair) — idempotency answers "is this the same request replayed",
-- this RPC answers "does the combined total of ALL requests for this
-- employee/leave_type/year, regardless of key, stay under the cap."

CREATE OR REPLACE FUNCTION request_leave_encashment_atomic(
  p_tenant_id     UUID,
  p_employee_id   UUID,
  p_leave_type_id UUID,
  p_year          INT,
  p_days          NUMERIC,
  p_notes         TEXT DEFAULT NULL
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_rule            RECORD;
  v_already_encashed NUMERIC;
  v_new_row         RECORD;
BEGIN
  -- Serializes every request for this exact (employee, leave_type, year)
  -- combination — concurrent requests for a DIFFERENT employee, leave
  -- type, or year never contend for the same lock.
  PERFORM pg_advisory_xact_lock(hashtextextended(
    p_tenant_id::text || ':' || p_employee_id::text || ':' ||
    p_leave_type_id::text || ':' || p_year::text, 0
  ));

  -- Deterministic pick if more than one active rule row ever exists for
  -- the same leave_type_id (the product invariant is one active rule at a
  -- time, matching the route's pre-existing `.maybeSingle()` assumption;
  -- ORDER BY + LIMIT keeps this function's behavior well-defined even if
  -- that invariant is ever violated, rather than relying on plpgsql's
  -- undefined "first row wins" SELECT INTO default).
  SELECT encashable, max_encashable_per_year
  INTO   v_rule
  FROM   leave_accrual_rules
  WHERE  tenant_id     = p_tenant_id
    AND  leave_type_id = p_leave_type_id
    AND  is_active      = true
  ORDER BY effective_from DESC
  LIMIT 1;

  IF v_rule IS NULL OR v_rule.encashable IS NOT TRUE THEN
    RAISE EXCEPTION 'NOT_ENCASHABLE: This leave type does not allow encashment';
  END IF;

  IF v_rule.max_encashable_per_year > 0 THEN
    -- A 'reversed' request's days were credited back to the balance by
    -- reverse_leave_encashment_atomic — exclude it from the cap the same
    -- way 'rejected' already was (checkpoint 11's exclusion was
    -- incomplete; fixed here).
    SELECT COALESCE(SUM(days), 0)
    INTO   v_already_encashed
    FROM   leave_encashment_requests
    WHERE  tenant_id     = p_tenant_id
      AND  employee_id   = p_employee_id
      AND  leave_type_id = p_leave_type_id
      AND  year          = p_year
      AND  status NOT IN ('rejected', 'reversed');

    IF v_already_encashed + p_days > v_rule.max_encashable_per_year THEN
      RAISE EXCEPTION 'ENCASHMENT_LIMIT_EXCEEDED: Annual encashment limit is % days. Already requested: %',
        v_rule.max_encashable_per_year, v_already_encashed;
    END IF;
  END IF;

  INSERT INTO leave_encashment_requests (
    tenant_id, employee_id, leave_type_id, year, days, notes
  ) VALUES (
    p_tenant_id, p_employee_id, p_leave_type_id, p_year, p_days, p_notes
  )
  RETURNING id, days, status, created_at INTO v_new_row;

  RETURN jsonb_build_object(
    'id',         v_new_row.id,
    'days',       v_new_row.days,
    'status',     v_new_row.status,
    'created_at', v_new_row.created_at
  );
END;
$$;

REVOKE EXECUTE ON FUNCTION request_leave_encashment_atomic(UUID, UUID, UUID, INT, NUMERIC, TEXT)
  FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION request_leave_encashment_atomic(UUID, UUID, UUID, INT, NUMERIC, TEXT)
  TO service_role;
