-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 378 — Heartbeat column for payroll_runs
--
-- Adds last_heartbeat_at to payroll_runs so zombie-detection queries can
-- distinguish a live run from a crashed-but-stuck one.
--
-- executePayrollRun() writes this timestamp every 30 seconds during processing.
-- A run with status='processing' and last_heartbeat_at older than ~5 minutes
-- (2× the heartbeat interval with slack) can be treated as a zombie and
-- surfaced via the GET /payroll/runs/:id response or an ops cron.
--
-- Rollback:
--   ALTER TABLE payroll_runs DROP COLUMN IF EXISTS last_heartbeat_at;
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE payroll_runs
  ADD COLUMN IF NOT EXISTS last_heartbeat_at timestamptz;

-- Index for zombie-detection queries: WHERE status='processing' AND last_heartbeat_at < threshold
CREATE INDEX IF NOT EXISTS idx_payroll_runs_zombie_detect
  ON payroll_runs (status, last_heartbeat_at)
  WHERE status = 'processing';

COMMENT ON COLUMN payroll_runs.last_heartbeat_at IS
  'Updated every ~30 s by executePayrollRun() during active processing. '
  'A processing run with a stale heartbeat (> 5 min old) is a zombie candidate — '
  'the durable-queue crash-recovery will re-queue the job on next process start.';
