-- ============================================================
-- 426_separation_access_auto_revoke.sql
--
-- Fresh-audit F3 — no scheduled job catches on_notice employees past their
-- last_working_date while clearance/F&F lags: today, auth revocation only
-- happens at the manual "relieve" step (separation-workflow.ts), which is
-- gated on clearance_done AND F&F paid. If either drags past the employee's
-- actual last working date, the employee keeps full live login access for
-- as long as HR takes to finish paperwork — no automatic backstop exists.
--
-- Adds a nullable marker column so the new scheduled scan
-- (notice-overdue-scanner.ts) can record when it auto-revoked access for a
-- given separation record, keeping the scan idempotent (never re-revokes an
-- already-handled row, and any tick that finds the column already set skips
-- it without a redundant auth call).
-- ============================================================

ALTER TABLE employee_separation
  ADD COLUMN IF NOT EXISTS access_auto_revoked_at TIMESTAMPTZ;

COMMENT ON COLUMN employee_separation.access_auto_revoked_at IS
  'Set once by the notice-overdue scheduled scan when it auto-revokes login access for an on_notice employee whose last_working_date has passed but clearance/relieving is not yet complete. NULL until that happens; never cleared automatically.';
