-- ============================================================
-- 263_payroll_finalization_lockdown.sql
--
-- PI-1: Payroll Finalization Lockdown (closes audit findings C1, C2).
--
-- Finding C1: a finalized payroll run had NO write protection. The
-- POST /payroll/runs path upserts the run to 'processing', deletes all
-- slips, and recomputes — its only guard checked payroll_freeze_log, NOT
-- the run's finalized status. So re-running a finalized-but-unfrozen month
-- silently overwrote audited slips with new figures.
--
-- These triggers are the hard floor that no code path (route, service, or
-- ad-hoc query) can bypass. The application layer adds a clean 409 on top.
--
-- Scope is deliberately surgical so the LEGITIMATE break-glass paths keep
-- working:
--   • rollback  : finalized → draft     (super_admin) — allowed
--   • reopen    : finalized → reopened   (super_admin) — allowed
--   • freeze    : finalized → frozen                   — allowed
--   • snapshot/metadata writes that keep status='finalized'        — allowed
-- What is blocked is the destructive overwrite:
--   • finalized → processing  (the re-run upsert)      — BLOCKED
--   • DELETE of a finalized run                        — BLOCKED
--   • DELETE of slips belonging to a finalized run     — BLOCKED
-- (The rollback handler is reordered to flip the run to 'draft' BEFORE
--  deleting its slips, so the slip trigger permits that deletion.)
-- ============================================================

-- ── Run-level guard ────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION fn_block_finalized_payroll_run_mutation()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.status = 'finalized' THEN
      RAISE EXCEPTION
        'PAYROLL_FINALIZED: payroll run % is finalized and cannot be deleted', OLD.id
        USING ERRCODE = 'check_violation',
              HINT    = 'Roll the run back (super_admin) before removing it.';
    END IF;
    RETURN OLD;
  END IF;

  -- UPDATE: block only the re-run transition that would enable an overwrite.
  IF OLD.status = 'finalized' AND NEW.status = 'processing' THEN
    RAISE EXCEPTION
      'PAYROLL_FINALIZED: run % is finalized and cannot be reset to processing / re-run', OLD.id
      USING ERRCODE = 'check_violation',
            HINT    = 'Use the rollback flow (super_admin) to reopen a finalized run before reprocessing.';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_block_finalized_payroll_run_mutation ON payroll_runs;
CREATE TRIGGER trg_block_finalized_payroll_run_mutation
  BEFORE UPDATE OR DELETE ON payroll_runs
  FOR EACH ROW
  EXECUTE FUNCTION fn_block_finalized_payroll_run_mutation();

-- ── Slip-level guard ───────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION fn_block_finalized_payroll_slip_delete()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE
  v_run_status TEXT;
BEGIN
  SELECT status INTO v_run_status FROM payroll_runs WHERE id = OLD.run_id;
  IF v_run_status = 'finalized' THEN
    RAISE EXCEPTION
      'PAYROLL_FINALIZED: slips of finalized payroll run % cannot be deleted', OLD.run_id
      USING ERRCODE = 'check_violation',
            HINT    = 'Roll the run back (super_admin) — which resets it to draft — before removing its slips.';
  END IF;
  RETURN OLD;
END;
$$;

DROP TRIGGER IF EXISTS trg_block_finalized_payroll_slip_delete ON payroll_slips;
CREATE TRIGGER trg_block_finalized_payroll_slip_delete
  BEFORE DELETE ON payroll_slips
  FOR EACH ROW
  EXECUTE FUNCTION fn_block_finalized_payroll_slip_delete();
