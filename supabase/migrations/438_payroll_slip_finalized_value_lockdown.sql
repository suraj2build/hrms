-- ============================================================
-- 438_payroll_slip_finalized_value_lockdown.sql
--
-- Closes a gap found while auditing keyset pagination (fetchAllRowsByKeyset,
-- see apps/api/src/lib/supabase-paginate.ts): keyset pagination prevents a
-- multi-page financial read from skipping or duplicating ROWS under
-- concurrent insert/delete, but it does NOT make that read a consistent
-- point-in-time snapshot. If a row already returned on an earlier page has
-- one of its financial columns changed by a concurrent UPDATE before a later
-- page is read, the aggregate total mixes pre- and post-update values —
-- wrong, and not detectable from the row count alone.
--
-- 263_payroll_finalization_lockdown.sql already established "finalized slips
-- cannot be deleted" as a hard DB floor. It did NOT extend that floor to
-- UPDATE of a finalized slip's financial columns — current application code
-- happens to never do this (the only UPDATE call site on payroll_slips in
-- apps/api/src/routes/payroll/runs.ts is gated `.eq('status', 'draft')`), but
-- that is an application-level convention, not a DB-enforced invariant, so a
-- future code path or an ad-hoc query could silently violate it and
-- reintroduce the exact read-inconsistency this migration closes.
--
-- This makes "finalized" a true immutability boundary for the columns that
-- feed statutory wage-base reads (ESI/EPF/PTax contributions, TDS actual-TDS,
-- statutory-recon payable queries — all migrated to fetchAllRowsByKeyset in
-- this round): once a slip is finalized, multi-page reads filtered to
-- status = 'finalized' are reading values that cannot change underneath
-- them, closing the value-mutation gap keyset pagination itself does not
-- close. It does not make an in-flight DRAFT read consistent — only
-- finalized reads, which is what every migrated statutory query filters on.
--
-- Scope mirrors 263's break-glass model exactly: the legitimate path to
-- correct a finalized slip is rollback (super_admin, flips status to
-- 'draft' FIRST), then edit, then re-finalize. A status-only transition
-- (e.g. draft -> finalized at finalize time) is never blocked by this
-- trigger — only a change to a financial column while status stays
-- 'finalized' on both sides of the UPDATE.
-- ============================================================

CREATE OR REPLACE FUNCTION fn_block_finalized_payroll_slip_value_update()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.status = 'finalized' AND NEW.status = 'finalized' THEN
    IF NEW.gross_pay              IS DISTINCT FROM OLD.gross_pay
    OR NEW.net_pay                IS DISTINCT FROM OLD.net_pay
    OR NEW.lop_amount             IS DISTINCT FROM OLD.lop_amount
    OR NEW.lop_days               IS DISTINCT FROM OLD.lop_days
    OR NEW.payable_days           IS DISTINCT FROM OLD.payable_days
    OR NEW.overtime_hours         IS DISTINCT FROM OLD.overtime_hours
    OR NEW.total_deductions       IS DISTINCT FROM OLD.total_deductions
    OR NEW.tds_deducted           IS DISTINCT FROM OLD.tds_deducted
    OR NEW.employer_contributions IS DISTINCT FROM OLD.employer_contributions
    OR NEW.component_breakdown    IS DISTINCT FROM OLD.component_breakdown
    THEN
      RAISE EXCEPTION
        'PAYROLL_FINALIZED: slip % (employee %) is finalized — financial columns cannot be updated in place', OLD.id, OLD.employee_id
        USING ERRCODE = 'check_violation',
              HINT    = 'Roll the run back to draft (super_admin) before correcting a finalized slip, then re-finalize.';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_block_finalized_payroll_slip_value_update ON payroll_slips;
CREATE TRIGGER trg_block_finalized_payroll_slip_value_update
  BEFORE UPDATE ON payroll_slips
  FOR EACH ROW
  EXECUTE FUNCTION fn_block_finalized_payroll_slip_value_update();
