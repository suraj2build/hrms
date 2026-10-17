-- ═══════════════════════════════════════════════════════════════
-- 451 — Controlled, audited correction for a PAID F&F settlement
--
-- mark_fnf_paid_atomic (445, extended by 448/450) is a one-way door:
-- PATCH /separation-ff/reopen explicitly refuses a 'paid' settlement
-- ("money has already moved, no silent way back to draft"). Before
-- migration 450 that one-way-ness only meant a status flip plus loan
-- foreclosure / advance recovery couldn't be undone through the API —
-- already a real gap, just a narrower one. Migration 450 made it worse:
-- it now also CONSUMES employee_leave_balance (decrements it, writes a
-- leave_balance_ledger row). If that payment later turns out to be wrong
-- — the bank transfer failed, HR cancels the settlement, or it was
-- recorded with the wrong figures — there was no way to recover the
-- consumed leave entitlement (or the foreclosed loan / recovered advance)
-- at all. Disclosure alone doesn't close that: an employee could be left
-- short leave days (or a loan short-closed, or an advance marked
-- recovered) with no system-level corrective action, forcing a manual,
-- unaudited DB edit — exactly what every other atomic function in this
-- series (445/448/450) was built to avoid.
--
-- This migration adds the missing compensating transaction:
-- correct_fnf_payment_atomic reverses EXACTLY what mark_fnf_paid_atomic
-- wrote, scoped precisely to the rows it itself touched (never a loan or
-- advance that happened to reach the same terminal status through a
-- normal, unrelated payroll cycle):
--
--   - employee_loans: only rows with status='foreclosed' AND
--     foreclosure_notes = the exact marker mark_fnf_paid_atomic writes
--     ('Auto-foreclosed on F&F settlement payment') are reverted — back
--     to 'active' (not 'disbursed': POST /payroll/runs's own EMI-recovery
--     query, runs.ts, only ever picks up status='active' loans, so
--     reverting to anything else would silently strand the loan outside
--     normal recovery going forward). outstanding_balance is restored
--     from the stored foreclosure_amount; foreclosed_at/foreclosure_
--     amount/foreclosure_notes are cleared. loan_schedules rows this
--     foreclosure adjusted (status='adjusted') revert to 'pending'.
--   - advance_recoveries: only rows with recovery_type='adjustment' AND
--     the exact notes marker mark_fnf_paid_atomic writes ('Auto-recovered
--     on F&F settlement payment') identify which advance_recovery_
--     schedules rows to revert (status='recovered' -> 'pending',
--     recovered_at cleared) and which advance_salary_requests to revert
--     (status='fully_recovered' -> 'recovering' — correct because the
--     schedules just reverted to 'pending' ARE its remaining recovery).
--     Unlike the GL ledger and leave_balance_ledger, advance_recoveries is
--     NOT append-only: migration 281's UNIQUE(tenant_id, schedule_id)
--     index allows at most one recovery row per schedule ever, and
--     advance_recoveries_amount_nonneg forbids a negative mirror row. The
--     matched row is deleted, not reversed in place — this doesn't depart
--     from this table's own audit model, since it already never supported
--     more than one event per schedule.
--   - employee_leave_balance / leave_balance_ledger: only the exact
--     leave_balance_ledger rows migration 450 wrote for THIS settlement
--     (txn_type='encashment', notes containing this exact
--     separation_ff_summary.id) are located; their leave_type_id/year
--     rows get credited back by the same amount, and a reversal row is
--     inserted using the table's OWN existing reversal mechanism
--     (txn_type='reversal', reversal_of = the original row's id,
--     is_reversal=true — migration 158), not a new ad-hoc type.
--   - separation_ff_summary itself reverts to 'draft', not 'approved':
--     a correction implies the approved figures may themselves need
--     recomputing (this is explicitly one of the three triggering
--     scenarios — "recorded incorrectly") — forcing a fresh compute/
--     approve/pay cycle is safer than leaving stale approved figures one
--     mark-paid call away from being paid again unexamined. paid_by/
--     paid_at are cleared.
--
-- Controlled and audited: FOR UPDATE locks the settlement row and every
-- row it is about to touch up front (same pattern as 445/448/450), raises
-- distinct, actionable error codes, requires a non-empty p_reason (stored
-- on the settlement and returned to the caller for the route's own audit-
-- log write), and is gated to super_admin only at the route layer (money
-- already moved once; undoing that is a bigger action than the hr_admin-
-- level actions elsewhere in this workflow).
-- ═══════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION correct_fnf_payment_atomic(
  p_tenant_id   UUID,
  p_employee_id UUID,
  p_user_id     UUID,
  p_reason      TEXT
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_ff               RECORD;
  v_loan             RECORD;
  v_arec             RECORD;
  v_elb              RECORD;
  v_now              TIMESTAMPTZ := now();
  v_loans_reverted   INT := 0;
  v_advances_reverted JSONB := '[]'::jsonb;
  v_advance_ids      UUID[] := ARRAY[]::UUID[];
  v_leave_days_credited NUMERIC := 0;
BEGIN
  IF p_reason IS NULL OR btrim(p_reason) = '' THEN
    RAISE EXCEPTION 'REASON_REQUIRED: A reason is required to correct a paid F&F settlement';
  END IF;

  SELECT id, status
  INTO   v_ff
  FROM   separation_ff_summary
  WHERE  employee_id = p_employee_id AND tenant_id = p_tenant_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'NOT_FOUND: F&F record not found';
  END IF;

  IF v_ff.status <> 'paid' THEN
    RAISE EXCEPTION 'INVALID_STATE: Only a paid settlement can be corrected (current: %)', v_ff.status;
  END IF;

  -- Lock every row this correction will touch, up front, so nothing (a
  -- concurrent payroll run's own EMI deduction, a concurrent standalone
  -- leave-encashment approval) races the write-back below.
  PERFORM 1 FROM employee_loans
    WHERE employee_id = p_employee_id AND tenant_id = p_tenant_id
      AND status = 'foreclosed' AND foreclosure_notes = 'Auto-foreclosed on F&F settlement payment'
    FOR UPDATE;
  PERFORM 1 FROM loan_schedules ls
    JOIN employee_loans el ON el.id = ls.loan_id
    WHERE el.employee_id = p_employee_id AND el.tenant_id = p_tenant_id AND ls.tenant_id = p_tenant_id
      AND el.status = 'foreclosed' AND el.foreclosure_notes = 'Auto-foreclosed on F&F settlement payment'
      AND ls.status = 'adjusted'
    FOR UPDATE OF ls;
  PERFORM 1 FROM advance_recovery_schedules ars
    WHERE ars.tenant_id = p_tenant_id AND ars.id IN (
      SELECT schedule_id FROM advance_recoveries
      WHERE employee_id = p_employee_id AND tenant_id = p_tenant_id
        AND recovery_type = 'adjustment' AND notes = 'Auto-recovered on F&F settlement payment'
        AND schedule_id IS NOT NULL
    )
    FOR UPDATE;
  PERFORM 1 FROM advance_salary_requests
    WHERE employee_id = p_employee_id AND tenant_id = p_tenant_id AND status = 'fully_recovered'
      AND id IN (
        SELECT advance_id FROM advance_recoveries
        WHERE employee_id = p_employee_id AND tenant_id = p_tenant_id
          AND recovery_type = 'adjustment' AND notes = 'Auto-recovered on F&F settlement payment'
      )
    FOR UPDATE;
  PERFORM 1 FROM employee_leave_balance elb
    WHERE elb.tenant_id = p_tenant_id AND elb.employee_id = p_employee_id
      AND (elb.leave_type_id, elb.year) IN (
        SELECT leave_type_id, year FROM leave_balance_ledger
        WHERE tenant_id = p_tenant_id AND employee_id = p_employee_id
          AND txn_type = 'encashment' AND notes LIKE ('%separation_ff_summary.id=' || v_ff.id || ')%')
      )
    FOR UPDATE OF elb;

  -- ── Loans: revert exactly what this settlement's payment foreclosed ──────
  FOR v_loan IN
    SELECT id, foreclosure_amount FROM employee_loans
    WHERE employee_id = p_employee_id AND tenant_id = p_tenant_id
      AND status = 'foreclosed' AND foreclosure_notes = 'Auto-foreclosed on F&F settlement payment'
  LOOP
    UPDATE employee_loans
    SET    status = 'active', outstanding_balance = COALESCE(v_loan.foreclosure_amount, 0),
           foreclosed_at = NULL, foreclosure_amount = NULL,
           foreclosure_notes = NULL, updated_at = v_now
    WHERE  id = v_loan.id AND tenant_id = p_tenant_id;

    UPDATE loan_schedules
    SET    status = 'pending'
    WHERE  loan_id = v_loan.id AND tenant_id = p_tenant_id AND status = 'adjusted';

    v_loans_reverted := v_loans_reverted + 1;
  END LOOP;

  -- ── Advances: revert exactly what this settlement's payment recovered ───
  -- advance_recoveries is NOT an append-only ledger like leave_balance_
  -- ledger or the GL: migration 281's uidx_advance_recoveries_schedule is a
  -- UNIQUE(tenant_id, schedule_id) index (one recovery row per schedule,
  -- ever — see POST /payroll/advances/recover, which relies on exactly that
  -- to refuse double-recovering a schedule) and advance_recoveries_amount_
  -- nonneg forbids a negative mirror row outright. Reverting the schedule
  -- to 'pending' while the OLD recovery row for that same schedule_id still
  -- existed would permanently violate the unique index the moment that
  -- schedule is legitimately recovered again. Deleting the row is
  -- therefore not a departure from this table's audit model — it already
  -- never supported more than one recovery event per schedule.
  FOR v_arec IN
    SELECT id, advance_id, schedule_id
    FROM advance_recoveries
    WHERE employee_id = p_employee_id AND tenant_id = p_tenant_id
      AND recovery_type = 'adjustment' AND notes = 'Auto-recovered on F&F settlement payment'
  LOOP
    IF v_arec.schedule_id IS NOT NULL THEN
      UPDATE advance_recovery_schedules
      SET    status = 'pending', recovered_at = NULL
      WHERE  id = v_arec.schedule_id AND tenant_id = p_tenant_id AND status = 'recovered';
    END IF;

    DELETE FROM advance_recoveries WHERE id = v_arec.id AND tenant_id = p_tenant_id;

    IF NOT (v_arec.advance_id = ANY(v_advance_ids)) THEN
      v_advance_ids := array_append(v_advance_ids, v_arec.advance_id);
    END IF;
  END LOOP;

  IF array_length(v_advance_ids, 1) > 0 THEN
    UPDATE advance_salary_requests
    SET    status = 'recovering', updated_at = v_now
    WHERE  id = ANY(v_advance_ids) AND tenant_id = p_tenant_id AND status = 'fully_recovered';
    SELECT jsonb_agg(x) INTO v_advances_reverted FROM unnest(v_advance_ids) x;
  END IF;

  -- ── Leave balance: credit back exactly what migration 450 consumed ──────
  -- txn_type='reversal' + reversal_of is the table's own existing mechanism
  -- for this (migration 158), not a new ad-hoc type.
  FOR v_elb IN
    SELECT id, leave_type_id, year, -delta AS credit_back
    FROM leave_balance_ledger
    WHERE tenant_id = p_tenant_id AND employee_id = p_employee_id
      AND txn_type = 'encashment' AND notes LIKE ('%separation_ff_summary.id=' || v_ff.id || ')%')
  LOOP
    UPDATE employee_leave_balance
    SET    balance = balance + v_elb.credit_back, updated_at = v_now
    WHERE  tenant_id = p_tenant_id AND employee_id = p_employee_id
      AND leave_type_id = v_elb.leave_type_id AND year = v_elb.year
    RETURNING balance INTO v_leave_days_credited;

    INSERT INTO leave_balance_ledger (
      tenant_id, employee_id, leave_type_id, year, txn_type,
      delta, balance_after, notes, created_by, reversal_of, is_reversal
    ) VALUES (
      p_tenant_id, p_employee_id, v_elb.leave_type_id, v_elb.year, 'reversal',
      v_elb.credit_back, v_leave_days_credited,
      'F&F payment correction reversal (separation_ff_summary.id=' || v_ff.id || '). Reason: ' || p_reason,
      p_user_id, v_elb.id, true
    );
  END LOOP;

  -- ── Settlement itself: back to draft — figures need a fresh compute ─────
  UPDATE separation_ff_summary
  SET    status = 'draft', paid_by = NULL, paid_at = NULL,
         updated_by = p_user_id, updated_at = v_now,
         correction_reason = p_reason, corrected_by = p_user_id, corrected_at = v_now
  WHERE  id = v_ff.id AND tenant_id = p_tenant_id;

  RETURN jsonb_build_object(
    'id', v_ff.id, 'status', 'draft',
    'loans_reverted', v_loans_reverted,
    'advances_reverted', v_advances_reverted,
    'reason', p_reason
  );
END;
$$;

ALTER FUNCTION correct_fnf_payment_atomic(UUID, UUID, UUID, TEXT) SET search_path = public;

REVOKE EXECUTE ON FUNCTION correct_fnf_payment_atomic(UUID, UUID, UUID, TEXT)
  FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION correct_fnf_payment_atomic(UUID, UUID, UUID, TEXT)
  TO service_role;

-- Audit columns on the settlement itself, so a correction is visible on the
-- row (not only inside maker_checker_log/audit_logs) — mirrors paid_by/
-- paid_at already on this table.
ALTER TABLE separation_ff_summary ADD COLUMN IF NOT EXISTS correction_reason TEXT;
ALTER TABLE separation_ff_summary ADD COLUMN IF NOT EXISTS corrected_by UUID REFERENCES profiles(id) ON DELETE SET NULL;
ALTER TABLE separation_ff_summary ADD COLUMN IF NOT EXISTS corrected_at TIMESTAMPTZ;
