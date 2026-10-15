-- SYSTEM_AUDIT_2026-10-14 checkpoint 14 — two qualifications raised against
-- checkpoint 13's cap-invariant review and this batch's period-lock fix,
-- both closed here with a real schema/behavior correction rather than a
-- restated assumption.
--
-- ─────────────────────────────────────────────────────────────────────────
-- 1. Cap-policy effective-dating — "re-reading the policy live" is not the
--    same as "effective-dated correctly."
-- ─────────────────────────────────────────────────────────────────────────
-- leave_accrual_rules has effective_from/effective_to columns AND a unique
-- constraint on (tenant_id, leave_type_id, effective_from) — the table is
-- explicitly designed to hold multiple time-scoped versions of a rule, not
-- one mutable row. The monthly/yearly accrual job's own rule lookup
-- (lib/accrual-engine.ts, monthlyAccrualJob) already implements this
-- correctly: `.lte('effective_from', periodEndDate).or('effective_to.is.
-- null,effective_to.gte.' + periodDate)`. request_leave_encashment_atomic
-- (migration 465) and processEncashment's rule lookup (lib/accrual-
-- engine.ts) did NOT follow that pattern — both picked "the active rule
-- with the latest effective_from," full stop, with no check that
-- effective_from had actually arrived yet. Migration 465's own comment
-- rationalized this as "the product invariant is one active rule at a
-- time" — which contradicts the schema's own design and the accrual job's
-- own implementation elsewhere in this exact file, and was never actually
-- true: an HR admin can create a second, FUTURE-dated rule version today,
-- and the OLD code would apply it immediately to every encashment request
-- checked between creation and that future date — a genuine effective-
-- dating bug, not a documentation gap.
--
-- INTENDED (and now actual) behavior, stated explicitly: a rule version
-- governs encashment requests/approvals made on or after its effective_from
-- and before its effective_to (or forever, if effective_to is NULL) —
-- evaluated fresh against CURRENT_DATE at both request time and approval
-- time, exactly like the accrual job's own period-scoped lookup. A
-- future-dated version has NO effect until that date arrives; from that
-- date, every NEW check (request or approval) picks it up — there is no
-- separate "grandfather" protection for already-pending requests, matching
-- how every other rule-driven check in this codebase (accrual itself,
-- period locks, approval chains) already re-reads current state fresh on
-- every call rather than snapshotting it at submission time.
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
  PERFORM pg_advisory_xact_lock(hashtextextended(
    p_tenant_id::text || ':' || p_employee_id::text || ':' ||
    p_leave_type_id::text || ':' || p_year::text, 0
  ));

  -- Effective-dated version pick: the most recent version whose window
  -- actually covers today, not merely the most recent version to exist.
  SELECT encashable, max_encashable_per_year
  INTO   v_rule
  FROM   leave_accrual_rules
  WHERE  tenant_id     = p_tenant_id
    AND  leave_type_id = p_leave_type_id
    AND  is_active      = true
    AND  effective_from <= CURRENT_DATE
    AND  (effective_to IS NULL OR effective_to >= CURRENT_DATE)
  ORDER BY effective_from DESC
  LIMIT 1;

  IF v_rule IS NULL OR v_rule.encashable IS NOT TRUE THEN
    RAISE EXCEPTION 'NOT_ENCASHABLE: This leave type does not allow encashment';
  END IF;

  IF v_rule.max_encashable_per_year > 0 THEN
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

ALTER FUNCTION request_leave_encashment_atomic(UUID, UUID, UUID, INT, NUMERIC, TEXT) SET search_path = public;
REVOKE EXECUTE ON FUNCTION request_leave_encashment_atomic(UUID, UUID, UUID, INT, NUMERIC, TEXT)
  FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION request_leave_encashment_atomic(UUID, UUID, UUID, INT, NUMERIC, TEXT)
  TO service_role;

-- ─────────────────────────────────────────────────────────────────────────
-- 2. Period-lock auto-LOP: the regularisation reject and the approval-
--    instance close must commit together, not as two independent writes.
-- ─────────────────────────────────────────────────────────────────────────
-- checkpoint 14's first fix made period-locks.ts's fire-and-forget auto-LOP
-- job close any open approval_instances row alongside the raw regularisation
-- reject — but as two separate supabase-js calls, a crash/network failure
-- between them re-creates exactly the orphaned-instance state the fix was
-- meant to close, just via a different trigger. Folding both writes into
-- one plpgsql function makes them commit or roll back together by
-- construction (a function body runs as part of the ONE implicit
-- transaction its single top-level RPC call opens) — the same guarantee
-- this audit has relied on throughout (e.g. finalize_payroll_run_atomic) —
-- which satisfies "commit together" directly rather than needing a
-- separate retry/recovery path bolted on afterward.
CREATE OR REPLACE FUNCTION auto_lop_reject_regularisations_atomic(
  p_tenant_id UUID,
  p_reg_ids   UUID[]
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
           rejection_reason   = 'Period locked — regularisation window closed. Attendance marked as Absent (LOP).',
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

ALTER FUNCTION auto_lop_reject_regularisations_atomic(UUID, UUID[]) SET search_path = public;
REVOKE EXECUTE ON FUNCTION auto_lop_reject_regularisations_atomic(UUID, UUID[])
  FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION auto_lop_reject_regularisations_atomic(UUID, UUID[])
  TO service_role;
