-- ═══════════════════════════════════════════════════════════════
-- 447 — G12 follow-up: encashment payout must survive payroll regeneration
--
-- A review found migration 446's design had a real, confirmed data-loss
-- defect: mark_leave_encashment_paid_atomic posted the payout into an
-- ALREADY-PERSISTED payroll_slips row and immediately flipped the request
-- to 'paid'. But POST /payroll/runs is explicitly documented (runs.ts) to
-- allow re-running a non-finalized month: "the re-run upsert... would
-- reset the run to 'processing', delete all slips, and recompute." A
-- regeneration after assignment would silently WIPE the posted
-- gross/TDS/component lines from the slip while leave_encashment_requests
-- still said status='paid' with a payroll_run_id — money gone from the
-- payslip, system still claiming it was paid.
--
-- There is no way to make a post-hoc mutation both (a) safe from
-- regeneration and (b) compliant with migration 438's finalized-value
-- lockdown — draft slips are exactly the ones regeneration can destroy,
-- and finalized slips are exactly the ones the lockdown trigger refuses to
-- update. The only correct design is: the payout must be part of the SAME
-- computation every (re)generation already runs (apps/api/src/routes/
-- payroll/runs.ts's computeOneEmployee → fetchEncashmentPayout →
-- lib/payroll-engine.ts's applyEncashmentPayout), so regenerating
-- reconstructs the identical result instead of losing it — and "paid"
-- must only become true once the run is actually FINALIZED, not when HR
-- merely picks a run.
--
-- New model:
--   1. assign_leave_encashment_to_payroll_run_atomic — HR picks a draft
--      run. Sets payroll_run_id; status STAYS 'approved' (not yet paid).
--      No slip/run mutation here at all — nothing to lose on regeneration,
--      because nothing is written to payroll_slips at this step.
--   2. Every (re)generation of that run's slip for this employee
--      (computeOneEmployee, unconditionally — same code path whether this
--      is the first generation or the hundredth re-run) queries
--      leave_encashment_requests WHERE payroll_run_id = this run AND
--      status = 'approved' and folds gross/TDS into the slip fresh. Always
--      the same source-of-truth read → always the same result.
--   3. fn_finalize_leave_encashments_for_run — called by the finalize route
--      AFTER slips are confirmed finalized (same non-fatal-step pattern the
--      finalize route already uses for advance/loan schedules). Only here
--      does status become 'paid' — because only here is the number
--      actually locked in (migration 438's trigger now protects it).
--   4. fn_revert_leave_encashments_for_rollback — called by the rollback
--      route. A 'paid' request is no longer actually paid once its run is
--      back in draft, so it reverts to 'approved' (still assigned — the
--      next regeneration picks it up again).
--   5. Deleting a run needs no special handling: payroll_run_id's existing
--      ON DELETE SET NULL (migration 446) already unassigns it, and a
--      finalized run can't be deleted without rolling back first (existing
--      guard in the DELETE route) — so a 'paid' request's run is never
--      silently deleted out from under it.
--
-- mark_leave_encashment_paid_atomic (446) is replaced entirely — it mutated
-- payroll_slips/payroll_runs directly, which no longer happens anywhere in
-- this design. reverse_leave_encashment_atomic (446) is replaced with a
-- version that no longer touches payroll_slips/payroll_runs either, for
-- the same reason — the slip's content is now always derived, not stored
-- state to surgically undo.
-- ═══════════════════════════════════════════════════════════════

DROP FUNCTION IF EXISTS mark_leave_encashment_paid_atomic(UUID, UUID, UUID, UUID);

-- ─────────────────────────────────────────────────────────────────────────────
-- assign_leave_encashment_to_payroll_run_atomic
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION assign_leave_encashment_to_payroll_run_atomic(
  p_tenant_id      UUID,
  p_request_id     UUID,
  p_payroll_run_id UUID
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_req RECORD;
  v_run RECORD;
BEGIN
  SELECT id, status, payroll_run_id, employee_id, gross_amount
  INTO   v_req
  FROM   leave_encashment_requests
  WHERE  id = p_request_id AND tenant_id = p_tenant_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'NOT_FOUND: Encashment request not found';
  END IF;
  IF v_req.status <> 'approved' THEN
    RAISE EXCEPTION 'ALREADY_DECIDED: This encashment request is no longer in approved status (current: %)', v_req.status;
  END IF;
  IF v_req.payroll_run_id IS NOT NULL THEN
    RAISE EXCEPTION 'ALREADY_ASSIGNED: This request is already assigned to a payroll run';
  END IF;
  IF v_req.gross_amount IS NULL THEN
    RAISE EXCEPTION 'NOT_COMPUTED: This request has no computed payout amount — it predates the amount computation and must be re-approved';
  END IF;

  SELECT id, status INTO v_run
  FROM payroll_runs
  WHERE id = p_payroll_run_id AND tenant_id = p_tenant_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'RUN_NOT_FOUND: Payroll run not found';
  END IF;
  IF v_run.status NOT IN ('draft', 'partial_failed') THEN
    RAISE EXCEPTION 'RUN_NOT_DRAFT: Payroll run is % — pick a draft run', v_run.status;
  END IF;

  PERFORM 1 FROM payroll_slips
  WHERE run_id = p_payroll_run_id AND employee_id = v_req.employee_id AND tenant_id = p_tenant_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'NO_PAYSLIP: This employee has no payslip in that run — pick a run that includes them';
  END IF;

  UPDATE leave_encashment_requests
  SET    payroll_run_id = p_payroll_run_id
  WHERE  id = p_request_id AND tenant_id = p_tenant_id AND status = 'approved' AND payroll_run_id IS NULL;

  RETURN jsonb_build_object('id', v_req.id, 'status', 'approved', 'payroll_run_id', p_payroll_run_id,
    'note', 'Assigned, not yet paid — re-run (or run) payroll for this month so the payslip reflects it, then finalize to mark paid.');
END;
$$;

ALTER FUNCTION assign_leave_encashment_to_payroll_run_atomic(UUID, UUID, UUID) SET search_path = public;
REVOKE EXECUTE ON FUNCTION assign_leave_encashment_to_payroll_run_atomic(UUID, UUID, UUID) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION assign_leave_encashment_to_payroll_run_atomic(UUID, UUID, UUID) TO service_role;

-- ─────────────────────────────────────────────────────────────────────────────
-- fn_finalize_leave_encashments_for_run — called by POST /payroll/runs/:id/finalize
-- AFTER slips are confirmed finalized.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION fn_finalize_leave_encashments_for_run(
  p_tenant_id UUID,
  p_run_id    UUID
) RETURNS INT
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_count INT;
BEGIN
  UPDATE leave_encashment_requests
  SET    status = 'paid', paid_at = now()
  WHERE  tenant_id = p_tenant_id AND payroll_run_id = p_run_id AND status = 'approved';
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;

ALTER FUNCTION fn_finalize_leave_encashments_for_run(UUID, UUID) SET search_path = public;
REVOKE EXECUTE ON FUNCTION fn_finalize_leave_encashments_for_run(UUID, UUID) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION fn_finalize_leave_encashments_for_run(UUID, UUID) TO service_role;

-- ─────────────────────────────────────────────────────────────────────────────
-- fn_revert_leave_encashments_for_rollback — called by POST /payroll/runs/:id/rollback
-- AFTER the run is reset to draft and its slips deleted.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION fn_revert_leave_encashments_for_rollback(
  p_tenant_id UUID,
  p_run_id    UUID
) RETURNS INT
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_count INT;
BEGIN
  UPDATE leave_encashment_requests
  SET    status = 'approved', paid_at = NULL
  WHERE  tenant_id = p_tenant_id AND payroll_run_id = p_run_id AND status = 'paid';
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;

ALTER FUNCTION fn_revert_leave_encashments_for_rollback(UUID, UUID) SET search_path = public;
REVOKE EXECUTE ON FUNCTION fn_revert_leave_encashments_for_rollback(UUID, UUID) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION fn_revert_leave_encashments_for_rollback(UUID, UUID) TO service_role;

-- ─────────────────────────────────────────────────────────────────────────────
-- reverse_leave_encashment_atomic — replaced. No longer touches
-- payroll_slips/payroll_runs (there is no stored posting to surgically
-- undo any more — the slip's content is always derived fresh at
-- generation time from this table's own status/payroll_run_id). Refuses
-- to reverse a 'paid' request whose run is still finalized (the slip's
-- numbers are locked by migration 438 either way) — roll the run back to
-- draft first, which itself reverts the request to 'approved' via
-- fn_revert_leave_encashments_for_rollback above, then reverse normally.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION reverse_leave_encashment_atomic(
  p_tenant_id   UUID,
  p_request_id  UUID,
  p_actor_id    UUID,
  p_reason      TEXT
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_req      RECORD;
  v_run      RECORD;
  v_inserted BOOLEAN := false;
  v_now      TIMESTAMPTZ := now();
BEGIN
  SELECT id, employee_id, leave_type_id, year, days, status, payroll_run_id
  INTO   v_req
  FROM   leave_encashment_requests
  WHERE  id = p_request_id AND tenant_id = p_tenant_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'NOT_FOUND: Encashment request not found';
  END IF;
  IF v_req.status NOT IN ('approved', 'paid') THEN
    RAISE EXCEPTION 'CONFLICT: Only an approved or paid request can be reversed (current: %)', v_req.status;
  END IF;

  IF v_req.status = 'paid' AND v_req.payroll_run_id IS NOT NULL THEN
    SELECT id, status INTO v_run
    FROM payroll_runs WHERE id = v_req.payroll_run_id AND tenant_id = p_tenant_id
    FOR UPDATE;
    IF FOUND AND v_run.status = 'finalized' THEN
      RAISE EXCEPTION 'PAYROLL_FINALIZED: This payout was posted into a payroll run that is now finalized — roll that run back to draft before reversing';
    END IF;
  END IF;

  UPDATE leave_encashment_requests
  SET    status = 'reversed', reversed_by = p_actor_id, reversed_at = v_now, reversal_reason = p_reason,
         payroll_run_id = NULL, paid_at = NULL
  WHERE  id = p_request_id AND tenant_id = p_tenant_id AND status = v_req.status;

  -- Idempotent credit-back, same pattern as reverse_leave_request_atomic (286).
  INSERT INTO leave_accrual_ledger (
    tenant_id, employee_id, leave_type_id, year, accrual_type,
    days, accrued_on, is_expired, notes, source_request_id
  ) VALUES (
    p_tenant_id, v_req.employee_id, v_req.leave_type_id, v_req.year, 'reversal',
    ABS(v_req.days), v_now::date, false,
    'Leave encashment reversed — ' || v_req.days || ' days credited back' || COALESCE(': ' || p_reason, ''),
    p_request_id
  )
  ON CONFLICT (tenant_id, accrual_type, source_request_id, year) DO NOTHING;
  GET DIAGNOSTICS v_inserted = ROW_COUNT;

  IF v_inserted THEN
    UPDATE employee_leave_balance
    SET    balance    = balance + v_req.days,
           updated_at = v_now
    WHERE  tenant_id     = p_tenant_id
      AND  employee_id   = v_req.employee_id
      AND  leave_type_id = v_req.leave_type_id
      AND  year          = v_req.year;

    INSERT INTO leave_balance_ledger (
      tenant_id, employee_id, leave_type_id, year, txn_type,
      delta, balance_after, encashment_id, notes, created_by
    )
    SELECT p_tenant_id, v_req.employee_id, v_req.leave_type_id, v_req.year, 'reversal',
           v_req.days, COALESCE(balance, 0), p_request_id,
           'Leave encashment reversed — ' || v_req.days || ' days credited back', p_actor_id
    FROM employee_leave_balance
    WHERE tenant_id = p_tenant_id AND employee_id = v_req.employee_id
      AND leave_type_id = v_req.leave_type_id AND year = v_req.year;
  END IF;

  RETURN jsonb_build_object('id', v_req.id, 'status', 'reversed', 'days_credited_back', v_req.days, 'balance_credit_applied', v_inserted);
END;
$$;

ALTER FUNCTION reverse_leave_encashment_atomic(UUID, UUID, UUID, TEXT) SET search_path = public;
REVOKE EXECUTE ON FUNCTION reverse_leave_encashment_atomic(UUID, UUID, UUID, TEXT) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION reverse_leave_encashment_atomic(UUID, UUID, UUID, TEXT) TO service_role;
