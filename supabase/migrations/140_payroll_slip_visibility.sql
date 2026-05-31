-- ============================================================
-- 140_payroll_slip_visibility.sql
--
-- Payroll slip visibility pipeline repairs.
--
-- Changes:
--   1. payroll_slips — add `warning TEXT` to persist engine warnings
--      (previously lost after computation; frontend shows them but they
--       were never populated from DB)
--
--   2. payroll_runs  — add `partial_failed` status for runs where some
--      employees succeeded but others failed (distinct from `failed`
--      which means zero employees succeeded)
--
--   3. payroll_runs  — fix `pr_hr_all` RLS policy to include tenant_id
--      (previously allowed hr_admin to see any tenant's runs)
--
--   4. payroll_slips — fix `ps_hr_all` RLS policy to include tenant_id
--      (previously allowed hr_admin to see any tenant's slips)
--
-- ============================================================

-- ── 1. Add warning column to payroll_slips ───────────────────────────────────

ALTER TABLE payroll_slips
  ADD COLUMN IF NOT EXISTS warning TEXT;

COMMENT ON COLUMN payroll_slips.warning IS
  'Human-readable operator warning from the payroll engine computation, '
  'e.g. "No attendance data found — full pay assumed (0 LOP)". '
  'NULL means no warning was produced for this employee this month.';

-- ── 2. Add partial_failed to payroll_runs.status ─────────────────────────────
--
-- partial_failed: some employees computed successfully and have slips;
--   others failed (see payroll_run_events for per-employee details).
--   The run is still reviewable and finalizable (just for succeeded slips).
--
-- This is distinct from failed (zero employees succeeded — no slips created).

-- Postgres requires DROP + ADD to change a check constraint
ALTER TABLE payroll_runs
  DROP CONSTRAINT IF EXISTS payroll_runs_status_check;

ALTER TABLE payroll_runs
  ADD CONSTRAINT payroll_runs_status_check
  CHECK (status IN ('draft', 'processing', 'finalized', 'failed', 'partial_failed'));

COMMENT ON COLUMN payroll_runs.status IS
  'draft: computed, all employees succeeded, ready for finalization. '
  'partial_failed: computed, some employees failed — see payroll_run_events. '
  'processing: currently running. '
  'finalized: locked for payroll disbursement. '
  'failed: all employees failed — no slips created.';

-- ── 3. Fix pr_hr_all RLS policy — add tenant_id guard ───────────────────────

DROP POLICY IF EXISTS "pr_hr_all" ON payroll_runs;
CREATE POLICY "pr_hr_all" ON payroll_runs FOR ALL
  USING (
    tenant_id = get_user_tenant_id()
    AND get_user_role() IN ('super_admin', 'hr_admin')
  );

-- ── 4. Fix ps_hr_all RLS policy — add tenant_id guard ───────────────────────

DROP POLICY IF EXISTS "ps_hr_all" ON payroll_slips;
CREATE POLICY "ps_hr_all" ON payroll_slips FOR ALL
  USING (
    tenant_id = get_user_tenant_id()
    AND get_user_role() IN ('super_admin', 'hr_admin')
  );

-- Employee read policy is already correct (tenant_id + status = finalized)
-- Reproducing here for clarity — no change needed, but re-declare idempotently.
DROP POLICY IF EXISTS "ps_emp_read" ON payroll_slips;
CREATE POLICY "ps_emp_read" ON payroll_slips FOR SELECT
  USING (
    tenant_id = get_user_tenant_id()
    AND status = 'finalized'
    AND employee_id IN (
      SELECT employee_id FROM profiles WHERE id = auth.uid()
    )
  );
