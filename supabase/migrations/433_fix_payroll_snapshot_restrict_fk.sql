-- ============================================================
-- 433_fix_payroll_snapshot_restrict_fk.sql
--
-- Third tenant-hard-delete blocker found via live testing:
--   ERROR: update or delete on table "payroll_run_snapshots" violates
--   foreign key constraint "payroll_runs_snapshot_id_fkey" on table
--   "payroll_runs"
--
-- Different shape from 431/432 — this one is a deliberate ON DELETE
-- RESTRICT (migration 145), not a missing action. It protects a payroll
-- run's snapshot manifest from being deleted while the run still points at
-- it. But payroll_runs.tenant_id already cascades directly from tenants
-- (migration 074), and payroll_run_snapshots.tenant_id already cascades
-- from tenants too (migration 196) — so during a tenant delete, BOTH rows
-- are being removed in the same statement regardless; the RESTRICT here
-- only gets in the way of that, it doesn't protect anything a tenant wipe
-- needs protecting.
--
-- Verified no application code ever deletes payroll_run_snapshots rows
-- directly (grepped apps/api/src for it) — so this RESTRICT was never
-- actually exercised as a safety net against a live code path; it only
-- fires during a full tenant delete. Safe to relax to CASCADE: a payroll
-- run is meaningless without its snapshot manifest anyway, so if the
-- snapshot is ever removed for real (today, that only happens via the
-- tenant cascade), the run should go with it.
-- ============================================================

DO $$
DECLARE v_conname TEXT;
BEGIN
  SELECT con.conname INTO v_conname
  FROM pg_constraint con
  JOIN pg_class rel ON rel.oid = con.conrelid
  JOIN pg_class frel ON frel.oid = con.confrelid
  JOIN pg_attribute att ON att.attrelid = con.conrelid AND att.attnum = con.conkey[1]
  WHERE con.contype = 'f' AND rel.relname = 'payroll_runs'
    AND frel.relname = 'payroll_run_snapshots' AND att.attname = 'snapshot_id'
    AND array_length(con.conkey, 1) = 1;
  IF v_conname IS NOT NULL THEN
    EXECUTE format('ALTER TABLE payroll_runs DROP CONSTRAINT %I', v_conname);
  END IF;
  ALTER TABLE payroll_runs
    ADD CONSTRAINT payroll_runs_snapshot_id_fkey
    FOREIGN KEY (snapshot_id) REFERENCES payroll_run_snapshots(id) ON DELETE CASCADE;
END $$;
