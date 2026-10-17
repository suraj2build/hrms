-- ═══════════════════════════════════════════════════════════════
-- 446 — G12: standalone leave encashment, completed end to end
--
-- The original audit finding (G12): "Standalone leave encashment has no
-- employee request UI; mark-paid only changes status, no proven
-- disbursement path." The request/approve/reject plumbing
-- (leave_encashment_requests, migration 072; processEncashment's atomic
-- balance deduction, migration 269/282) already existed and was sound.
-- What was missing, and what this migration's companion route/engine
-- changes close:
--
--   1. No money. Approval deducted DAYS from the balance but never
--      computed what those days are actually worth, or what tax applies.
--   2. No disbursement path. mark-paid flipped status to 'paid' with no
--      link to an actual payroll run or payslip — nothing a filing/
--      accounting process could trace a real payment to.
--   3. No reversal. An approved-in-error or paid-in-error request had no
--      way back — the employee's balance stayed deducted forever.
--
-- Columns added here:
--   rate_per_day / gross_amount / tds_amount / net_amount — computed at
--     approval time (see accrual-engine.ts's extended processEncashment).
--     rate_per_day mirrors the F&F leave-encashment formula (basis/26)
--     for consistency; tds_amount is a FLAT marginal-slab-rate withholding
--     looked up from the employee's current tds_monthly_projections +
--     it_tax_slabs — not a full Section 10(10AA) exemption computation
--     (government vs non-government treatment, the ₹25L lifetime cap,
--     etc.). That exemption treatment needs tax/compliance sign-off
--     before go-live; this column is a real, working withholding, not a
--     stub, but is deliberately NOT presented as the final statutory
--     figure. See the PR description's G12 section for the explicit
--     disclosure.
--   payroll_run_id — the draft payroll run this was actually posted into
--     (see mark_leave_encashment_paid_atomic below). NULL until paid;
--     once set, it is the one and only run this request was ever paid
--     through — the status='approved' precondition on the pay-atomic
--     function's own UPDATE is what makes a second payment attempt 409,
--     not a uniqueness constraint on this column (many requests legally
--     share one run).
--   reversed_at / reversed_by / reversal_reason — set by
--     reverse_leave_encashment_atomic.
--   version — optimistic-locking column, same convention as migration 430.
-- ═══════════════════════════════════════════════════════════════

ALTER TABLE leave_encashment_requests
  ADD COLUMN IF NOT EXISTS rate_per_day     NUMERIC(14,2),
  ADD COLUMN IF NOT EXISTS gross_amount     NUMERIC(14,2),
  ADD COLUMN IF NOT EXISTS tds_amount       NUMERIC(14,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS net_amount       NUMERIC(14,2),
  ADD COLUMN IF NOT EXISTS payroll_run_id   UUID REFERENCES payroll_runs(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS reversed_at      TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS reversed_by      UUID REFERENCES profiles(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS reversal_reason  TEXT,
  ADD COLUMN IF NOT EXISTS version          INT NOT NULL DEFAULT 1;

CREATE INDEX IF NOT EXISTS idx_ler_payroll_run ON leave_encashment_requests (tenant_id, payroll_run_id) WHERE payroll_run_id IS NOT NULL;

ALTER TABLE leave_encashment_requests DROP CONSTRAINT IF EXISTS ler_status_check;
ALTER TABLE leave_encashment_requests
  ADD CONSTRAINT ler_status_check CHECK (status IN ('pending', 'approved', 'rejected', 'paid', 'reversed'));

DROP TRIGGER IF EXISTS trg_leave_encashment_requests_version ON leave_encashment_requests;
CREATE TRIGGER trg_leave_encashment_requests_version
  BEFORE UPDATE ON leave_encashment_requests
  FOR EACH ROW EXECUTE FUNCTION increment_version_column();

-- ─────────────────────────────────────────────────────────────────────────────
-- mark_leave_encashment_paid_atomic — posts the approved payout into a named,
-- still-draft payroll run's payslip for this employee (a real earning +
-- withholding line that then goes through the normal finalize flow, so
-- migration 438's finalized-value lockdown protects it exactly like every
-- other payslip figure once finalized), and flips the request to 'paid' in
-- the same transaction. FOR UPDATE locks both rows up front so a concurrent
-- second mark-paid attempt (same request, or a run-recompute step touching
-- the same slip) cannot interleave with this write.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION mark_leave_encashment_paid_atomic(
  p_tenant_id       UUID,
  p_request_id      UUID,
  p_payroll_run_id  UUID,
  p_user_id         UUID
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_req    RECORD;
  v_run    RECORD;
  v_slip   RECORD;
  v_new_components JSONB;
  v_now    TIMESTAMPTZ := now();
BEGIN
  SELECT id, employee_id, status, gross_amount, tds_amount
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
  IF v_run.status <> 'draft' THEN
    RAISE EXCEPTION 'RUN_NOT_DRAFT: Payroll run is % — pick a draft run, or roll this one back to draft first', v_run.status;
  END IF;

  SELECT id, gross_pay, total_deductions, net_pay, component_breakdown, status
  INTO   v_slip
  FROM   payroll_slips
  WHERE  run_id = p_payroll_run_id AND employee_id = v_req.employee_id AND tenant_id = p_tenant_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'NO_PAYSLIP: This employee has no payslip in that run — pick a run that includes them';
  END IF;
  IF v_slip.status <> 'draft' THEN
    RAISE EXCEPTION 'RUN_NOT_DRAFT: This employee''s payslip in that run is % — pick a draft run', v_slip.status;
  END IF;

  v_new_components := v_slip.component_breakdown
    || jsonb_build_array(
         jsonb_build_object('code', 'LEAVE_ENCASHMENT', 'name', 'Leave Encashment', 'type', 'earning', 'calc_type', 'flat', 'monthly_amount', v_req.gross_amount, 'is_employer_contrib', false),
         jsonb_build_object('code', 'TDS', 'name', 'TDS on Leave Encashment', 'type', 'deduction', 'calc_type', 'flat', 'monthly_amount', v_req.tds_amount, 'is_employer_contrib', false)
       );

  UPDATE payroll_slips
  SET    gross_pay           = gross_pay + v_req.gross_amount,
         total_deductions    = total_deductions + v_req.tds_amount,
         net_pay             = (gross_pay + v_req.gross_amount) - (total_deductions + v_req.tds_amount),
         tds_deducted        = (
           SELECT COALESCE(SUM((c->>'monthly_amount')::numeric), 0)
           FROM jsonb_array_elements(v_new_components) c
           WHERE c->>'code' = 'TDS'
         ),
         component_breakdown = v_new_components,
         updated_at          = v_now
  WHERE  id = v_slip.id AND tenant_id = p_tenant_id;

  -- Keep the run's own aggregate totals in sync with the slip-level change —
  -- otherwise the run's reported total_gross/total_deductions/total_net
  -- would silently drift from the sum of its own slips.
  UPDATE payroll_runs
  SET    total_gross      = total_gross + v_req.gross_amount,
         total_deductions = total_deductions + v_req.tds_amount,
         total_net        = total_net + (v_req.gross_amount - v_req.tds_amount),
         updated_at       = v_now
  WHERE  id = p_payroll_run_id AND tenant_id = p_tenant_id;

  UPDATE leave_encashment_requests
  SET    status = 'paid', paid_at = v_now, payroll_run_id = p_payroll_run_id
  WHERE  id = p_request_id AND tenant_id = p_tenant_id AND status = 'approved';

  RETURN jsonb_build_object('id', v_req.id, 'status', 'paid', 'payroll_run_id', p_payroll_run_id, 'payslip_id', v_slip.id);
END;
$$;

ALTER FUNCTION mark_leave_encashment_paid_atomic(UUID, UUID, UUID, UUID) SET search_path = public;
REVOKE EXECUTE ON FUNCTION mark_leave_encashment_paid_atomic(UUID, UUID, UUID, UUID) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION mark_leave_encashment_paid_atomic(UUID, UUID, UUID, UUID) TO service_role;

-- ─────────────────────────────────────────────────────────────────────────────
-- reverse_leave_encashment_atomic — undoes an 'approved' or 'paid' request:
-- credits the leave balance back (idempotent via leave_accrual_ledger's own
-- unique constraint on (tenant_id, accrual_type, source_request_id, year),
-- exactly like reverse_leave_request_atomic (migration 286) does for regular
-- leave), and if the request was already posted into a draft payslip,
-- removes that posting too. Refuses if the linked payslip has since been
-- finalized — migration 438's own lockdown would reject that write anyway;
-- this returns a clear error instead of a raw trigger exception, and names
-- the fix (roll the run back to draft first).
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
  v_req     RECORD;
  v_slip    RECORD;
  v_inserted BOOLEAN := false;
  v_now     TIMESTAMPTZ := now();
  v_filtered JSONB;
BEGIN
  SELECT id, employee_id, leave_type_id, year, days, status, payroll_run_id, gross_amount, tds_amount
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
    SELECT id, status, component_breakdown, gross_pay, total_deductions
    INTO   v_slip
    FROM   payroll_slips
    WHERE  run_id = v_req.payroll_run_id AND employee_id = v_req.employee_id AND tenant_id = p_tenant_id
    FOR UPDATE;

    IF FOUND AND v_slip.status <> 'draft' THEN
      RAISE EXCEPTION 'PAYROLL_FINALIZED: This payout was posted into a payslip that is now % — roll that payroll run back to draft before reversing', v_slip.status;
    END IF;

    IF FOUND THEN
      -- Remove exactly the two lines this payout added, leaving any other
      -- LEAVE_ENCASHMENT/TDS lines (a different request, unlikely but not
      -- assumed impossible) untouched — filter by matching amount, not just code.
      SELECT jsonb_agg(c) INTO v_filtered
      FROM jsonb_array_elements(v_slip.component_breakdown) c
      WHERE NOT (
        (c->>'code' = 'LEAVE_ENCASHMENT' AND (c->>'monthly_amount')::numeric = v_req.gross_amount)
        OR (c->>'code' = 'TDS' AND (c->>'monthly_amount')::numeric = v_req.tds_amount AND c->>'name' = 'TDS on Leave Encashment')
      );

      UPDATE payroll_slips
      SET    gross_pay           = gross_pay - v_req.gross_amount,
             total_deductions    = total_deductions - v_req.tds_amount,
             net_pay             = (gross_pay - v_req.gross_amount) - (total_deductions - v_req.tds_amount),
             tds_deducted        = (
               SELECT COALESCE(SUM((c->>'monthly_amount')::numeric), 0)
               FROM jsonb_array_elements(COALESCE(v_filtered, '[]'::jsonb)) c
               WHERE c->>'code' = 'TDS'
             ),
             component_breakdown = COALESCE(v_filtered, '[]'::jsonb),
             updated_at          = v_now
      WHERE  id = v_slip.id AND tenant_id = p_tenant_id;

      UPDATE payroll_runs
      SET    total_gross      = total_gross - v_req.gross_amount,
             total_deductions = total_deductions - v_req.tds_amount,
             total_net        = total_net - (v_req.gross_amount - v_req.tds_amount),
             updated_at       = v_now
      WHERE  id = v_req.payroll_run_id AND tenant_id = p_tenant_id;
    END IF;
  END IF;

  UPDATE leave_encashment_requests
  SET    status = 'reversed', reversed_by = p_actor_id, reversed_at = v_now, reversal_reason = p_reason
  WHERE  id = p_request_id AND tenant_id = p_tenant_id AND status = v_req.status;

  -- Idempotent credit-back, same pattern as reverse_leave_request_atomic.
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
