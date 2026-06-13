-- ============================================================
-- 245_deductor_tan.sql
--
-- P2.4 (Form 24Q MVP) — capture the deductor's TAN and PAN, required for the
-- Form 24Q return header. Additive columns on the EXISTING tenant statutory
-- settings table (no new compliance table). Idempotent.
-- ============================================================

ALTER TABLE payroll_statutory_settings
  ADD COLUMN IF NOT EXISTS deductor_tan TEXT,
  ADD COLUMN IF NOT EXISTS deductor_pan TEXT;
