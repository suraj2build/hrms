-- ============================================================
-- 287_leave_applications_working_days.sql
--
-- LEAVE P1-2 — the ESS leave page recomputed leave duration from raw calendar
-- dates (to_date − from_date + 1), ignoring half-days, holidays and weekly-offs,
-- so the employee-facing "days taken/pending" disagreed with the authoritative
-- deducted balance. The frontend has no way to compute the roster-aware figure;
-- the server must supply it.
--
-- Adds a nullable working_days column to leave_applications. It is populated by
-- the duration engine (computeWorkingLeaveDays) at creation and refreshed on
-- approval. Old rows stay NULL and the UI falls back to the calendar-day estimate
-- for those only.
-- ============================================================

ALTER TABLE leave_applications
  ADD COLUMN IF NOT EXISTS working_days DECIMAL(5,1) NULL;
