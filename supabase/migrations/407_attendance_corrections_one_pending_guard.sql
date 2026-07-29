-- ============================================================
-- 407_attendance_corrections_one_pending_guard.sql
--
-- POST /attendance/corrections checks "is there already a pending correction
-- for this employee+date?" via a plain SELECT count, then INSERTs — two
-- separate steps with no DB-level guard. Two concurrent submissions for the
-- same employee+date (double-click, retried client request) can both pass
-- the count check before either INSERT commits, producing two pending
-- corrections for the same date that can each independently be approved
-- later, double-processing/clobbering attendance for that day.
--
-- Same fix pattern as migration 401 (attendance_policies one-default guard):
-- a partial unique index lets the route catch a real 23505 on the second
-- INSERT instead of relying on a racy read-then-write check.
-- ============================================================

CREATE UNIQUE INDEX IF NOT EXISTS idx_attendance_corrections_one_pending
  ON attendance_corrections (tenant_id, employee_id, date)
  WHERE status = 'pending';
