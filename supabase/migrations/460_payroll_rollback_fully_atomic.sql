-- ============================================================
-- 460_payroll_rollback_fully_atomic.sql
--
-- SYSTEM_AUDIT_2026-10-14 item 2 (payroll rollback transactionality).
--
-- rollback_payroll_run_atomic (migration 452) locks the payroll_runs row,
-- re-validates (processing guard, authorization, posted-ledger check,
-- filed-statutory check) and flips status to 'draft' — all inside one
-- transaction, and RETURNS. Everything else the rollback is actually
-- supposed to do happens AFTER that transaction has already committed, as
-- separate, uncoordinated calls from the route handler
-- (POST /payroll/runs/:id/rollback in apps/api/src/routes/payroll/runs.ts):
-- deleting the run's payroll_slips, resyncing payroll_runs' now-phantom
-- totals, reverting any leave-encashment request this run had marked
-- 'paid' back to 'approved', deleting the run's never-posted GL ledgers
-- (entries, then cost allocations, then the ledger headers), and archiving
-- the pre-rollback finalized snapshot. If the process crashes or the pod
-- is killed between the RPC's commit and ANY of these steps — or between
-- any two of them — the run is left in status='draft' (looks rolled back)
-- with a torn, inconsistent remainder of the old 'finalized' state still
-- attached to it: still-existing slips on a "rolled back" run, phantom
-- totals, a leave-encashment request still marked 'paid' for a run that no
-- longer has the slip that supposedly paid it (a real financial-correctness
-- gap, not a cosmetic one), orphaned draft ledgers pointing at slips that
-- no longer exist, or a stale replayable=true snapshot that a later
-- self-heal/replay path could mistake for still-valid finalized-era data.
--
-- Fix: pull every one of those steps INTO rollback_payroll_run_atomic's own
-- transaction. All of them operate on data scoped to this ONE run (this
-- run's slips, this run's ledgers, this run's own snapshot, and whatever
-- encashment requests THIS run's own id is attached to) — unlike the
-- accrual engine's cross-tenant batch problem (migration 459), there is no
-- scale reason to chunk this across multiple transactions; a single run's
-- slip count is bounded by that one tenant's headcount, not every tenant's.
-- Either the whole rollback completes — draft status, slips gone, totals
-- zeroed, encashments reverted, ledgers cleaned, snapshot archived — or
-- NONE of it does, and the run is left exactly as it was (still
-- 'finalized', nothing touched), which is always safe to retry.
--
-- Freeze-lift (unfreezing the run's month if it was frozen) is
-- DELIBERATELY left outside this function and stays a separate step in the
-- route, same as before: it is period-lock state, not financial data, its
-- own guard (checkFreezeGuard) already treats re-checking/re-lifting as
-- safe to retry, and it is not one of the four things this audit item
-- named (slips, totals, encashments, ledgers).
-- ============================================================

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
    'unposted_ledgers_cleaned', coalesce(array_length(v_unposted_ledger_ids, 1), 0)
  );
END;
$$;

ALTER FUNCTION rollback_payroll_run_atomic(UUID, UUID, BOOLEAN) SET search_path = public;
REVOKE EXECUTE ON FUNCTION rollback_payroll_run_atomic(UUID, UUID, BOOLEAN) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION rollback_payroll_run_atomic(UUID, UUID, BOOLEAN) TO service_role;
