-- 238_declaration_window.sql
-- Adds declaration window open/close dates to payroll_statutory_settings.
-- HR sets these dates to control when employees can add/update declarations.

ALTER TABLE payroll_statutory_settings
  ADD COLUMN IF NOT EXISTS declaration_window_open  DATE,
  ADD COLUMN IF NOT EXISTS declaration_window_close DATE;
