-- SYSTEM_AUDIT_2026-10-14 — extends rollback_payroll_run_atomic (migration
-- 460) to also revert arrears/variable-pay/payroll-adjustments that this
-- run had flipped to their terminal state, in the SAME transaction as the
-- existing leave-encashment revert — a 'processed'/'applied' row only
-- became that because THIS run finalized; rolling the run back to draft
-- means it is no longer actually paid/applied, so it reverts to its
-- pre-finalize status (still assigned to this run — the next regeneration
-- picks it up again), exactly like fn_revert_leave_encashments_for_rollback
-- already does.
--
-- CREATE OR REPLACE with the same signature/return shape (JSONB) — this is
-- the exact same function, just with three more revert calls added to its
-- existing "every step is part of the SAME transaction" section.

CREATE OR REPLACE FUNCTION rollback_payroll_run_atomic(
  p_tenant_id         UUID,
  p_run_id            UUID,
  p_is_super_admin    BOOLEAN
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_run                RECORD;
  v_posted_ledger      UUID;
  v_filed_statutes     TEXT;
  v_unposted_ledger_ids UUID[];
  v_encashments_reverted INT := 0;
  v_arrears_reverted      INT := 0;
  v_variable_pay_reverted INT := 0;
  v_adjustments_reverted  INT := 0;
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

  -- From here on, every step is part of the SAME transaction as the status
  -- flip below — either all of it commits together, or (on any exception)
  -- none of it does and the run is left exactly as found above.

  UPDATE payroll_runs
  SET    status = 'draft', finalized_at = NULL, error_message = NULL, failure_summary = NULL,
         total_gross = 0, total_deductions = 0, total_net = 0, total_lop_amount = 0, employee_count = 0,
         snapshot_id = NULL
  WHERE  id = p_run_id AND tenant_id = p_tenant_id;

  -- Never-posted ledgers ('draft'/'balanced') carry no live accounting fact
  -- — staging artifacts that would otherwise point at slips about to be
  -- deleted and keep counting toward the liability dashboard for a run no
  -- longer in that state. 'reversed' ledgers are left alone (already
  -- neutralized, and are the historical record of what was reversed). The
  -- checks above already proved no 'posted', non-reversal ledger exists.
  SELECT array_agg(id) INTO v_unposted_ledger_ids
  FROM payroll_financial_ledgers
  WHERE tenant_id = p_tenant_id AND run_id = p_run_id
    AND ledger_status IN ('draft', 'balanced');

  IF v_unposted_ledger_ids IS NOT NULL THEN
    -- Entries and cost allocations first — both FK payroll_financial_ledgers(id)
    -- with no cascade, so the header delete would otherwise fail.
    DELETE FROM payroll_ledger_entries WHERE ledger_id = ANY(v_unposted_ledger_ids);
    DELETE FROM payroll_cost_allocations WHERE ledger_id = ANY(v_unposted_ledger_ids);
    DELETE FROM payroll_financial_ledgers WHERE id = ANY(v_unposted_ledger_ids) AND tenant_id = p_tenant_id;
  END IF;

  -- Now delete the slips — the parent run's status was just set to 'draft'
  -- above, in THIS transaction, so trg_block_finalized_payroll_slip_delete's
  -- own fresh SELECT of payroll_runs.status (migration 263) sees 'draft'
  -- and permits it, exactly as it did when the route did these as two
  -- separate round trips — the only difference is there is no longer a gap
  -- between them a crash could land in.
  DELETE FROM payroll_slips WHERE run_id = p_run_id AND tenant_id = p_tenant_id;

  -- G12: a 'paid' leave-encashment request only became 'paid' because THIS
  -- run finalized — rolling the run back to draft means it is no longer
  -- actually paid, so revert it to 'approved' (still assigned to this run —
  -- the next regeneration picks it up fresh again).
  v_encashments_reverted := fn_revert_leave_encashments_for_rollback(p_tenant_id, p_run_id);

  -- SYSTEM_AUDIT_2026-10-14: same reasoning, for the three subsystems
  -- that previously never reached a payslip at all.
  v_arrears_reverted      := fn_revert_arrears_for_rollback(p_tenant_id, p_run_id);
  v_variable_pay_reverted := fn_revert_variable_pay_for_rollback(p_tenant_id, p_run_id);
  v_adjustments_reverted  := fn_revert_payroll_adjustments_for_rollback(p_tenant_id, p_run_id);

  -- Archive the pre-rollback finalized snapshot rather than leave it
  -- dangling: it is still marked replayable=true, which would let a
  -- self-heal/replay path treat deleted-slip-era data as still valid.
  -- payroll_runs.snapshot_id was already cleared in the UPDATE above.
  UPDATE payroll_run_snapshots SET replayable = false WHERE run_id = p_run_id AND tenant_id = p_tenant_id;

  RETURN jsonb_build_object(
    'run_id', p_run_id,
    'month', v_run.month,
    'status', 'draft',
    'encashments_reverted', v_encashments_reverted,
    'arrears_reverted', v_arrears_reverted,
    'variable_pay_reverted', v_variable_pay_reverted,
    'adjustments_reverted', v_adjustments_reverted,
    'unposted_ledgers_cleaned', coalesce(array_length(v_unposted_ledger_ids, 1), 0)
  );
END;
$$;

ALTER FUNCTION rollback_payroll_run_atomic(UUID, UUID, BOOLEAN) SET search_path = public;
REVOKE EXECUTE ON FUNCTION rollback_payroll_run_atomic(UUID, UUID, BOOLEAN) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION rollback_payroll_run_atomic(UUID, UUID, BOOLEAN) TO service_role;
