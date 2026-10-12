-- ═══════════════════════════════════════════════════════════════
-- 452 — Close the rollback-vs-ledger/statutory race; make the F&F
-- correction's deletions durably auditable; require recovery evidence
--
-- A review of round 5's rollback and correction fixes found they proved
-- the right INVARIANTS but not that they hold under CONCURRENCY, and
-- found the correction's deletion of advance_recoveries rows (required
-- by migration 281's own schema — see 451's header) was not itself
-- durably audited. Three distinct gaps, all closed here:
--
-- 1. ROLLBACK CONCURRENCY. Migration-451-era rollback checked
--    payroll_financial_ledgers/statutory_filing_closures with a plain,
--    unlocked SELECT, then did a SEPARATE UPDATE to flip payroll_runs to
--    'draft'. Nothing stopped POST /payroll/ledgers/:id/post or
--    POST /payroll/statutory-reconciliation/close from landing in the
--    gap between that check and that write — either operation could
--    create exactly the posted-ledger/filed-closure fact rollback had
--    just confirmed didn't exist, a split-second too late to be caught.
--    Fixed with the SAME pattern every other money-safety function in
--    this series uses (mark_fnf_paid_atomic, correct_fnf_payment_atomic):
--    SELECT ... FOR UPDATE on the payroll_runs row as the FIRST action in
--    all three operations — rollback, ledger-post, and statutory-close —
--    so whichever gets there first forces the others to wait, re-check
--    fresh state, and correctly lose. All three lock payroll_runs before
--    touching any child table, in that order, so none of them can
--    deadlock against each other over lock-acquisition order.
--      - rollback_payroll_run_atomic: locks the run, re-validates
--        (status, posted ledger, filed closure — a reversal ledger is
--        still excluded, same as the route-level fix it replaces), and
--        flips status to 'draft', all inside the lock. Also closes a
--        related TOCTOU on authorization itself: the super_admin-only
--        check for rolling back a FINALIZED run is now re-verified
--        AFTER the lock is held, against the row's actual current
--        status, not a stale pre-lock read.
--      - mark_ledger_posted_atomic: locks the run (via the ledger's own
--        run_id) before locking/checking/posting the ledger itself.
--      - close_statutory_filing_atomic: locks the run before inserting
--        any filing row, and re-does the idempotency ("already filed")
--        check fresh under the lock, not just the route's own earlier,
--        unlocked read.
--
-- 2. DURABLE CORRECTION AUDIT. correct_fnf_payment_atomic (451) deleted
--    the matched advance_recoveries row outright — required by migration
--    281's UNIQUE(tenant_id, schedule_id) index and amount>=0 constraint,
--    which make an append-only mirror row impossible for that table (see
--    451's header for the full reasoning). But deleting a financial
--    record with nothing durable capturing what it said before it's gone
--    is its own gap: new table fnf_payment_correction_log (append-only —
--    INSERT-only RLS policy, same pattern as leave_balance_ledger)
--    captures the FULL original row (amount, schedule_id, advance_id,
--    payroll_run_id, recovery_month, recovery_type, created_by,
--    created_at — the "payment linkage" a deleted row would otherwise
--    take with it) as original_data JSONB, one row per loan reverted /
--    advance-recovery deleted / leave-balance credit, inside the SAME
--    transaction as the correction itself.
--
-- 3. RECOVERY EVIDENCE IS NOW A SEPARATE, MANDATORY FIELD. A database
--    reversal does not itself reverse a bank transfer. correct_fnf_
--    payment_atomic gains a second mandatory parameter, p_recovery_
--    reference, distinct from p_reason: p_reason is the business reason
--    ("why"); p_recovery_reference is the evidence that the real-world
--    money was actually handled (a bank reversal/UTR reference, an
--    employee refund acknowledgement, or an explicit statement that no
--    money had moved yet when correcting). Both are required and both
--    are stored — on separation_ff_summary (new recovery_reference
--    column, alongside 451's correction_reason) and on every
--    fnf_payment_correction_log row — so the DB record can never imply
--    the money question was answered when it wasn't asked.
-- ═══════════════════════════════════════════════════════════════

-- ── 1a. rollback_payroll_run_atomic ──────────────────────────────────────────
CREATE OR REPLACE FUNCTION rollback_payroll_run_atomic(
  p_tenant_id         UUID,
  p_run_id            UUID,
  p_is_super_admin    BOOLEAN
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_run            RECORD;
  v_posted_ledger  UUID;
  v_filed_statutes TEXT;
BEGIN
  SELECT id, month, status INTO v_run
  FROM payroll_runs
  WHERE id = p_run_id AND tenant_id = p_tenant_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'NOT_FOUND: Run not found';
  END IF;

  IF v_run.status = 'processing' THEN
    RAISE EXCEPTION 'PROCESSING: Cannot rollback a run that is currently processing';
  END IF;

  -- Authorization re-verified AFTER the lock, against the real current
  -- status — not the route's own pre-lock read, which could be stale if
  -- a concurrent finalize landed between that read and this function
  -- acquiring the lock.
  IF v_run.status = 'finalized' AND NOT p_is_super_admin THEN
    RAISE EXCEPTION 'FORBIDDEN: Only super_admin may rollback a finalized run';
  END IF;

  -- A reversal ledger always auto-posts (it IS the undo record) — exclude
  -- it from the block, or "reverse, then roll back" could never proceed.
  SELECT id INTO v_posted_ledger
  FROM payroll_financial_ledgers
  WHERE tenant_id = p_tenant_id AND run_id = p_run_id
    AND ledger_status = 'posted' AND reverses_ledger_id IS NULL
  LIMIT 1;
  IF FOUND THEN
    RAISE EXCEPTION 'LEDGER_POSTED: This run has a posted GL ledger (%). Reverse it first via POST /payroll/ledgers/:ledgerId/reverse before rolling back this run.', v_posted_ledger;
  END IF;

  SELECT string_agg(DISTINCT statutory_type, ', ') INTO v_filed_statutes
  FROM statutory_filing_closures
  WHERE tenant_id = p_tenant_id AND month = v_run.month AND status IN ('filed', 'confirmed');
  IF v_filed_statutes IS NOT NULL THEN
    RAISE EXCEPTION 'STATUTORY_FILING_EXISTS: % has filed statutory closures (%). Reopen them first via POST /payroll/statutory-reconciliation/reopen before rolling back this run.', v_run.month, v_filed_statutes;
  END IF;

  UPDATE payroll_runs
  SET    status = 'draft', finalized_at = NULL, error_message = NULL, failure_summary = NULL
  WHERE  id = p_run_id AND tenant_id = p_tenant_id;

  RETURN jsonb_build_object('run_id', p_run_id, 'month', v_run.month, 'status', 'draft');
END;
$$;

ALTER FUNCTION rollback_payroll_run_atomic(UUID, UUID, BOOLEAN) SET search_path = public;
REVOKE EXECUTE ON FUNCTION rollback_payroll_run_atomic(UUID, UUID, BOOLEAN) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION rollback_payroll_run_atomic(UUID, UUID, BOOLEAN) TO service_role;

-- ── 1b. mark_ledger_posted_atomic ────────────────────────────────────────────
CREATE OR REPLACE FUNCTION mark_ledger_posted_atomic(
  p_tenant_id UUID,
  p_ledger_id UUID,
  p_user_id   UUID
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_run_id UUID;
  v_run    RECORD;
  v_ledger RECORD;
  v_now    TIMESTAMPTZ := now();
BEGIN
  SELECT run_id INTO v_run_id
  FROM payroll_financial_ledgers
  WHERE id = p_ledger_id AND tenant_id = p_tenant_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'NOT_FOUND: Ledger not found';
  END IF;

  -- Lock the run row FIRST — same order rollback_payroll_run_atomic uses —
  -- so the two can never deadlock against each other.
  SELECT id, status INTO v_run
  FROM payroll_runs WHERE id = v_run_id AND tenant_id = p_tenant_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'NOT_FOUND: Run not found';
  END IF;
  IF v_run.status <> 'finalized' THEN
    RAISE EXCEPTION 'RUN_NOT_FINALIZED: Payroll run is no longer finalized (current: %) — it may have been rolled back concurrently; this ledger cannot be posted against it.', v_run.status;
  END IF;

  SELECT id, ledger_status, total_debit, total_credit INTO v_ledger
  FROM payroll_financial_ledgers
  WHERE id = p_ledger_id AND tenant_id = p_tenant_id
  FOR UPDATE;

  IF v_ledger.ledger_status = 'posted' THEN
    RAISE EXCEPTION 'ALREADY_POSTED: Ledger is already posted';
  END IF;
  IF v_ledger.ledger_status <> 'balanced' THEN
    RAISE EXCEPTION 'NOT_BALANCED: Ledger must be balanced before posting. Current status: %, Debit: %, Credit: %', v_ledger.ledger_status, v_ledger.total_debit, v_ledger.total_credit;
  END IF;

  UPDATE payroll_financial_ledgers
  SET    ledger_status = 'posted', posted_at = v_now, posted_by = p_user_id
  WHERE  id = p_ledger_id AND tenant_id = p_tenant_id;

  RETURN jsonb_build_object('ledger_id', p_ledger_id, 'run_id', v_run_id, 'posted_at', v_now);
END;
$$;

ALTER FUNCTION mark_ledger_posted_atomic(UUID, UUID, UUID) SET search_path = public;
REVOKE EXECUTE ON FUNCTION mark_ledger_posted_atomic(UUID, UUID, UUID) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION mark_ledger_posted_atomic(UUID, UUID, UUID) TO service_role;

-- ── 1c. close_statutory_filing_atomic ────────────────────────────────────────
-- Takes the already-computed candidate rows (buildStatutoryRecon's
-- reconciliation logic stays in TS — it reads payroll_slips, tds_monthly_
-- projections, EPF/ESI/PT contribution tables and is not worth re-deriving
-- in plpgsql) and re-validates, under the SAME run-row lock rollback and
-- ledger-post use, that the run is still finalized and that none of these
-- rows have been filed by a concurrent request since the route's own
-- (unlocked, advisory-only) idempotency check.
CREATE OR REPLACE FUNCTION close_statutory_filing_atomic(
  p_tenant_id UUID,
  p_run_id    UUID,
  p_rows      JSONB
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_run     RECORD;
  v_row     JSONB;
  v_filed   TEXT[] := ARRAY[]::TEXT[];
  v_skipped TEXT[] := ARRAY[]::TEXT[];
BEGIN
  SELECT id, month, status INTO v_run
  FROM payroll_runs WHERE id = p_run_id AND tenant_id = p_tenant_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'NOT_FOUND: Run not found';
  END IF;
  IF v_run.status <> 'finalized' THEN
    RAISE EXCEPTION 'RUN_NOT_FINALIZED: Payroll run for % is no longer finalized (current: %) — it may have been rolled back concurrently.', v_run.month, v_run.status;
  END IF;

  FOR v_row IN SELECT * FROM jsonb_array_elements(p_rows)
  LOOP
    IF EXISTS (
      SELECT 1 FROM statutory_filing_closures
      WHERE tenant_id = p_tenant_id AND month = (v_row->>'month') AND statutory_type = (v_row->>'statutory_type')
    ) THEN
      v_skipped := array_append(v_skipped, v_row->>'statutory_type');
      CONTINUE;
    END IF;

    INSERT INTO statutory_filing_closures (
      tenant_id, month, statutory_type, status, run_id,
      computed_amount, payable_amount, variance, snapshot,
      challan_number, reference_note, filed_by, filed_at
    ) VALUES (
      p_tenant_id, v_row->>'month', v_row->>'statutory_type', 'filed', p_run_id,
      (v_row->>'computed_amount')::numeric, (v_row->>'payable_amount')::numeric, (v_row->>'variance')::numeric,
      v_row->'snapshot', v_row->>'challan_number', v_row->>'reference_note',
      NULLIF(v_row->>'filed_by', '')::uuid, (v_row->>'filed_at')::timestamptz
    );
    v_filed := array_append(v_filed, v_row->>'statutory_type');
  END LOOP;

  RETURN jsonb_build_object('filed', to_jsonb(v_filed), 'skipped_already_filed', to_jsonb(v_skipped));
END;
$$;

ALTER FUNCTION close_statutory_filing_atomic(UUID, UUID, JSONB) SET search_path = public;
REVOKE EXECUTE ON FUNCTION close_statutory_filing_atomic(UUID, UUID, JSONB) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION close_statutory_filing_atomic(UUID, UUID, JSONB) TO service_role;

-- ── 2. Durable correction audit log (append-only) ────────────────────────────
CREATE TABLE IF NOT EXISTS fnf_payment_correction_log (
  id                       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id                UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  separation_ff_summary_id UUID NOT NULL REFERENCES separation_ff_summary(id) ON DELETE CASCADE,
  employee_id              UUID NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  correction_type          TEXT NOT NULL CHECK (correction_type IN (
                              'loan_reverted', 'advance_recovery_deleted', 'leave_balance_credited'
                            )),
  -- Full original row this correction superseded/deleted, so a deleted
  -- advance_recoveries row's amount/schedule_id/advance_id/payroll_run_id
  -- (its "payment linkage") is never actually lost.
  original_data            JSONB NOT NULL,
  reason                   TEXT NOT NULL,
  recovery_reference       TEXT NOT NULL,
  created_by                UUID REFERENCES profiles(id) ON DELETE SET NULL,
  created_at               TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_fpcl_tenant_ff ON fnf_payment_correction_log (tenant_id, separation_ff_summary_id);

ALTER TABLE fnf_payment_correction_log ENABLE ROW LEVEL SECURITY;
CREATE POLICY "fpcl_tenant_read" ON fnf_payment_correction_log
  FOR SELECT USING (tenant_id = get_user_tenant_id());
CREATE POLICY "fpcl_hr_insert" ON fnf_payment_correction_log
  FOR INSERT WITH CHECK (tenant_id = get_user_tenant_id());

-- ── 3. correct_fnf_payment_atomic: recovery evidence + durable audit ────────
DROP FUNCTION IF EXISTS correct_fnf_payment_atomic(UUID, UUID, UUID, TEXT);

CREATE OR REPLACE FUNCTION correct_fnf_payment_atomic(
  p_tenant_id         UUID,
  p_employee_id       UUID,
  p_user_id           UUID,
  p_reason            TEXT,
  p_recovery_reference TEXT
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
  IF p_recovery_reference IS NULL OR btrim(p_recovery_reference) = '' THEN
    RAISE EXCEPTION 'RECOVERY_REFERENCE_REQUIRED: A database reversal alone does not reverse a bank payment — record how the actual money was recovered/refunded (a bank reversal/UTR reference, an employee refund acknowledgement, or an explicit confirmation that no money had moved yet) before correcting this settlement';
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

  -- ── Loans ────────────────────────────────────────────────────────────────
  FOR v_loan IN
    SELECT id, foreclosure_amount, outstanding_balance, foreclosed_at, foreclosure_notes
    FROM employee_loans
    WHERE employee_id = p_employee_id AND tenant_id = p_tenant_id
      AND status = 'foreclosed' AND foreclosure_notes = 'Auto-foreclosed on F&F settlement payment'
  LOOP
    INSERT INTO fnf_payment_correction_log (
      tenant_id, separation_ff_summary_id, employee_id, correction_type,
      original_data, reason, recovery_reference, created_by
    ) VALUES (
      p_tenant_id, v_ff.id, p_employee_id, 'loan_reverted',
      jsonb_build_object(
        'loan_id', v_loan.id, 'foreclosure_amount', v_loan.foreclosure_amount,
        'outstanding_balance_at_correction', v_loan.outstanding_balance,
        'foreclosed_at', v_loan.foreclosed_at, 'foreclosure_notes', v_loan.foreclosure_notes
      ),
      p_reason, p_recovery_reference, p_user_id
    );

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

  -- ── Advances ─────────────────────────────────────────────────────────────
  FOR v_arec IN
    SELECT id, advance_id, schedule_id, employee_id, payroll_run_id, recovery_month, amount, recovery_type, notes, created_by, created_at
    FROM advance_recoveries
    WHERE employee_id = p_employee_id AND tenant_id = p_tenant_id
      AND recovery_type = 'adjustment' AND notes = 'Auto-recovered on F&F settlement payment'
  LOOP
    -- Durable audit BEFORE delete — captures the exact "payment linkage"
    -- (advance_id, schedule_id, payroll_run_id, amount, recovery_month)
    -- a deleted advance_recoveries row would otherwise take with it.
    INSERT INTO fnf_payment_correction_log (
      tenant_id, separation_ff_summary_id, employee_id, correction_type,
      original_data, reason, recovery_reference, created_by
    ) VALUES (
      p_tenant_id, v_ff.id, p_employee_id, 'advance_recovery_deleted',
      jsonb_build_object(
        'advance_recoveries_id', v_arec.id, 'advance_id', v_arec.advance_id,
        'schedule_id', v_arec.schedule_id, 'payroll_run_id', v_arec.payroll_run_id,
        'recovery_month', v_arec.recovery_month, 'amount', v_arec.amount,
        'recovery_type', v_arec.recovery_type, 'notes', v_arec.notes,
        'original_created_by', v_arec.created_by, 'original_created_at', v_arec.created_at
      ),
      p_reason, p_recovery_reference, p_user_id
    );

    IF v_arec.schedule_id IS NOT NULL THEN
      UPDATE advance_recovery_schedules
      SET    status = 'pending', recovered_at = NULL
      WHERE  id = v_arec.schedule_id AND tenant_id = p_tenant_id AND status = 'recovered';
    END IF;

    -- advance_recoveries is NOT append-only (migration 281's UNIQUE(tenant_id,
    -- schedule_id) + amount>=0 forbid a mirror row — see 451's header); the
    -- INSERT above is what makes this delete durably auditable instead of a
    -- silent loss of the row's original values.
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

  -- ── Leave balance ────────────────────────────────────────────────────────
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

    INSERT INTO fnf_payment_correction_log (
      tenant_id, separation_ff_summary_id, employee_id, correction_type,
      original_data, reason, recovery_reference, created_by
    ) VALUES (
      p_tenant_id, v_ff.id, p_employee_id, 'leave_balance_credited',
      jsonb_build_object(
        'leave_balance_ledger_id', v_elb.id, 'leave_type_id', v_elb.leave_type_id,
        'year', v_elb.year, 'days_credited_back', v_elb.credit_back
      ),
      p_reason, p_recovery_reference, p_user_id
    );
  END LOOP;

  UPDATE separation_ff_summary
  SET    status = 'draft', paid_by = NULL, paid_at = NULL,
         updated_by = p_user_id, updated_at = v_now,
         correction_reason = p_reason, recovery_reference = p_recovery_reference,
         corrected_by = p_user_id, corrected_at = v_now
  WHERE  id = v_ff.id AND tenant_id = p_tenant_id;

  RETURN jsonb_build_object(
    'id', v_ff.id, 'status', 'draft',
    'loans_reverted', v_loans_reverted,
    'advances_reverted', v_advances_reverted,
    'reason', p_reason, 'recovery_reference', p_recovery_reference
  );
END;
$$;

ALTER FUNCTION correct_fnf_payment_atomic(UUID, UUID, UUID, TEXT, TEXT) SET search_path = public;
REVOKE EXECUTE ON FUNCTION correct_fnf_payment_atomic(UUID, UUID, UUID, TEXT, TEXT) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION correct_fnf_payment_atomic(UUID, UUID, UUID, TEXT, TEXT) TO service_role;

ALTER TABLE separation_ff_summary ADD COLUMN IF NOT EXISTS recovery_reference TEXT;
