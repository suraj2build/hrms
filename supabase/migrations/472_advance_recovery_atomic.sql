-- SYSTEM_AUDIT_2026-10-14 checkpoint 17 — payroll audit, advances.ts.
--
-- POST /payroll/advances/recover had TWO real defects in the same write path:
--
-- 1. The INSERT into advance_recoveries never supplied `employee_id` or
--    `recovery_month`, both NOT NULL on that table with no default and no
--    trigger to populate them. Every call to this endpoint with a real
--    payload would fail with a Postgres NOT NULL violation — the endpoint
--    was unconditionally broken for its one real job (recording that an
--    advance recovery happened).
-- 2. Worse, that failing insert happened AFTER the schedule row (when
--    schedule_id was supplied) was already updated to status='recovered' in
--    a SEPARATE, EARLIER statement. Because #1 made the insert fail on every
--    real call, EVERY attempt to record a scheduled recovery left that
--    schedule permanently stuck at 'recovered' with NO advance_recoveries
--    row — no record of how much, when, or why — and no way to retry
--    (the schedule's own CAS guard requires status='pending', which it no
--    longer is). This is live, not hypothetical: the route is a reachable
--    authenticated API endpoint regardless of current frontend usage.
--
-- Fixed by fusing the whole sequence (lock the advance, update the
-- schedule, insert the recovery record with the now-correctly-supplied
-- employee_id/recovery_month, recompute and update the advance's aggregate
-- status) into one atomic transaction — the same pattern used throughout
-- this codebase for this problem class. A failure anywhere rolls back
-- everything: the schedule is never left in a stuck 'recovered' state with
-- no matching recovery record.

CREATE OR REPLACE FUNCTION record_advance_recovery_atomic(
  p_tenant_id     UUID,
  p_advance_id    UUID,
  p_schedule_id   UUID,
  p_payroll_run_id UUID,
  p_amount        NUMERIC,
  p_recovery_type TEXT,
  p_notes         TEXT,
  p_actor_id      UUID
) RETURNS JSONB
LANGUAGE plpgsql
AS $$
DECLARE
  v_advance        RECORD;
  v_recovery_month TEXT;
  v_recovery_id    UUID;
  v_pending_count  INT;
BEGIN
  SELECT employee_id, status INTO v_advance
  FROM advance_salary_requests
  WHERE id = p_advance_id AND tenant_id = p_tenant_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'NOT_FOUND: Advance not found';
  END IF;

  IF p_schedule_id IS NOT NULL THEN
    UPDATE advance_recovery_schedules
    SET status = 'recovered', actual_amount = p_amount, recovered_at = now(),
        payroll_run_id = COALESCE(p_payroll_run_id, payroll_run_id)
    WHERE id = p_schedule_id AND tenant_id = p_tenant_id
      AND advance_id = p_advance_id AND status = 'pending'
    RETURNING recovery_month INTO v_recovery_month;

    IF v_recovery_month IS NULL THEN
      RAISE EXCEPTION 'ALREADY_RECOVERED: This recovery schedule has already been recovered';
    END IF;
  ELSE
    -- Ad-hoc recovery not tied to a specific schedule row (e.g. a manual
    -- payment outside the normal payroll-deduction cadence) — recorded
    -- against the current tenant month, matching the schedule-driven case's
    -- own recovery_month semantics (a YYYY-MM string).
    v_recovery_month := to_char(now(), 'YYYY-MM');
  END IF;

  INSERT INTO advance_recoveries (
    tenant_id, advance_id, schedule_id, employee_id, payroll_run_id,
    recovery_month, amount, recovery_type, notes, created_by
  ) VALUES (
    p_tenant_id, p_advance_id, p_schedule_id, v_advance.employee_id, p_payroll_run_id,
    v_recovery_month, p_amount, p_recovery_type, p_notes, p_actor_id
  )
  RETURNING id INTO v_recovery_id;

  SELECT count(*) INTO v_pending_count
  FROM advance_recovery_schedules
  WHERE advance_id = p_advance_id AND tenant_id = p_tenant_id AND status = 'pending';

  IF v_pending_count = 0 THEN
    UPDATE advance_salary_requests
    SET status = 'fully_recovered', updated_at = now()
    WHERE id = p_advance_id AND tenant_id = p_tenant_id;
  ELSE
    UPDATE advance_salary_requests
    SET status = 'recovering', updated_at = now()
    WHERE id = p_advance_id AND tenant_id = p_tenant_id AND status = 'disbursed';
  END IF;

  RETURN jsonb_build_object(
    'recovery_id', v_recovery_id,
    'pending_count', v_pending_count,
    'recovery_month', v_recovery_month
  );
END;
$$;
