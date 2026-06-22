-- Migration 298: Notice period by grade + per-separation override / waiver
--
-- Adds a grade-level notice period (config reference) and lets HR override the
-- notice period or waive the notice-shortfall deduction on a specific
-- separation (buyout / waiver). The FnF engine honours both.

ALTER TABLE grades
  ADD COLUMN IF NOT EXISTS notice_period_days INT;

ALTER TABLE employee_separation
  ADD COLUMN IF NOT EXISTS notice_period_days_override INT,
  ADD COLUMN IF NOT EXISTS notice_waived               BOOLEAN NOT NULL DEFAULT false;
